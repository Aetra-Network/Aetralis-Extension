'use strict';

// ---------------------------------------------------------------------------
// Static knowledge. No parsing, no analysis loops — plain dictionaries.
// ---------------------------------------------------------------------------

const HANDLERS = {
  internal: { name: 'onInternalMessage', params: 'in: InMessage' },
  external: { name: 'onExternalMessage', params: 'inMsg: Segment' },
  bounced: { name: 'onBouncedMessage', params: 'in: InMessageBounced' }
};

const ANNOTATION_DOCS = {
  '@internal': [
    '**Internal message handler.**',
    'Handles messages sent by other contracts.',
    '',
    'Rules:',
    '- only **one** `@internal` handler per contract;',
    '- the function name is reserved: must be `onInternalMessage`;',
    '- signature: `func onInternalMessage(in: InMessage)`.',
    '',
    'Typical fields: `in.body`, `in.senderAddress`, `in.valueCoins`.'
  ],
  '@external': [
    '**External message handler.**',
    'Entry point for user-signed, off-chain requests.',
    '',
    'Rules:',
    '- only **one** `@external` handler per contract;',
    '- the function name is reserved: must be `onExternalMessage`;',
    '- signature: `func onExternalMessage(inMsg: Segment)`.',
    '',
    'External flows should validate nonce, signature, or expiry.'
  ],
  '@bounced': [
    '**Bounced message handler.**',
    'Runs when a bounceable outbound message fails and returns.',
    '',
    'Rules:',
    '- only **one** `@bounced` handler per contract;',
    '- the function name is reserved: must be `onBouncedMessage`;',
    '- signature: `func onBouncedMessage(in: InMessageBounced)`.',
    '',
    'Call `in.bouncedBody.skipBouncedPrefix()` before decoding.'
  ],
  '@get': [
    '**Read-only getter.**',
    'Must not mutate storage and must not send messages.',
    'Deterministic for the same state and input; may be served off-chain.'
  ],
  '@pure': [
    '**Pure helper function.**',
    'No storage writes, no message sends, no chain-visible side effects.',
    'Deterministic for the same inputs.'
  ],
  '@impure': [
    '**Impure helper function.**',
    'May write storage, send messages, or mutate contract-visible state.'
  ],
  '@storage': [
    '**Persistent storage schema.**',
    'Marks a struct as contract state. The compiler generates canonical',
    '`toChunk` / `fromChunk` serialization for it.'
  ],
  '@message': [
    '**Typed message body.**',
    'Binds a struct to an opcode for canonical ABI decode,',
    'e.g. `@message(0x1001)`. Used in message unions and `match`.'
  ],
  '@store': [
    '**Canonical storage helper.**',
    'For `Type.load()` / `Type.save(self)` wrappers over',
    '`contract.getData()` / `contract.setData(...)`.'
  ]
};

const SEND_MODE_DOCS = {
  SEND_DEFAULT: 'Ordinary send. Fees are paid from the attached message amount.',
  SEND_CARRY_REMAINDER: 'Forwards the remaining value of the inbound message along with this send.',
  SEND_DRAIN_BALANCE: 'Sends the entire remaining contract balance with the message.',
  SEND_ESTIMATE_ONLY: 'Estimates fees only — the message is not actually sent.',
  SEND_FEE_FROM_BALANCE: 'Pays the forward fee from the contract balance instead of the message value.',
  SEND_IGNORE_ERRORS: 'Ignores errors during send and continues execution.',
  SEND_BOUNCE_ON_FAIL: 'Bounces the message back to this contract if delivery fails.',
  SEND_DESTROY_IF_EMPTY: 'Destroys the contract if its balance becomes zero after the send.'
};

const WORD_DOCS = {
  onInternalMessage: 'Reserved name for the `@internal` handler. Signature: `func onInternalMessage(in: InMessage)`. Cannot be used for any other function.',
  onExternalMessage: 'Reserved name for the `@external` handler. Signature: `func onExternalMessage(inMsg: Segment)`. Cannot be used for any other function.',
  onBouncedMessage: 'Reserved name for the `@bounced` handler. Signature: `func onBouncedMessage(in: InMessageBounced)`. Cannot be used for any other function.',
  buildMessage: 'Canonical builder for outbound messages: `buildMessage({ bounce, amount, receiver, body })`. Send it with `.send(SEND_...)`.',
  aet: 'Compile-time helper: converts a decimal AET string into base-unit `coins`, e.g. `aet("1.5")`. Rejects excess precision instead of rounding.',
  lazy: 'Deferred decoding/reading: the value is materialized deterministically on first use, e.g. `const st = lazy Storage.load()`.',
  mutate: 'Marks a receiver or argument as mutable inside the function, e.g. `func Storage.touch(mutate self)`.',
  assert: 'Canonical validation form: `assert (cond) throw CODE` — aborts with the exit code when the condition is false.',
  throw: 'Aborts execution with an exit code, e.g. `throw 403` or `throw ERR_BAD_MSG`.',
  const: 'Immutable local binding. The only alternative is `var`.',
  var: 'Mutable local binding. The only alternative is `const`.',
  match: 'Dispatch over a decoded union or enum. Include an `else` branch unless the match is intentionally exhaustive.',
  InMessage: 'Envelope of an inbound internal message: `in.body`, `in.senderAddress`, `in.valueCoins`, `in.originalForwardFee`.',
  InMessageBounced: 'Envelope of a bounced inbound message: `in.bouncedBody` (call `.skipBouncedPrefix()` first).',
  Segment: 'Bounded read view over a chunk; the inbound body-reading form, e.g. `Msg.fromSegment(inMsg)`.',
  Chunk: 'Canonical chunk-backed data unit; `Chunk<T>?` stores a typed out-of-line payload. Hover the `T` to see its fields.',
  Code: 'Canonical contract bytecode value. Build with `Code.fromChunk/fromHex/fromBase64`, hash with `.hash()`.',
  BounceMode: 'Bounce policy for `buildMessage`: `BounceMode.NoBounce`, `BounceMode.Only256BitsOfBody`.',
  uint2: '2-bit unsigned integer (0..3). Small width means cheaper storage.',
  uint4: '4-bit unsigned integer (0..15). Small width means cheaper storage.',
  int2: '2-bit signed integer (-2..1).',
  int4: '4-bit signed integer (-8..7).'
};

// Core language words offered in completion beyond the documented WORD_DOCS
// entries. Mirrors the TextMate grammar's keyword.control / keyword.declaration
// sets plus literal/self forms.
const LANGUAGE_KEYWORDS = [
  'if', 'else', 'while', 'do', 'repeat', 'for', 'break', 'continue', 'return',
  'import', 'contract', 'struct', 'enum', 'type', 'func',
  'true', 'false', 'self'
];

// Callable without a receiver — used both for completion and for the
// "unknown function" diagnostic so builtins never get flagged.
const BUILTIN_FUNCTIONS = new Set([
  'buildMessage', 'counterfactualAddress', 'autoDeployAddress', 'getAddress',
  'getOriginalBalance', 'getAttachedValue', 'getBalance', 'now', 'logicalTime',
  'currentBlockLogicalTime', 'aet', 'address', 'hash', 'isSignatureValid',
  'isSegmentSignatureValid', 'len', 'setCodePostponed', 'random'
]);

// Words that are not part of the language: legacy/removed forms. Extension-
// side mirror of what the compiler now rejects (parser.go reservedBindingNames,
// lexer identifier rules, and the removal of package/migrate/selector).
const BANNED_WORDS = {
  slice: 'not part of the language — use `Segment` for inbound reading.',
  cell: 'not part of the language — use `Chunk`.',
  isSlice: 'not part of the language.',
  isSliceSignatureValid: 'not part of the language — use `isSignatureValid`/`isSegmentSignatureValid`.',
  package: 'not part of the language — the only top-level unit form is `import`.',
  migrate: 'not part of the language — message kinds are `external`/`internal`/`bounced` only.',
  selector: 'not part of the language.'
};

// ---------------------------------------------------------------------------
// Completion snippets offered when typing `@`.
// ---------------------------------------------------------------------------

const ANNOTATION_SNIPPETS = {
  '@internal': '@internal\nfunc onInternalMessage(in: InMessage) {\n    $0\n}',
  '@external': '@external(inMsg: Segment)\nfunc onExternalMessage(inMsg: Segment) {\n    $0\n}',
  '@bounced': '@bounced\nfunc onBouncedMessage(in: InMessageBounced) {\n    in.bouncedBody.skipBouncedPrefix()\n    $0\n}',
  '@get': '@get\nfunc ${1:name}(): ${2:int64} {\n    const st = lazy ${3:Storage}.load()\n    return st.${4:field}\n}',
  '@pure': '@pure\nfunc ${1:name}(${2:x}: ${3:int64}) {\n    return $0\n}',
  '@impure': '@impure\nfunc ${1:name}(mutate ${2:x}: ${3:int64}) {\n    $0\n}',
  '@storage': '@storage\nstruct ${1:Storage} {\n    ${2:owner}: ${3:address}\n}',
  '@message': '@message(0x${1:1001})\nstruct ${2:Name} {\n    ${3:field}: ${4:uint32}\n}',
  '@store': '@store\nfunc ${1:Storage}.load() {\n    return ${1:Storage}.fromChunk(contract.getData())\n}\n\n@store\nfunc ${1:Storage}.save(self) {\n    contract.setData(self.toChunk())\n}'
};

// Control-flow keywords that are followed by `(` but are not function calls
// — excluded from the "unknown function" diagnostic.
const CONTROL_KEYWORDS_BEFORE_PAREN = new Set(['if', 'while', 'for', 'match', 'assert', 'return']);

module.exports = {
  HANDLERS,
  ANNOTATION_DOCS,
  SEND_MODE_DOCS,
  WORD_DOCS,
  LANGUAGE_KEYWORDS,
  BUILTIN_FUNCTIONS,
  BANNED_WORDS,
  ANNOTATION_SNIPPETS,
  CONTROL_KEYWORDS_BEFORE_PAREN
};
