"use babel"

import {Point, Range} from "atom"

import escapeStringRegexp from "escape-string-regexp"
import _ from "lodash"

import store from "./store"
import {log, isMultilanguageGrammar, getEmbeddedScope} from "./utils"

export function normalizeString(code) {
  if (code) {
    return code.replace(/\r\n|\r/g, "\n").trim()
  }
  throw new Erorr("I want know what a situation is this.")
}

export function getTextInRow(editor, row) {
  return normalizeString(editor.lineTextForBufferRow(row))
}

export function getTextInRange(editor, range) {
  return normalizeString(editor.getTextInBufferRange(range))
}

export function getBufferRangeForRowRange(editor, [startRow, endRow]) {
  const startRowRange = editor.bufferRangeForBufferRow(startRow)
  const endRowRange = editor.bufferRangeForBufferRow(endRow)
  return startRowRange.union(endRowRange)
}

export function isBlankRowOrCommentedRow(editor, row) {
  return editor.isBufferRowBlank(row) || editor.isBufferRowCommented(row)
}

// NOTE: Should be named: `findNonBlankRowOrNonCommentedRowUpward`.
export function findNormalRowUpward(editor, {from, stop = 0}) {
  let row = from
  while (row > stop && isBlankRowOrCommentedRow(editor, row)) {
    row--
  }
  return row
}

export function getFoldRange(editor, row) {
  const range = editor.languageMode.rowRangeForCodeFoldAtBufferRow(row)
  if (!range) return
  if (range[1] < editor.getLastBufferRow() && getTextInRow(editor, range[1] + 1) === "end") {
    range[1] += 1
  }
  return range
}

export function getCodeToInspect(editor) {
  const selectedText = getTextInRange(editor.getSelectedBufferRange())
  let code
  let cursorPosition
  if (selectedText) {
    code = selectedText
    cursorPosition = code.length
  } else {
    const cursor = editor.getLastCursor()
    const row = cursor.getBufferRow()
    code = getTextInRow(editor, row)
    cursorPosition = cursor.getBufferColumn()

    // TODO: use kernel.complete to find a selection
    const identifierEnd = code ? code.slice(cursorPosition).search(/\W/) : -1
    if (identifierEnd !== -1) {
      cursorPosition += identifierEnd
    }
  }

  return [code, cursorPosition]
}

export function getRegexString(editor) {
  const scope = editor.getRootScopeDescriptor()

  const {commentStartString} = editor.getCommentStrings(scope)

  if (!commentStartString) {
    log("CellManager: No comment string defined in root scope")
    return null
  }

  const escapedCommentStartString = escapeStringRegexp(commentStartString.trimRight())

  const regexString = `${escapedCommentStartString}(%%| %%| <codecell>| In\[[0-9 ]*\]:?)`

  return regexString
}

export function getBreakpoints(editor) {
  const breakpoints = []

  const regexString = getRegexString(editor)
  if (regexString) {
    const regex = new RegExp(regexString, "g")
    editor.buffer.scan(regex, ({range}) => {
      breakpoints.push(range.start)
    })
  }
  return breakpoints
}

function getCurrentCodeCell(editor) {
  const buffer = editor.getBuffer()
  let start = new Point(0, 0)
  let end = buffer.getEndPosition()
  const regexString = getRegexString(editor)

  if (!regexString) {
    return new Range(start, end)
  }

  const regex = new RegExp(regexString)
  const cursor = editor.getCursorBufferPosition()

  while (cursor.row < end.row && editor.isBufferRowCommented(cursor.row)) {
    cursor.row += 1
    cursor.column = 0
  }

  if (cursor.row > 0) {
    buffer.backwardsScanInRange(regex, new Range(start, cursor), ({range}) => {
      start = new Point(range.start.row + 1, 0)
    })
  }

  buffer.scanInRange(regex, new Range(cursor, end), ({range}) => {
    end = range.start
  })

  log("CellManager: Cell [start, end]:", [start, end], "cursor:", cursor)

  return new Range(start, end)
}

function isEmbeddedCode(editor, referenceScope, row) {
  const scopes = editor.scopeDescriptorForBufferPosition(new Point(row, 0)).getScopesArray()
  return _.includes(scopes, referenceScope)
}

function getCurrentFencedCodeBlock(editor) {
  const buffer = editor.getBuffer()
  const {row: bufferEndRow} = buffer.getEndPosition()

  const cursor = editor.getCursorBufferPosition()
  let start = cursor.row
  let end = cursor.row
  const scope = getEmbeddedScope(editor, cursor)
  if (!scope) return getCurrentCodeCell(editor)
  while (start > 0 && isEmbeddedCode(editor, scope, start - 1)) {
    start -= 1
  }

  while (end < bufferEndRow && isEmbeddedCode(editor, scope, end + 1)) {
    end += 1
  }

  return new Range([start, 0], [end, 9999999])
}

export function getCurrentCell(editor) {
  if (isMultilanguageGrammar(editor.getGrammar())) {
    return getCurrentFencedCodeBlock(editor)
  }
  return getCurrentCodeCell(editor)
}

export function getCells(editor, breakpoints = []) {
  if (breakpoints.length) {
    breakpoints.unshift(Point.ZERO)
    breakpoints.sort((a, b) => a.compare(b))
  } else {
    breakpoints.push(Point.ZERO)
    const detectedBreakpoints = getBreakpoints(editor)
    if (detectedBreakpoints.length) {
      breakpoints.push(...detectedBreakpoints)
    }
    breakpoints.push(editor.getEofBufferPosition())
  }
  return getRangesBetweenPoints(breakpoints)
}

// assume all points passed are at EOL.
function getRangesBetweenPoints(points) {
  points = points.map(point => Point.fromObject(point))
  points.sort((a, b) => a.compare(b))

  let start = points.shift()
  const ranges = []
  for (const point of points) {
    ranges.push(new Range(start, point))
    start = point.traverse([1, 0])
  }
  return ranges
}

export function moveDown(editor, row) {
  const lastRow = editor.getLastBufferRow()

  if (row >= lastRow) {
    editor.moveToBottom()
    editor.insertNewline()
    return
  }

  while (row < lastRow) {
    row += 1
    if (!isBlankRowOrCommentedRow(editor, row)) break
  }

  editor.setCursorBufferPosition({
    row,
    column: 0,
  })
}

export function findPrecedingBlock(editor, fromRow) {
  const baseIndentLevel = editor.indentationForBufferRow(fromRow)

  for (let row = startRow; row >= 0; row--) {
    if (
      editor.indentationForBufferRow(row) > baseIndentLevel ||
      isBlankRowOrCommentedRow(editor, row) ||
      getTextInRow(editor, row) === "end"
    )
      continue

    const endRow = findNormalRowUpward(editor, {from: fromRow, stop: row})
    const range = getBufferRangeForRowRange(editor, [row, endRow])
    return [getTextInRange(editor, range), endRow]
  }
  return null
}

// Return [text, endRow]
export function findCodeBlock(editor) {
  const selection = editor.getLastSelection()
  const {cursor} = selection

  if (!selection.isEmpty()) {
    let [starRow, endRow] = selection.getBufferRowRange()
    endRow = findNormalRowUpward(editor, {from: endRow, stop: startRow})
    return [selection.getText(), endRow]
  }

  const cursorRow = cursor.getBufferRow()

  // cursor is at fold
  const rowRange = editor.languageMode.rowRangeForCodeFoldAtBufferRow(cursorRow)
  // FIXME, some grammar omit foldending row of text from fold which break completeness of fold
  if (!rowRange || (Number.isInteger(rowRange[0]) && Number.isInteger(rowRange[1]))) {
    const text = getTextInRange(editor, getBufferRangeForRowRange(editor, rowRange))
    return [text, rowRange[1]]
  }

  // cursor is at non-code row
  // FIXME === end is not accurate approach.
  if (isBlankRowOrCommentedRow(editor, cursorRow) || getTextInRow(editor, cursorRow) === "end") {
    return findPrecedingBlock(editor, cursorRow)
  }

  // cursor is at normal code row
  return [getTextInRow(editor, cursorRow), cursorRow]
}
