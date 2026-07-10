'use strict';
const { maskNonCode } = require('./symbolIndex');
const { ANNOTATION_DOCS } = require('./constants');

// ---------------------------------------------------------------------------
// Finds the four token classes that get the shimmer treatment. Pure text
// scanning (reuses maskNonCode, same masked-text idiom as diagnostics.js and
// unicodeSubstitution.js) — no vscode dependency, so this is directly
// unit-tested in test/shimmerMatcher.test.js.
// ---------------------------------------------------------------------------

// Reuses the exact annotation vocabulary already driving hovers (constants.js
// ANNOTATION_DOCS), so a new annotation added there gets shimmer for free.
const ANNOTATION_NAMES = Object.keys(ANNOTATION_DOCS).map((a) => a.slice(1));
const ANNOTATION_RE = new RegExp('@(?:' + ANNOTATION_NAMES.join('|') + ')\\b', 'g');

// The `contract` declaration keyword (`contract Vault { ... }`) — deliberately
// excludes the `contract.getData()`/`contract.setData()` builtin-namespace
// form (which is followed by `.`, not whitespace + a name).
const CONTRACT_DECL_RE = /\bcontract\b(?=\s+[A-Za-z_])/g;

// `aet("...")` — a single string-literal argument, the same call shape as
// the "builtin-functions" grammar rule (`aet` followed by `(`).
const AET_CALL_RE = /\baet(\s*\(\s*)("(?:\\.|[^"\\])*")(\s*\))/g;

/**
 * Finds every shimmer target in `text` and returns plain `{kind, start, end}`
 * ranges (character offsets into `text`, end exclusive).
 *
 * kind is one of: 'annotation', 'contract', 'aetName', 'aetString'.
 */
function findShimmerRanges(text) {
  const masked = maskNonCode(text);
  const ranges = [];
  let m;

  ANNOTATION_RE.lastIndex = 0;
  while ((m = ANNOTATION_RE.exec(masked)) !== null) {
    ranges.push({ kind: 'annotation', start: m.index, end: m.index + m[0].length });
  }

  CONTRACT_DECL_RE.lastIndex = 0;
  while ((m = CONTRACT_DECL_RE.exec(masked)) !== null) {
    ranges.push({ kind: 'contract', start: m.index, end: m.index + m[0].length });
  }

  // Matched against the ORIGINAL text, because maskNonCode blanks string
  // contents (and their quotes) — the string argument has to be read from
  // the real source. The `aet` identifier itself is then checked against the
  // masked text to confirm it's real code, not text inside a comment or
  // another string (mirrors the masked-compare idiom in unicodeSubstitution.js).
  AET_CALL_RE.lastIndex = 0;
  while ((m = AET_CALL_RE.exec(text)) !== null) {
    const nameStart = m.index;
    const nameEnd = nameStart + 3; // 'aet'.length
    if (masked.slice(nameStart, nameEnd) !== 'aet') continue;

    ranges.push({ kind: 'aetName', start: nameStart, end: nameEnd });

    const stringStart = nameEnd + m[1].length;
    const stringEnd = stringStart + m[2].length;
    ranges.push({ kind: 'aetString', start: stringStart, end: stringEnd });
  }

  return ranges;
}

module.exports = { findShimmerRanges, ANNOTATION_NAMES };
