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

test("annotations and function keywords keep the requested token types", () => {
  const analysis = analyzeDocument(`
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

  assert.equal(semanticTypeForToken(analysis, "@pure", 6), "annotation");
  assert.equal(semanticTypeForToken(analysis, "@get", 7), "annotation");
  assert.equal(semanticTypeForToken(analysis, "func", 8), "functionKeyword");
  assert.equal(semanticTypeForToken(analysis, "\"some author\"", 2), "string");
  assert.equal(semanticTypeForToken(analysis, "\"some text\"", 3), "string");
  assert.equal(semanticTypeForToken(analysis, "\"0.01.2\"", 4), "string");
  assert.equal(semanticTypeForToken(analysis, "assert", 9), "assertKeyword");
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

  assert.equal(semanticTypeForToken(analysis, "const", 1), "storageKeyword");
  assert.equal(semanticTypeForToken(analysis, "type", 3), "typeKeyword");
  assert.equal(semanticTypeForToken(analysis, "CounterValue", 3), "type");
  assert.equal(semanticTypeForToken(analysis, "uint64", 3), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "contract", 5), "contractKeyword");
  assert.equal(semanticTypeForToken(analysis, "Counter", 5), "contractName");
  assert.equal(semanticTypeForToken(analysis, "func", 7), "functionKeyword");
  assert.equal(semanticTypeForToken(analysis, "currentCounter", 7), "function");
  assert.equal(semanticTypeForToken(analysis, "address", 7), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "Chunk", 7), "builtinType");
  assert.equal(semanticTypeForToken(analysis, "var", 8), "storageKeyword");
  assert.equal(semanticTypeForToken(analysis, "localValue", 8), "variable");
  assert.equal(semanticTypeForToken(analysis, "if", 9), "controlKeyword");
  assert.equal(semanticTypeForToken(analysis, "else", 11), "controlKeyword");
  assert.equal(semanticTypeForToken(analysis, "return", 10), "controlKeyword");
});

test("contract metadata and storage-like fields stay in the property color lane", () => {
  const analysis = analyzeDocument(`
@storage
struct Packed {
  counter: CounterValue
  at: int64
  storage: Storage
  incomingMessages: InternalMsg
  incomingExternal: ExternalMsg
  author: "a"
  description: "b"
  version: "c"
}`);

  assert.equal(semanticTypeForToken(analysis, "counter", 3), "property");
  assert.equal(semanticTypeForToken(analysis, "at", 4), "property");
  assert.equal(semanticTypeForToken(analysis, "storage", 5), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingMessages", 6), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingExternal", 7), "property");
  assert.equal(semanticTypeForToken(analysis, "author", 8), "property");
  assert.equal(semanticTypeForToken(analysis, "description", 9), "property");
  assert.equal(semanticTypeForToken(analysis, "version", 10), "property");
});

test("message declarations stay green in match arms", () => {
  const analysis = analyzeDocument(`
@message(0x1001)
struct Inc {
  by: uint32
}

type InternalMsg = Inc

contract Counter {
  @internal
  func onInternalMessage(in: InMessage) {
    match (msg) {
      Inc => { }
    }
  }
}`);

  assert.equal(semanticTypeForText(analysis, "Inc"), "messageName");
  assert.equal(semanticTypeForText(analysis, "InMessage"), "builtinType");
});

test("builtin helpers and built-in member methods share one color lane", () => {
  const analysis = analyzeDocument(`
contract Counter {
  @store
  func Storage.load() {
    return Storage.fromChunk(contract.getData())
  }

  @store
  func Storage.save(self) {
    contract.setData(self.toChunk())
  }

  @impure
  func Storage.touch(mutate self) {
    self.lastNow = now()
    self.lastBalance = getBalance()
    self.lastRandom = random()
  }
}`);

  assert.equal(semanticTypeForText(analysis, "fromChunk"), "builtin");
  assert.equal(semanticTypeForText(analysis, "getData"), "builtin");
  assert.equal(semanticTypeForText(analysis, "setData"), "builtin");
  assert.equal(semanticTypeForText(analysis, "toChunk"), "builtin");
  assert.equal(semanticTypeForText(analysis, "now"), "builtin");
  assert.equal(semanticTypeForText(analysis, "getBalance"), "builtin");
  assert.equal(semanticTypeForText(analysis, "random"), "builtin");
});

test("annotation completions do not duplicate the leading at sign", () => {
  const analysis = analyzeDocument("@in");
  const items = getCompletionItems(analysis, { line: 0, character: 3 });

  const internal = items.find((item) => item.label === "@internal");
  assert.ok(internal, "missing @internal completion");
  assert.ok(String(internal.insertText).startsWith("internal"), "annotation completion should not include a second @");

  const getter = getCompletionItems(analyzeDocument("@g"), { line: 0, character: 2 }).find((item) => item.label === "@get");
  assert.ok(getter, "missing @get completion");
  assert.equal(String(getter.insertText), "get");
});
