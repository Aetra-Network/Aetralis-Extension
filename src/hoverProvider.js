'use strict';
const vscode = require('vscode');
const { SEND_MODE_DOCS, ANNOTATION_DOCS, WORD_DOCS } = require('./constants');
const { mergedIndex } = require('./symbolIndex');
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
      return new vscode.Hover(md(['**' + word + '** — send mode.', '', SEND_MODE_DOCS[word]]), wordRange);
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
    const linePrefix = document.getText(new vscode.Range(wordRange.start.line, 0, wordRange.start.line, wordRange.start.character));
    const recvMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/);
    if (recvMatch && index.methods.has(recvMatch[1] + '.' + word)) {
      return new vscode.Hover(md(renderFunctionHover(index.methods.get(recvMatch[1] + '.' + word))), wordRange);
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
