'use strict';
const vscode = require('vscode');
const { maskNonCode } = require('./symbolIndex');

// ---------------------------------------------------------------------------
// Live "as you type" substitution of a few ASCII operator digraphs for their
// Unicode math equivalents. Purely a text edit — the grammar already colors
// the Unicode forms identically to their ASCII originals (see the
// "operators" rule in syntaxes/atlx.tmLanguage.json), so this doesn't
// introduce a new token kind, just a nicer glyph for the same operator.
// ---------------------------------------------------------------------------

const REPLACEMENTS = [
  { ascii: '!=', unicode: '≠' }, // ≠ not equal to
  { ascii: '=>', unicode: '⇒' }, // ⇒ rightwards double arrow
  { ascii: '<=', unicode: '≤' }, // ≤ less-than or equal to
  { ascii: '>=', unicode: '≥' }  // ≥ greater-than or equal to
];

/**
 * Registers the substitution and returns its disposable. Runs only for
 * `.atlx` documents, only reacts to a single plain keystroke (never to
 * paste, deletion, or its own replacement edit — see the rangeLength/text
 * length guard below, which is what stops this from looping on itself),
 * and skips any match found inside a string or comment.
 */
function registerUnicodeSubstitution() {
  return vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (document.languageId !== 'atlx') return;
    if (event.contentChanges.length !== 1) return;

    const change = event.contentChanges[0];
    if (change.rangeLength !== 0 || change.text.length !== 1) return;

    const endOffset = document.offsetAt(change.range.start) + 1;
    if (endOffset < 2) return;
    const startOffset = endOffset - 2;

    const text = document.getText();
    const pair = text.slice(startOffset, endOffset);
    const match = REPLACEMENTS.find((r) => r.ascii === pair);
    if (!match) return;

    // maskNonCode blanks out string and comment contents with spaces, so a
    // real ASCII pair sitting inside either of those no longer matches here
    // and is left alone.
    if (maskNonCode(text).slice(startOffset, endOffset) !== pair) return;

    const editor = vscode.window.visibleTextEditors.find((e) => e.document === document);
    if (!editor) return;

    const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
    editor.edit(
      (builder) => builder.replace(range, match.unicode),
      { undoStopBefore: false, undoStopAfter: false }
    );
  });
}

module.exports = { registerUnicodeSubstitution, REPLACEMENTS };
