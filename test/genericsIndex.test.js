'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// symbolIndex.js's indexSource() requires 'vscode' lazily (only inside the
// functions that actually touch it) so it stays loadable from a plain Node
// process for exactly this kind of test -- but it does still need a minimal
// stub for the two things it constructs, vscode.Location and vscode.Range, or
// the require() throws MODULE_NOT_FOUND outside a real VS Code host.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return require.resolve('../src/testHelpers/vscodeStub.js');
  return originalResolve.call(this, request, ...rest);
};

const { indexSource, maskNonCode } = require('../src/symbolIndex');
const { computeDiagnostics: _unused } = require('../src/diagnostics'); // sanity: loads without vscode present at require-time issues beyond the stub

// Regression coverage for the generics-v1 fix: before it, a generic function/
// struct declaration (`func foo<T>(...)`, `struct Pair<A, B> {...}`) was
// invisible to symbolIndex.js's funcRe/structRe (they required the opening
// paren/brace immediately after the name), so hovering/go-to-definition on a
// generic symbol silently returned nothing.
test('indexSource registers a generic function declaration (func foo<T>(...))', () => {
  const src = 'func maxOf<T>(a: T, b: T) -> T { if (a > b) { return a } return b }';
  const index = indexSource(maskNonCode(src), { toString: () => 'file:///t.atlx' });
  assert.ok(index.functions.has('maxOf'), 'maxOf must be indexed despite its <T> type-param list');
  assert.equal(index.functions.get('maxOf').params, 'a: T, b: T');
  assert.equal(index.functions.get('maxOf').returnType, 'T');
});

test('indexSource registers a generic struct declaration (struct Pair<A, B> {...})', () => {
  const src = 'struct Pair<A, B> {\n  first: A\n  second: B\n}';
  const index = indexSource(maskNonCode(src), { toString: () => 'file:///t.atlx' });
  assert.ok(index.structs.has('Pair'), 'Pair must be indexed despite its <A, B> type-param list');
  const fields = index.structs.get('Pair').fields.map((f) => f.name);
  assert.deepEqual(fields, ['first', 'second']);
});

test('indexSource still registers an ordinary (non-generic) function and struct', () => {
  const src = 'func plain(x: uint64): uint64 { return x }\nstruct S { a: uint64 }';
  const index = indexSource(maskNonCode(src), { toString: () => 'file:///t.atlx' });
  assert.ok(index.functions.has('plain'));
  assert.ok(index.structs.has('S'));
});

test('indexSource still registers a receiver-style method declaration', () => {
  const src = '@store\nfunc Storage.save(self) {\n  contract.setData(self.toChunk())\n}';
  const index = indexSource(maskNonCode(src), { toString: () => 'file:///t.atlx' });
  assert.ok(index.methods.has('Storage.save'), 'Storage.save must still be indexed as a receiver method');
});
