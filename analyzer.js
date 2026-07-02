"use strict";

const {
  declarationKeywords,
  controlKeywords,
  messageKinds,
  purityKeywords,
  surfaceKeys,
  builtins,
  builtinConstants,
  builtinTypes,
  memberCompletions,
  annotationNames,
  annotationDetails,
  makeSet
} = require("./language-data");

const IMPLICIT_NAMES = new Set(["state", "contract", "msg", "self", "this", "in", "out"]);

const DECLARATION_KEYWORDS = makeSet(declarationKeywords);
const CONTROL_KEYWORDS = makeSet(controlKeywords);
const MESSAGE_KINDS = makeSet(messageKinds);
const PURITY_KEYWORDS = makeSet(purityKeywords);
const SURFACE_KEYS = makeSet(surfaceKeys);
const BUILTINS = makeSet(builtins);
const BUILTIN_CONSTANTS = makeSet(builtinConstants);
const BUILTIN_TYPES = makeSet(builtinTypes);

const ANNOTATION_ORDER = annotationNames;
const ANNOTATION_HELP = annotationDetails;

const BUILTIN_HELP = {
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

const SURFACE_KEY_HELP = {
  author: "Contract metadata field.",
  description: "Contract metadata field.",
  version: "Contract metadata field.",
  title: "Wallet action metadata field.",
  risk: "Wallet action metadata field.",
  confirm_label: "Wallet action metadata field.",
  warning_level: "Wallet action metadata field.",
  expected_side_effects: "Wallet action metadata field.",
  fund_access: "Wallet action metadata field.",
  approval_semantics: "Wallet action metadata field."
};

const SEMANTIC_TOKEN_TYPES = [
  "comment",
  "string",
  "annotation",
  "declarationKeyword",
  "controlKeyword",
  "messageKind",
  "purityKeyword",
  "surfaceKey",
  "builtin",
  "type",
  "function",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "constant",
  "number",
  "operator"
];

function analyzeDocument(text) {
  const lineStarts = buildLineStarts(text);
  const scan = scanDocument(text, lineStarts);
  const masked = maskNonCode(text);
  const extracted = extractSymbols(masked, lineStarts);
  const symbols = extracted.symbols;
  const lookup = extracted.lookup || buildLookup(symbols);
  const diagnostics = [...scan.diagnostics, ...findUnknownIdentifiers(scan.tokens, lookup)];

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

function getHoverMarkdown(analysis, position) {
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

  if (token.kind === "surfaceKey") {
    return `**${token.text}**  \n${SURFACE_KEY_HELP[token.text] || "Metadata key."}`;
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

function getCompletionItems(analysis, position) {
  const prefix = getPrefixAtPosition(analysis.text, position);
  const lineText = getLineText(analysis.text, analysis.lineStarts, position.line);
  const beforeCursor = lineText.slice(0, position.character);
  const token = tokenAtPosition(analysis.tokens, position, analysis.lineStarts);

  if (token && (token.kind === "comment" || token.kind === "string")) {
    return [];
  }

  const memberItems = memberCompletionItems(beforeCursor, prefix);
  if (memberItems.length) {
    return dedupeCompletionItems(memberItems);
  }

  if (/(@|@[A-Za-z_][A-Za-z0-9_]*)$/.test(beforeCursor)) {
    return makeCompletionItems(ANNOTATION_ORDER, "Keyword", prefix, "Aetralis annotation");
  }

  if (/\bmessage\s+$/.test(beforeCursor)) {
    return makeCompletionItems([...MESSAGE_KINDS], "EnumMember", prefix, "Message kind");
  }

  const items = [];
  items.push(...makeCompletionItems([...DECLARATION_KEYWORDS], "Keyword", prefix, "Declaration keyword"));
  items.push(...makeCompletionItems([...CONTROL_KEYWORDS], "Keyword", prefix, "Control keyword"));
  items.push(...makeCompletionItems([...MESSAGE_KINDS], "EnumMember", prefix, "Message kind"));
  items.push(...makeCompletionItems([...PURITY_KEYWORDS], "Keyword", prefix, "Purity keyword"));
  items.push(...makeCompletionItems([...SURFACE_KEYS], "Keyword", prefix, "Metadata key"));
  items.push(...makeCompletionItems([...BUILTINS], "Function", prefix, "Built-in helper"));
  items.push(...makeCompletionItems([...BUILTIN_CONSTANTS], "Constant", prefix, "Built-in constant"));
  items.push(...makeCompletionItems([...BUILTIN_TYPES], "TypeParameter", prefix, "Type"));
  items.push(...makeCompletionItems([...analysis.lookup.byName.values()], null, prefix, null, true));

  return dedupeCompletionItems(items);
}

function getDocumentSymbols(analysis) {
  return analysis.symbols.map((symbol) => ({
    name: symbol.name,
    detail: symbol.detail,
    kind: symbol.kind,
    range: toRange(symbol.range),
    selectionRange: toRange(symbol.selectionRange)
  }));
}

function getSemanticTokens(analysis) {
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

function semanticTypeForToken(token, lookup, tokens, index) {
  if (token.kind === "comment") {
    return "comment";
  }
  if (token.kind === "string") {
    return "string";
  }
  if (token.kind === "annotation") {
    return "annotation";
  }
  if (token.kind === "number") {
    return "number";
  }
  if (token.kind === "operator") {
    return "operator";
  }
  if (token.kind === "keyword") {
    if (DECLARATION_KEYWORDS.has(token.text)) {
      return "declarationKeyword";
    }
    if (CONTROL_KEYWORDS.has(token.text)) {
      return "controlKeyword";
    }
    if (MESSAGE_KINDS.has(token.text)) {
      return "messageKind";
    }
    if (PURITY_KEYWORDS.has(token.text)) {
      return "purityKeyword";
    }
    if (SURFACE_KEYS.has(token.text)) {
      return "surfaceKey";
    }
    if (token.text === "true" || token.text === "false" || token.text === "null") {
      return "constant";
    }
    return "controlKeyword";
  }
  if (token.kind === "surfaceKey") {
    return "surfaceKey";
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
  if (lookup.typeNames.has(token.text) || BUILTIN_TYPES.has(token.text)) {
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
  if (lookup.enumMembers.has(token.text)) {
    return "enumMember";
  }
  if (lookup.constantNames.has(token.text)) {
    return "constant";
  }
  if (SURFACE_KEYS.has(token.text)) {
    return "surfaceKey";
  }
  if (IMPLICIT_NAMES.has(token.text)) {
    return "variable";
  }
  return null;
}

function scanDocument(text, lineStarts) {
  const tokens = [];
  const diagnostics = [];
  const stack = [];
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
      if (two === "->" || two === "=>" || two === "::") {
        continue;
      }
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

function maskNonCode(text) {
  const out = [];
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

function extractSymbols(masked, lineStarts) {
  const symbols = [];
  const lookup = {
    byName: new Map(),
    typeNames: new Set(),
    functionNames: new Set(),
    parameterNames: new Set(),
    variableNames: new Set(),
    fields: new Set(),
    enumMembers: new Set(),
    constantNames: new Set(),
    allNames: new Set()
  };

  const note = (kind, name, detail, range, containerName) => {
    const symbol = { kind, name, detail, range, selectionRange: range, containerName };
    symbols.push(symbol);
    if (!lookup.byName.has(name)) {
      lookup.byName.set(name, symbol);
    }
    lookup.allNames.add(name);
    switch (kind) {
      case "Class":
      case "Type":
        lookup.typeNames.add(name);
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
      case "EnumMember":
        lookup.enumMembers.add(name);
        break;
      case "Constant":
        lookup.constantNames.add(name);
        break;
      default:
        break;
    }
  };

  const topLevelRegexes = [
    {
      pattern: /(?:^|\n)\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g,
      kind: "Type",
      nameGroup: 1,
      detail: (match) => `type alias = ${match[2].trim()}`
    },
    {
      pattern: /(?:^|\n)\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g,
      kind: "Constant",
      nameGroup: 1,
      detail: (match) => `const = ${match[2].trim()}`
    },
    {
      pattern: /(?:^|\n)\s*contract\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g,
      kind: "Class",
      nameGroup: 1,
      detail: () => "contract"
    },
    {
      pattern: /(?:^|\n)\s*struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g,
      kind: "Class",
      nameGroup: 1,
      detail: () => "struct",
      bodyGroup: 2
    },
    {
      pattern: /(?:^|\n)\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g,
      kind: "Class",
      nameGroup: 1,
      detail: () => "enum",
      bodyGroup: 2
    },
    {
      pattern: /(?:^|\n)\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*)*(?:fn|fun)\s+(?:(?:[A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^{\n]+))?/g,
      kind: "Function",
      nameGroup: 1,
      paramsGroup: 2,
      returnGroup: 3,
      detail: (match) => signatureText("fn", match[1], match[2] || "", (match[3] || "").trim())
    },
    {
      pattern: /(?:^|\n)\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*)*message\s+(external|internal|bounced)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^{\n]+))?/g,
      kind: "Function",
      nameGroup: 2,
      paramsGroup: 3,
      returnGroup: 4,
      detail: (match) => `message ${match[1]}${match[3].trim() ? `(${match[3].trim()})` : ""}${match[4] ? ` -> ${match[4].trim()}` : ""}`
    },
    {
      pattern: /(?:^|\n)\s*(?:@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*)*getter\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*([^{\n]+)/g,
      kind: "Function",
      nameGroup: 1,
      paramsGroup: 2,
      returnGroup: 3,
      detail: (match) => `getter(${match[2].trim()}) -> ${match[3].trim()}`
    },
    {
      pattern: /(?:^|\n)\s*event\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
      kind: "Function",
      nameGroup: 1,
      paramsGroup: 2,
      detail: (match) => `event(${match[2].trim()})`
    },
    {
      pattern: /(?:^|\n)\s*wallet\s+action\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g,
      kind: "Function",
      nameGroup: 1,
      detail: () => "wallet action"
    },
  ];

  for (const spec of topLevelRegexes) {
    for (const match of masked.matchAll(spec.pattern)) {
      const name = match[spec.nameGroup || 1];
      const offset = match.index + match[0].lastIndexOf(name);
      const range = rangeFromOffset(lineStarts, offset, offset + name.length);
      note(spec.kind, name, spec.detail(match), range);

      if (spec.bodyGroup === 2) {
        const body = match[2] || "";
        if (match[0].includes("struct ")) {
          for (const field of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=\n]+?)(?:\s*=\s*([^\n]+))?\s*;?\s*$/gm)) {
            const fieldName = field[1];
            const fieldOffset = match.index + match[0].indexOf(field[0]) + field[0].indexOf(fieldName);
            note("Field", fieldName, `field: ${field[2].trim()}`, rangeFromOffset(lineStarts, fieldOffset, fieldOffset + fieldName.length), name);
          }
        } else if (match[0].includes("enum ")) {
          for (const variant of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)/gm)) {
            const variantName = variant[1];
            const variantOffset = match.index + match[0].indexOf(variant[0]) + variant[0].indexOf(variantName);
            note("EnumMember", variantName, `variant of ${name}`, rangeFromOffset(lineStarts, variantOffset, variantOffset + variantName.length), name);
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
    }
  }

  for (const match of masked.matchAll(/(?:^|\n)\s*storage\s+([A-Za-z_][A-Za-z0-9_]*(?:<[^>\n]+>)?\??)/g)) {
    const name = stripGenerics(match[1]).replace(/\?$/, "");
    const offset = match.index + match[0].lastIndexOf(match[1]);
    note("Type", name, "storage root reference", rangeFromOffset(lineStarts, offset, offset + match[1].length));
  }

  for (const match of masked.matchAll(/\b(?:var|val)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    const offset = match.index + match[0].lastIndexOf(name);
    note("Variable", name, "local variable", rangeFromOffset(lineStarts, offset, offset + name.length));
  }

  return { symbols, lookup };
}

function buildLookup(symbols) {
  const lookup = {
    byName: new Map(),
    typeNames: new Set(),
    functionNames: new Set(),
    parameterNames: new Set(),
    variableNames: new Set(),
    fields: new Set(),
    enumMembers: new Set(),
    constantNames: new Set(),
    allNames: new Set()
  };

  for (const symbol of symbols) {
    if (!lookup.byName.has(symbol.name)) {
      lookup.byName.set(symbol.name, symbol);
    }
    lookup.allNames.add(symbol.name);
    switch (symbol.kind) {
      case "Class":
      case "Type":
        lookup.typeNames.add(symbol.name);
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
      case "EnumMember":
        lookup.enumMembers.add(symbol.name);
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

function findUnknownIdentifiers(tokens, lookup) {
  const diagnostics = [];
  const known = new Set([
    ...DECLARATION_KEYWORDS,
    ...CONTROL_KEYWORDS,
    ...MESSAGE_KINDS,
    ...PURITY_KEYWORDS,
    ...SURFACE_KEYS,
    ...BUILTINS,
    ...BUILTIN_CONSTANTS,
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

    const suggestion = closestName(token.text, [
      ...lookup.allNames,
      ...BUILTINS,
      ...BUILTIN_CONSTANTS,
      ...BUILTIN_TYPES,
      ...IMPLICIT_NAMES,
      ...SURFACE_KEYS
    ]);
    diagnostics.push({
      severity: "warning",
      code: "W_UNKNOWN_IDENTIFIER",
      message: suggestion
        ? `Unknown identifier "${token.text}". Did you mean "${suggestion}"?`
        : `Unknown identifier "${token.text}".`,
      range: rangeFromPositions(token.start, token.end)
    });
  }

  return diagnostics;
}

function closestName(name, candidates) {
  let best = null;
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

function levenshtein(a, b) {
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
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function previousSignificantToken(tokens, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].kind !== "comment" && tokens[i].kind !== "string") {
      return tokens[i];
    }
  }
  return null;
}

function nextSignificantToken(tokens, index) {
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== "comment" && tokens[i].kind !== "string") {
      return tokens[i];
    }
  }
  return null;
}

function tokenAtPosition(tokens, position, lineStarts) {
  const offset = positionToOffset(lineStarts, position);
  return tokens.find((token) => {
    const start = positionToOffset(lineStarts, token.start);
    const end = positionToOffset(lineStarts, token.end);
    return offset >= start && offset < end;
  }) || null;
}

function getPrefixAtPosition(text, position) {
  const line = getLineText(text, buildLineStarts(text), position.line);
  const slice = line.slice(0, position.character);
  const match = slice.match(/[A-Za-z_@][A-Za-z0-9_@]*$/);
  return match ? match[0] : "";
}

function getLineText(text, lineStarts, line) {
  const start = lineStarts[line] || 0;
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
  return text.slice(start, end).replace(/\r$/, "");
}

function memberCompletionItems(beforeCursor, prefix) {
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

function classifyWord(word) {
  if (DECLARATION_KEYWORDS.has(word) || CONTROL_KEYWORDS.has(word) || MESSAGE_KINDS.has(word) || PURITY_KEYWORDS.has(word)) {
    return "keyword";
  }
  if (SURFACE_KEYS.has(word)) {
    return "surfaceKey";
  }
  if (BUILTINS.has(word)) {
    return "builtin";
  }
  if (BUILTIN_CONSTANTS.has(word)) {
    return "constant";
  }
  if (BUILTIN_TYPES.has(word)) {
    return "type";
  }
  if (word === "true" || word === "false" || word === "null") {
    return "keyword";
  }
  return "identifier";
}

function keywordHelp(word) {
  if (DECLARATION_KEYWORDS.has(word)) {
    return "Declaration keyword.";
  }
  if (CONTROL_KEYWORDS.has(word)) {
    return "Control-flow keyword.";
  }
  if (MESSAGE_KINDS.has(word)) {
    return "Message kind.";
  }
  if (PURITY_KEYWORDS.has(word)) {
    return "Purity modifier.";
  }
  if (SURFACE_KEYS.has(word)) {
    return SURFACE_KEY_HELP[word] || "Metadata key.";
  }
  if (word === "true" || word === "false" || word === "null") {
    return "Literal keyword.";
  }
  return "Keyword.";
}

function makeCompletionItems(values, kind, prefix, detail, fromSymbols = false) {
  return values.map((value) => {
    if (fromSymbols) {
      const symbol = value;
      return makeCompletionItem(symbol.name, symbolKindToCompletionKind(symbol.kind), prefix, symbol.detail);
    }
    return makeCompletionItem(value, kind, prefix, detail);
  });
}

function symbolKindToCompletionKind(kind) {
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
    case "EnumMember":
      return "EnumMember";
    case "Constant":
      return "Constant";
    case "Type":
      return "TypeParameter";
    default:
      return "Property";
  }
}

function makeCompletionItem(label, kind, prefix, detail) {
  if (!matchesPrefix(label, prefix)) {
    return null;
  }
  return {
    label,
    kind,
    detail,
    sortText: `${completionRank(kind)}_${label.toLowerCase()}`
  };
}

function matchesPrefix(label, prefix) {
  if (!prefix) {
    return true;
  }
  const normalizedPrefix = prefix.replace(/^@/, "").toLowerCase();
  return label.toLowerCase().startsWith(normalizedPrefix);
}

function completionRank(kind) {
  switch (kind) {
    case "Keyword":
      return "01";
    case "EnumMember":
      return "02";
    case "Constant":
      return "03";
    case "Function":
      return "04";
    case "Class":
    case "TypeParameter":
      return "05";
    case "Property":
      return "06";
    case "Field":
      return "07";
    case "Variable":
      return "08";
    default:
      return "99";
  }
}

function dedupeCompletionItems(items) {
  const seen = new Set();
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

function extractNamedEntries(text) {
  const out = [];
  for (const part of splitTopLevel(text, ",")) {
    const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (match) {
      out.push({ name: match[1], type: match[2].trim() });
    }
  }
  return out;
}

function splitTopLevel(text, separator) {
  const out = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let start = 0;
  let quote = null;
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

    if (
      ch === separator &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0 &&
      depthAngle === 0
    ) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }

  out.push(text.slice(start));
  return out;
}

function signatureText(prefix, name, paramsText, returnType) {
  const params = paramsText.trim();
  const suffix = returnType ? ` -> ${returnType}` : "";
  return `${prefix} ${name}(${params})${suffix}`;
}

function stripGenerics(text) {
  return text.replace(/<[^>]*>/g, "");
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function positionToOffset(lineStarts, position) {
  const lineStart = lineStarts[position.line] || 0;
  return lineStart + position.character;
}

function offsetToPosition(lineStarts, offset) {
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

function rangeFromPositions(start, end) {
  return { start, end };
}

function rangeFromOffset(lineStarts, start, end) {
  return rangeFromPositions(offsetToPosition(lineStarts, start), offsetToPosition(lineStarts, end));
}

function handleBracket(ch, start, stack, diagnostics, lineStarts, nextOffset) {
  if ("{[(".includes(ch)) {
    stack.push({ openChar: ch, position: start });
    return;
  }

  const closeToOpen = {
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

function matchingClose(openChar) {
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

function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch) {
  return /[0-9]/.test(ch);
}

function isHexDigit(ch) {
  return /[0-9A-Fa-f]/.test(ch);
}

module.exports = {
  analyzeDocument,
  getHoverMarkdown,
  getCompletionItems,
  getDocumentSymbols,
  getSemanticTokens,
  SEMANTIC_TOKEN_TYPES
};
