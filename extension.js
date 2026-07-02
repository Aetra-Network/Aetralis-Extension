"use strict";

const vscode = require("vscode");
const {
  analyzeDocument,
  getHoverMarkdown,
  getCompletionItems,
  getDocumentSymbols,
  getSemanticTokens,
  SEMANTIC_TOKEN_TYPES
} = require("./analyzer");

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("aetralis");
  const validationTimers = new Map();
  const semanticTokensLegend = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, []);

  const validate = (document) => {
    if (!isAtlxDocument(document)) {
      return;
    }

    try {
      const analysis = analyzeDocument(document.getText());
      diagnostics.set(document.uri, analysis.diagnostics.map(toDiagnostic));
    } catch (error) {
      diagnostics.set(document.uri, [
        new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Aetralis analysis failed: ${error.message}`,
          vscode.DiagnosticSeverity.Error
        )
      ]);
    }
  };

  const scheduleValidation = (document) => {
    if (!isAtlxDocument(document)) {
      return;
    }

    const key = document.uri.toString();
    const existing = validationTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      validationTimers.delete(key);
      validate(document);
    }, 120);
    validationTimers.set(key, timer);
  };

  const disposables = [
    diagnostics,
    vscode.languages.registerCompletionItemProvider(
      { language: "atlx" },
      {
        provideCompletionItems(document, position) {
          const analysis = analyzeDocument(document.getText());
          return getCompletionItems(analysis, position).map(toCompletionItem);
        }
      },
      "@",
      ".",
      ":"
    ),
    vscode.languages.registerHoverProvider(
      { language: "atlx" },
      {
        provideHover(document, position) {
          const analysis = analyzeDocument(document.getText());
          const markdown = getHoverMarkdown(analysis, position);
          return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown)) : null;
        }
      }
    ),
    vscode.languages.registerDocumentSymbolProvider(
      { language: "atlx" },
      {
        provideDocumentSymbols(document) {
          const analysis = analyzeDocument(document.getText());
          return getDocumentSymbols(analysis).map(toDocumentSymbol);
        }
      }
    ),
    vscode.languages.registerSemanticTokensProvider(
      { language: "atlx" },
      {
        provideSemanticTokens(document) {
          const analysis = analyzeDocument(document.getText());
          const builder = new vscode.SemanticTokensBuilder();
          for (const token of getSemanticTokens(analysis)) {
            const index = SEMANTIC_TOKEN_TYPES.indexOf(token.type);
            if (index >= 0) {
              builder.push(token.line, token.character, token.length, index, 0);
            }
          }
          return builder.build();
        }
      },
      semanticTokensLegend
    ),
    vscode.workspace.onDidOpenTextDocument((document) => scheduleValidation(document)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleValidation(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => validate(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      const key = document.uri.toString();
      const existing = validationTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        validationTimers.delete(key);
      }
    }),
    {
      dispose() {
        for (const timer of validationTimers.values()) {
          clearTimeout(timer);
        }
        validationTimers.clear();
      }
    }
  ];

  context.subscriptions.push(...disposables);

  for (const document of vscode.workspace.textDocuments) {
    scheduleValidation(document);
  }
}

function deactivate() {}

function isAtlxDocument(document) {
  return document.languageId === "atlx" || document.fileName.toLowerCase().endsWith(".atlx");
}

function toDiagnostic(diag) {
  const severity = diag.severity === "warning"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
  const diagnostic = new vscode.Diagnostic(toRange(diag.range), diag.message || "Aetralis diagnostic", severity);
  diagnostic.source = "aetralis";
  diagnostic.code = diag.code || undefined;
  return diagnostic;
}

function toCompletionItem(item) {
  const completion = new vscode.CompletionItem(item.label, completionKindFromName(item.kind));
  completion.detail = item.detail || "";
  completion.sortText = item.sortText;
  return completion;
}

function toDocumentSymbol(symbol) {
  return new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail || "",
    symbolKindFromName(symbol.kind),
    toRange(symbol.range),
    toRange(symbol.selectionRange)
  );
}

function toRange(range) {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}

function symbolKindFromName(kind) {
  switch (kind) {
    case "Class":
      return vscode.SymbolKind.Class;
    case "Function":
    case "Method":
      return vscode.SymbolKind.Function;
    case "Event":
      return vscode.SymbolKind.Event;
    case "Field":
      return vscode.SymbolKind.Field;
    case "EnumMember":
      return vscode.SymbolKind.EnumMember;
    case "Variable":
      return vscode.SymbolKind.Variable;
    case "Parameter":
      return vscode.SymbolKind.Variable;
    case "Type":
      return vscode.SymbolKind.TypeParameter;
    case "Constant":
      return vscode.SymbolKind.Constant;
    default:
      return vscode.SymbolKind.Property;
  }
}

function completionKindFromName(kind) {
  switch (kind) {
    case "Keyword":
      return vscode.CompletionItemKind.Keyword;
    case "Value":
      return vscode.CompletionItemKind.Value;
    case "Field":
      return vscode.CompletionItemKind.Field;
    case "EnumMember":
      return vscode.CompletionItemKind.EnumMember;
    case "Function":
      return vscode.CompletionItemKind.Function;
    case "TypeParameter":
      return vscode.CompletionItemKind.TypeParameter;
    case "Variable":
      return vscode.CompletionItemKind.Variable;
    case "Constant":
      return vscode.CompletionItemKind.Constant;
    case "Class":
      return vscode.CompletionItemKind.Class;
    case "Property":
      return vscode.CompletionItemKind.Property;
    default:
      return vscode.CompletionItemKind.Text;
  }
}

module.exports = {
  activate,
  deactivate
};
