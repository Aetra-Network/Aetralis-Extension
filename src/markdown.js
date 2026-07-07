'use strict';
const vscode = require('vscode');

/** Builds a plain-text-safe MarkdownString from a string or array of lines. */
function md(lines) {
  const m = new vscode.MarkdownString(Array.isArray(lines) ? lines.join('\n') : lines);
  m.supportHtml = false;
  return m;
}

module.exports = { md };
