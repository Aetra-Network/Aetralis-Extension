'use strict';
const vscode = require('vscode');
const { HANDLERS, BANNED_WORDS, BUILTIN_FUNCTIONS, CONTROL_KEYWORDS_BEFORE_PAREN } = require('./constants');
const { maskNonCode, mergedIndex } = require('./symbolIndex');

// ---------------------------------------------------------------------------
// Diagnostics.
//   1) @internal/@external/@bounced — at most one per contract;
//   2) the annotated function must use its reserved name and signature;
//   3) reserved names cannot be used without the matching annotation;
//   4) legacy/removed words (slice, cell, let/val/mut bindings, package,
//      migrate, selector, ...) — not part of the language;
//   5) calls to names that are neither a builtin, nor declared in this file
//      or any known workspace file, nor an enum variant constructor.
// ---------------------------------------------------------------------------

function normalizeParams(p) {
  return p.replace(/\s+/g, '');
}

function computeDiagnostics(document) {
  const text = maskNonCode(document.getText());
  const diags = [];
  const push = (start, length, message, severity) => {
    const range = new vscode.Range(
      document.positionAt(start),
      document.positionAt(start + length)
    );
    diags.push(new vscode.Diagnostic(range, message, severity === undefined ? vscode.DiagnosticSeverity.Error : severity));
  };

  // Contract segment starts (for the "once per contract" rule).
  const contractStarts = [0];
  const contractRe = /\bcontract\s+[A-Za-z_]/g;
  let m;
  while ((m = contractRe.exec(text)) !== null) contractStarts.push(m.index);
  const segmentOf = (idx) => {
    let seg = 0;
    for (const s of contractStarts) { if (s <= idx) seg = s; else break; }
    return seg;
  };

  // Rule 1 + 2: walk handler annotations.
  const seen = new Map(); // key: segment + kind
  const annRe = /@(internal|external|bounced)\b/g;
  while ((m = annRe.exec(text)) !== null) {
    const kind = m[1];
    const handler = HANDLERS[kind];
    const key = segmentOf(m.index) + ':' + kind;
    if (seen.has(key)) {
      push(m.index, m[0].length, 'Only one @' + kind + ' handler is allowed per contract.');
    } else {
      seen.set(key, true);
    }

    // Look at the function that follows (bounded window; @external may carry args).
    const window = text.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const fn = window.match(/^\s*(?:\([^)\n]*\)\s*)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)\n]*)\)/);
    if (fn) {
      const nameOffset = m.index + m[0].length + fn[0].indexOf(fn[1], fn[0].indexOf('func'));
      if (fn[1] !== handler.name) {
        push(nameOffset, fn[1].length,
          'Expected function name `' + handler.name + '` for handler annotated with `@' + kind + '`.');
      } else if (normalizeParams(fn[2]) !== normalizeParams(handler.params)) {
        push(nameOffset, fn[1].length,
          kind + ' handler must be `func ' + handler.name + '(' + handler.params + ')`.');
      }
    }
  }

  // Rule 3: reserved names require the matching annotation.
  const reservedRe = /\bfunc\s+(onInternalMessage|onExternalMessage|onBouncedMessage)\b/g;
  while ((m = reservedRe.exec(text)) !== null) {
    const name = m[1];
    const kind = name === 'onInternalMessage' ? 'internal'
      : name === 'onExternalMessage' ? 'external' : 'bounced';
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    const lastAnn = before.match(/@([a-z]+)(?:\s*\([^)\n]*\))?\s*$/);
    if (!lastAnn || lastAnn[1] !== kind) {
      const nameOffset = m.index + m[0].indexOf(name);
      push(nameOffset, name.length,
        '`' + name + '` is a reserved message handler name and can only be used with `@' + kind + '`.');
    }
  }

  // Rule 4: legacy/removed words.
  const bannedRe = new RegExp('\\b(' + Object.keys(BANNED_WORDS).join('|') + ')\\b', 'g');
  while ((m = bannedRe.exec(text)) !== null) {
    push(m.index, m[1].length, '`' + m[1] + '` is ' + BANNED_WORDS[m[1]], vscode.DiagnosticSeverity.Warning);
  }
  // let/val/mut are only banned as a binding form (`let x = ...`), not as
  // arbitrary identifiers elsewhere — narrower pattern to avoid false flags.
  const bindingRe = /(^|[{};])\s*(let|val|mut)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/gm;
  while ((m = bindingRe.exec(text)) !== null) {
    const kwOffset = m.index + m[0].indexOf(m[2]);
    push(kwOffset, m[2].length, 'Local bindings must use `const` or `var` — `' + m[2] + '` is not part of the language.', vscode.DiagnosticSeverity.Warning);
  }

  // Rule 5: calls to unknown names.
  const index = mergedIndex(document.uri.toString());
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  while ((m = callRe.exec(text)) !== null) {
    const name = m[1];
    if (CONTROL_KEYWORDS_BEFORE_PAREN.has(name)) continue;
    if (BUILTIN_FUNCTIONS.has(name)) continue;
    if (index.enumVariants.has(name)) continue; // enum variant constructor, e.g. Deposit(amount: u64)
    // Receiver-style call (Type.method(...) or value.method(...)) — not
    // validated here; method existence checking would need real types.
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (before === '.') continue;
    // Annotation with an argument list, e.g. @message(0x1001), @external(inMsg: Segment)
    // — not a function call.
    if (before === '@') continue;
    // Declaration site, not a call: `func name(` / `func Type.name(`.
    const decl = text.slice(Math.max(0, m.index - 80), m.index);
    if (/\bfunc\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?$/.test(decl)) continue;
    if (index.functions.has(name) || index.methods.has(name)) continue;
    if (index.structs.has(name)) continue; // shouldn't normally be called, but not our concern here
    push(m.index, name.length,
      '`' + name + '` is not declared in this file or any known workspace file, and is not a recognized builtin.',
      vscode.DiagnosticSeverity.Warning);
  }

  return diags;
}

module.exports = { normalizeParams, computeDiagnostics };
