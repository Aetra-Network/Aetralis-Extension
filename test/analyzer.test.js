const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeDocument, getSemanticTokens } = require("../out/analyzer");

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

test("annotations and function keywords keep the requested token types", () => {
  const analysis = analyzeDocument(`
contract Counter {
  author: "some author"
  description: "some text"
  version: "0.01.2"

  @get
  func snapshot(): PackedState? {
    return null
  }
}`);

  assert.equal(semanticTypeForToken(analysis, "@get", 6), "annotation");
  assert.equal(semanticTypeForToken(analysis, "func", 7), "functionKeyword");
  assert.equal(semanticTypeForToken(analysis, "\"some author\"", 2), "string");
  assert.equal(semanticTypeForToken(analysis, "\"some text\"", 3), "string");
  assert.equal(semanticTypeForToken(analysis, "\"0.01.2\"", 4), "string");
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
}`);

  assert.equal(semanticTypeForToken(analysis, "counter", 3), "property");
  assert.equal(semanticTypeForToken(analysis, "at", 4), "property");
  assert.equal(semanticTypeForToken(analysis, "storage", 5), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingMessages", 6), "property");
  assert.equal(semanticTypeForToken(analysis, "incomingExternal", 7), "property");
});
