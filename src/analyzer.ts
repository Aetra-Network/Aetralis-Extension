import {
  annotationDetails,
  annotationNames,
  annotationTemplates,
  builtinConstants,
  builtinTypes,
  builtins,
  controlKeywords,
  createMessageFields,
  declarationKeywords,
  metadataKeywords,
  bounceModeMembers,
  makeSet,
  memberCompletions,
  reservedHandlerNames
} from "./language-data";

const IMPLICIT_NAMES = new Set(["state", "contract", "msg", "self", "this", "in", "out"]);

const DECLARATION_KEYWORDS: Set<string> = makeSet(declarationKeywords as readonly string[]);
const CONTROL_KEYWORDS: Set<string> = makeSet(controlKeywords as readonly string[]);
const METADATA_KEYWORDS: Set<string> = makeSet(metadataKeywords as readonly string[]);
const BUILTINS: Set<string> = makeSet(builtins as readonly string[]);
const BUILTIN_CONSTANTS: Set<string> = makeSet(builtinConstants as readonly string[]);
const BOUNCE_MODE_MEMBERS: Set<string> = makeSet(bounceModeMembers as readonly string[]);
const BUILTIN_TYPES: Set<string> = makeSet(builtinTypes as readonly string[]);
const CONTRACT_MEMBER_FUNCTIONS: Set<string> = makeSet(["getData", "setData"] as readonly string[]);

const ANNOTATION_ORDER = annotationNames;
const ANNOTATION_HELP = annotationDetails;

const BUILTIN_HELP: Record<string, string> = {
  now: "Returns the current block time in the runtime.",
  getBalance: "Returns the current contract balance.",
  random: "Accesses the runtime random generator.",
  createMessage: "Builds an outbound message envelope.",
  commit: "Finalizes state changes in the current execution flow.",
  skipBouncedPrefix: "Skips the bounced body prefix before decoding payload.",
  fromSegment: "Parses a typed value from a segment.",
  fromChunk: "Parses a typed value from a chunk.",
  toChunk: "Serializes a typed value into a chunk.",
  isEmpty: "Checks whether a segment or body is empty.",
  send: "Sends a message or dispatches an action."
};

export const SEMANTIC_TOKEN_TYPES = [
  "comment",
  "string",
  "annotation",
  "contractKeyword",
  "typeKeyword",
  "storageKeyword",
  "assertKeyword",
  "controlKeyword",
  "type",
  "builtinType",
  "contractName",
  "functionKeyword",
  "messageName",
  "builtin",
  "function",
  "parameter",
  "variable",
  "property",
  "constant",
  "number",
  "operator"
] as const;

export function analyzeDocument(text: string) {
  const lineStarts = buildLineStarts(text);
  const scan = scanDocument(text, lineStarts);
  const masked = maskNonCode(text);
  const extracted = extractSymbols(masked, lineStarts);
  const symbols = extracted.symbols;
  const lookup = extracted.lookup || buildLookup(symbols);
  const diagnostics = [...scan.diagnostics, ...(extracted.diagnostics || []), ...findUnknownIdentifiers(scan.tokens, lookup)];

  return {
    text,
    masked,
    lineStarts,
    tokens: scan.tokens,
    symbols,
    lookup,
    diagnostics
  };
}

export function getHoverMarkdown(analysis: any, position: any) {
  const token = tokenAtPosition(analysis.tokens, position, analysis.lineStarts);
  if (!token) {
    return null;
  }

  if (token.kind === "annotation") {
    return `**${token.text}**  \n${ANNOTATION_HELP.get(token.text) || "Annotation."}`;
  }

  if (token.kind === "comment") {
    return "Comment";
  }

  if (token.kind === "string") {
    return "String literal";
  }

  if (token.kind === "keyword") {
    return `**${token.text}**  \n${keywordHelp(token.text)}`;
  }

  if (token.kind === "builtin") {
    return `**${token.text}**  \n${BUILTIN_HELP[token.text] || "Built-in runtime helper."}`;
  }

  if (token.kind === "constant" && BUILTIN_CONSTANTS.has(token.text)) {
    return `**${token.text}**  \nBuilt-in send mode constant.`;
  }

  const symbol = analysis.lookup.byName.get(token.text);
  if (!symbol) {
    return null;
  }

  let markdown = `**${symbol.name}**  \n${symbol.detail}`;
  if (symbol.containerName) {
    markdown += `  \nContainer: \`${symbol.containerName}\``;
  }
  return markdown;
}

export function getCompletionItems(analysis: any, position: any) {
  const prefix = getPrefixAtPosition(analysis.text, position, analysis.lineStarts);
  const lineText = getLineText(analysis.text, analysis.lineStarts, position.line);
  const beforeCursor = lineText.slice(0, position.character);
  const textBeforeCursor = analysis.text.slice(0, positionToOffset(analysis.lineStarts, position));
  const token = tokenAtPosition(analysis.tokens, position, analysis.lineStarts);

  if (token && (token.kind === "comment" || token.kind === "string")) {
    return [];
  }

  const memberItems = memberCompletionItems(beforeCursor, prefix);
  if (memberItems.length) {
    return dedupeCompletionItems(memberItems);
  }

  const createMessageItems = createMessageCompletionItems(textBeforeCursor, prefix);
  if (createMessageItems.length) {
    return dedupeCompletionItems(createMessageItems);
  }

  if (/@$/.test(beforeCursor) || /@[A-Za-z_][A-Za-z0-9_]*$/.test(beforeCursor)) {
    return annotationCompletionItems(prefix);
  }

  const items = [];
  items.push(...makeCompletionItems([...DECLARATION_KEYWORDS], "Keyword", prefix, "Declaration keyword"));
  items.push(...makeCompletionItems([...CONTROL_KEYWORDS], "Keyword", prefix, "Control keyword"));
  items.push(...makeCompletionItems([...METADATA_KEYWORDS], "Keyword", prefix, "Contract metadata"));
  items.push(...makeCompletionItems([...analysis.lookup.byName.values()], null, prefix, null, true));

  return dedupeCompletionItems(items);
}

export function getDocumentSymbols(analysis: any) {
  return analysis.symbols.map((symbol: any) => ({
    name: symbol.name,
    detail: symbol.detail,
    kind: symbol.kind,
    range: symbol.range,
    selectionRange: symbol.selectionRange
  }));
}

export function getSemanticTokens(analysis: any) {
  const tokens = [];
  for (let i = 0; i < analysis.tokens.length; i++) {
    const token = analysis.tokens[i];
    const type = semanticTypeForToken(token, analysis.lookup, analysis.tokens, i);
    if (!type) {
      continue;
    }
    tokens.push({
      line: token.start.line,
      character: token.start.character,
      length: token.text.length,
      type
    });
  }
  return tokens;
}

function semanticTypeForToken(token: any, lookup: any, tokens: any, index: number) {
  if (token.kind === "comment") {
    return "comment";
  }
  if (token.kind === "string") {
    return "string";
  }
  if (token.kind === "annotation") {
    return "annotation";
  }
  if (token.kind === "builtin") {
    return "builtin";
  }
  if (token.kind === "type") {
    return "builtinType";
  }
  if (token.kind === "function") {
    return "function";
  }
  if (token.kind === "parameter") {
    return "parameter";
  }
  if (token.kind === "variable") {
    return "variable";
  }
  if (token.kind === "constant") {
    return "constant";
  }
  if (token.kind === "number") {
    return "number";
  }
  if (token.kind === "operator") {
    return "operator";
  }
  if (token.kind === "property") {
    return "property";
  }
  if (token.kind === "keyword") {
    if (DECLARATION_KEYWORDS.has(token.text)) {
      if (token.text === "contract") {
        return "contractKeyword";
      }
      if (token.text === "type") {
        return "typeKeyword";
      }
      if (token.text === "struct") {
        return "typeKeyword";
      }
      if (token.text === "func") {
        return "functionKeyword";
      }
      if (token.text === "const" || token.text === "var" || token.text === "val") {
        return "storageKeyword";
      }
      return "storageKeyword";
    }
    if (CONTROL_KEYWORDS.has(token.text)) {
      if (token.text === "var" || token.text === "val") {
        return "storageKeyword";
      }
      if (token.text === "assert") {
        return "assertKeyword";
      }
      return "controlKeyword";
    }
    if (METADATA_KEYWORDS.has(token.text)) {
      return "property";
    }
    return "controlKeyword";
  }
  if (token.kind !== "identifier") {
    return null;
  }
  if (BUILTINS.has(token.text)) {
    return "builtin";
  }
  if (BUILTIN_CONSTANTS.has(token.text)) {
    return "constant";
  }
  if (BOUNCE_MODE_MEMBERS.has(token.text)) {
    return "constant";
  }
  if (lookup.messageNames && lookup.messageNames.has(token.text)) {
    return "messageName";
  }
  const previous = previousSignificantToken(tokens, index);
  if (previous && previous.kind === "operator" && previous.text === "." && CONTRACT_MEMBER_FUNCTIONS.has(token.text)) {
    return "builtin";
  }
  if (lookup.contractNames && lookup.contractNames.has(token.text)) {
    return "contractName";
  }
  if (BUILTIN_TYPES.has(token.text)) {
    return "builtinType";
  }
  if (lookup.typeNames.has(token.text)) {
    return "type";
  }
  if (lookup.functionNames.has(token.text)) {
    return "function";
  }
  if (lookup.parameterNames.has(token.text)) {
    return "parameter";
  }
  if (lookup.variableNames.has(token.text)) {
    return "variable";
  }
  if (lookup.fields.has(token.text)) {
    return "property";
  }
  if (lookup.constantNames.has(token.text)) {
    return "constant";
  }
  if (IMPLICIT_NAMES.has(token.text)) {
    return "variable";
  }
  return null;
}

function scanDocument(text: string, lineStarts: number[]) {
  const tokens: any[] = [];
  const diagnostics: any[] = [];
  const stack: any[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    const start = offsetToPosition(lineStarts, i);

    if (ch === "/" && next === "/") {
      const begin = i;
      i += 2;
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      tokens.push({
        kind: "comment",
        text: text.slice(begin, i),
        start,
        end: offsetToPosition(lineStarts, i)
      });
      continue;
    }

    if (ch === "/" && next === "*") {
      const begin = i;
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
          continue;
        }
        if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
          continue;
        }
        i++;
      }
      tokens.push({
        kind: "comment",
        text: text.slice(begin, i),
        start,
        end: offsetToPosition(lineStarts, i)
      });
      if (depth > 0) {
        diagnostics.push({
          severity: "error",
          code: "E_UNTERMINATED_COMMENT",
          message: "Unterminated block comment.",
          range: rangeFromPositions(start, offsetToPosition(lineStarts, text.length))
        });
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const quote = ch;
      const begin = i;
      i++;
      let escaped = false;
      let closed = false;
      while (i < text.length) {
        const curr = text[i];
        if (escaped) {
          escaped = false;
          i++;
          continue;
        }
        if (curr === "\\") {
          escaped = true;
          i++;
          continue;
        }
        if (curr === quote) {
          i++;
          closed = true;
          break;
        }
        if (curr === "\n") {
          break;
        }
        i++;
      }
      tokens.push({
        kind: "string",
        text: text.slice(begin, i),
        start,
        end: offsetToPosition(lineStarts, i)
      });
      if (!closed) {
        diagnostics.push({
          severity: "error",
          code: "E_UNTERMINATED_STRING",
          message: "Unterminated string literal.",
          range: rangeFromPositions(start, offsetToPosition(lineStarts, i))
        });
      }
      continue;
    }

    if (ch === "@") {
      const begin = i;
      i++;
      while (i < text.length && isIdentPart(text[i])) {
        i++;
      }
      if (i === begin + 1) {
        diagnostics.push({
          severity: "error",
          code: "E_BAD_ANNOTATION",
          message: "Expected annotation name after '@'.",
          range: rangeFromPositions(start, offsetToPosition(lineStarts, i))
        });
        continue;
      }
      if (text[i] === "(") {
        let depth = 0;
        while (i < text.length) {
          if (text[i] === "(") {
            depth++;
          } else if (text[i] === ")") {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          i++;
        }
      }
      tokens.push({
        kind: "annotation",
        text: text.slice(begin, i),
        start,
        end: offsetToPosition(lineStarts, i)
      });
      continue;
    }

    if (isIdentStart(ch)) {
      const begin = i;
      i++;
      while (i < text.length && isIdentPart(text[i])) {
        i++;
      }
      const ident = text.slice(begin, i);
      tokens.push({
        kind: classifyWord(ident),
        text: ident,
        start,
        end: offsetToPosition(lineStarts, i)
      });
      continue;
    }

    if (isDigit(ch)) {
      const begin = i;
      if (ch === "0" && (next === "x" || next === "X")) {
        i += 2;
        while (i < text.length && isHexDigit(text[i])) {
          i++;
        }
      } else {
        while (i < text.length && /[0-9_]/.test(text[i])) {
          i++;
        }
      }
      tokens.push({
        kind: "number",
        text: text.slice(begin, i),
        start,
        end: offsetToPosition(lineStarts, i)
      });
      continue;
    }

    const two = ch + next;
    if (["->", "=>", "==", "!=", "<=", ">=", "&&", "||", "..", "::", "+=", "-=", "*=", "/=", "%="].includes(two)) {
      i += 2;
      tokens.push({
        kind: "operator",
        text: two,
        start,
        end: offsetToPosition(lineStarts, i)
      });
      continue;
    }

    if ("{}()[],:;.+-*/=<>&|!?".includes(ch)) {
      i++;
      tokens.push({
        kind: "operator",
        text: ch,
        start,
        end: offsetToPosition(lineStarts, i)
      });
      handleBracket(ch, start, stack, diagnostics, lineStarts, i);
      continue;
    }

    diagnostics.push({
      severity: "error",
      code: "E_BAD_CHAR",
      message: `Unexpected character "${ch}".`,
      range: rangeFromPositions(start, offsetToPosition(lineStarts, i + 1))
    });
    i++;
  }

  while (stack.length) {
    const open = stack.pop();
    diagnostics.push({
      severity: "error",
      code: "E_UNMATCHED_OPEN",
      message: `Unclosed ${open.openChar}.`,
      range: rangeFromPositions(open.position, open.position)
    });
  }

  return { tokens, diagnostics };
}

function maskNonCode(text: string) {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      out.push(" ", " ");
      i += 2;
      while (i < text.length && text[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          out.push(" ", " ");
          i += 2;
          depth++;
          continue;
        }
        if (text[i] === "*" && text[i + 1] === "/") {
          out.push(" ", " ");
          i += 2;
          depth--;
          continue;
        }
        out.push(text[i] === "\n" ? "\n" : " ");
        i++;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const quote = ch;
      out.push(" ");
      i++;
      let escaped = false;
      while (i < text.length) {
        const curr = text[i];
        if (curr === "\n") {
          out.push("\n");
          i++;
          break;
        }
        out.push(" ");
        if (escaped) {
          escaped = false;
          i++;
          continue;
        }
        if (curr === "\\") {
          escaped = true;
          i++;
          continue;
        }
        if (curr === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join("");
}

function extractSymbols(masked: string, lineStarts: number[]) {
  const symbols: any[] = [];
  const diagnostics: any[] = [];
  const lookup = {
    byName: new Map<string, any>(),
    contractNames: new Set<string>(),
    typeNames: new Set<string>(),
    messageNames: new Set<string>(),
    functionNames: new Set<string>(),
    parameterNames: new Set<string>(),
    variableNames: new Set<string>(),
    fields: new Set<string>(),
    constantNames: new Set<string>(),
    allNames: new Set<string>()
  };

  const note = (kind: string, name: string, detail: string, range: any, containerName?: string) => {
    const symbol = { kind, name, detail, range, selectionRange: range, containerName };
    symbols.push(symbol);
    if (!lookup.byName.has(name)) {
      lookup.byName.set(name, symbol);
    }
    lookup.allNames.add(name);
    switch (kind) {
      case "Class":
        lookup.contractNames.add(name);
        break;
      case "Type":
        lookup.typeNames.add(name);
        break;
      case "Message":
        lookup.messageNames.add(name);
        break;
      case "Function":
      case "Method":
        lookup.functionNames.add(name);
        break;
      case "Variable":
        lookup.variableNames.add(name);
        break;
      case "Parameter":
        lookup.parameterNames.add(name);
        break;
      case "Field":
        lookup.fields.add(name);
        break;
      case "Constant":
        lookup.constantNames.add(name);
        break;
      default:
        break;
    }

    if (isReservedSymbolName(name)) {
      const label = containerName ? `${containerName}.${name}` : name;
      const reserved = reservedHandlerNames[name];
      const message = reserved
        ? `Reserved name "${label}" is only allowed for ${reserved.annotation}.`
        : `Keyword "${name}" cannot be used as an identifier.`;
      diagnostics.push({
        severity: "error",
        code: "E_RESERVED_IDENTIFIER",
        message,
        range
      });
    }
  };

  const topLevelRegexes = [
    {
      pattern: /(?:^|\n)\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g,
      kind: "Type",
      nameGroup: 1,
      detail: (match: any) => `type alias = ${match[2].trim()}`
    },
    {
      pattern: /(?:^|\n)\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g,
      kind: "Constant",
      nameGroup: 1,
      detail: (match: any) => `const = ${match[2].trim()}`
    },
    {
      pattern: /(?:^|\n)\s*contract\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g,
      kind: "Class",
      nameGroup: 1,
      detail: () => "contract"
    },
    {
      pattern: /(?:^|\n)\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*)*struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g,
      kind: "Type",
      nameGroup: 1,
      detail: () => "struct",
      bodyGroup: 2
    },
    {
      pattern: /(?:^|\n)\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*)*func\s+(?:(?:[A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^{\n]+))?/g,
      kind: "Function",
      nameGroup: 1,
      paramsGroup: 2,
      returnGroup: 3,
      detail: (match: any) => signatureText("func", match[1], match[2] || "", (match[3] || "").trim())
    }
  ];

  for (const spec of topLevelRegexes) {
    for (const match of masked.matchAll(spec.pattern)) {
      const name = match[spec.nameGroup || 1];
      const offset = match.index + match[0].lastIndexOf(name);
      const range = rangeFromOffset(lineStarts, offset, offset + name.length);
      note(spec.kind, name, spec.detail(match), range);
      if (spec.kind === "Type" && /@message\b/.test(match[0])) {
        lookup.messageNames.add(name);
      }

      if (spec.bodyGroup === 2) {
        const body = match[2] || "";
        if (match[0].includes("struct ")) {
          for (const field of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=\n]+?)(?:\s*=\s*([^\n]+))?\s*;?\s*$/gm)) {
            const fieldName = field[1];
            const fieldOffset = match.index + match[0].indexOf(field[0]) + field[0].indexOf(fieldName);
            note("Field", fieldName, `field: ${field[2].trim()}`, rangeFromOffset(lineStarts, fieldOffset, fieldOffset + fieldName.length), name);
          }
        }
      }

      const paramsText = spec.paramsGroup ? (match[spec.paramsGroup] || "") : "";
      if (spec.kind === "Function" && paramsText) {
        for (const param of extractNamedEntries(paramsText)) {
          const paramOffset = match.index + match[0].indexOf(paramsText) + paramsText.indexOf(param.name);
          note("Parameter", param.name, `param: ${param.type}`, rangeFromOffset(lineStarts, paramOffset, paramOffset + param.name.length), name);
        }
      }

      if (spec.kind === "Function") {
        const annotations = collectAnnotations(match[0]);
        validateReservedHandlerUsage(name, annotations, paramsText, range, diagnostics);
      }
    }
  }

  for (const match of masked.matchAll(/\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
    const contractName = match[1];
    const contractBodyStart = match.index + match[0].length;
    const region = contractFieldRegion(masked.slice(contractBodyStart));
    for (const field of region.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n]+)$/gm)) {
      const fieldName = field[1];
      const fieldOffset = contractBodyStart + field.index + field[0].indexOf(fieldName);
      note("Field", fieldName, `contract field: ${field[2].trim()}`, rangeFromOffset(lineStarts, fieldOffset, fieldOffset + fieldName.length), contractName);
    }
  }

  for (const match of masked.matchAll(/\b(?:var|val)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    const offset = match.index + match[0].lastIndexOf(name);
    note("Variable", name, "local variable", rangeFromOffset(lineStarts, offset, offset + name.length));
  }

  return { symbols, lookup, diagnostics };
}

function buildLookup(symbols: any[]) {
  const lookup = {
    byName: new Map<string, any>(),
    contractNames: new Set<string>(),
    typeNames: new Set<string>(),
    messageNames: new Set<string>(),
    functionNames: new Set<string>(),
    parameterNames: new Set<string>(),
    variableNames: new Set<string>(),
    fields: new Set<string>(),
    constantNames: new Set<string>(),
    allNames: new Set<string>()
  };

  for (const symbol of symbols) {
    if (!lookup.byName.has(symbol.name)) {
      lookup.byName.set(symbol.name, symbol);
    }
    lookup.allNames.add(symbol.name);
    switch (symbol.kind) {
      case "Class":
        lookup.contractNames.add(symbol.name);
        break;
      case "Type":
        lookup.typeNames.add(symbol.name);
        break;
      case "Message":
        lookup.messageNames.add(symbol.name);
        break;
      case "Function":
      case "Method":
        lookup.functionNames.add(symbol.name);
        break;
      case "Parameter":
        lookup.parameterNames.add(symbol.name);
        break;
      case "Variable":
        lookup.variableNames.add(symbol.name);
        break;
      case "Field":
        lookup.fields.add(symbol.name);
        break;
      case "Constant":
        lookup.constantNames.add(symbol.name);
        break;
      default:
        break;
    }
  }

  return lookup;
}

function collectAnnotations(text: string) {
  return (text.match(/@[A-Za-z_][A-Za-z0-9_]*/g) || []).filter(Boolean);
}

function validateReservedHandlerUsage(name: string, annotations: string[], paramsText: string, range: any, diagnostics: any[]) {
  const rule = reservedHandlerNames[name];
  const reservedAnnotation = annotations.find((annotation) => {
    return annotation === "@internal" || annotation === "@external" || annotation === "@bounced";
  });

  if (!rule && !reservedAnnotation) {
    return;
  }

  if (rule) {
    const hasExpectedAnnotation = annotations.includes(rule.annotation);
    const signature = normalizeSignatureText(`func ${name}(${paramsText})`);
    if (!hasExpectedAnnotation || signature !== normalizeSignatureText(rule.signature)) {
      diagnostics.push({
        severity: "error",
        code: "E_RESERVED_HANDLER",
        message: `Expected ${rule.annotation} to use ${rule.signature}.`,
        range
      });
    }
    return;
  }

  const expectedName = reservedHandlerNameFromAnnotation(reservedAnnotation);
  if (expectedName) {
    diagnostics.push({
      severity: "error",
      code: "E_RESERVED_HANDLER",
      message: `Function declared with ${reservedAnnotation} must be named ${expectedName}.`,
      range
    });
  }
}

function reservedHandlerNameFromAnnotation(annotation: string) {
  switch (annotation) {
    case "@internal":
      return "onInternalMessage";
    case "@external":
      return "onExternalMessage";
    case "@bounced":
      return "onBouncedMessage";
    default:
      return null;
  }
}

function normalizeSignatureText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function signatureText(prefix: string, name: string, params: string, returnType: string) {
  const suffix = returnType ? ` -> ${returnType}` : "";
  return `${prefix} ${name}(${params})${suffix}`;
}

function contractFieldRegion(body: string) {
  const candidates = [body.search(/\n\s*@/), body.search(/\n\s*func\b/), body.search(/\n\s*}/)].filter((offset) => offset >= 0);
  const end = candidates.length ? Math.min(...candidates) : body.length;
  return body.slice(0, end);
}

function isReservedSymbolName(name: string) {
  const keywordNames = new Set([
    ...DECLARATION_KEYWORDS,
    ...CONTROL_KEYWORDS,
    ...BUILTINS,
    ...BUILTIN_CONSTANTS,
    ...BUILTIN_TYPES
  ]);
  return keywordNames.has(name);
}

function findUnknownIdentifiers(tokens: any[], lookup: any) {
  const diagnostics: any[] = [];
  const known = new Set([
    ...DECLARATION_KEYWORDS,
    ...CONTROL_KEYWORDS,
    ...METADATA_KEYWORDS,
    ...BUILTINS,
    ...BUILTIN_CONSTANTS,
    ...BOUNCE_MODE_MEMBERS,
    ...BUILTIN_TYPES,
    ...IMPLICIT_NAMES,
    ...lookup.allNames
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== "identifier") {
      continue;
    }
    if (known.has(token.text)) {
      continue;
    }
    const prev = previousSignificantToken(tokens, i);
    const next = nextSignificantToken(tokens, i);
    if (prev && prev.kind === "operator" && prev.text === ".") {
      continue;
    }
    if (next && next.kind === "operator" && next.text === ":") {
      continue;
    }

    const suggestion = closestName(token.text, [...lookup.allNames, ...BUILTINS, ...BUILTIN_CONSTANTS, ...BUILTIN_TYPES, ...IMPLICIT_NAMES]);
    diagnostics.push({
      severity: "warning",
      code: "W_UNKNOWN_IDENTIFIER",
      message: suggestion ? `Unknown identifier "${token.text}". Did you mean "${suggestion}"?` : `Unknown identifier "${token.text}".`,
      range: rangeFromPositions(token.start, token.end)
    });
  }

  return diagnostics;
}

function closestName(name: string, candidates: string[]) {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (!candidate || candidate === name) {
      continue;
    }
    if (candidate[0] && name[0] && candidate[0].toLowerCase() !== name[0].toLowerCase()) {
      continue;
    }
    const score = levenshtein(name, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= 2 ? best : null;
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function previousSignificantToken(tokens: any[], index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].kind !== "comment" && tokens[i].kind !== "string") {
      return tokens[i];
    }
  }
  return null;
}

function nextSignificantToken(tokens: any[], index: number) {
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== "comment" && tokens[i].kind !== "string") {
      return tokens[i];
    }
  }
  return null;
}

function tokenAtPosition(tokens: any[], position: any, lineStarts: number[]) {
  const offset = positionToOffset(lineStarts, position);
  let low = 0;
  let high = tokens.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = positionToOffset(lineStarts, tokens[mid].start);
    if (start <= offset) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate < 0) {
    return null;
  }

  const token = tokens[candidate];
  const end = positionToOffset(lineStarts, token.end);
  return offset < end ? token : null;
}

function getPrefixAtPosition(text: string, position: any, lineStarts?: number[]) {
  const starts = lineStarts || buildLineStarts(text);
  const line = getLineText(text, starts, position.line);
  const slice = line.slice(0, position.character);
  const match = slice.match(/[A-Za-z_@][A-Za-z0-9_@]*$/);
  return match ? match[0] : "";
}

function getLineText(text: string, lineStarts: number[], line: number) {
  const start = lineStarts[line] || 0;
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
  return text.slice(start, end).replace(/\r$/, "");
}

function memberCompletionItems(beforeCursor: string, prefix: string) {
  const match = beforeCursor.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (!match) {
    return [];
  }
  const base = match[1];
  const items = memberCompletions[base];
  if (!items) {
    return [];
  }
  return items
    .filter((item) => matchesPrefix(item.label, prefix))
    .map((item) => ({
      label: item.label,
      kind: "Property",
      detail: item.detail,
      sortText: `00_${base}_${item.label}`
    }));
}

function classifyWord(word: string) {
  if (DECLARATION_KEYWORDS.has(word) || CONTROL_KEYWORDS.has(word)) {
    return "keyword";
  }
  if (METADATA_KEYWORDS.has(word)) {
    return "keyword";
  }
  if (BUILTINS.has(word)) {
    return "builtin";
  }
  if (BUILTIN_CONSTANTS.has(word)) {
    return "constant";
  }
  if (BOUNCE_MODE_MEMBERS.has(word)) {
    return "constant";
  }
  if (BUILTIN_TYPES.has(word)) {
    return "type";
  }
  if (word === "true" || word === "false" || word === "null") {
    return "constant";
  }
  return "identifier";
}

function keywordHelp(word: string) {
  if (DECLARATION_KEYWORDS.has(word)) {
    switch (word) {
      case "contract":
        return "Declares a contract.";
      case "type":
        return "Declares a type alias.";
      case "struct":
        return "Declares a struct type.";
      case "func":
        return "Declares a function.";
      default:
        return "Declaration keyword.";
    }
  }
  if (METADATA_KEYWORDS.has(word)) {
    switch (word) {
      case "author":
        return "Contract author metadata.";
      case "description":
        return "Contract description metadata.";
      case "version":
        return "Contract version metadata.";
      default:
        return "Metadata keyword.";
    }
  }
  if (CONTROL_KEYWORDS.has(word)) {
    if (word === "assert") {
      return "Assertion keyword.";
    }
    return "Control-flow keyword.";
  }
  if (word === "true" || word === "false" || word === "null") {
    return "Literal constant.";
  }
  return "Keyword.";
}

function makeCompletionItems(values: any[], kind: any, prefix: string, detail: string | null, fromSymbols = false) {
  return values.map((value) => {
    if (fromSymbols) {
      const symbol = value;
      return makeCompletionItem(symbol.name, symbolKindToCompletionKind(symbol.kind), prefix, symbol.detail);
    }
    return makeCompletionItem(value, kind, prefix, detail);
  });
}

function annotationCompletionItems(prefix: string) {
  const items = [];
  for (const name of ANNOTATION_ORDER) {
    const template = annotationTemplates[name];
    if (template) {
      items.push(makeSnippetCompletionItem(template, prefix));
      continue;
    }
    items.push(makeCompletionItem(name, "Keyword", prefix, ANNOTATION_HELP.get(name) || "Annotation."));
  }
  return items.filter(Boolean);
}

function createMessageCompletionItems(beforeCursor: string, prefix: string) {
  if (!/createMessage\s*\(\s*\{[\s\S]*$/.test(beforeCursor)) {
    return [];
  }
  return createMessageFields.map((field) => makeCompletionItem(field.label, "Property", prefix, field.detail)).filter(Boolean);
}

function symbolKindToCompletionKind(kind: string) {
  switch (kind) {
    case "Class":
      return "Class";
    case "Function":
    case "Method":
      return "Function";
    case "Parameter":
      return "Variable";
    case "Variable":
      return "Variable";
    case "Field":
      return "Field";
    case "Constant":
      return "Constant";
    case "Type":
      return "TypeParameter";
    default:
      return "Property";
  }
}

function makeCompletionItem(label: string, kind: string | null, prefix: string, detail: string | null) {
  if (!matchesPrefix(label, prefix)) {
    return null;
  }
  const item: any = {
    label,
    kind,
    detail,
    sortText: `${completionRank(kind)}_${label.toLowerCase()}`
  };
  if (label.startsWith("@")) {
    item.insertText = label.slice(1);
  }
  return item;
}

function makeSnippetCompletionItem(template: any, prefix: string) {
  if (!matchesPrefix(template.label, prefix)) {
    return null;
  }
  return {
    label: template.label,
    kind: "Snippet",
    detail: template.detail,
    insertText: template.body.join("\n"),
    sortText: `00_${template.label.toLowerCase()}`
  };
}

function matchesPrefix(label: string, prefix: string) {
  if (!prefix) {
    return true;
  }
  const normalizedPrefix = prefix.replace(/^@/, "").toLowerCase();
  const normalizedLabel = label.replace(/^@/, "").toLowerCase();
  return normalizedLabel.startsWith(normalizedPrefix);
}

function completionRank(kind: any) {
  switch (kind) {
    case "Keyword":
      return "01";
    case "Constant":
      return "02";
    case "Function":
      return "03";
    case "Class":
    case "TypeParameter":
      return "04";
    case "Property":
      return "05";
    case "Field":
      return "06";
    case "Variable":
      return "07";
    default:
      return "99";
  }
}

function dedupeCompletionItems(items: any[]) {
  const seen = new Set<string>();
  const out = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    const key = `${item.label}:${item.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractNamedEntries(text: string) {
  const out: any[] = [];
  for (const part of splitTopLevel(text, ",")) {
    const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (match) {
      out.push({ name: match[1], type: match[2].trim() });
    }
  }
  return out;
}

function splitTopLevel(text: string, separator: string) {
  const out: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let start = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }

    switch (ch) {
      case "(":
        depthParen++;
        break;
      case ")":
        depthParen = Math.max(0, depthParen - 1);
        break;
      case "{":
        depthBrace++;
        break;
      case "}":
        depthBrace = Math.max(0, depthBrace - 1);
        break;
      case "[":
        depthBracket++;
        break;
      case "]":
        depthBracket = Math.max(0, depthBracket - 1);
        break;
      case "<":
        depthAngle++;
        break;
      case ">":
        depthAngle = Math.max(0, depthAngle - 1);
        break;
      default:
        break;
    }

    if (ch === separator && depthParen === 0 && depthBrace === 0 && depthBracket === 0 && depthAngle === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }

  out.push(text.slice(start));
  return out;
}

function buildLineStarts(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      if (mid === lineStarts.length - 1 || lineStarts[mid + 1] > offset) {
        return { line: mid, character: offset - lineStarts[mid] };
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { line: 0, character: offset };
}

function positionToOffset(lineStarts: number[], position: any) {
  const line = Math.max(0, Math.min(position.line, lineStarts.length - 1));
  return (lineStarts[line] || 0) + position.character;
}

function rangeFromPositions(start: any, end: any) {
  return { start, end };
}

function rangeFromOffset(lineStarts: number[], start: number, end: number) {
  return rangeFromPositions(offsetToPosition(lineStarts, start), offsetToPosition(lineStarts, end));
}

function handleBracket(ch: string, start: any, stack: any[], diagnostics: any[], lineStarts: number[], nextOffset: number) {
  if ("{[(".includes(ch)) {
    stack.push({ openChar: ch, position: start });
    return;
  }

  const closeToOpen: Record<string, string> = {
    "}": "{",
    "]": "[",
    ")": "("
  };
  const expected = closeToOpen[ch];
  if (!expected) {
    return;
  }

  const last = stack.pop();
  if (!last) {
    diagnostics.push({
      severity: "error",
      code: "E_UNMATCHED_CLOSE",
      message: `Unexpected closing ${ch}.`,
      range: rangeFromPositions(start, offsetToPosition(lineStarts, nextOffset))
    });
    return;
  }
  if (last.openChar !== expected) {
    diagnostics.push({
      severity: "error",
      code: "E_BRACKET_MISMATCH",
      message: `Mismatched ${ch}; expected ${matchingClose(last.openChar)}.`,
      range: rangeFromPositions(start, offsetToPosition(lineStarts, nextOffset))
    });
  }
}

function matchingClose(openChar: string) {
  switch (openChar) {
    case "{":
      return "}";
    case "[":
      return "]";
    case "(":
      return ")";
    default:
      return "?";
  }
}

function isWhitespace(ch: string) {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isIdentStart(ch: string) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string) {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string) {
  return /[0-9]/.test(ch);
}

function isHexDigit(ch: string) {
  return /[0-9A-Fa-f]/.test(ch);
}
