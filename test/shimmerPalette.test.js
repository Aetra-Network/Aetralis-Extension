'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hexToRgb, rgbToHex, mixHex, buildShimmerPalette } = require('../src/shimmerPalette');

test('hexToRgb/rgbToHex round-trip', () => {
  assert.deepEqual(hexToRgb('#56B6C2'), { r: 0x56, g: 0xb6, b: 0xc2 });
  assert.equal(rgbToHex({ r: 0x56, g: 0xb6, b: 0xc2 }), '#56b6c2');
});

test('mixHex interpolates linearly between two colors', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('buildShimmerPalette returns the requested number of valid hex colors', () => {
  const palette = buildShimmerPalette('#C9A575', { steps: 12 });
  assert.equal(palette.length, 12);
  for (const color of palette) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('buildShimmerPalette peaks at the highlight and troughs at the base', () => {
  const palette = buildShimmerPalette('#000000', {
    steps: 24, highlightHex: '#ffffff', intensity: 1, sharpness: 4
  });
  const peak = hexToRgb(palette[0]); // angle 0 -> cos = 1 -> brightest step
  const trough = hexToRgb(palette[12]); // angle = pi -> cos = -1 -> back to base
  assert.ok(peak.r > trough.r, 'the peak step should be brighter than the trough step');
  assert.ok(trough.r < 20, 'the trough step should sit close to the base color');
  assert.ok(peak.r > 200, 'the peak step should sit close to the highlight color');
});

test('buildShimmerPalette is cyclic: the band appears exactly once per cycle', () => {
  const palette = buildShimmerPalette('#101010', { steps: 24, highlightHex: '#ffffff', intensity: 1 });
  const brightnesses = palette.map((hex) => hexToRgb(hex).r);
  const max = Math.max(...brightnesses);
  const peaks = brightnesses.filter((v) => v === max);
  assert.equal(peaks.length, 1, 'exactly one step should hit the brightest value in a 24-step cycle');
});

test('buildShimmerPalette rejects a step count below 2', () => {
  assert.throws(() => buildShimmerPalette('#000000', { steps: 1 }), RangeError);
  assert.throws(() => buildShimmerPalette('#000000', { steps: 1.5 }), RangeError);
});
