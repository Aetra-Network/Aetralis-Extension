'use strict';
const vscode = require('vscode');
const {
  SEND_MODE_DOCS,
  SEND_MODE_VALUES,
  SEND_MODE_COMBINE_NOTE,
  WORD_DOCS,
  ANNOTATION_DOCS,
  ANNOTATION_SNIPPETS,
  LANGUAGE_KEYWORDS,
  BUILTIN_FUNCTIONS,
  BUILD_MESSAGE_FIELDS,
  BUILD_MESSAGE_FIELD_DOCS,
  MAP_METHODS,
  INTEGER_TYPE_NAMES,
  INTEGER_TYPE_DOCS,
  MAP_TYPE_DOC,
  SEND_METHOD_DOC
} = require('./constants');
const { mergedIndex } = require('./symbolIndex');
const { renderStructHover, renderEnumHover, renderFunctionHover } = require('./hoverProvider');
const { md } = require('./markdown');

// ---------------------------------------------------------------------------
// Completion provider — static items, snippet expansion, plus live symbols.
// ---------------------------------------------------------------------------

// Everything below builds completion items purely from constants.js — the
// same ~80 items (send modes, buildMessage fields, Map methods, keywords,
// builtins, types), byte-for-byte identical, on every single call. VS Code
// re-invokes provideCompletionItems on close to every keystroke while typing
// an identifier, so without caching this was reconstructing that whole list
// (including a fresh vscode.MarkdownString per item) dozens of times a
// minute. None of it depends on the document or position, so it is built
// once, lazily, and reused; only the prefix filter and the live
// mergedIndex-derived symbols below are recomputed per call.
let cachedStaticItems = null;

function buildStaticItems() {
  const items = [];

  for (const [mode, doc] of Object.entries(SEND_MODE_DOCS)) {
    const item = new vscode.CompletionItem(mode, vscode.CompletionItemKind.EnumMember);
    item.documentation = md(['**' + mode + '** = `' + SEND_MODE_VALUES[mode] + '` — send mode.', '', doc, '', SEND_MODE_COMBINE_NOTE]);
    item.detail = 'send mode (' + SEND_MODE_VALUES[mode] + ')';
    item.sortText = '1' + mode;
    items.push(item);
  }

  const build = new vscode.CompletionItem('buildMessage', vscode.CompletionItemKind.Snippet);
  build.insertText = new vscode.SnippetString(
    'buildMessage({\n' +
    '    bounce: BounceMode.${1|Only256BitsOfBody,NoBounce|},\n' +
    '    amount: ${2:0},\n' +
    '    receiver: ${3:dest},\n' +
    '    body: ${4:MessageStruct} {\n' +
    '        $0\n' +
    '    }\n' +
    '})'
  );
  build.detail = 'Outbound message builder';
  build.documentation = md([
    'Canonical builder for outbound messages. Fields:',
    '- `receiver` — destination address (**required**);',
    '- `body` — typed `@message` struct literal (**required**);',
    '- `bounce` — `BounceMode.NoBounce` or `BounceMode.Only256BitsOfBody`;',
    '- `amount` — attached coins;',
    '- `mode` — optional send mode, a `+`-combination of `SEND_*` constants;',
    '- `textComment` — optional human-readable memo;',
    '- `opcode`, `queryId`, `stateInit` — advanced overrides.',
    '',
    'Send the result with `.send()`. The send mode lives only in `buildMessage({ ..., mode: ... })`.'
  ]);
  build.sortText = '0buildMessage';
  items.push(build);

  // buildMessage field keys — offered so `mode:` / `textComment:` and the
  // rest complete inside a `buildMessage({ ... })` literal. The static
  // diagnostics reject any key outside this exact set.
  for (const field of BUILD_MESSAGE_FIELDS) {
    const item = new vscode.CompletionItem(field, vscode.CompletionItemKind.Field);
    item.detail = 'buildMessage field';
    item.documentation = md(BUILD_MESSAGE_FIELD_DOCS[field] || '');
    item.insertText = new vscode.SnippetString(field + ': ${0}');
    item.sortText = '2' + field;
    items.push(item);
  }

  // Map<K,V> dictionary methods, offered after a receiver. `.set` / `.delete`
  // mutate and are rejected inside `@get` / `@pure` (see diagnostics).
  for (const [method, doc] of Object.entries(MAP_METHODS)) {
    const item = new vscode.CompletionItem(method, vscode.CompletionItemKind.Method);
    item.detail = 'Map method';
    item.documentation = md(['**Map.' + method + '** — dictionary method.', '', doc]);
    const takesArgs = method === 'get' || method === 'set' || method === 'has' || method === 'delete';
    const bounded = method === 'keys' || method === 'entries';
    item.insertText = new vscode.SnippetString(method + (bounded ? '(${1:255})' : takesArgs ? '($0)' : '()'));
    item.sortText = '3' + method;
    items.push(item);
  }

  const sendCall = new vscode.CompletionItem('send', vscode.CompletionItemKind.Snippet);
  sendCall.insertText = new vscode.SnippetString('send()');
  sendCall.detail = 'Send a built message';
  sendCall.documentation = md(SEND_METHOD_DOC);
  items.push(sendCall);

  for (const word of Object.keys(WORD_DOCS)) {
    // Builtin callables get their own Function-kind item below; buildMessage
    // already has a dedicated snippet above.
    if (BUILTIN_FUNCTIONS.has(word)) continue;
    const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
    item.documentation = md(WORD_DOCS[word]);
    items.push(item);
  }
  for (const word of LANGUAGE_KEYWORDS) {
    if (WORD_DOCS[word]) continue;
    const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
    item.detail = 'keyword';
    items.push(item);
  }
  for (const fn of BUILTIN_FUNCTIONS) {
    // buildMessage has a richer snippet above; `address` is offered as a type.
    if (fn === 'buildMessage' || fn === 'address') continue;
    const item = new vscode.CompletionItem(fn, vscode.CompletionItemKind.Function);
    item.detail = 'builtin function';
    if (WORD_DOCS[fn]) item.documentation = md(WORD_DOCS[fn]);
    item.insertText = new vscode.SnippetString(fn + '($0)');
    items.push(item);
  }
  for (const typ of [...INTEGER_TYPE_NAMES, 'coins', 'address', 'bool', 'string', 'bytes', 'Code', 'Segment', 'Chunk']) {
    const item = new vscode.CompletionItem(typ, vscode.CompletionItemKind.TypeParameter);
    item.detail = 'type';
    if (INTEGER_TYPE_DOCS[typ]) item.documentation = md(INTEGER_TYPE_DOCS[typ]);
    items.push(item);
  }
  const mapType = new vscode.CompletionItem('Map', vscode.CompletionItemKind.TypeParameter);
  mapType.detail = 'Map<K, V> — dictionary type';
  mapType.documentation = md(['**type Map<K, V>**', '', ...MAP_TYPE_DOC]);
  mapType.insertText = new vscode.SnippetString('Map<${1:uint64}, ${2:uint64}>');
  items.push(mapType);

  return items;
}

const completionProvider = {
  provideCompletionItems(document, position) {
    const line = document.lineAt(position.line).text.slice(0, position.character);

    // What's actually been typed so far at the cursor (e.g. "walletAddr" out
    // of "walletAddressFor"). Everything built below is filtered down to
    // this prefix before being returned — without it, VS Code receives every
    // keyword, type, send mode, and workspace symbol on every keystroke and
    // has to fuzzy-match its way to the one you meant, which is exactly what
    // produces a long, noisy, seemingly-irrelevant suggestion list. An empty
    // prefix (completion invoked on blank space, e.g. Ctrl+Space) still
    // returns everything, unfiltered, which is the expected "browse" case.
    const prefixMatch = line.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    const matchesPrefix = (label) => !prefix || label.toLowerCase().startsWith(prefix);

    const annMatch = line.match(/@[a-z]*$/);
    if (annMatch) {
      const replaceRange = new vscode.Range(
        position.translate(0, -annMatch[0].length),
        position
      );
      const items = [];
      for (const [ann, snippet] of Object.entries(ANNOTATION_SNIPPETS)) {
        const item = new vscode.CompletionItem(ann, vscode.CompletionItemKind.Snippet);
        item.insertText = new vscode.SnippetString(snippet);
        item.range = replaceRange;
        item.documentation = md(ANNOTATION_DOCS[ann] || '');
        item.detail = 'Aetralis annotation';
        item.sortText = '0' + ann;
        items.push(item);
      }
      return items;
    }

    if (!cachedStaticItems) cachedStaticItems = buildStaticItems();
    const items = cachedStaticItems.slice();

    // Live symbols: this file's own + every other known/workspace-scanned
    // .atlx file, so an imported name (e.g. from token_shared.atlx) shows up
    // by just typing its first letters, same as a builtin would. This also
    // covers names you just declared yourself — a struct, function, const,
    // or local `var` binding you wrote earlier in the file (or in another
    // open/workspace file) is offered back to you as you start typing it
    // again, and Tab or a click on the suggestion completes it.
    const index = mergedIndex(document.uri.toString());
    for (const [name, entry] of index.structs) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Struct);
      item.detail = 'struct ' + name;
      item.documentation = md(renderStructHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.enums) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Enum);
      item.detail = 'enum ' + name;
      item.documentation = md(renderEnumHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.types) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Interface);
      item.detail = 'type ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.functions) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = (entry.receiver ? entry.receiver + '.' : '') + name + '(' + entry.params + ')';
      item.documentation = md(renderFunctionHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.consts) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Constant);
      item.detail = 'const ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.variables) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.detail = 'var ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.contracts) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
      item.detail = 'contract ' + name;
      items.push(item);
    }
    return items.filter((item) => matchesPrefix(item.label));
  }
};

module.exports = { completionProvider };
