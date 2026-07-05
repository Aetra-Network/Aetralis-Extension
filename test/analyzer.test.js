const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeDocument, getSemanticTokens } = require("../out/analyzer");
const { getCompletionItems } = require("../out/analyzer");

function semanticTypeForToken(analysis, text, line) {
  const token = analysis.tokens.find((entry) => entry.text === text && entry.start.line === line);
  assert.ok(token, `missing token ${text} on line ${line}`);
  const semantic = getSemanticTokens(analysis).find((entry) => {
    return entry.line === token.start.line
      && entry.character === token.start.character
      && entry.length === token.text.length;
  });
  assert.ok(semantic, `missing semantic token ${text} on line ${line}`);
  return semantic.type;
}

function semanticTypeForText(analysis, text, occurrence = 1) {
  const matches = analysis.tokens.filter((entry) => entry.text === text);
  assert.ok(matches.length >= occurrence, `missing token ${text}`);
  const token = matches[occurrence - 1];
  const semantic = getSemanticTokens(analysis).find((entry) => {
    return entry.line === token.start.line
      && entry.character === token.start.character
      && entry.length === token.text.length;
  });
  assert.ok(semantic, `missing semantic token ${text}`);
  return semantic.type;
}

test("annotations, declarations, and literals use the canonical semantic lanes", () => {
  const analysis = analyzeDocument(`
package sample
import core

contract Counter {
  author: "some author"
  description: "some text"
  version: "0.01.2"

  @pure
  @get
  func snapshot(): PackedState? {
    assert (true)
    return null
  }
}`);

  assert.equal(semanticTypeForToken(analysis, "package", 1), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "import", 2), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "contract", 4), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "func", 11), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "@pure", 9), "annotation");
  assert.equal(semanticTypeForToken(analysis, "@get", 10), "annotation");
  assert.equal(semanticTypeForToken(analysis, "assert", 12), "abortKeyword");
  assert.equal(semanticTypeForToken(analysis, "true", 12), "constant");
  assert.equal(semanticTypeForToken(analysis, "null", 13), "constant");
  assert.equal(semanticTypeForToken(analysis, "\"some author\"", 5), "string");
});

test("keywords, names, variables, and builtin data types split into the requested lanes", () => {
  const analysis = analyzeDocument(`
const ERR = 1

type CounterValue = uint64

contract Counter {
  @get
  func currentCounter(value: address, chunk: Chunk) {
    var localValue = value
    if (localValue == value) {
      return localValue
    } else {
      return value
    }
  }
}`);

  assert.equal(semanticTypeForToken(analysis, "const", 1), "bindingKeyword");
  assert.equal(semanticTypeForToken(analysis, "type", 3), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "CounterValue", 3), "type");
  assert.equal(semanticTypeForToken(analysis, "uint64", 3), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "contract", 5), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "Counter", 5), "contractName");
  assert.equal(semanticTypeForToken(analysis, "func", 7), "declarationKeyword");
  assert.equal(semanticTypeForToken(analysis, "currentCounter", 7), "function");
  assert.equal(semanticTypeForToken(analysis, "address", 7), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "Chunk", 7), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "var", 8), "bindingKeyword");
  assert.equal(semanticTypeForToken(analysis, "localValue", 8), "variable");
  assert.equal(semanticTypeForToken(analysis, "if", 9), "controlKeyword");
  assert.equal(semanticTypeForToken(analysis, "else", 11), "controlKeyword");
  assert.equal(semanticTypeForToken(analysis, "return", 10), "controlKeyword");
});

test("canonical scalar, numeric, container, and runtime types stay on one lane", () => {
  const analysis = analyzeDocument(`
contract Counter {
  a: string
  b: hash32
  c: uint256
  d: u8
  e: i256
  f: Dict
  g: MapEntry
  h: Option
  i: Result
  j: ChunkRef
  k: ChunkLink
  l: ChunkCursor
  m: InMessage
  n: InMessageBounced
  o: ContractContext
  p: MessageEnvelope
  q: Address
  r: Bytes
  s: Coins
  t: Timestamp
  u: StateInit
}`);

  for (const [name, line] of [
    ["string", 2],
    ["hash32", 3],
    ["uint256", 4],
    ["u8", 5],
    ["i256", 6],
    ["Dict", 7],
    ["MapEntry", 8],
    ["Option", 9],
    ["Result", 10],
    ["ChunkRef", 11],
    ["ChunkLink", 12],
    ["ChunkCursor", 13],
    ["InMessage", 14],
    ["InMessageBounced", 15],
    ["ContractContext", 16],
    ["MessageEnvelope", 17],
    ["Address", 18],
    ["Bytes", 19],
    ["Coins", 20],
    ["Timestamp", 21],
    ["StateInit", 22]
  ]) {
    assert.equal(semanticTypeForToken(analysis, name, line), "builtinType");
  }
});

test("contract metadata, fields, and enum members stay in the expected lanes", () => {
  const analysis = analyzeDocument(`
enum Mode {
  Inc,
  Dec,
}

contract Counter {
  author: "a"
  description: "b"
  storage: Storage
  incomingMessages: InternalMsg
  incomingExternal: ExternalMsg
  version: "c"
}`);

  assert.equal(semanticTypeForToken(analysis, "Inc", 2), "enumMember");
  assert.equal(semanticTypeForToken(analysis, "Dec", 3), "enumMember");
  assert.equal(semanticTypeForToken(analysis, "author", 7), "property");
  assert.equal(semanticTypeForToken(analysis, "description", 8), "property");
  assert.equal(semanticTypeForToken(analysis, "storage", 9), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingMessages", 10), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingExternal", 11), "property");
  assert.equal(semanticTypeForToken(analysis, "version", 12), "property");
});

test("builtin helpers and built-in member methods share one color lane", () => {
  const analysis = analyzeDocument(`
contract Counter {
  func TokenStorage.load() {
    return TokenStorage.save(random.initialize().range())
  }

  func TokenStorage.save(self) {
    buildMessage({
      value: getAttachedValue(),
      dest: getAddress(),
      body: fromChunk(contract.getCode())
    })
  }

  func TokenStorage.touch(mutate self) {
    self.lastNow = now()
    self.lastBalance = logicalTime()
    self.lastRandom = currentBlockLogicalTime()
    self.hashValue = Code.hash()
    self.chunkValue = Chunk.fromHex()
    self.segmentValue = segment.bitsHash()
  }
}`);

  assert.equal(semanticTypeForText(analysis, "load"), "function");
  assert.equal(semanticTypeForText(analysis, "save"), "function");
  assert.equal(semanticTypeForText(analysis, "initialize"), "builtin");
  assert.equal(semanticTypeForText(analysis, "range"), "builtin");
  assert.equal(semanticTypeForText(analysis, "buildMessage"), "builtin");
  assert.equal(semanticTypeForText(analysis, "getAttachedValue"), "builtin");
  assert.equal(semanticTypeForText(analysis, "getAddress"), "builtin");
  assert.equal(semanticTypeForText(analysis, "fromChunk"), "builtin");
  assert.equal(semanticTypeForText(analysis, "getCode"), "builtin");
  assert.equal(semanticTypeForText(analysis, "now"), "builtin");
  assert.equal(semanticTypeForText(analysis, "logicalTime"), "builtin");
  assert.equal(semanticTypeForText(analysis, "currentBlockLogicalTime"), "builtin");
  assert.equal(semanticTypeForText(analysis, "hash"), "builtin");
  assert.equal(semanticTypeForText(analysis, "fromHex"), "builtin");
  assert.equal(semanticTypeForText(analysis, "bitsHash"), "builtin");
});

test("send modes stay on the constant lane", () => {
  const analysis = analyzeDocument(`
contract Counter {
  func transfer() {
    buildMessage({
      value: getAttachedValue(),
      dest: getAddress(),
      body: fromChunk(contract.getCode())
    }).send(SEND_DEFAULT | SEND_IGNORE_ERRORS | SEND_BOUNCE_ON_FAIL)
  }
}`);

  assert.equal(semanticTypeForText(analysis, "SEND_DEFAULT"), "constant");
  assert.equal(semanticTypeForText(analysis, "SEND_IGNORE_ERRORS"), "constant");
  assert.equal(semanticTypeForText(analysis, "SEND_BOUNCE_ON_FAIL"), "constant");
});

test("light analysis skips diagnostics for editor responsiveness", () => {
  const analysis = analyzeDocument(`
contract Counter {
  func transfer() {
    value: uint64
    send(SEND_DEFAULT)
  }
}`, { includeDiagnostics: false });

  assert.equal(analysis.diagnostics.length, 0);
  assert.equal(semanticTypeForToken(analysis, "uint64", 3), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "SEND_DEFAULT", 4), "constant");
});

test("fields, handler parameters, and const locals do not trip reserved-name warnings", () => {
  const analysis = analyzeDocument(`
type Msg = address

contract TokenMaster {
  storage: Msg
  incomingMessages: Msg
  incomingExternal: Msg

  @bounced
  func onBouncedMessage(in: InMessageBounced) {
    const bounced = 1
    return bounced
  }
}`);

  assert.equal(semanticTypeForToken(analysis, "storage", 4), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingMessages", 5), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingExternal", 6), "property");
  assert.equal(semanticTypeForToken(analysis, "in", 9), "parameter");
  assert.equal(semanticTypeForToken(analysis, "bounced", 10), "variable");
  assert.ok(!analysis.diagnostics.some((diag) => diag.code === "E_RESERVED_IDENTIFIER" || diag.code === "W_UNKNOWN_IDENTIFIER"));
});

test("deprecated compatibility surface stays gray", () => {
  const analysis = analyzeDocument(`
let x = 1
val y = 2
mut z = 3
slice
cell
isSlice
isSliceSignatureValid
@store
`);

  assert.equal(semanticTypeForToken(analysis, "let", 1), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "val", 2), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "mut", 3), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "slice", 4), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "cell", 5), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "isSlice", 6), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "isSliceSignatureValid", 7), "deprecated");
  assert.equal(semanticTypeForToken(analysis, "@store", 8), "deprecated");
});

test("annotation completions do not duplicate the leading at sign", () => {
  const analysis = analyzeDocument("@in");
  const items = getCompletionItems(analysis, { line: 0, character: 3 });

  const internal = items.find((item) => item.label === "@internal");
  assert.ok(internal, "missing @internal completion");
  assert.ok(String(internal.insertText).startsWith("internal\n"), "annotation snippet should insert the keyword without a second @");

  const getter = getCompletionItems(analyzeDocument("@g"), { line: 0, character: 2 }).find((item) => item.label === "@get");
  assert.ok(getter, "missing @get completion");
  assert.equal(String(getter.insertText), "get");
});
