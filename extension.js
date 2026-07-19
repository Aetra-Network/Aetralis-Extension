'use strict';
const vscode = require('vscode');
const { hoverProvider } = require('./src/hoverProvider');
const { definitionProvider } = require('./src/definitionProvider');
const { completionProvider } = require('./src/completionProvider');
const { computeDiagnostics } = require('./src/diagnostics');
const { maskNonCode, indexSource, mergedIndex, docIndexCache, updateIndexFor, removeIndexFor, seedWorkspaceIndex } = require('./src/symbolIndex');
const { registerUnicodeSubstitution } = require('./src/unicodeSubstitution');
const { registerShimmerDecorations } = require('./src/shimmerDecorations');

// ---------------------------------------------------------------------------
// Activation.
// ---------------------------------------------------------------------------

function activate(context) {
  const selector = { language: 'atlx' };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerCompletionItemProvider(selector, completionProvider, '@'),
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    registerUnicodeSubstitution()
  );
  registerShimmerDecorations(context);

  const collection = vscode.languages.createDiagnosticCollection('atlx');
  context.subscriptions.push(collection);

  const timers = new Map();
  const refresh = (document) => {
    if (document.languageId !== 'atlx') return;
    // Masked once and shared: updateIndexFor and computeDiagnostics both
    // need `maskNonCode(document.getText())`, and re-masking the same text
    // twice per edit was pure waste on any non-trivial file.
    const maskedText = maskNonCode(document.getText());
    updateIndexFor(document, maskedText);
    collection.set(document.uri, computeDiagnostics(document, maskedText));
  };
  const refreshDebounced = (document) => {
    if (document.languageId !== 'atlx') return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => refresh(document), 300));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refreshDebounced(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      collection.delete(d.uri);
      // Real on-disk files stay in docIndexCache after close (seedWorkspaceIndex
      // relies on that for cross-file resolution). Untitled/scratch buffers
      // can never be re-populated by the workspace scan and have no value
      // once closed, so drop them — otherwise a long session that opens and
      // discards many scratch buffers grows the index (and mergedIndex's
      // per-call work) without bound.
      if (d.uri.scheme !== 'file') removeIndexFor(d.uri.toString());
    })
  );
  for (const document of vscode.workspace.textDocuments) refresh(document);

  // Seed the cross-file symbol index from the rest of the workspace, then
  // re-run diagnostics once (a call site may resolve now that an imported
  // file's symbols are known).
  seedWorkspaceIndex().then(() => {
    for (const document of vscode.workspace.textDocuments) refresh(document);
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // Exported for tests only.
  _internal: { maskNonCode, computeDiagnostics, indexSource, mergedIndex, docIndexCache }
};
