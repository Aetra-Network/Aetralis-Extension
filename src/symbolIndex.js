'use strict';
const vscode = require('vscode');

// ---------------------------------------------------------------------------
// Symbol index — a single regex pass per document, no AST. Powers hover
// (struct/enum field lists, function signatures), completion (user symbols
// alongside builtins), "go to definition", and the "unknown function"
// diagnostic. Rebuilt per document on open/change (debounced) and merged
// across every known document so cross-file `import`ed declarations
// (e.g. token_shared.atlx) resolve too.
// ---------------------------------------------------------------------------

/** Masks strings and comments with spaces, preserving offsets. */
function maskNonCode(text) {
  const out = text.split('');
  let i = 0;
  const n = text.length;
  let mode = 'code';
  while (i < n) {
    const c = text[i];
    if (mode === 'code') {
      if (c === '"') { mode = 'str'; out[i] = ' '; }
      else if (c === '/' && text[i + 1] === '/') { mode = 'line'; out[i] = ' '; }
      else if (c === '/' && text[i + 1] === '*') { mode = 'block'; out[i] = ' '; }
    } else if (mode === 'str') {
      if (c === '\\') { out[i] = ' '; i++; if (i < n && text[i] !== '\n') out[i] = ' '; }
      else if (c === '"') { out[i] = ' '; mode = 'code'; }
      else if (c !== '\n') out[i] = ' ';
    } else if (mode === 'line') {
      if (c === '\n') mode = 'code';
      else out[i] = ' ';
    } else if (mode === 'block') {
      if (c === '*' && text[i + 1] === '/') { out[i] = ' '; i++; out[i] = ' '; mode = 'code'; }
      else if (c !== '\n') out[i] = ' ';
    }
    i++;
  }
  return out.join('');
}

function lineColOf(text, offset) {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') { line++; lastNewline = i; }
  }
  return { line, character: offset - lastNewline - 1 };
}

function parseStructFields(body) {
  const fields = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_<>?,\s]*?)(?=[,\n]|$)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    fields.push({ name: m[1], type: m[2].trim() });
  }
  return fields;
}

function parseEnumVariants(body) {
  const variants = [];
  // [ \t]* (not \s*) after the name: \s would also eat the newline plus the
  // next line's leading indentation, silently skipping the following
  // variant whenever it isn't parenthesized (e.g. a bare `Off` between two
  // other variants).
  const re = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*(\([^)]*\))?/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    variants.push({ name: m[1], params: m[2] ? m[2].slice(1, -1).trim() : '' });
  }
  return variants;
}

/** Builds a symbol index for one document's (masked) text. */
function indexSource(text, uri) {
  const index = {
    structs: new Map(),
    enums: new Map(),
    types: new Map(),
    functions: new Map(),
    methods: new Map(), // "Receiver.name" -> entry
    consts: new Map(),
    variables: new Map(),
    contracts: new Map(),
    enumVariants: new Set()
  };
  const loc = (offset, len) => {
    const start = lineColOf(text, offset);
    const end = lineColOf(text, offset + len);
    return new vscode.Location(
      uri,
      new vscode.Range(start.line, start.character, end.line, end.character)
    );
  };

  let m;
  const structRe = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  while ((m = structRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('struct'));
    index.structs.set(m[1], { name: m[1], fields: parseStructFields(m[2]), location: loc(nameOffset, m[1].length) });
  }

  const enumRe = /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  while ((m = enumRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('enum'));
    const variants = parseEnumVariants(m[2]);
    index.enums.set(m[1], { name: m[1], variants, location: loc(nameOffset, m[1].length) });
    for (const v of variants) index.enumVariants.add(v.name);
  }

  const typeRe = /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n;]+)/g;
  while ((m = typeRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('type'));
    index.types.set(m[1], { name: m[1], value: m[2].trim(), location: loc(nameOffset, m[1].length) });
  }

  const contractRe = /\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  while ((m = contractRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('contract'));
    index.contracts.set(m[1], { name: m[1], location: loc(nameOffset, m[1].length) });
  }

  const funcRe = /\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?\s*\(([^)]*)\)\s*(?:(?:->|:)\s*([A-Za-z_][A-Za-z0-9_<>?,\s]*?))?\s*\{/g;
  while ((m = funcRe.exec(text)) !== null) {
    const isMethod = !!m[2];
    const name = isMethod ? m[2] : m[1];
    const receiver = isMethod ? m[1] : null;
    const nameStartInMatch = isMethod ? m[0].lastIndexOf(name, m[0].indexOf('(')) : m[0].indexOf(name, m[0].indexOf('func'));
    const nameOffset = m.index + nameStartInMatch;
    const entry = {
      name, receiver, params: m[3].trim(), returnType: m[4] ? m[4].trim() : '',
      location: loc(nameOffset, name.length)
    };
    if (isMethod) {
      index.methods.set(receiver + '.' + name, entry);
      if (!index.functions.has(name)) index.functions.set(name, entry);
    } else {
      index.functions.set(name, entry);
    }
  }

  const constRe = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g;
  while ((m = constRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('const'));
    if (!index.consts.has(m[1])) {
      index.consts.set(m[1], { name: m[1], value: m[2].trim().replace(/[{,].*$/, '').trim(), location: loc(nameOffset, m[1].length) });
    }
  }

  // Mutable local bindings — same shape as `const` above, kept separate so
  // hover/completion/definition can label them distinctly (`var` vs `const`).
  const varRe = /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g;
  while ((m = varRe.exec(text)) !== null) {
    const nameOffset = m.index + m[0].indexOf(m[1], m[0].indexOf('var'));
    if (!index.variables.has(m[1])) {
      index.variables.set(m[1], { name: m[1], value: m[2].trim().replace(/[{,].*$/, '').trim(), location: loc(nameOffset, m[1].length) });
    }
  }

  return index;
}

// Per-document cache, keyed by uri string. Merged lazily on lookup.
const docIndexCache = new Map();

function updateIndexFor(document) {
  if (document.languageId !== 'atlx') return;
  const text = maskNonCode(document.getText());
  docIndexCache.set(document.uri.toString(), indexSource(text, document.uri));
}

function mergedIndex(preferUri) {
  const merged = {
    structs: new Map(), enums: new Map(), types: new Map(), functions: new Map(),
    methods: new Map(), consts: new Map(), variables: new Map(), contracts: new Map(),
    enumVariants: new Set()
  };
  const uris = Array.from(docIndexCache.keys());
  // Put the current document last so its entries win on name collisions.
  if (preferUri) {
    const i = uris.indexOf(preferUri);
    if (i >= 0) { uris.splice(i, 1); uris.push(preferUri); }
  }
  for (const uri of uris) {
    const idx = docIndexCache.get(uri);
    for (const key of ['structs', 'enums', 'types', 'functions', 'methods', 'consts', 'variables', 'contracts']) {
      for (const [name, entry] of idx[key]) merged[key].set(name, entry);
    }
    for (const v of idx.enumVariants) merged.enumVariants.add(v);
  }
  return merged;
}

async function seedWorkspaceIndex() {
  try {
    const files = await vscode.workspace.findFiles('**/*.atlx', '**/node_modules/**', 500);
    for (const uri of files) {
      if (docIndexCache.has(uri.toString())) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = maskNonCode(Buffer.from(bytes).toString('utf8'));
        docIndexCache.set(uri.toString(), indexSource(text, uri));
      } catch (_e) { /* unreadable file, skip */ }
    }
  } catch (_e) { /* workspace scan unavailable, extension still works per-open-document */ }
}

module.exports = {
  maskNonCode,
  lineColOf,
  parseStructFields,
  parseEnumVariants,
  indexSource,
  docIndexCache,
  updateIndexFor,
  mergedIndex,
  seedWorkspaceIndex
};
