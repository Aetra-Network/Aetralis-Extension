export const declarationKeywords = ["const", "type", "struct", "contract", "func"] as const;

export const controlKeywords = ["if", "else", "match", "return", "assert", "throw", "lazy", "mutate", "var", "val"] as const;

export const metadataKeywords = ["author", "description", "version"] as const;

export const annotationNames = [
  "@storage",
  "@message",
  "@internal",
  "@external",
  "@bounced",
  "@get",
  "@pure",
  "@impure",
  "@store"
] as const;

export const annotationDetails = new Map<string, string>([
  ["@storage", "Marks a persistent storage struct."],
  ["@message", "Marks a message body struct."],
  ["@internal", "Marks an internal message handler."],
  ["@external", "Marks an external message handler."],
  ["@bounced", "Marks a bounced message handler."],
  ["@get", "Marks a read-only getter."],
  ["@pure", "Marks a pure function."],
  ["@impure", "Marks a function that may change chain-visible state."],
  ["@store", "Legacy storage helper annotation."]
]);

export const builtinTypes = [
  "int64",
  "uint32",
  "uint64",
  "uint256",
  "address",
  "coins",
  "Segment",
  "Chunk",
  "InMessage",
  "InMessageBounced",
  "BounceMode"
] as const;

export const builtins = [
  "now",
  "getBalance",
  "random",
  "createMessage",
  "skipBouncedPrefix",
  "fromSegment",
  "fromChunk",
  "toChunk",
  "isEmpty",
  "send"
] as const;

export const builtinConstants = ["SEND_BOUNCE_ON_FAIL", "SEND_FEE_FROM_BALANCE"] as const;

export const bounceModeMembers = ["Only256BitsOfBody", "NoBounce"] as const;

export const memberCompletions: Record<string, Array<{ label: string; detail: string }>> = {
  contract: [
    { label: "getData", detail: "contract.getData()" },
    { label: "setData", detail: "contract.setData(...)" }
  ],
  in: [
    { label: "body", detail: "in.body" },
    { label: "senderAddress", detail: "in.senderAddress" },
    { label: "bouncedBody", detail: "in.bouncedBody" }
  ],
  body: [
    { label: "isEmpty", detail: "body.isEmpty()" },
    { label: "skipBouncedPrefix", detail: "body.skipBouncedPrefix()" }
  ],
  bouncedBody: [
    { label: "isEmpty", detail: "bouncedBody.isEmpty()" },
    { label: "skipBouncedPrefix", detail: "bouncedBody.skipBouncedPrefix()" }
  ]
};

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
