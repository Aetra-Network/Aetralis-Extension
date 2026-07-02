"use strict";

const declarationKeywords = [
  "const",
  "type",
  "struct",
  "contract",
  "func"
];

const controlKeywords = [
  "if",
  "else",
  "match",
  "case",
  "return",
  "assert",
  "throw",
  "lazy",
  "mutate",
  "var",
  "val"
];

const annotationNames = [
  "@storage",
  "@message",
  "@internal",
  "@external",
  "@bounced",
  "@get",
  "@pure",
  "@impure",
  "@store"
];

const annotationDetails = new Map([
  ["@storage", "Marks a persistent storage struct."],
  ["@message", "Marks a message body struct."],
  ["@internal", "Marks an internal message handler."],
  ["@external", "Marks an external message handler."],
  ["@bounced", "Marks a bounced message handler."],
  ["@get", "Marks a read-only getter."],
  ["@pure", "Marks a helper that only computes a result."],
  ["@impure", "Marks a function that may change chain-visible state."],
  ["@store", "Legacy storage helper annotation."]
]);

const builtinTypes = [
  "int64",
  "uint32",
  "uint256",
  "address",
  "coins",
  "Segment",
  "Chunk",
  "InMessage",
  "InMessageBounced",
  "BounceMode"
];

const builtins = [
  "now",
  "getBalance",
  "random",
  "createMessage",
  "commit",
  "skipBouncedPrefix",
  "fromSegment",
  "fromChunk",
  "toChunk",
  "isEmpty",
  "send"
];

const builtinConstants = [
  "SEND_DEFAULT",
  "SEND_CARRY_REMAINDER",
  "SEND_DRAIN_BALANCE",
  "SEND_ESTIMATE_ONLY",
  "SEND_FEE_FROM_BALANCE",
  "SEND_IGNORE_ERRORS",
  "SEND_BOUNCE_ON_FAIL",
  "SEND_DESTROY_IF_EMPTY",
  "SEND_MODE_REGULAR",
  "SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE",
  "SEND_MODE_CARRY_ALL_BALANCE",
  "SEND_MODE_ESTIMATE_FEE_ONLY",
  "SEND_MODE_PAY_FEES_SEPARATELY",
  "SEND_MODE_IGNORE_ERRORS",
  "SEND_MODE_BOUNCE_ON_ACTION_FAIL",
  "SEND_MODE_DESTROY"
];

const memberCompletions = {
  contract: [
    { label: "getData", detail: "contract.getData()" },
    { label: "setData", detail: "contract.setData(...)" }
  ],
  in: [
    { label: "body", detail: "in.body" },
    { label: "senderAddress", detail: "in.senderAddress" },
    { label: "originalForwardFee", detail: "in.originalForwardFee" },
    { label: "valueCoins", detail: "in.valueCoins" },
    { label: "bouncedBody", detail: "in.bouncedBody" }
  ],
  body: [
    { label: "isEmpty", detail: "body.isEmpty()" },
    { label: "skipBouncedPrefix", detail: "body.skipBouncedPrefix()" },
    { label: "fromSegment", detail: "body.fromSegment(...)" },
    { label: "fromChunk", detail: "body.fromChunk(...)" }
  ],
  bouncedBody: [
    { label: "isEmpty", detail: "bouncedBody.isEmpty()" },
    { label: "skipBouncedPrefix", detail: "bouncedBody.skipBouncedPrefix()" }
  ]
};

const createMessageFields = [
  { label: "bounce", detail: "Bounce behavior" },
  { label: "value", detail: "Coins to transfer" },
  { label: "dest", detail: "Destination address" },
  { label: "body", detail: "Message body" }
];

const annotationTemplates = {
  "@internal": {
    label: "@internal",
    detail: "Insert the internal handler template",
    body: [
      "@internal",
      "func onInternalMessage(in: InMessage) {",
      "  $0",
      "}"
    ]
  },
  "@external": {
    label: "@external",
    detail: "Insert the external handler template",
    body: [
      "@external(inMsg: Segment)",
      "func onExternalMessage(inMsg: Segment) {",
      "  $0",
      "}"
    ]
  },
  "@bounced": {
    label: "@bounced",
    detail: "Insert the bounced handler template",
    body: [
      "@bounced",
      "func onBouncedMessage(in: InMessageBounced) {",
      "  $0",
      "}"
    ]
  }
};

const reservedHandlerNames = {
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

function makeSet(values) {
  return new Set(values);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexSource(values) {
  return values.map(escapeRegex).join("|");
}

module.exports = {
  declarationKeywords,
  controlKeywords,
  annotationNames,
  annotationDetails,
  builtinTypes,
  builtins,
  builtinConstants,
  memberCompletions,
  createMessageFields,
  annotationTemplates,
  reservedHandlerNames,
  makeSet,
  escapeRegex,
  regexSource
};
