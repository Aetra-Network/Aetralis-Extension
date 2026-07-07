'use strict';
const vscode = require('vscode');
const { SEND_MODE_DOCS, WORD_DOCS, ANNOTATION_DOCS, ANNOTATION_SNIPPETS } = require('./constants');
const { mergedIndex } = require('./symbolIndex');
const { renderStructHover, renderEnumHover, renderFunctionHover } = require('./hoverProvider');
const { md } = require('./markdown');

// ---------------------------------------------------------------------------
// Completion provider — static items, snippet expansion, plus live symbols.
// ---------------------------------------------------------------------------

const completionProvider = {
  provideCompletionItems(document, position) {
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const items = [];

    const annMatch = line.match(/@[a-z]*$/);
    if (annMatch) {
      const replaceRange = new vscode.Range(
        position.translate(0, -annMatch[0].length),
        position
      );
      for (const [ann, snippet] of Object.entries(ANNOTATION_SNIPPETS)) {
        const item = new vscode.CompletionItem(ann, vscode.CompletionItemKind.Snippet);
        item.insertText = new vscode.SnippetString(snippet);
        item.range = replaceRange;
        item.documentation = md(ANNOTATION_DOCS[ann] || '');
        item.detail = 'Aetralis annotation';
        item.sortText = '0' + ann;
        items.push(item);
      }
      return items;
    }

    for (const [mode, doc] of Object.entries(SEND_MODE_DOCS)) {
      const item = new vscode.CompletionItem(mode, vscode.CompletionItemKind.EnumMember);
      item.documentation = md(['**' + mode + '** — send mode.', '', doc]);
      item.detail = 'send mode';
      item.sortText = '1' + mode;
      items.push(item);
    }

    const build = new vscode.CompletionItem('buildMessage', vscode.CompletionItemKind.Snippet);
    build.insertText = new vscode.SnippetString(
      'buildMessage({\n' +
      '    bounce: BounceMode.${1|Only256BitsOfBody,NoBounce|},\n' +
      '    amount: ${2:0},\n' +
      '    receiver: ${3:dest},\n' +
      '    body: ${4:MessageStruct} {\n' +
      '        $0\n' +
      '    }\n' +
      '})'
    );
    build.detail = 'Outbound message builder';
    build.documentation = md([
      'Canonical builder for outbound messages. Fields:',
      '- `bounce` — `BounceMode.NoBounce` or `BounceMode.Only256BitsOfBody`;',
      '- `amount` — attached coins;',
      '- `receiver` — destination address;',
      '- `body` — typed `@message` struct literal.',
      '',
      'Send the result with `.send(SEND_...)`.'
    ]);
    build.sortText = '0buildMessage';
    items.push(build);

    const sendCall = new vscode.CompletionItem('send', vscode.CompletionItemKind.Snippet);
    sendCall.insertText = new vscode.SnippetString(
      'send(${1|SEND_DEFAULT,SEND_BOUNCE_ON_FAIL,SEND_CARRY_REMAINDER,SEND_DRAIN_BALANCE,SEND_FEE_FROM_BALANCE,SEND_IGNORE_ERRORS,SEND_ESTIMATE_ONLY,SEND_DESTROY_IF_EMPTY|})'
    );
    sendCall.detail = 'Send a built message';
    sendCall.documentation = md('Sends a `buildMessage` result with the chosen send mode. Hover a `SEND_*` name for its meaning.');
    items.push(sendCall);

    for (const word of Object.keys(WORD_DOCS)) {
      const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
      item.documentation = md(WORD_DOCS[word]);
      items.push(item);
    }
    for (const typ of ['uint2', 'uint4', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256', 'int2', 'int4', 'int8', 'int16', 'int32', 'int64', 'coins', 'address', 'bool', 'string', 'bytes', 'Code', 'Segment', 'Chunk']) {
      const item = new vscode.CompletionItem(typ, vscode.CompletionItemKind.TypeParameter);
      item.detail = 'type';
      items.push(item);
    }

    // Live symbols: this file's own + every other known/workspace-scanned
    // .atlx file, so an imported name (e.g. from token_shared.atlx) shows up
    // by just typing its first letters, same as a builtin would. This also
    // covers names you just declared yourself — a struct, function, const,
    // or local `var` binding you wrote earlier in the file (or in another
    // open/workspace file) is offered back to you as you start typing it
    // again, and Tab or a click on the suggestion completes it.
    const index = mergedIndex(document.uri.toString());
    for (const [name, entry] of index.structs) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Struct);
      item.detail = 'struct ' + name;
      item.documentation = md(renderStructHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.enums) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Enum);
      item.detail = 'enum ' + name;
      item.documentation = md(renderEnumHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.types) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Interface);
      item.detail = 'type ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.functions) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = (entry.receiver ? entry.receiver + '.' : '') + name + '(' + entry.params + ')';
      item.documentation = md(renderFunctionHover(entry));
      items.push(item);
    }
    for (const [name, entry] of index.consts) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Constant);
      item.detail = 'const ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.variables) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.detail = 'var ' + name;
      item.documentation = md('= `' + entry.value + '`');
      items.push(item);
    }
    for (const [name, entry] of index.contracts) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
      item.detail = 'contract ' + name;
      items.push(item);
    }
    return items;
  }
};

module.exports = { completionProvider };
