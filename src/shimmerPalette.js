'use strict';

// ---------------------------------------------------------------------------
// Pure color math for the "shimmer" effect: a bright highlight band that
// sweeps across a token's characters over time, rather than a flat static
// color. No vscode dependency — consumed by src/shimmerDecorations.js and
// covered directly by unit tests (test/shimmerPalette.test.js).
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex({ r, g, b }) {
  const channel = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + channel(r) + channel(g) + channel(b);
}

function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  });
}

/**
 * Builds a cyclic palette of `steps` colors: mostly `baseHex` (the token's
 * approved static color, unchanged), with a narrow bright band of
 * `highlightHex` that peaks once per cycle at index 0 and fades back to the
 * base by the middle of the cycle.
 *
 * shimmerDecorations.js samples `palette[(charIndex * phaseStep + frame) %
 * steps]` per character, which makes the bright band sweep across a token's
 * text as `frame` advances — a moving "переливание" rather than a static
 * gradient. `sharpness` controls how narrow the bright band is (higher =
 * a tighter glint instead of a broad, slow glow).
 */
function buildShimmerPalette(baseHex, options = {}) {
  const { steps = 24, highlightHex = '#FFFFFF', intensity = 0.55, sharpness = 4 } = options;
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError('steps must be an integer >= 2');
  }

  const palette = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const pulse = Math.pow((1 + Math.cos(angle)) / 2, sharpness);
    palette.push(mixHex(baseHex, highlightHex, intensity * pulse));
  }
  return palette;
}

module.exports = { hexToRgb, rgbToHex, mixHex, buildShimmerPalette };
