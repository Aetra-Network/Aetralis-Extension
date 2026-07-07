# Changelog

## 1.2.0

- **Fixed**: brackets (`{} () []`) appearing inside a `//` or `/* */` comment could render in a highlighted (yellow/pink-ish) color instead of the comment's own color. Comment bodies now explicitly scope every bracket they contain, in both single-line and multi-line comments, verified against a real TextMate tokenizer.
- **Added**: inline code inside a comment — wrap a snippet in backticks, e.g. `` `contract.getData()` `` — now renders in italics.
- **Added**: typing `!=`, `=>`, `<=`, or `>=` in code now becomes `≠`, `⇒`, `≤`, `≥` the moment the second character is typed; skipped automatically inside strings and comments so example code in a comment or a string literal is never rewritten.
- `README.md` is now the GitHub-facing page (Marketplace link, feature list, screenshots); the general, install-page-style description moved to `docs/marketplace-readme.md`, packaged as the Marketplace overview via `npm run package` (`vsce package --readme-path`).

## 1.1.0

- **Completion**: local `var` bindings are now indexed alongside `const`, structs, enums, types, functions, and contracts — a variable you've declared anywhere in the file (or another known workspace file) is suggested as soon as you start typing its name again, with hover documentation and "Go to Definition" support to match.
- Internal: `extension.js` split into single-responsibility modules under `src/` (symbol indexing, hover, go-to-definition, completion, diagnostics, static language data) with no behavior change to any existing feature.
- `README.md` rewritten as a general product description; the color palette and per-keyword reference moved out of it (still available in-editor via hover).

## 1.0.3

- Added a lightweight cross-file symbol index (structs, enums, type aliases, functions/methods, consts, contracts) built from a single regex pass per `.atlx` file, seeded from the whole workspace on activation.
- **Hover**: struct/enum/type/function/const hovers now work for any user-declared name, in this file or another — including hovering `T` inside `Chunk<T>` to see `T`'s fields.
- **Completion**: declared structs/enums/types/functions/consts/contracts now show up as you type their first letters, the same as builtins and annotations already did.
- **Go to Definition** (Ctrl+Click / F12): jumps to where a function, struct, enum, type, or const is declared, resolving across files pulled in via `import`.
- **Diagnostics**: added warnings for legacy/removed words (`slice`, `cell`, `isSlice`, `isSliceSignatureValid`, `package`, `migrate`, `selector`, and `let`/`val`/`mut` used as a binding form) and for calls to names that are neither a builtin nor declared anywhere in the workspace.
- Fixed two real bugs found while building the above: `random()` was missing from the builtin list (false "unknown function"), and `@message(...)`/`@external(...)` annotation argument lists were mistaken for function calls.
- Annotations (`@internal`, `@external`, ...) are now a brighter gold (`#FFC670`) to stand out more from contract-meta fields, which keep the previous shade.
- Unicode `≠ ⇒ ⇐ ⇔` are now recognized and colored as operators wherever they appear (same token color as their ASCII `!=`/`=>`/`<=>` equivalents).

## 1.0.2

- Fixed brackets `{} () []` inside comments rendering in bracket-pair colors: bracket pair colorization is now disabled for `.atlx`, so brackets take their token color everywhere (gray in code, green in comments) in every theme.
- `buildMessage` completion: picking it inserts the full envelope (`bounce`/`amount`/`receiver`/`body`) with a dropdown for `BounceMode`; `send` completion offers a dropdown of all `SEND_*` modes.
- Typing `SEND` suggests every send mode with hover-style documentation on each item.
- Added the new small integer types `uint2`, `uint4`, `int2`, `int4` (and `u2/u4/i2/i4`) to highlighting, completions, and hovers.

## 1.0.1

- `wallet`, `action`, `getter`, `event` are no longer highlighted as keywords — they are plain identifiers; the language declares these surfaces through annotations only.
- Annotations (`@internal`, `@external`, ...) are now rendered **bold italic**; reserved handler names (`onInternalMessage`, `onExternalMessage`, `onBouncedMessage`) are **bold**.
- Added hover documentation for annotations, `SEND_*` modes, reserved handler names, and core builtins.
- Added smart `@` completions: picking `@internal` / `@external` / `@bounced` inserts the full reserved handler skeleton; `@storage`, `@message`, `@get`, `@store`, `@pure`, `@impure` insert their canonical forms.
- Added lightweight diagnostics mirroring the compiler handler rules: one handler of each kind per contract, reserved names bound to their annotations, canonical signatures.

## 1.0.0

Complete rewrite.

- Removed all runtime code (analyzer, hover, diagnostics) that could freeze the editor on `.atlx` files. The extension is now fully declarative: grammar + language configuration + snippets, no activation events.
- New backtracking-safe TextMate grammar covering the canonical Aetralis surface only (annotation-style handlers, `const`/`var` bindings, `assert ... throw`, `match`, `buildMessage`, send modes). Legacy forms (`slice`, `cell`, `let`, `val`, `mut`, `message external ...`) are no longer highlighted as keywords.
- Fixed colors across all VS Code themes via `configurationDefaults` token color rules scoped to `*.atlx` only.
- Added `/* ... */` block comment support to the editor configuration.
- Rewrote snippets around the canonical contract skeleton.
