const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");

test("language-specific defaults lock the requested colors", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  assert.ok(defaults, "missing [atlx] defaults");

  const semanticRules = defaults["editor.semanticTokenColorCustomizations"].rules;
  assert.equal(semanticRules.annotation, "#41d7d1");
  assert.equal(semanticRules.property, "#8fd3c7");
  assert.equal(semanticRules.string, "#d8c6a0");
  assert.equal(semanticRules.functionKeyword, "#f4c96b");
  assert.equal(semanticRules.type, "#8dff9f");
});

test("textmate fallback rules cover annotations, metadata and fields", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  const rules = defaults["editor.tokenColorCustomizations"].textMateRules;

  const annotationRule = rules.find((rule) => rule.scope.includes("entity.other.attribute-name.atlx"));
  assert.ok(annotationRule, "missing annotation scope fallback");

  const metadataRule = rules.find((rule) => rule.scope.includes("entity.name.variable.contract-field.atlx"));
  assert.ok(metadataRule, "missing metadata/field scope fallback");

  assert.equal(annotationRule.settings.foreground, "#41d7d1");
  assert.equal(metadataRule.settings.foreground, "#8fd3c7");
});
