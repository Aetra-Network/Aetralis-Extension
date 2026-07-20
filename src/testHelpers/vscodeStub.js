'use strict';
// Minimal stand-in for the `vscode` module, just enough for symbolIndex.js's
// indexSource() to run outside a real VS Code host (see genericsIndex.test.js).
// Only the two constructors indexSource actually touches (via its `loc()`
// helper) are implemented.

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
}

class Location {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}

module.exports = { Position, Range, Location };
