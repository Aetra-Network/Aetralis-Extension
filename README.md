# Aetralis Language

Editor support for Aetralis smart contracts (`.atlx`) in Visual Studio Code.

Aetralis is a purpose-built smart contract language. This extension gives it a proper home in the editor: your code is colored consistently no matter which color theme you use, the editor understands what you're pointing at and offers to explain it, it helps you write correct code faster by suggesting what you're likely to type next — including the names you've already declared yourself — and it flags structural mistakes as you type, before you ever reach for the compiler.

## What it does

- **Highlighting** that reflects the shape of the language rather than approximating it — every construct gets its own distinct, theme-independent color, so the same file looks the same whether you're on a light theme, a dark theme, or a custom one.
- **Contextual documentation on hover** — point at any part of your code and see what it means, what rules govern it, and how it's meant to be used, without leaving the editor.
- **Completion that knows your project** — suggestions cover the language's own vocabulary as well as everything you've declared yourself, anywhere in your workspace. Start typing a name you've already used and it's offered back to you; accept it with Tab or a click, the same way any other suggestion works.
- **Jump to definition** — navigate directly from a usage to where it's declared, including across files that reference one another.
- **Inline diagnostics** that mirror the language's own structural rules, catching a class of mistakes immediately instead of after a full build.

All of this runs entirely inside the editor: nothing is sent anywhere, and there is no separate compiler or language server process to install or manage.

## Requirements

Visual Studio Code 1.85 or later. No other setup is required — installing the extension is enough.

## Installation

Install **Aetralis Language** from the Visual Studio Code Marketplace, or install a downloaded `.vsix` package via **Extensions → ... → Install from VSIX**.

Any file with the `.atlx` extension is recognized automatically.

## Contributing

Issues and pull requests are welcome at the [repository](https://github.com/Aetra-Network/Aetralis-Extension). See `CHANGELOG.md` for the history of released versions.

## License

Released under the [MIT License](LICENSE) — the license applies to this extension's source code. "Aetralis" and "ATLX", along with the associated logo, are marks of Aetra Network and are not covered by the MIT grant.
