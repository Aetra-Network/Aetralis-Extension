'use strict';
// Manual smoke test (not part of `npm test` — deliberately outside test/, so
// Node's test runner doesn't sweep in this file, which isn't shaped as a
// node:test module and calls process.exit() itself). Runs activate() against
// a minimal in-process vscode stub, to catch reference errors that a syntax
// check alone can't (only a real VS Code host normally exercises this path).
// Run with: node scripts/smoke.js

const path = require('path');
const Module = require('module');

class Range { constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class Uri { constructor(s) { this._s = s; } toString() { return this._s; } }

function makeDocument(text, uriStr, languageId) {
  const uri = new Uri(uriStr);
  return {
    uri,
    languageId: languageId || 'atlx',
    getText: () => text,
    offsetAt: (pos) => pos.__offset,
    positionAt: (offset) => ({ line: 0, character: offset, __offset: offset })
  };
}

const decorationSetCalls = [];
const disposedTypes = [];

const documents = [
  makeDocument('@internal\nfunc onInternalMessage(in: InMessage) {\n  contract.setData(self.toChunk())\n}\n\ncontract Vault {\n  storage: Storage\n}\n\nconst price = aet("1.5")\n', 'file:///vault.atlx')
];

const editors = [{
  document: documents[0],
  setDecorations: (type, ranges) => decorationSetCalls.push({ type, count: ranges.length }),
  edit: () => {}
}];

const listeners = { onDidChangeVisibleTextEditors: [], onDidChangeConfiguration: [] };

const vscodeStub = {
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  languages: {
    registerHoverProvider: () => ({ dispose() {} }),
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerDefinitionProvider: () => ({ dispose() {} }),
    createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} })
  },
  workspace: {
    textDocuments: documents,
    onDidOpenTextDocument: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: (cb) => { listeners.onDidChangeConfiguration.push(cb); return { dispose() {} }; },
    getConfiguration: () => ({ get: (_key, def) => def }),
    findFiles: async () => [],
    fs: { readFile: async () => Buffer.from('') }
  },
  window: {
    visibleTextEditors: editors,
    onDidChangeVisibleTextEditors: (cb) => { listeners.onDidChangeVisibleTextEditors.push(cb); return { dispose() {} }; },
    createTextEditorDecorationType: (opts) => ({ opts, dispose: () => disposedTypes.push(opts) })
  }
};

// Intercept require('vscode') across the whole extension without touching
// node_modules or package.json — this file is a manual dev tool only.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return originalResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscodeStub };

const { activate, deactivate } = require(path.join(__dirname, '..', 'extension.js'));

const context = { subscriptions: [] };
activate(context);

console.log('activate() ran without throwing.');
console.log('subscriptions registered:', context.subscriptions.length);

// Manually invoke one shimmer tick's worth of work by calling the
// visible-editors listener (simulates VS Code firing the event once).
for (const cb of listeners.onDidChangeVisibleTextEditors) cb();

setTimeout(() => {
  console.log('setDecorations calls observed so far:', decorationSetCalls.length);
  const nonEmpty = decorationSetCalls.filter((c) => c.count > 0);
  console.log('non-empty decoration batches:', nonEmpty.length, nonEmpty.slice(0, 8));
  for (const d of context.subscriptions) { if (d && typeof d.dispose === 'function') d.dispose(); }
  deactivate();
  console.log('disposed', disposedTypes.length, 'decoration types; smoke test OK');
  process.exit(nonEmpty.length > 0 ? 0 : 1);
}, 200);
