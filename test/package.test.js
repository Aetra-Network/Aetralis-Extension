const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");

test("language-specific defaults lock the requested colors", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  assert.ok(defaults, "missing [atlx] defaults");

  const semanticRules = defaults["editor.semanticTokenColorCustomizations"].rules;
  assert.equal(semanticRules.annotation, "#56b6c2");
  assert.equal(semanticRules.declarationKeyword, "#c678dd");
  assert.equal(semanticRules.controlKeyword, "#e06c75");
  assert.equal(semanticRules.abortKeyword, "#e06c75");
  assert.equal(semanticRules.bindingKeyword, "#e5c07b");
  assert.equal(semanticRules.sideEffectKeyword, "#56b6c2");
  assert.equal(semanticRules.deprecated, "#7f848e");
  assert.equal(semanticRules.type, "#61afef");
  assert.equal(semanticRules.builtinType, "#61afef");
  assert.equal(semanticRules.contractName, "#61afef");
  assert.equal(semanticRules.builtin, "#56b6c2");
  assert.equal(semanticRules.function, "#d19a66");
  assert.equal(semanticRules.parameter, "#e5c07b");
  assert.equal(semanticRules.variable, "#abb2bf");
  assert.equal(semanticRules.property, "#abb2bf");
  assert.equal(semanticRules.constant, "#98c379");
  assert.equal(semanticRules.enumMember, "#98c379");
  assert.equal(semanticRules.operator, "#7f848e");
  assert.equal(semanticRules.string, "#d8c6a0");
});

test("language icon points at atlx artwork", () => {
  const language = packageJson.contributes.languages.find((entry) => entry.id === "atlx");
  assert.ok(language, "missing atlx language contribution");
  assert.equal(language.icon.light, "./assets/atlx.png");
  assert.equal(language.icon.dark, "./assets/atlx.png");
});

test("extension does not contribute icon themes", () => {
  assert.ok(!packageJson.contributes.iconThemes, "icon themes should not be contributed");
});

test("textmate fallback rules cover annotations, declarations, types, and deprecated compatibility", () => {
  const defaults = packageJson.configurationDefaults["[atlx]"];
  const rules = defaults["editor.tokenColorCustomizations"].textMateRules;

  const annotationRule = rules.find((rule) => rule.scope.includes("entity.other.attribute-name.atlx"));
  assert.ok(annotationRule, "missing annotation scope fallback");

  const declarationRule = rules.find((rule) => rule.scope.includes("keyword.declaration.atlx"));
  assert.ok(declarationRule, "missing declaration scope fallback");

  const deprecatedRule = rules.find((rule) => rule.scope.includes("invalid.deprecated.atlx"));
  assert.ok(deprecatedRule, "missing deprecated scope fallback");

  const builtinTypeRule = rules.find((rule) => rule.scope.includes("storage.type.builtin.atlx"));
  assert.ok(builtinTypeRule, "missing builtin type scope fallback");

  assert.equal(annotationRule.settings.foreground, "#56b6c2");
  assert.equal(declarationRule.settings.foreground, "#c678dd");
  assert.equal(deprecatedRule.settings.foreground, "#7f848e");
  assert.equal(builtinTypeRule.settings.foreground, "#61afef");
});

test("semantic token legend includes the emitted token types", () => {
  const tokenTypes = packageJson.contributes.semanticTokenTypes.map((entry) => entry.id);
  for (const id of ["declarationKeyword", "controlKeyword", "abortKeyword", "bindingKeyword", "sideEffectKeyword", "deprecated", "type", "builtinType", "function", "parameter", "variable", "property", "constant", "enumMember", "number", "operator"]) {
    assert.ok(tokenTypes.includes(id), `missing semantic token type ${id}`);
  }
});
