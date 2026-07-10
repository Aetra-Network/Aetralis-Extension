'use strict';
const vscode = require('vscode');
const { findShimmerRanges } = require('./shimmerMatcher');
const { buildShimmerPalette } = require('./shimmerPalette');

// ---------------------------------------------------------------------------
// Animated "shimmer" — a bright highlight band that sweeps across
// @annotations, the `contract` declaration keyword, and aet("...") calls
// (both the `aet` name and the string argument), on top of each token's
// already-approved static color from configurationDefaults.
//
// VS Code decorations only ever paint a flat color, so the sweep is faked by
// pre-building one TextEditorDecorationType per palette step per token kind,
// then, on a timer, bucketing each matched character into the step its
// current animation phase resolves to and calling setDecorations once per
// step. Matching (regex work) only re-runs on open/edit, debounced; the
// timer tick itself is just array bucketing — no regex, no AST.
// ---------------------------------------------------------------------------

const PALETTE_STEPS = 24;
const PHASE_STEP = 3; // how many palette steps apart consecutive characters sit
const FRAME_INTERVAL_MS = 90; // ~11 fps: smooth enough to read as motion, cheap to sustain
const REFRESH_DEBOUNCE_MS = 300; // matches the debounce already used for diagnostics
// Hard cap on characters decorated per document — bounds worst-case cost on a
// pathological file instead of silently scanning/decorating without limit.
const MAX_SHIMMER_CHARS_PER_DOC = 4000;

// Each target keeps its existing approved base color (see package.json's
// editor.tokenColorCustomizations) and adds a moving lighter band — the
// static palette identity from atlx-highlight-palette isn't changed, just
// animated.
const TARGETS = {
  annotation: { base: '#FFC670', highlight: '#FFF3D6', bold: true, italic: true },
  contract: { base: '#C792EA', highlight: '#F1E3FF' },
  aetName: { base: '#56B6C2', highlight: '#D8FBFF' },
  aetString: { base: '#C9A575', highlight: '#FFEFD9' }
};

function buildDecorationTypes() {
  const types = {};
  for (const [kind, spec] of Object.entries(TARGETS)) {
    const palette = buildShimmerPalette(spec.base, { steps: PALETTE_STEPS, highlightHex: spec.highlight });
    types[kind] = palette.map((color) => vscode.window.createTextEditorDecorationType({
      color,
      fontWeight: spec.bold ? 'bold' : undefined,
      fontStyle: spec.italic ? 'italic' : undefined
    }));
  }
  return types;
}

/** Registers the shimmer effect and returns nothing — disposables go on `context.subscriptions`. */
function registerShimmerDecorations(context) {
  const isEnabled = () => vscode.workspace.getConfiguration('aetralis').get('shimmer.enabled', true);

  const decorationTypes = buildDecorationTypes();
  const emptyDecorationLists = () => {
    const empty = {};
    for (const kind of Object.keys(TARGETS)) empty[kind] = decorationTypes[kind].map(() => []);
    return empty;
  };

  // uri string -> shimmer ranges for the whole document (from findShimmerRanges).
  const matchCache = new Map();
  // uri string -> whether that document's match count was capped (logged once).
  const cappedDocs = new Set();

  function refreshMatches(document) {
    if (document.languageId !== 'atlx') return;
    let ranges = findShimmerRanges(document.getText());
    let totalChars = 0;
    for (const r of ranges) totalChars += r.end - r.start;
    if (totalChars > MAX_SHIMMER_CHARS_PER_DOC) {
      let budget = MAX_SHIMMER_CHARS_PER_DOC;
      ranges = ranges.filter((r) => {
        const len = r.end - r.start;
        if (budget <= 0) return false;
        budget -= len;
        return true;
      });
      cappedDocs.add(document.uri.toString());
    } else {
      cappedDocs.delete(document.uri.toString());
    }
    matchCache.set(document.uri.toString(), ranges);
  }

  function clearEditorDecorations(editor) {
    for (const kind of Object.keys(TARGETS)) {
      for (const type of decorationTypes[kind]) editor.setDecorations(type, []);
    }
  }

  function applyDecorations(editor, frame) {
    const ranges = matchCache.get(editor.document.uri.toString());
    if (!ranges || ranges.length === 0) return;

    const byKindByStep = emptyDecorationLists();
    const document = editor.document;
    for (const { kind, start, end } of ranges) {
      for (let offset = start; offset < end; offset++) {
        const charIndex = offset - start;
        const step = (((charIndex * PHASE_STEP + frame + start) % PALETTE_STEPS) + PALETTE_STEPS) % PALETTE_STEPS;
        byKindByStep[kind][step].push(new vscode.Range(
          document.positionAt(offset),
          document.positionAt(offset + 1)
        ));
      }
    }

    for (const kind of Object.keys(TARGETS)) {
      const types = decorationTypes[kind];
      for (let step = 0; step < PALETTE_STEPS; step++) {
        editor.setDecorations(types[step], byKindByStep[kind][step]);
      }
    }
  }

  let frame = 0;
  let timer = null;
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const startTimer = () => {
    if (timer) return;
    timer = setInterval(() => {
      frame = (frame + 1) % PALETTE_STEPS;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.languageId === 'atlx') applyDecorations(editor, frame);
      }
    }, FRAME_INTERVAL_MS);
  };

  // Starts/stops the timer based on the setting and whether any .atlx editor
  // is currently visible — no point animating (or even holding an interval)
  // when there's nothing to paint.
  function syncActivity() {
    if (!isEnabled()) {
      stopTimer();
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.languageId === 'atlx') clearEditorDecorations(editor);
      }
      return;
    }
    const hasVisibleAtlx = vscode.window.visibleTextEditors.some((e) => e.document.languageId === 'atlx');
    if (hasVisibleAtlx) startTimer(); else stopTimer();
  }

  const debounceTimers = new Map();
  const refreshDebounced = (document) => {
    if (document.languageId !== 'atlx') return;
    const key = document.uri.toString();
    clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(() => { refreshMatches(document); syncActivity(); }, REFRESH_DEBOUNCE_MS));
  };

  for (const document of vscode.workspace.textDocuments) refreshMatches(document);
  syncActivity();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => { refreshMatches(document); syncActivity(); }),
    vscode.workspace.onDidChangeTextDocument((event) => refreshDebounced(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      matchCache.delete(key);
      cappedDocs.delete(key);
      clearTimeout(debounceTimers.get(key));
      debounceTimers.delete(key);
    }),
    vscode.window.onDidChangeVisibleTextEditors(syncActivity),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('aetralis.shimmer')) syncActivity();
    }),
    { dispose: stopTimer },
    { dispose: () => { for (const types of Object.values(decorationTypes)) for (const t of types) t.dispose(); } }
  );
}

module.exports = { registerShimmerDecorations };
