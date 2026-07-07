'use strict';
const vscode = require('vscode');
const { mergedIndex } = require('./symbolIndex');

// ---------------------------------------------------------------------------
// Definition provider — Ctrl+Click / F12 / "Go to Definition".
// ---------------------------------------------------------------------------

const definitionProvider = {
  provideDefinition(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const index = mergedIndex(document.uri.toString());

    const linePrefix = document.getText(new vscode.Range(wordRange.start.line, 0, wordRange.start.line, wordRange.start.character));
    const recvMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/);
    if (recvMatch) {
      const qualified = recvMatch[1] + '.' + word;
      if (index.methods.has(qualified)) return index.methods.get(qualified).location;
      // Receiver itself might be a struct/type name being dereferenced.
      if (index.structs.has(recvMatch[1]) && word === recvMatch[1]) return index.structs.get(recvMatch[1]).location;
    }
    if (index.functions.has(word)) return index.functions.get(word).location;
    if (index.methods.has(word)) return index.methods.get(word).location;
    if (index.structs.has(word)) return index.structs.get(word).location;
    if (index.enums.has(word)) return index.enums.get(word).location;
    if (index.types.has(word)) return index.types.get(word).location;
    if (index.consts.has(word)) return index.consts.get(word).location;
    if (index.variables.has(word)) return index.variables.get(word).location;
    if (index.contracts.has(word)) return index.contracts.get(word).location;
    return null;
  }
};

module.exports = { definitionProvider };
