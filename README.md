<p align="center">
  <img src="./assets/aetralis.png" alt="Aetralis Language" width="140" />
</p>

# Aetralis Language

VS Code support for Aetralis smart contract development on the Aetra blockchain.

## Features

- syntax highlighting for the Aetralis language surface
- diagnostics for unmatched brackets, broken strings, malformed annotations, reserved names, and unknown identifiers
- completions for annotations, built-ins, declared symbols, member access, and message builders
- hover help for keywords, annotations, built-ins, and declared symbols
- document symbols and semantic highlighting
- snippets for common Aetralis constructs

## Notes

- functions use `func`
- `@internal`, `@external`, and `@bounced` insert reserved handler templates and are validated against their expected names
- the extension keeps the highlighted keyword set intentionally narrow so it stays aligned with the current language model
- the header logo comes from `assets/aetralis.png`
