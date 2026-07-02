![Aetralis Language](./assets/aetralis.png)

# Aetralis Language

VS Code support for the Aetralis `.atlx` language used to write smart contracts for the Aetra blockchain.

## Features

- syntax highlighting for the sample language surface used in `counter_should_be.atlx`
- diagnostics for unmatched brackets, broken strings, malformed annotations, reserved names, and unknown identifiers
- completions for declared symbols, keywords, annotation templates, and `createMessage(...)` fields
- hover help for keywords, annotations, built-ins, and declared symbols
- document symbols and semantic highlighting

## Notes

- functions use `func`
- `@internal`, `@external`, and `@bounced` insert reserved handler templates and are validated against their expected names
- the highlight set is intentionally narrow and only covers the words used in the sample source
