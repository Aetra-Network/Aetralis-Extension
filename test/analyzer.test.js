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
  func Storage.load() {
    return Storage.save(random.initialize().range())
  }

  func Storage.save(self) {
    buildMessage({
      value: getAttachedValue(),
      dest: getAddress(),
      body: fromChunk(contract.getCode())
    })
  }

  func Storage.touch(mutate self) {
    self.lastNow = now()
    self.lastBalance = logicalTime()
    self.lastRandom = currentBlockLogicalTime()
    self.hashValue = Code.hash()
    self.chunkValue = Chunk.fromHex()
    self.segmentValue = segment.bitsHash()
  }
}`);

  assert.equal(semanticTypeForText(analysis, "load"), "builtin");
  assert.equal(semanticTypeForText(analysis, "save"), "builtin");
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
