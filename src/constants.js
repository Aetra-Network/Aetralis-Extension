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

// Numeric bit values of every send mode — mirrors builtinSendModeValue in the
// compiler (x/aetravm/compiler/compile.go). Drives the static send-mode
// combination check in diagnostics.js.
const SEND_MODE_VALUES = {
  SEND_DEFAULT: 0,
  SEND_FEE_FROM_BALANCE: 1,
  SEND_IGNORE_ERRORS: 2,
  SEND_BOUNCE_ON_FAIL: 16,
  SEND_DESTROY_IF_EMPTY: 32,
  SEND_CARRY_REMAINDER: 64,
  SEND_DRAIN_BALANCE: 128,
  SEND_ESTIMATE_ONLY: 1024
};

const INTEGER_WIDTHS = [2, 4, 8, 16, 32, 64, 128, 256];
const INTEGER_TYPE_NAMES = ['uint', 'int'];
const INTEGER_TYPE_DOCS = {
  uint: 'Alias of `uint256` — the full-width 256-bit unsigned integer. Writing `uint` without a width is the canonical shorthand.',
  int: 'Alias of `int256` — the full-width 256-bit signed integer. Writing `int` without a width is the canonical shorthand.'
};
for (const width of INTEGER_WIDTHS) {
  const uintName = 'uint' + width;
  const intName = 'int' + width;
  INTEGER_TYPE_NAMES.push(uintName, intName);
  INTEGER_TYPE_DOCS[uintName] = width + '-bit unsigned integer (range 0..2^' + width + '-1). Canonical form.';
  INTEGER_TYPE_DOCS[intName] = width + '-bit signed integer (range -2^' + (width - 1) + '..2^' + (width - 1) + '-1). Canonical form.';
}

const MAP_TYPE_DOC = [
  'Canonical dictionary type `Map<K, V>`.',
  '',
  'Methods:',
  '- `.get(key)` — the value, or `null` when the key is absent;',
  '- `.set(key, value)` — insert or update (mutating);',
  '- `.has(key)` — `bool`;',
  '- `.delete(key)` — remove a key (mutating);',
  '- `.keys(max)` — bounded list of keys;',
  '- `.entries(max)` — bounded list of `(key, value)` pairs;',
  '- `.empty()` — whether the map has no entries;',
  '- `.len()` — on a list returned by `.keys()` / `.entries()`.',
  '',
  '`.set` / `.delete` mutate state and are rejected in `@get` / `@pure`.',
  '',
  'Chaining on `.keys()` / `.entries()` results is unsupported — bind to a local first: `const keys = m.keys(255)` then `keys.len()`.'
];

const SEND_METHOD_DOC = 'Sends a built message. `.send()` takes **no arguments** — delivery semantics live exclusively in the optional `mode:` field of `buildMessage({ ... })` (omitted = `SEND_DEFAULT`).';

// Shared footer for every SEND_* hover / completion doc.
const SEND_MODE_COMBINE_NOTE = 'Modes combine with `+` in the optional `mode:` field of `buildMessage`; when `mode:` is omitted the message is sent with `SEND_DEFAULT`.';

// Exact set of keys the compiler accepts inside a `buildMessage({ ... })`
// literal (validateBuildMessageFields). Any other key is E_BUILD_MESSAGE_FIELD.
const BUILD_MESSAGE_FIELDS = [
  'bounce', 'amount', 'receiver', 'body', 'opcode', 'queryId', 'stateInit', 'mode', 'textComment'
];

const BUILD_MESSAGE_FIELD_DOCS = {
  bounce: 'Bounce policy: `BounceMode.NoBounce` or `BounceMode.Only256BitsOfBody`.',
  amount: 'Attached coins for the outbound message.',
  receiver: 'Destination address. **Required.**',
  body: 'Typed `@message` struct literal payload. **Required.**',
  opcode: 'Explicit message opcode override (normally derived from the `@message` struct).',
  queryId: 'Optional correlation id echoed back by the receiver.',
  stateInit: 'State init (code + data) for deploying the receiver.',
  mode: 'Optional delivery semantics — a compile-time combination of `SEND_*` flags joined with `+`. Defaults to `SEND_DEFAULT` when omitted. This is the only home for send modes: `.send()` takes no arguments.',
  textComment: 'Optional message memo — at most one per message, any characters (UTF-8), max 512 bytes. Priced per byte via the normal message fee and bound into the message id, so it cannot be forged in flight. Wallets and explorers show it as the transaction comment.'
};

// Map<K,V> instance methods offered in completion and recognized as receiver
// calls (so they are not flagged as unknown functions).
const MAP_METHODS = {
  get: 'Returns the value for a key, or `null` when the key is absent.',
  set: 'Inserts or updates the value for a key. Mutating — illegal in `@get`/`@pure`.',
  has: 'Reports whether a key is present (`bool`).',
  delete: 'Removes a key. Mutating — illegal in `@get`/`@pure`.',
  keys: '`.keys(max)` — returns a bounded list of keys. Bind it to a local before calling `.len()` on it.',
  entries: '`.entries(max)` — returns a bounded list of `(key, value)` pairs. Bind it to a local before calling `.len()` on it.',
  empty: 'Reports whether the map has no entries.'
};

// Legacy top-level declaration keywords the parser rejects outright
// (parser.go parseContractItem). Flagged as errors at declaration position.
const LEGACY_DECLARATIONS = {
  message: 'a legacy declaration and is not part of ATLX — declare a `@message(opcode)` struct and handle it in `@internal func onInternalMessage` / `@external func onExternalMessage`.',
  getter: 'a legacy declaration and is not part of ATLX — use `@get func name(): T`.',
  event: 'a legacy declaration and is not part of ATLX.',
  wallet: 'a legacy declaration (`wallet action`) and is not part of ATLX.'
};

// Annotations that take NO argument list — only `@message(opcode)` may carry
// an argument (parser.go parseAnnotationList). `@external(inMsg: Segment)` etc.
// are rejected: parameters belong in the function signature.
const NO_ARG_ANNOTATIONS = new Set([
  'internal', 'external', 'bounced', 'get', 'pure', 'impure', 'storage', 'store'
]);

const SEND_MODE_DOCS = {
  SEND_DEFAULT: 'Ordinary send — fees are paid from the message value.',
  SEND_FEE_FROM_BALANCE: 'The forwarding fee is paid from the contract balance instead of the message amount.',
  SEND_IGNORE_ERRORS: 'If delivery fails, the message is dropped instead of being retried every block.',
  SEND_BOUNCE_ON_FAIL: 'If execution on the receiver fails, the message bounces back to the sender\'s `@bounced` handler.',
  SEND_DESTROY_IF_EMPTY: 'After the send debit, if the source balance reached zero the contract is irreversibly deactivated — status `deleted`, storage cleared. Pairs with `SEND_DRAIN_BALANCE` (the withdraw-all-and-self-destruct idiom).',
  SEND_CARRY_REMAINDER: 'Forwards the remaining value of the inbound message instead of a fixed amount. Mutually exclusive with `SEND_DRAIN_BALANCE`.',
  SEND_DRAIN_BALANCE: 'Sends the contract\'s **entire** remaining balance (`amount` is ignored). To keep a reserve, omit this flag and use an explicit amount. Mutually exclusive with `SEND_CARRY_REMAINDER`.',
  SEND_ESTIMATE_ONLY: 'Dry-run — computes fees without sending. Cannot be combined with any other flag.'
};

const WORD_DOCS = {
  onInternalMessage: 'Reserved name for the `@internal` handler. Signature: `func onInternalMessage(in: InMessage)`. Cannot be used for any other function.',
  onExternalMessage: 'Reserved name for the `@external` handler. Signature: `func onExternalMessage(inMsg: Segment)`. Cannot be used for any other function.',
  onBouncedMessage: 'Reserved name for the `@bounced` handler. Signature: `func onBouncedMessage(in: InMessageBounced)`. Cannot be used for any other function.',
  buildMessage: 'Canonical builder for outbound messages: `buildMessage({ receiver, body, bounce, amount, mode, textComment })`. `receiver` and `body` are required; `mode` and `textComment` are optional. Send it with `.send()`.',
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

  // Byte-exact hashes (distinct from the chunk-tree hash()) — one argument,
  // no receiver. sha256/keccak256/blake2b produce a 32-byte digest tagged as
  // `hash32`; ripemd160/sha512 have non-32-byte digests (20 / 64 bytes) so
  // they are returned as plain `bytes`.
  sha256: 'Byte-exact SHA-256 digest over raw bytes (distinct from the chunk-tree `hash()`). Signature: sha256(data: bytes): hash32.',
  keccak256: 'Byte-exact Keccak-256 digest over raw bytes (distinct from the chunk-tree `hash()`). Signature: keccak256(data: bytes): hash32.',
  ripemd160: 'Byte-exact RIPEMD-160 digest over raw bytes. Returned as `bytes` (20 bytes) since there is no 20-byte hash tag. Signature: ripemd160(data: bytes): bytes.',
  sha512: 'Byte-exact SHA-512 digest over raw bytes. Returned as `bytes` (64 bytes) since there is no 64-byte hash tag. Signature: sha512(data: bytes): bytes.',
  blake2b: 'Byte-exact BLAKE2b-256 digest over raw bytes (distinct from the chunk-tree `hash()`). Signature: blake2b(data: bytes): hash32.',

  concat: 'Concatenates two byte strings. Traps if the result would exceed the max bytes length. Signature: concat(a: bytes, b: bytes): bytes.',
  byteAt: 'Reads a single byte at an index. O(1) — traps if the index is out of range. Signature: byteAt(data: bytes, index: uint256): uint8.',
  toBytesBE: 'Big-endian, zero-padded encoding at a fixed output width. Traps if the value does not fit in `n` bytes or `n` exceeds the max bytes length. Signature: toBytesBE(value: uint256, n: uint256): bytes.',
  fromBytesBE: 'Big-endian decode into the widest lossless integer. Traps if the input is more than 32 bytes. Signature: fromBytesBE(data: bytes): uint256.',

  slice: 'Extracts a byte window: slice(data, start, len). O(len) -- traps if the window runs past the end of `data`, mirroring `byteAt`/`concat`\'s deterministic-trap-not-panic rule. Signature: slice(data: bytes, start: uint256, len: uint256): bytes.',

  mulDiv: 'Full-width fused multiply-divide: floor(a*b/c). The a*b product is formed at unbounded width so it never overflows -- only the final quotient is range-checked to uint256 (traps if it does not fit, or if c == 0). Signature: mulDiv(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivRoundUp: 'Full-width fused multiply-divide, rounded up: ceil(a*b/c). Same unbounded-width product as `mulDiv`, only the final quotient is range-checked to uint256 (traps if it does not fit, or if c == 0). Signature: mulDivRoundUp(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivNearest: 'Full-width fused multiply-divide, rounded half-up: floor(a*b/c), incremented by one iff the true remainder doubled is >= c (the exact quotient\'s fractional part is >= 1/2). Same unbounded-width product as `mulDiv`/`mulDivRoundUp`, least-biased of the three for fee/price math. Traps if the quotient does not fit uint256, or if c == 0. Signature: mulDivNearest(a: uint256, b: uint256, c: uint256): uint256.',
  mulCmp: 'Full-range cross-product comparison: sign(a*b - c*d) as -1/0/+1. Both products are formed at unbounded width, so it never traps on a >uint256 product -- the full-range replacement for a bounded ratio-compare. Operands are unsigned. Signature: mulCmp(a: uint256, b: uint256, c: uint256, d: uint256): int256.',
  mulDivSigned: '(a*b)/c truncated toward zero, over signed int256 operands. The a*b product is formed at unbounded width, only the final quotient is range-checked to int256 (traps if it does not fit, or if c == 0). Signature: mulDivSigned(a: int256, b: int256, c: int256): int256.',
  isqrt: 'Integer square root: floor(sqrt(x)). Traps if the operand is negative. Signature: isqrt(x: uint256): uint256.',

  verifySecp256k1: 'Verifies a 64-byte compact R‖S secp256k1 signature over a 32-byte message hash against a public key. Malformed input soft-fails to `false` rather than trapping, mirroring Ethereum\'s ecrecover. Signature: verifySecp256k1(msgHash: hash32, sig: bytes, pubkey: bytes): bool.',
  ecrecover: 'Recovers the signer\'s 64-byte X‖Y public key from a 65-byte recoverable secp256k1 signature over a message hash. Malformed input soft-fails to empty bytes rather than trapping, matching Ethereum\'s ecrecover. Signature: ecrecover(msgHash: hash32, sig: bytes): bytes.'
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
  'isSegmentSignatureValid', 'len', 'setCodePostponed', 'random',
  // Byte-exact hashes, byte manipulation, full-width math, and signatures
  // (x/aetravm/compiler/compile.go, x/aetravm/avm/avm.go).
  'sha256', 'keccak256', 'ripemd160', 'sha512', 'blake2b',
  'concat', 'slice', 'byteAt', 'toBytesBE', 'fromBytesBE',
  'mulDiv', 'mulDivRoundUp', 'mulDivNearest', 'mulCmp', 'mulDivSigned', 'isqrt',
  'verifySecp256k1', 'ecrecover'
]);

// Words that are not part of the language: legacy/removed forms. Extension-
// side mirror of what the compiler now rejects (parser.go reservedBindingNames,
// lexer identifier rules, and the removal of package/migrate/selector).
// NOTE: `slice` is deliberately NOT here — it collided with the byte-window
// builtin `slice(data, start, len)` (compile.go, Phase A), which is real
// language surface; the legacy TON "Slice" cell concept it used to warn
// about is covered by the `cell` entry below instead.
const BANNED_WORDS = {
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
  '@external': '@external\nfunc onExternalMessage(inMsg: Segment) {\n    $0\n}',
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
  SEND_MODE_VALUES,
  INTEGER_TYPE_DOCS,
  INTEGER_TYPE_NAMES,
  BUILD_MESSAGE_FIELDS,
  BUILD_MESSAGE_FIELD_DOCS,
  MAP_TYPE_DOC,
  MAP_METHODS,
  LEGACY_DECLARATIONS,
  NO_ARG_ANNOTATIONS,
  SEND_METHOD_DOC,
  SEND_MODE_COMBINE_NOTE,
  WORD_DOCS,
  LANGUAGE_KEYWORDS,
  BUILTIN_FUNCTIONS,
  BANNED_WORDS,
  ANNOTATION_SNIPPETS,
  CONTROL_KEYWORDS_BEFORE_PAREN
};
