const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");

test("language-specific defaults lock the requested colors", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  assert.ok(defaults, "missing [atlx] defaults");

  const semanticRules = defaults["editor.semanticTokenColorCustomizations"].rules;
  assert.equal(semanticRules.annotation, "#3ddc97");
  assert.equal(semanticRules.assertKeyword, "#c792ea");
  assert.equal(semanticRules.property, "#6bd6ff");
  assert.equal(semanticRules.string, "#d8c6a0");
  assert.equal(semanticRules.functionKeyword, "#f4c96b");
  assert.equal(semanticRules.type, "#8dff9f");
  assert.equal(semanticRules.messageName, "#8dff9f");
  assert.equal(semanticRules.function, "#ffd166");
  assert.equal(semanticRules.builtin, "#ffd166");
});

test("textmate fallback rules cover annotations, metadata, fields, and controls", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  const rules = defaults["editor.tokenColorCustomizations"].textMateRules;

  const annotationRule = rules.find((rule) => rule.scope.includes("entity.other.attribute-name.atlx"));
  assert.ok(annotationRule, "missing annotation scope fallback");

  const metadataRule = rules.find((rule) => rule.scope.includes("entity.name.variable.contract-field.atlx"));
  assert.ok(metadataRule, "missing metadata/field scope fallback");

  const assertRule = rules.find((rule) => rule.scope.includes("keyword.control.assert.atlx"));
  assert.ok(assertRule, "missing assert scope fallback");

  assert.equal(annotationRule.settings.foreground, "#3ddc97");
  assert.equal(metadataRule.settings.foreground, "#6bd6ff");
  assert.equal(assertRule.settings.foreground, "#c792ea");
});

test("semantic token legend includes the emitted token types", () => {
  const tokenTypes = packageJson.contributes.semanticTokenTypes.map((entry) => entry.id);
  for (const id of ["assertKeyword", "type", "function", "parameter", "variable", "property", "number", "operator", "messageName"]) {
    assert.ok(tokenTypes.includes(id), `missing semantic token type ${id}`);
  }
});
