import * as vscode from "vscode";
import {
  analyzeDocument,
  getCompletionItems,
  getDocumentSymbols,
  getHoverMarkdown,
  getSemanticTokens,
  SEMANTIC_TOKEN_TYPES
} from "./analyzer";

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection("aetralis");
  const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const analysisCache = new Map<string, { version: number; analysis: ReturnType<typeof analyzeDocument> }>();
  const semanticTokensLegend = new vscode.SemanticTokensLegend([...SEMANTIC_TOKEN_TYPES], []);

  const validate = (document: vscode.TextDocument) => {
    if (!isAtlxDocument(document)) {
      return;
    }

    try {
      const analysis = getAnalysis(document);
      diagnostics.set(document.uri, analysis.diagnostics.map(toDiagnostic));
    } catch (error: any) {
      diagnostics.set(document.uri, [
        new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          `Aetralis analysis failed: ${error.message}`,
          vscode.DiagnosticSeverity.Error
        )
      ]);
    }
  };

  const scheduleValidation = (document: vscode.TextDocument) => {
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

  const disposables: vscode.Disposable[] = [
    diagnostics,
    vscode.languages.registerCompletionItemProvider(
      { language: "atlx" },
      {
        provideCompletionItems(document, position) {
          const analysis = getAnalysis(document);
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
          const analysis = getAnalysis(document);
          const markdown = getHoverMarkdown(analysis, position);
          return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown)) : null;
        }
      }
    ),
    vscode.languages.registerDocumentSymbolProvider(
      { language: "atlx" },
      {
        provideDocumentSymbols(document) {
          const analysis = getAnalysis(document);
          return getDocumentSymbols(analysis).map(toDocumentSymbol);
        }
      }
    ),
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "atlx" },
      {
        provideDocumentSemanticTokens(document) {
          const analysis = getAnalysis(document);
          const builder = new vscode.SemanticTokensBuilder();
          for (const token of getSemanticTokens(analysis)) {
            const index = SEMANTIC_TOKEN_TYPES.indexOf(token.type as any);
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
      analysisCache.delete(key);
    }),
    {
      dispose() {
        for (const timer of validationTimers.values()) {
          clearTimeout(timer);
        }
        validationTimers.clear();
        analysisCache.clear();
      }
    }
  ];

  context.subscriptions.push(...disposables);

  for (const document of vscode.workspace.textDocuments) {
    scheduleValidation(document);
  }

  function getAnalysis(document: vscode.TextDocument) {
    const key = document.uri.toString();
    const cached = analysisCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.analysis;
    }

    const analysis = analyzeDocument(document.getText());
    analysisCache.set(key, { version: document.version, analysis });
    return analysis;
  }
}

export function deactivate() {}

function isAtlxDocument(document: vscode.TextDocument) {
  return document.languageId === "atlx" || document.fileName.toLowerCase().endsWith(".atlx");
}

function toDiagnostic(diag: any) {
  const severity = diag.severity === "warning"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
  const diagnostic = new vscode.Diagnostic(toRange(diag.range), diag.message || "Aetralis diagnostic", severity);
  diagnostic.source = "aetralis";
  diagnostic.code = diag.code || undefined;
  return diagnostic;
}

function toCompletionItem(item: any) {
  const completion = new vscode.CompletionItem(item.label, completionKindFromName(item.kind));
  completion.detail = item.detail || "";
  completion.sortText = item.sortText;
  if (item.insertText) {
    completion.insertText = new vscode.SnippetString(item.insertText);
  }
  return completion;
}

function toDocumentSymbol(symbol: any) {
  return new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail || "",
    symbolKindFromName(symbol.kind),
    toRange(symbol.range),
    toRange(symbol.selectionRange)
  );
}

function toRange(range: any) {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}

function symbolKindFromName(kind: string) {
  switch (kind) {
    case "Class":
      return vscode.SymbolKind.Class;
    case "Function":
    case "Method":
      return vscode.SymbolKind.Function;
    case "Field":
      return vscode.SymbolKind.Field;
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

function completionKindFromName(kind: string) {
  switch (kind) {
    case "Keyword":
      return vscode.CompletionItemKind.Keyword;
    case "Value":
      return vscode.CompletionItemKind.Value;
    case "Field":
      return vscode.CompletionItemKind.Field;
    case "Snippet":
      return vscode.CompletionItemKind.Snippet;
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
