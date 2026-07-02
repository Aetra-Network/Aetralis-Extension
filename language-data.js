"use strict";

const declarationKeywords = [
  "const",
  "type",
  "struct",
  "contract",
  "storage",
  "message",
  "getter",
  "event",
  "wallet",
  "action",
  "fn",
  "fun"
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

const messageKinds = ["external", "internal", "bounced"];

const purityKeywords = ["pure", "impure", "get", "store"];

const surfaceKeys = [
  "author",
  "description",
  "version",
  "title",
  "risk",
  "confirm_label",
  "warning_level",
  "expected_side_effects",
  "fund_access",
  "approval_semantics"
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
  "BounceMode",
  "Grams"
];

const memberCompletions = {
  random: [
    { label: "initialize", detail: "random.initialize()" },
    { label: "initializeBy", detail: "random.initializeBy(...)" },
    { label: "uint256", detail: "random.uint256()" },
    { label: "range", detail: "random.range(...)" },
    { label: "getSeed", detail: "random.getSeed()" },
    { label: "setSeed", detail: "random.setSeed(...)" }
  ],
  contract: [
    { label: "getData", detail: "contract.getData()" },
    { label: "setData", detail: "contract.setData(...)" },
    { label: "getAddress", detail: "contract.getAddress()" },
    { label: "getOriginalBalance", detail: "contract.getOriginalBalance()" }
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

const keywordGroups = {
  declarationKeywords,
  controlKeywords,
  messageKinds,
  purityKeywords,
  surfaceKeys,
  builtins,
  builtinConstants,
  builtinTypes,
  annotationNames
};

function makeSet(values) {
  return new Set(values);
}

function regexSource(values) {
  return values.map(escapeRegex).join("|");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
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
  keywordGroups,
  makeSet,
  regexSource,
  escapeRegex
};
