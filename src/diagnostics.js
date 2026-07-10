'use strict';
const vscode = require('vscode');
const {
  HANDLERS, BANNED_WORDS, BUILTIN_FUNCTIONS, CONTROL_KEYWORDS_BEFORE_PAREN,
  SEND_MODE_VALUES, BUILD_MESSAGE_FIELDS, LEGACY_DECLARATIONS, NO_ARG_ANNOTATIONS
} = require('./constants');
const { maskNonCode, mergedIndex } = require('./symbolIndex');

// ---------------------------------------------------------------------------
// Diagnostics — predictive checks that mirror what the AVM compiler rejects
// (x/aetravm/compiler/{parser,compile}.go), surfaced live before compilation:
//   1) @internal/@external/@bounced — at most one per contract;
//   2) the annotated function must use its reserved name and signature;
//   3) reserved names cannot be used without the matching annotation;
//   4) legacy/removed words (slice, cell, let/val/mut bindings, package,
//      migrate, selector, ...) — not part of the language;
//   5) calls to names that are neither a builtin, nor declared in this file
//      or any known workspace file, nor an enum variant constructor;
//   6) legacy declarations message/getter/event/wallet action (parser rejects);
//   7) annotations other than @message may not carry an argument list;
//   8) buildMessage({...}) — unknown/duplicate keys, missing receiver/body;
//   9) send modes (buildMessage `mode:` only) — must be SEND_* combined with +,
//      no repeats, DRAIN/CARRY exclusive, ESTIMATE_ONLY alone; `.send()` takes
//      no arguments and is just the method form of the built message.
//  10) @get/@pure functions must not call mutating builtins (setData, save,
//      touch, map set/delete) or send/emit/refund.
// ---------------------------------------------------------------------------

function normalizeParams(p) {
  return p.replace(/\s+/g, '');
}

// Index of the bracket that closes the opener at `openIdx`. Works on masked
// text (strings/comments blanked), so brackets inside them are neutralized.
function matchBalanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split [start,end) into comma-separated segments at bracket depth 0, then
// extract those that look like `key:` — used for buildMessage top-level fields.
function topLevelFields(text, start, end) {
  const fields = [];
  const pushSeg = (s, e) => {
    const seg = text.slice(s, e);
    const mm = seg.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (!mm) return; // trailing comma / non-key segment
    fields.push({
      name: mm[2],
      nameStart: s + mm[1].length,
      valueStart: s + mm[0].length,
      valueEnd: e
    });
  };
  let depth = 0;
  let segStart = start;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { pushSeg(segStart, i); segStart = i + 1; }
  }
  pushSeg(segStart, end);
  return fields;
}

// Split a send-mode expression on top-level `+`.
function splitPlus(raw) {
  const parts = [];
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '+' && depth === 0) { parts.push({ text: raw.slice(segStart, i), start: segStart }); segStart = i + 1; }
  }
  parts.push({ text: raw.slice(segStart), start: segStart });
  return parts;
}

// Validate a send-mode expression (the RHS of a `mode:` field or a `.send(...)`
// argument). `raw` is the expression text; `offset` its start in the document.
// Only engages when the expression actually references a SEND_* constant, to
// keep false positives near zero on variables / partial input.
function validateSendMode(raw, offset, push) {
  if (!/SEND_[A-Za-z0-9_]*/.test(raw)) return;
  const lead = raw.length - raw.trimStart().length;
  const spanStart = offset + lead;
  const spanLen = Math.max(1, raw.trim().length);

  const seen = new Set();
  let mask = 0;
  for (const p of splitPlus(raw)) {
    const tok = p.text.trim();
    if (tok === '' || tok === '0') continue;
    if (!/^SEND_[A-Za-z0-9_]*$/.test(tok)) {
      push(spanStart, spanLen, 'Send mode must be built from `SEND_*` constants combined with `+`.');
      return;
    }
    const tokStart = offset + p.start + (p.text.length - p.text.trimStart().length);
    if (!(tok in SEND_MODE_VALUES)) {
      push(tokStart, tok.length, '`' + tok + '` is not a valid send mode.');
      continue;
    }
    if (seen.has(tok)) {
      push(tokStart, tok.length, 'Send mode `' + tok + '` is specified more than once.');
      continue;
    }
    seen.add(tok);
    mask |= SEND_MODE_VALUES[tok];
  }
  const DRAIN = 128;
  const CARRY = 64;
  const EST = 1024;
  if ((mask & DRAIN) && (mask & CARRY)) {
    push(spanStart, spanLen, 'SEND_DRAIN_BALANCE and SEND_CARRY_REMAINDER are mutually exclusive.');
  } else if ((mask & EST) && (mask & ~EST)) {
    push(spanStart, spanLen, 'SEND_ESTIMATE_ONLY cannot be combined with other send modes.');
  }
}

function computeDiagnostics(document) {
  const text = maskNonCode(document.getText());
  const diags = [];
  const push = (start, length, message, severity) => {
    const range = new vscode.Range(
      document.positionAt(start),
      document.positionAt(start + length)
    );
    diags.push(new vscode.Diagnostic(range, message, severity === undefined ? vscode.DiagnosticSeverity.Error : severity));
  };

  // Contract segment starts (for the "once per contract" rule).
  const contractStarts = [0];
  const contractRe = /\bcontract\s+[A-Za-z_]/g;
  let m;
  while ((m = contractRe.exec(text)) !== null) contractStarts.push(m.index);
  const segmentOf = (idx) => {
    let seg = 0;
    for (const s of contractStarts) { if (s <= idx) seg = s; else break; }
    return seg;
  };

  // Rule 1 + 2: walk handler annotations.
  const seen = new Map(); // key: segment + kind
  const annRe = /@(internal|external|bounced)\b/g;
  while ((m = annRe.exec(text)) !== null) {
    const kind = m[1];
    const handler = HANDLERS[kind];
    const key = segmentOf(m.index) + ':' + kind;
    if (seen.has(key)) {
      push(m.index, m[0].length, 'Only one @' + kind + ' handler is allowed per contract.');
    } else {
      seen.set(key, true);
    }

    // Look at the function that follows (bounded window; @external may carry args).
    const window = text.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const fn = window.match(/^\s*(?:\([^)\n]*\)\s*)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)\n]*)\)/);
    if (fn) {
      const nameOffset = m.index + m[0].length + fn[0].indexOf(fn[1], fn[0].indexOf('func'));
      if (fn[1] !== handler.name) {
        push(nameOffset, fn[1].length,
          'Expected function name `' + handler.name + '` for handler annotated with `@' + kind + '`.');
      } else if (normalizeParams(fn[2]) !== normalizeParams(handler.params)) {
        push(nameOffset, fn[1].length,
          kind + ' handler must be `func ' + handler.name + '(' + handler.params + ')`.');
      }
    }
  }

  // Rule 3: reserved names require the matching annotation.
  const reservedRe = /\bfunc\s+(onInternalMessage|onExternalMessage|onBouncedMessage)\b/g;
  while ((m = reservedRe.exec(text)) !== null) {
    const name = m[1];
    const kind = name === 'onInternalMessage' ? 'internal'
      : name === 'onExternalMessage' ? 'external' : 'bounced';
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    const lastAnn = before.match(/@([a-z]+)(?:\s*\([^)\n]*\))?\s*$/);
    if (!lastAnn || lastAnn[1] !== kind) {
      const nameOffset = m.index + m[0].indexOf(name);
      push(nameOffset, name.length,
        '`' + name + '` is a reserved message handler name and can only be used with `@' + kind + '`.');
    }
  }

  // Rule 4: legacy/removed words.
  const bannedRe = new RegExp('\\b(' + Object.keys(BANNED_WORDS).join('|') + ')\\b', 'g');
  while ((m = bannedRe.exec(text)) !== null) {
    push(m.index, m[1].length, '`' + m[1] + '` is ' + BANNED_WORDS[m[1]], vscode.DiagnosticSeverity.Warning);
  }
  // let/val/mut are only banned as a binding form (`let x = ...`), not as
  // arbitrary identifiers elsewhere — narrower pattern to avoid false flags.
  const bindingRe = /(^|[{};])\s*(let|val|mut)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/gm;
  while ((m = bindingRe.exec(text)) !== null) {
    const kwOffset = m.index + m[0].indexOf(m[2]);
    push(kwOffset, m[2].length, 'Local bindings must use `const` or `var` — `' + m[2] + '` is not part of the language.', vscode.DiagnosticSeverity.Warning);
  }

  // Rule 5: calls to unknown names.
  const index = mergedIndex(document.uri.toString());
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  while ((m = callRe.exec(text)) !== null) {
    const name = m[1];
    if (CONTROL_KEYWORDS_BEFORE_PAREN.has(name)) continue;
    if (BUILTIN_FUNCTIONS.has(name)) continue;
    if (index.enumVariants.has(name)) continue; // enum variant constructor, e.g. Deposit(amount: uint64)
    // Receiver-style call (Type.method(...) or value.method(...)) — not
    // validated here; method existence checking would need real types.
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (before === '.') continue;
    // Annotation with an argument list, e.g. @message(0x1001), @external(inMsg: Segment)
    // — not a function call.
    if (before === '@') continue;
    // Declaration site, not a call: `func name(` / `func Type.name(`.
    const decl = text.slice(Math.max(0, m.index - 80), m.index);
    if (/\bfunc\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?$/.test(decl)) continue;
    if (index.functions.has(name) || index.methods.has(name)) continue;
    if (index.structs.has(name)) continue; // shouldn't normally be called, but not our concern here
    push(m.index, name.length,
      '`' + name + '` is not declared in this file or any known workspace file, and is not a recognized builtin.',
      vscode.DiagnosticSeverity.Warning);
  }

  // Rule 6: legacy top-level declarations (message/getter/event/wallet action).
  // Only at declaration position and followed by a name (or `action`), so a
  // field named `message:` or a `const message = ...` binding is not flagged.
  const legacyRe = /(^|[\n{};])([ \t]*)(message|getter|event|wallet)\b/g;
  while ((m = legacyRe.exec(text)) !== null) {
    const kw = m[3];
    const kwStart = m.index + m[1].length + m[2].length;
    const rest = text.slice(kwStart + kw.length);
    if (kw === 'wallet') {
      if (!/^\s+action\b/.test(rest)) continue;
    } else if (!/^\s+[A-Za-z_]/.test(rest)) {
      continue;
    }
    push(kwStart, kw.length, '`' + kw + '` is ' + LEGACY_DECLARATIONS[kw]);
  }

  // Rule 7: only `@message(opcode)` may carry an argument list. Every other
  // annotation is bare — parameters belong in the function signature. This is
  // exactly the form the old @external(inMsg: Segment) snippet produced.
  const badAnnRe = /@([a-z]+)\s*\(/g;
  while ((m = badAnnRe.exec(text)) !== null) {
    const ann = m[1];
    if (!NO_ARG_ANNOTATIONS.has(ann)) continue;
    const parenIdx = m.index + m[0].length - 1;
    const parenEnd = matchBalanced(text, parenIdx);
    const end = parenEnd < 0 ? parenIdx + 1 : parenEnd + 1;
    push(m.index, end - m.index,
      '`@' + ann + '` takes no arguments — declare parameters in the function signature instead (only `@message(opcode)` carries an argument).');
  }

  // Rule 8 + 9: buildMessage({...}) field validation, buildMessage.mode
  // checks, and `.send()` argument rejection.
  const bmRe = /\bbuildMessage\s*\(/g;
  while ((m = bmRe.exec(text)) !== null) {
    const parenIdx = m.index + m[0].length - 1;
    const parenEnd = matchBalanced(text, parenIdx);
    if (parenEnd < 0) continue;
    const braceRel = text.slice(parenIdx + 1, parenEnd).indexOf('{');
    if (braceRel < 0) continue; // not a struct literal yet (still typing) — skip
    const braceIdx = parenIdx + 1 + braceRel;
    const braceEnd = matchBalanced(text, braceIdx);
    if (braceEnd < 0 || braceEnd > parenEnd) continue; // incomplete literal — skip
    const fields = topLevelFields(text, braceIdx + 1, braceEnd);
    const seenField = new Set();
    for (const f of fields) {
      if (!BUILD_MESSAGE_FIELDS.includes(f.name)) {
        push(f.nameStart, f.name.length,
          'Unknown buildMessage field `' + f.name + '`. Allowed: ' + BUILD_MESSAGE_FIELDS.join(', ') + '.');
      } else if (seenField.has(f.name)) {
        push(f.nameStart, f.name.length,
          'Duplicate buildMessage field `' + f.name + '` — each field may appear at most once.');
      } else {
        seenField.add(f.name);
      }
      if (f.name === 'mode') {
        validateSendMode(text.slice(f.valueStart, f.valueEnd), f.valueStart, push);
      }
    }
    if (!seenField.has('receiver')) push(m.index, 'buildMessage'.length, 'buildMessage requires a `receiver` field.');
    if (!seenField.has('body')) push(m.index, 'buildMessage'.length, 'buildMessage requires a `body` field.');
  }

  // Rule 9 (cont.): `.send()` takes no arguments.
  const sendRe = /\.\s*send\s*\(/g;
  while ((m = sendRe.exec(text)) !== null) {
    const parenIdx = m.index + m[0].length - 1;
    const parenEnd = matchBalanced(text, parenIdx);
    if (parenEnd < 0) continue;
    const arg = text.slice(parenIdx + 1, parenEnd);
    if (arg.trim().length > 0) {
      push(m.index, parenEnd - m.index + 1, '`.send()` takes no arguments — declare the send mode in buildMessage via the `mode:` field (e.g. `mode: SEND_BOUNCE_ON_FAIL`).');
    }
  }

  // Rule 10: @get / @pure functions must not call mutating builtins or send.
  const MUTATIONS = [
    { re: /\bcontract\s*\.\s*setData\s*\(/g, name: 'setData()' },
    { re: /\bcontract\s*\.\s*deleteData\s*\(/g, name: 'deleteData()' },
    { re: /\.\s*save\s*\(\s*\)/g, name: 'save()' },
    { re: /\.\s*touch\s*\(\s*\)/g, name: 'touch()' },
    { re: /\.\s*set\s*\(/g, name: 'map set()' },
    { re: /\.\s*delete\s*\(/g, name: 'map delete()' },
    { re: /\.\s*send\s*\(/g, name: 'send()' },
    { re: /\bemit\s*\(/g, name: 'emit()' },
    { re: /\brefund\s*\(/g, name: 'refund()' }
  ];
  const getRe = /@(get|pure)\b[\s\S]*?\bfunc\b[^{;]*\{/g;
  while ((m = getRe.exec(text)) !== null) {
    const kind = m[1];
    const bodyOpen = m.index + m[0].length - 1;
    const bodyEnd = matchBalanced(text, bodyOpen);
    if (bodyEnd < 0) continue;
    const label = kind === 'get' ? 'A getter (`@get`)' : 'A pure function (`@pure`)';
    for (const mut of MUTATIONS) {
      mut.re.lastIndex = bodyOpen + 1;
      let mm;
      while ((mm = mut.re.exec(text)) !== null) {
        if (mm.index >= bodyEnd) break;
        push(mm.index, mm[0].length, label + ' cannot call `' + mut.name + '`, which mutates state or performs a chain-visible side effect.');
      }
    }
    getRe.lastIndex = bodyEnd; // don't rescan inside the body
  }

  return diags;
}

module.exports = { normalizeParams, computeDiagnostics };
