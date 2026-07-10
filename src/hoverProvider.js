'use strict';
const vscode = require('vscode');
const {
  SEND_MODE_DOCS,
  SEND_MODE_VALUES,
  SEND_MODE_COMBINE_NOTE,
  ANNOTATION_DOCS,
  WORD_DOCS,
  INTEGER_TYPE_DOCS,
  BUILD_MESSAGE_FIELD_DOCS,
  MAP_TYPE_DOC,
  MAP_METHODS,
  SEND_METHOD_DOC
} = require('./constants');
const { maskNonCode, mergedIndex } = require('./symbolIndex');
const { md } = require('./markdown');

// ---------------------------------------------------------------------------
// Hover provider.
// ---------------------------------------------------------------------------

function renderStructHover(entry) {
  const lines = ['**struct ' + entry.name + '**', ''];
  if (entry.fields.length === 0) {
    lines.push('_(no fields)_');
  } else {
    lines.push('| Field | Type |', '|---|---|');
    for (const f of entry.fields) lines.push('| `' + f.name + '` | `' + f.type + '` |');
  }
  return lines;
}

function renderEnumHover(entry) {
  const lines = ['**enum ' + entry.name + '**', ''];
  for (const v of entry.variants) {
    lines.push('- `' + v.name + (v.params ? '(' + v.params + ')' : '') + '`');
  }
  return lines;
}

function renderFunctionHover(entry) {
  const sig = 'func ' + (entry.receiver ? entry.receiver + '.' : '') + entry.name +
    '(' + entry.params + ')' + (entry.returnType ? ': ' + entry.returnType : '');
  return ['**' + sig + '**'];
}

function matchBalanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function topLevelFields(text, start, end) {
  const fields = [];
  const pushSeg = (s, e) => {
    const seg = text.slice(s, e);
    const mm = seg.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (!mm) return;
    fields.push({
      name: mm[2],
      nameStart: s + mm[1].length,
      valueStart: s + mm[0].length,
      valueEnd: e
    });
  };
  let depth = 0;
  let segStart = start;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      pushSeg(segStart, i);
      segStart = i + 1;
    }
  }
  pushSeg(segStart, end);
  return fields;
}

function buildMessageFieldNameAt(document, position) {
  const text = maskNonCode(document.getText());
  const offset = document.offsetAt(position);
  const before = text.slice(0, offset);
  const matches = [...before.matchAll(/\bbuildMessage\s*\(/g)];
  if (matches.length === 0) return null;
  const callMatch = matches[matches.length - 1];
  const parenIdx = callMatch.index + callMatch[0].lastIndexOf('(');
  const parenEnd = matchBalanced(text, parenIdx);
  if (parenEnd < 0 || offset > parenEnd) return null;
  const braceRel = text.slice(parenIdx + 1, parenEnd).indexOf('{');
  if (braceRel < 0) return null;
  const braceIdx = parenIdx + 1 + braceRel;
  const braceEnd = matchBalanced(text, braceIdx);
  if (braceEnd < 0 || offset > braceEnd) return null;
  const fields = topLevelFields(text, braceIdx + 1, braceEnd);
  for (const field of fields) {
    if (offset >= field.nameStart && offset < field.nameStart + field.name.length) {
      return field.name;
    }
  }
  return null;
}

const hoverProvider = {
  provideHover(document, position) {
    const annRange = document.getWordRangeAtPosition(position, /@[a-z]+/);
    if (annRange) {
      const word = document.getText(annRange);
      if (ANNOTATION_DOCS[word]) return new vscode.Hover(md(ANNOTATION_DOCS[word]), annRange);
    }
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (SEND_MODE_DOCS[word]) {
      return new vscode.Hover(md([
        '**' + word + '** = `' + SEND_MODE_VALUES[word] + '` — send mode.',
        '',
        SEND_MODE_DOCS[word],
        '',
        SEND_MODE_COMBINE_NOTE
      ]), wordRange);
    }
    if (BUILD_MESSAGE_FIELD_DOCS[word] && buildMessageFieldNameAt(document, wordRange.start) === word) {
      return new vscode.Hover(md(['**buildMessage field `'+ word + '`**', '', BUILD_MESSAGE_FIELD_DOCS[word]]), wordRange);
    }
    if (INTEGER_TYPE_DOCS[word]) {
      return new vscode.Hover(md(['**type ' + word + '**', '', INTEGER_TYPE_DOCS[word]]), wordRange);
    }
    if (word === 'Map') {
      return new vscode.Hover(md(['**type Map<K, V>**', '', ...MAP_TYPE_DOC]), wordRange);
    }
    const sendPrefix = document.getText(new vscode.Range(wordRange.start.line, 0, wordRange.start.line, wordRange.start.character));
    if (word === 'send' && /\.\s*$/.test(sendPrefix)) {
      return new vscode.Hover(md(['**send()**', '', SEND_METHOD_DOC]), wordRange);
    }
    if (WORD_DOCS[word]) return new vscode.Hover(md(WORD_DOCS[word]), wordRange);

    const index = mergedIndex(document.uri.toString());
    if (index.structs.has(word)) return new vscode.Hover(md(renderStructHover(index.structs.get(word))), wordRange);
    if (index.enums.has(word)) return new vscode.Hover(md(renderEnumHover(index.enums.get(word))), wordRange);
    if (index.types.has(word)) {
      const t = index.types.get(word);
      return new vscode.Hover(md(['**type ' + t.name + '** = `' + t.value + '`']), wordRange);
    }
    // Prefer a receiver-qualified method if the word follows "Receiver."
    const recvPrefix = document.getText(new vscode.Range(wordRange.start.line, 0, wordRange.start.line, wordRange.start.character));
    const recvMatch = recvPrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/);
    if (recvMatch && index.methods.has(recvMatch[1] + '.' + word)) {
      return new vscode.Hover(md(renderFunctionHover(index.methods.get(recvMatch[1] + '.' + word))), wordRange);
    }
    // Dictionary method after a dot with no declared method of that name —
    // document the Map<K, V> surface.
    if (recvMatch && MAP_METHODS[word]) {
      return new vscode.Hover(md(['**Map.' + word + '** — dictionary method.', '', MAP_METHODS[word]]), wordRange);
    }
    if (index.functions.has(word)) return new vscode.Hover(md(renderFunctionHover(index.functions.get(word))), wordRange);
    if (index.consts.has(word)) {
      const c = index.consts.get(word);
      return new vscode.Hover(md(['**const ' + c.name + '** = `' + c.value + '`']), wordRange);
    }
    if (index.variables.has(word)) {
      const v = index.variables.get(word);
      return new vscode.Hover(md(['**var ' + v.name + '** = `' + v.value + '`']), wordRange);
    }
    return null;
  }
};

module.exports = { hoverProvider, renderStructHover, renderEnumHover, renderFunctionHover };
