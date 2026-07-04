export const declarationKeywords = [
  "package",
  "import",
  "contract",
  "struct",
  "enum",
  "type",
  "func",
  "storage",
  "deploy",
  "message",
  "getter",
  "event",
  "wallet",
  "action",
  "namespace",
  "chain",
  "deployer",
  "salt",
  "initial_balance",
  "selector",
  "version",
  "as"
] as const;

export const controlKeywords = [
  "if",
  "else",
  "while",
  "do",
  "repeat",
  "for",
  "in",
  "to",
  "match",
  "case",
  "return",
  "break",
  "continue"
] as const;

export const abortKeywords = ["assert", "throw"] as const;

export const bindingKeywords = ["const", "var", "lazy", "mutate", "self", "set"] as const;

export const sideEffectKeywords = ["emit", "send", "refund"] as const;

export const metadataKeywords = ["author", "description", "version"] as const;

export const annotationNames = [
  "@internal",
  "@external",
  "@bounced",
  "@get",
  "@pure",
  "@impure",
  "@storage",
  "@message"
] as const;

export const annotationDetails = new Map<string, string>([
  ["@internal", "Marks an internal message handler."],
  ["@external", "Marks an external message handler."],
  ["@bounced", "Marks a bounced message handler."],
  ["@get", "Marks a read-only getter."],
  ["@pure", "Marks a pure function."],
  ["@impure", "Marks a function that may change chain-visible state."],
  ["@storage", "Marks a persistent storage struct."],
  ["@message", "Marks a message body struct."],
  ["@store", "Legacy compatibility annotation."]
]);

export const builtinTypes = [
  "bool",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uint128",
  "uint256",
  "int8",
  "int16",
  "int32",
  "int64",
  "int128",
  "int256",
  "coins",
  "address",
  "bytes",
  "hash",
  "code",
  "chunk",
  "segment",
  "stateinit",
  "timestamp",
  "List",
  "Map",
  "Option",
  "Result",
  "Chunk",
  "ChunkRef",
  "ChunkLink",
  "ChunkCursor",
  "Code",
  "Segment",
  "StateInit",
  "Address",
  "Hash",
  "Bytes",
  "Coins",
  "Timestamp",
  "Storage"
] as const;

export const builtinHelpers = [
  "buildMessage",
  "counterfactualAddress",
  "autoDeployAddress",
  "getAddress",
  "getOriginalBalance",
  "getAttachedValue",
  "getCode",
  "setCodePostponed",
  "now",
  "logicalTime",
  "currentBlockLogicalTime",
  "random",
  "isSignatureValid",
  "fromChunk",
  "toChunk"
] as const;

export const builtinMemberHelpers: Record<string, Array<{ label: string; detail: string }>> = {
  random: [
    { label: "initialize", detail: "random.initialize(...)" },
    { label: "initializeBy", detail: "random.initializeBy(...)" },
    { label: "uint256", detail: "random.uint256()" },
    { label: "range", detail: "random.range(...)" },
    { label: "getSeed", detail: "random.getSeed()" },
    { label: "setSeed", detail: "random.setSeed(...)" }
  ],
  Code: [
    { label: "fromHex", detail: "Code.fromHex(...)" },
    { label: "fromBase64", detail: "Code.fromBase64(...)" },
    { label: "fromChunk", detail: "Code.fromChunk(...)" },
    { label: "hash", detail: "Code.hash()" },
    { label: "toChunk", detail: "Code.toChunk(...)" }
  ],
  Chunk: [
    { label: "fromHex", detail: "Chunk.fromHex(...)" },
    { label: "hash", detail: "Chunk.hash()" }
  ],
  Segment: [
    { label: "hash", detail: "Segment.hash()" }
  ],
  segment: [
    { label: "bitsHash", detail: "segment.bitsHash()" }
  ]
};

export const compatibilityNames = [
  "let",
  "val",
  "mut",
  "slice",
  "cell",
  "isSlice",
  "isSliceSignatureValid",
  "createMessage",
  "commit",
  "skipBouncedPrefix",
  "fromSegment",
  "isEmpty",
  "send",
  "getData",
  "setData"
] as const;

export const compatibilityAnnotations = ["@store"] as const;

export const enumMemberKeywords = ["message", "enum"] as const;

export const createMessageFields = [
  { label: "bounce", detail: "Bounce behavior" },
  { label: "value", detail: "Coins to transfer" },
  { label: "dest", detail: "Destination address" },
  { label: "body", detail: "Message body" }
] as const;

export const annotationTemplates: Record<
  string,
  {
    label: string;
    detail: string;
    body: string[];
  }
> = {
  "@internal": {
    label: "@internal",
    detail: "Insert the internal handler template",
    body: ["internal", "func onInternalMessage(in: InMessage) {", "  $0", "}"]
  },
  "@external": {
    label: "@external",
    detail: "Insert the external handler template",
    body: ["external(inMsg: Segment)", "func onExternalMessage(inMsg: Segment) {", "  $0", "}"]
  },
  "@bounced": {
    label: "@bounced",
    detail: "Insert the bounced handler template",
    body: ["bounced", "func onBouncedMessage(in: InMessageBounced) {", "  $0", "}"]
  }
};

export const reservedHandlerNames: Record<
  string,
  {
    annotation: string;
    signature: string;
  }
> = {
  onInternalMessage: {
    annotation: "@internal",
    signature: "func onInternalMessage(in: InMessage)"
  },
  onExternalMessage: {
    annotation: "@external",
    signature: "func onExternalMessage(inMsg: Segment)"
  },
  onBouncedMessage: {
    annotation: "@bounced",
    signature: "func onBouncedMessage(in: InMessageBounced)"
  }
};

export function makeSet<T>(values: readonly T[]): Set<T> {
  return new Set(values);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function regexSource(values: readonly string[]): string {
  return values.map(escapeRegex).join("|");
}
