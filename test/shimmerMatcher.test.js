'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findShimmerRanges } = require('../src/shimmerMatcher');

function slices(text, ranges, kind) {
  return ranges.filter((r) => r.kind === kind).map((r) => text.slice(r.start, r.end));
}

test('finds every documented annotation', () => {
  const text = '@internal\nfunc onInternalMessage(in: InMessage) {}\n@get\nfunc balance(): int64 {}';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'annotation'), ['@internal', '@get']);
});

test('ignores an @annotation-looking token inside a comment or a string', () => {
  const text = '// @get is documented above\nconst label = "@internal"\n@pure\nfunc f() {}';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'annotation'), ['@pure']);
});

test('matches a contract declaration but not contract.method() namespace access', () => {
  const text = 'contract Vault {\n  storage: Storage\n}\nfunc f() { contract.getData() }';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'contract'), ['contract']);
});

test('matches aet("...") splitting the name and the string literal', () => {
  const text = 'const price = aet("1.5")';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'aetName'), ['aet']);
  assert.deepEqual(slices(text, ranges, 'aetString'), ['"1.5"']);
});

test('keeps matching every aet(...) call across multiple occurrences', () => {
  const text = 'const a = aet("1.5")\nconst b = aet("0.25")';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'aetName'), ['aet', 'aet']);
  assert.deepEqual(slices(text, ranges, 'aetString'), ['"1.5"', '"0.25"']);
});

test('handles an escaped quote inside the aet(...) string argument', () => {
  const text = 'const price = aet("1\\"5")';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'aetString'), ['"1\\"5"']);
});

test('ignores aet(...) written inside a comment or another string', () => {
  const text = '// aet("1.5") converts AET to base units\nconst label = "call aet(\\"x\\") here"\nconst price = aet("2.0")';
  const ranges = findShimmerRanges(text);
  assert.deepEqual(slices(text, ranges, 'aetName'), ['aet']);
  assert.deepEqual(slices(text, ranges, 'aetString'), ['"2.0"']);
});

test('does not match aet without a call, or aet as part of a longer identifier', () => {
  const text = 'const aetTotal = 1\nconst x = aet\nfunc aetHelper() {}';
  const ranges = findShimmerRanges(text);
  assert.equal(ranges.filter((r) => r.kind === 'aetName').length, 0);
});

test('returns no ranges for text with none of the target constructs', () => {
  const text = 'func plain(x: int64): int64 {\n  return x + 1\n}';
  assert.deepEqual(findShimmerRanges(text), []);
});
