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
  SEND_PAYOUT_TO_WALLET: 256,
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
  SEND_PAYOUT_TO_WALLET: 'Routes the send to a plain wallet address instead of a registered contract, moving real AET out of the contract\'s storage-rent-reserved balance into the destination wallet via the bank module — the only supported way for a contract to pay a human wallet directly. Mutually exclusive with `SEND_DRAIN_BALANCE` and `SEND_CARRY_REMAINDER`.',
  SEND_ESTIMATE_ONLY: 'Dry-run — computes fees without sending. Cannot be combined with any other flag.'
};

const WORD_DOCS = {
  onInternalMessage: 'Reserved name for the `@internal` handler. Signature: `func onInternalMessage(in: InMessage)`. Cannot be used for any other function.',
  onExternalMessage: 'Reserved name for the `@external` handler. Signature: `func onExternalMessage(inMsg: Segment)`. Cannot be used for any other function.',
  onBouncedMessage: 'Reserved name for the `@bounced` handler. Signature: `func onBouncedMessage(in: InMessageBounced)`. Cannot be used for any other function.',
  buildMessage: 'Canonical builder for outbound messages: `buildMessage({ receiver, body, bounce, amount, mode, textComment })`. `receiver` and `body` are required; `mode` and `textComment` are optional. Send it with `.send()`.',
  wrapMessage: 'Wraps a `@message`-annotated struct literal into that same message type, stamping its opcode as a hidden field — used so a NESTED `match` (one whose scrutinee is not the handler\'s own top-level message) can still recover the discriminant via a plain field read. Signature: wrapMessage(msg: <a @message struct literal>): <that struct\'s own type>.',
  ok: 'Wraps a value as the present/success case of an `Option<T>` (or the Ok case of a `Result<T, E>`) — typically a `@get` getter\'s return value when it may or may not have one, consumed by `match`. Erased at runtime: purely a compile-time marker, no separate runtime tag. Signature: ok(x: T): Option<T>.',
  err: 'Wraps a payload as the error case of a `Result<T, E>` (the Ok type defaults to `uint64`) — consumed by `match`. Erased at runtime, like `ok`. Signature: err(e: E): Result<uint64, E>.',
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

  subBytes: 'Extracts a byte window: subBytes(data, start, len). O(len) -- traps if the window runs past the end of `data`, mirroring `byteAt`/`concat`\'s deterministic-trap-not-panic rule. Renamed from `slice` -- `slice` is no longer part of the language (see the `cell`/`isSlice`-style entries in the legacy-word warnings). Signature: subBytes(data: bytes, start: uint256, len: uint256): bytes.',
  addressBytes: 'Returns the raw UTF-8 bytes of an address\'s canonical string form, so it can be folded into a byte-exact hash (e.g. `sha256(concat(addressBytes(whom), ...))`) -- the hash builtins only accept `bytes`/`string`/`hash` operands, not `address` directly. Typical use: binding a specific recipient into a proof-of-work / commitment digest so a solution cannot be copied and resubmitted for a different recipient. Signature: addressBytes(addr: address): bytes.',

  mulDiv: 'Full-width fused multiply-divide: floor(a*b/c). The a*b product is formed at unbounded width so it never overflows -- only the final quotient is range-checked to uint256 (traps if it does not fit, or if c == 0). Signature: mulDiv(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivFloor: 'Alias of `mulDiv` -- floor(a*b/c). Accepted spelling when the rounding direction should be explicit in the call site; lowers to the exact same opcode as `mulDiv`, not a distinct one. Signature: mulDivFloor(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivRoundUp: 'Full-width fused multiply-divide, rounded up: ceil(a*b/c). Same unbounded-width product as `mulDiv`, only the final quotient is range-checked to uint256 (traps if it does not fit, or if c == 0). Signature: mulDivRoundUp(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivCeil: 'Alias of `mulDivRoundUp` -- ceil(a*b/c). Accepted spelling when the rounding direction should be explicit in the call site; lowers to the exact same opcode as `mulDivRoundUp`, not a distinct one. Signature: mulDivCeil(a: uint256, b: uint256, c: uint256): uint256.',
  mulDivNearest: 'Full-width fused multiply-divide, rounded half-up: floor(a*b/c), incremented by one iff the true remainder doubled is >= c (the exact quotient\'s fractional part is >= 1/2). Same unbounded-width product as `mulDiv`/`mulDivRoundUp`, least-biased of the three for fee/price math. Traps if the quotient does not fit uint256, or if c == 0. Signature: mulDivNearest(a: uint256, b: uint256, c: uint256): uint256.',
  mulCmp: 'Full-range cross-product comparison: sign(a*b - c*d) as -1/0/+1. Both products are formed at unbounded width, so it never traps on a >uint256 product -- the full-range replacement for a bounded ratio-compare. Operands are unsigned. Signature: mulCmp(a: uint256, b: uint256, c: uint256, d: uint256): int256.',
  mulDivSigned: '(a*b)/c truncated toward zero, over signed int256 operands. The a*b product is formed at unbounded width, only the final quotient is range-checked to int256 (traps if it does not fit, or if c == 0). Signature: mulDivSigned(a: int256, b: int256, c: int256): int256.',
  isqrt: 'Integer square root: floor(sqrt(x)). Traps if the operand is negative. Signature: isqrt(x: uint256): uint256.',

  toUint128: 'Checked narrowing cast: re-tags a uint256-family arithmetic result (e.g. from `mulDiv`/`mulDivNearest`, which always return uint256) as `uint128`. Traps if the value does not fit in 128 bits -- never silently truncates. Signature: toUint128(x: uint256): uint128.',
  toInt128: 'Checked narrowing cast: re-tags an int256-family arithmetic result as `int128`. Traps if the value does not fit in 128 bits (either direction) -- never silently truncates. Signature: toInt128(x: int256): int128.',
  toInt256: 'Checked re-tagging cast from an unsigned uint256 magnitude (e.g. a `Ratio256`/`BasisPoints`-derived value) into signed `int256`. Traps if the magnitude does not fit (>= 2^255) -- never silently wraps into a negative value. Signature: toInt256(x: uint256): int256.',

  verifySecp256k1: 'Verifies a 64-byte compact R‖S secp256k1 signature over a 32-byte message hash against a public key. Malformed input soft-fails to `false` rather than trapping, mirroring Ethereum\'s ecrecover. Signature: verifySecp256k1(msgHash: hash32, sig: bytes, pubkey: bytes): bool.',
  ecrecover: 'Recovers the signer\'s 64-byte X‖Y public key from a 65-byte recoverable secp256k1 signature over a message hash. Malformed input soft-fails to empty bytes rather than trapping, matching Ethereum\'s ecrecover. Signature: ecrecover(msgHash: hash32, sig: bytes): bytes.',

  isSignatureValid: 'Verifies an ed25519 signature (ZIP-215) over raw data against a public key. Malformed input soft-fails to `false` rather than trapping. Same builtin as `verifySignature` -- both names lower to the identical opcode. Signature: isSignatureValid(data: bytes, sig: bytes, pubkey: bytes): bool.',
  verifySignature: 'Verifies an ed25519 signature (ZIP-215) over raw data against a public key. Malformed input soft-fails to `false` rather than trapping. Same builtin as `isSignatureValid` -- both names lower to the identical opcode. Signature: verifySignature(data: bytes, sig: bytes, pubkey: bytes): bool.',

  bn254G1Add: 'Adds two BN254 G1 points (64-byte uncompressed X‖Y encoding, no mask bits). Malformed, non-canonical, or off-curve operands soft-fail to empty bytes rather than trapping; the all-zero encoding is the valid point-at-infinity/identity. Signature: bn254G1Add(a: bytes, b: bytes): bytes.',
  bn254G1ScalarMul: 'Multiplies a BN254 G1 point by a uint256 scalar. A malformed/off-curve point or a negative-magnitude scalar soft-fails to empty bytes rather than trapping. Signature: bn254G1ScalarMul(point: bytes, scalar: uint256): bytes.',
  bn254G1IsOnCurve: 'Reports whether a 64-byte encoding decodes to a valid BN254 G1 point (on-curve, canonical coordinates). Never traps on malformed input. Signature: bn254G1IsOnCurve(point: bytes): bool.',
  bn254G2Add: 'Adds two BN254 G2 points (128-byte X.A0‖X.A1‖Y.A0‖Y.A1 encoding). Requires both operands to be in the correct r-order subgroup, not just on-curve; malformed, off-curve, or out-of-subgroup input soft-fails to empty bytes rather than trapping. Signature: bn254G2Add(a: bytes, b: bytes): bytes.',
  bn254G2ScalarMul: 'Multiplies a BN254 G2 point by a uint256 scalar. A malformed/off-curve/out-of-subgroup point or a negative-magnitude scalar soft-fails to empty bytes rather than trapping. Signature: bn254G2ScalarMul(point: bytes, scalar: uint256): bytes.',
  bn254PairingCheck: 'Checks whether the product of pairings e(g1[i], g2[i]) over k pairs equals 1 -- the core Groth16/pairing-based verification primitive. k is hard-capped at 16; a length mismatch against the declared k, or any malformed/out-of-subgroup point, soft-fails to `false` rather than trapping. Signature: bn254PairingCheck(g1s: bytes, g2s: bytes, k: uint256): bool.',
  poseidon2Bn254: 'Poseidon2 hash over n 32-byte BN254 scalar-field elements -- a ZK-circuit-friendly hash, unlike sha256/keccak256. Unlike the rest of this opcode family, a length mismatch against n or a non-canonical (>= the scalar field modulus) chunk TRAPS rather than soft-failing, since a hash has no safe "invalid input" sentinel. Signature: poseidon2Bn254(data: bytes, n: uint256): hash32.',
  externalGet: 'Read-only synchronous call into ANOTHER already-deployed contract\'s `@get` function, reading its current committed storage -- no message round-trip, no async bus, and (being a read) no atomicity/rollback concern. A bare free-function call, not a dotted `target.method()` -- the first three arguments are always positional: the target `address`, the `@get` method name as a string literal, and the expected return type as a string literal (an integer kind, `bool`, `address`, `hash`/`hash32`, `bytes`, `string`, `coins`, or `timestamp`); any further arguments are forwarded to the callee\'s getter. The expression\'s own type is exactly the expected-type argument, so `externalGet(oracle, "price", "uint64")` has type `uint64`. A depth-limited call chain (`MaxExternalGetDepth`, far smaller than the ordinary intra-contract call-stack limit, since this crosses contracts via real Go-level recursion). Signature: externalGet(target: address, method: string, expectedType: string, ...args): <expectedType>.',

  // Addressing / contract identity.
  getAddress: 'Returns this contract\'s own address. Signature: getAddress(): address.',
  address: 'Parses a bech32 address string literal into a constant `address` value at compile time. Signature: address(literal: string): address.',
  counterfactualAddress: 'Derives the deterministic address a contract WOULD have if deployed with the given `{ code, data, ... }` state-init -- under THIS contract as deployer -- without deploying anything. Purely informational; contrast `autoDeployAddress`, which additionally registers the address so the next send to it auto-deploys the child. Signature: counterfactualAddress(stateInit: { code: Code, data: <struct> }): address.',
  autoDeployAddress: 'Derives the same deterministic address as `counterfactualAddress`, but additionally marks it so the first internal message sent to that address auto-deploys the child contract with the given `{ code, data }` state-init. Signature: autoDeployAddress(stateInit: { code: Code, data: <struct> }): address.',

  // Balances / coins.
  getBalance: 'Returns the contract\'s balance. Resolves to the same underlying value as `getOriginalBalance()` (the balance as of the start of this message\'s execution). Signature: getBalance(): coins.',
  getOriginalBalance: 'Returns the contract\'s balance as captured at the start of this message\'s execution, before any of this execution\'s own sends/receipts mutate it. Signature: getOriginalBalance(): coins.',
  getAttachedValue: 'Returns the coin amount attached to the currently-executing incoming message. Signature: getAttachedValue(): coins.',

  // Time / randomness.
  now: 'Current block timestamp (Unix seconds). Deterministic across every validator. Signature: now(): int64.',
  logicalTime: 'This contract\'s own monotonic call counter -- incremented on every execution. NOT wall-clock time or block height. Signature: logicalTime(): uint64.',
  currentBlockLogicalTime: 'The logical-time value as of the start of the current block. Signature: currentBlockLogicalTime(): uint64.',
  random: 'Deterministic block-randomness beacon -- SHA256 over the previous state root, block entropy, the current message, and a per-call domain-separating nonce (so successive calls within one execution differ). Every validator derives the identical value; this is NOT process/OS entropy. Signature: random(): uint256.',

  // Misc scalar / collection.
  hash: 'Canonical content-addressing hash: canonically encodes the value, then hashes it as a BLAKE3 chunk-tree Merkle root. Distinct from the byte-exact `sha256`/`keccak256`/`blake2b`/`ripemd160`/`sha512` above -- an off-chain verifier without the AVM\'s own chunk encoder cannot reproduce this hash, so use a byte-exact hash instead when matching a foreign digest. Signature: hash(x: any): hash32.',
  len: 'Generic length of a byte string, string, or map/list-family value. Always emits a real length-read -- never constant-folded. Signature: len(x: bytes | string | Map<K,V> | List<T>): uint64.',

  // Contract-code intrinsics (dotted `contract.` receiver methods -- state-
  // mutating effects, like setData/deleteData: rejected in @get/@pure unless
  // the function is annotated @store/@impure).
  getData: 'Reads this contract\'s raw persistent storage as a `Chunk`. Almost always used inside the canonical `@store func Type.load() { return Type.fromChunk(contract.getData()) }` wrapper rather than called directly. Signature: contract.getData(): Chunk.',
  setData: 'Writes this contract\'s raw persistent storage from a `Chunk`. Almost always used inside the canonical `@store func Type.save(self) { contract.setData(self.toChunk()) }` wrapper. Mutating. Signature: contract.setData(data: Chunk).',
  deleteData: 'Clears this contract\'s persistent storage entirely. Mutating. Signature: contract.deleteData().',
  upgradeCode: 'Swaps this contract\'s own running code for a new compiled module, carried as a `Code` value -- no off-chain step, no code-hash indirection. Only legal as a statement (`contract.upgradeCode(newCode)`), like `setData`/`deleteData`. The swap is recorded during the current message and takes effect on the NEXT message -- this handler still finishes running the OLD code. Signature: contract.upgradeCode(newCode: Code).',

  // Typed decode/encode receiver methods.
  fromChunk: 'Decodes a typed value (a `@storage` struct, or any struct) from a `Chunk` -- the canonical storage-load path, e.g. `Type.fromChunk(contract.getData())`. Signature: Type.fromChunk(c: Chunk): Type.',
  toChunk: 'Encodes a typed value into a `Chunk` -- the canonical storage-save path, e.g. `contract.setData(self.toChunk())`. Signature: (self: Type).toChunk(): Chunk.',
  fromSegment: 'Decodes a typed message/union value from a `Segment` -- the canonical inbound-message decode path, e.g. `const msg = lazy MsgUnion.fromSegment(in.body)`. Signature: Type.fromSegment(s: Segment): Type.',
  fromState: 'Decodes a typed value from a state-init payload. Signature: Type.fromState(s: <state payload>): Type.',
  fromHex: 'Constructs a `bytes`/`Code`/`Chunk` value from a hex string literal, decoded at compile time. Signature: Type.fromHex(literal: string): Type.',
  fromBase64: 'Constructs a `bytes`/`Code`/`Chunk` value from a base64 string literal, decoded at compile time. Signature: Type.fromBase64(literal: string): Type.',
  isEmpty: 'Reports whether a `Segment`/message body has no remaining/attached data. The canonical guard in an `else` match arm: `assert (in.body.isEmpty()) throw ERR_UNKNOWN_MESSAGE`. Signature: (self: Segment).isEmpty(): bool.',
  skipBouncedPrefix: 'Skips the leading bytes prepended to a bounced message body before the original opcode+payload. Call this first in `@bounced`, before decoding: `in.bouncedBody.skipBouncedPrefix()`. Signature: (self: Segment).skipBouncedPrefix().',
  bitsHash: 'Byte-exact hash over the raw encoded bits of a value (distinct from the chunk-tree `hash()`). Signature: (self: T).bitsHash(): hash32.'
};

// Core language words offered in completion beyond the documented WORD_DOCS
// entries. Mirrors the TextMate grammar's keyword.control / keyword.declaration
// sets plus literal/self forms.
const LANGUAGE_KEYWORDS = [
  'if', 'else', 'while', 'do', 'repeat', 'for', 'break', 'continue', 'return',
  'import', 'contract', 'struct', 'enum', 'type', 'func',
  'true', 'false', 'self', 'null'
];

// Callable without a receiver — used both for completion and for the
// "unknown function" diagnostic so builtins never get flagged.
//
// This Set (and WORD_DOCS below) is hand-maintained against
// x/aetravm/compiler/compile.go's `switch strings.ToLower(expr.Text)` inside
// `inferExprType`'s `case ExprCall` (currently ~lines 2609-3024) — there is no
// automated sync, so any new compiler builtin must be added here in the same
// change, or it silently starts tripping Rule 5's "not declared... and is not
// a recognized builtin" diagnostic (this is exactly what happened to
// `addressBytes`, added to the compiler without a matching update here).
const BUILTIN_FUNCTIONS = new Set([
  'buildMessage', 'wrapMessage', 'counterfactualAddress', 'autoDeployAddress', 'getAddress',
  'getOriginalBalance', 'getAttachedValue', 'getBalance', 'now', 'logicalTime',
  'currentBlockLogicalTime', 'aet', 'address', 'addressBytes', 'hash', 'isSignatureValid',
  'verifySignature', 'len', 'random', 'ok', 'err',
  // Byte-exact hashes, byte manipulation, full-width math, and signatures
  // (x/aetravm/compiler/compile.go, x/aetravm/avm/avm.go).
  'sha256', 'keccak256', 'ripemd160', 'sha512', 'blake2b',
  'concat', 'subBytes', 'byteAt', 'toBytesBE', 'fromBytesBE',
  'mulDiv', 'mulDivFloor', 'mulDivRoundUp', 'mulDivCeil', 'mulDivNearest',
  'mulCmp', 'mulDivSigned', 'isqrt',
  'toUint128', 'toInt128', 'toInt256',
  'verifySecp256k1', 'ecrecover',
  // BN254 pairing/ZK opcodes + Poseidon2 (AVM Phase D).
  'bn254G1Add', 'bn254G1ScalarMul', 'bn254G1IsOnCurve',
  'bn254G2Add', 'bn254G2ScalarMul', 'bn254PairingCheck', 'poseidon2Bn254',
  // Read-only cross-contract call (x/aetravm/compiler/compile.go's
  // "externalget" case, design doc §6/§6.8).
  'externalGet'
]);

// Words that are not part of the language: legacy/removed forms. Extension-
// side mirror of what the compiler now rejects (parser.go reservedBindingNames,
// lexer identifier rules, and the removal of package/migrate/selector).
// `slice` and `cell` are deliberately NOT here: neither is a reserved/legacy
// keyword the compiler actively rejects — `slice` is just a builtin name the
// compiler no longer recognizes (renamed to `subBytes`), and `cell` was
// never ATLX syntax at all (it's the underlying FunC term ATLX exposes
// as `Chunk` instead). Writing either gets the same plain "not declared /
// not a recognized builtin" treatment as any other unresolved identifier
// (Rule 5 in diagnostics.js) — no special warning, no ban — so a contract
// author remains free to declare their own `func slice(...)` or `func
// cell(...)`.
const BANNED_WORDS = {
  isSlice: 'not part of the language.',
  isSliceSignatureValid: 'not part of the language — use `isSignatureValid`/`verifySignature`.',
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
// — excluded from the "unknown function" diagnostic. `const`/`var` are here
// for the destructuring-binding form `const (a, b) = f()` (design doc §2.4):
// the `(` right after the keyword binds new names, it doesn't call anything
// named `const`/`var`.
const CONTROL_KEYWORDS_BEFORE_PAREN = new Set(['if', 'while', 'for', 'match', 'assert', 'return', 'const', 'var']);

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
