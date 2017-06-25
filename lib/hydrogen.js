"use babel"

import {Range} from "atom"
import kernelManager from "./kernel-manager"
import {isMultilanguageGrammar} from "./utils"
import * as codeManager from "./code-manager"
import bubbleManager from "./bubble-manager"
import ResultView from "./components/result-view"
import OutputStore from "./store/output"

function createOutputStore(editor, row) {
  const outputStore = new OutputStore()
  outputStore.updatePosition({
    lineLength: editor.buffer.lineLengthForRow(row),
    lineHeight: editor.getLineHeightInPixels(),
    editorWidth: editor.getEditorWidthInChars(),
  })
  return outputStore
}

export default class Hydrogen {
  constructor(editor) {
    this.editor = editor
  }

  async runAll(breakpoints = []) {
    const editor = this.editor
    bubbleManager.clear(editor)

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All" is not supported for this file type!')
      return
    }

    await kernelManager.startKernelIfNeeded(editor)

    for (const range of codeManager.getCells(editor, breakpoints)) {
      const {start, end} = range
      const text = codeManager.normalizeString(editor.getTextInBufferRange(range))
      const bubbleRow = codeManager.escapeBlankRows(editor, start.row, end.row)
      this.executeText(editor, text, bubbleRow)
    }
  }

  async restartKernelAndReEvaluateBubbles() {
    if (kernelManager.hasKernelForEditor(this.editor)) {
      const restarted = await kernelManager.restart(this.editor)
      if (!restarted) return
    }
    const breakpoints = bubbleManager.getStartPositions(this.editor)
    this.runAll(breakpoints)
  }

  async executeText(editor, text, bubbleRow) {
    await kernelManager.startKernelIfNeeded(editor)
    const kernel = kernelManager.getKernelForEditor(editor)

    const outputStore = createOutputStore(editor, bubbleRow)
    const decoration = bubbleManager.createBubble({
      editor: editor,
      row: bubbleRow,
      view: new ResultView(outputStore, kernel, true),
    })

    kernel.execute(text, message => {
      editor.component.invalidateBlockDecorationDimensions(decoration)
      outputStore.appendOutput(message)
    })
  }

  toggleBubble() {
    const editor = this.editor
    const [startRow, endRow] = editor.getLastSelection().getBufferRowRange()

    const markerLayer = bubbleManager.getMarkerLayer(editor)

    for (let row = startRow; row <= endRow; row++) {
      let destroyed = false

      for (const marker of markerLayer.findMarkers({startBufferRow: row})) {
        marker.destroy()
        destroyed = true
      }

      if (!destroyed) {
        const outputStore = createOutputStore(editor, row)
        outputStore.status = "empty"

        bubbleManager.createBubble({
          editor: editor,
          row: row,
          view: new ResultView(outputStore, null, true),
        })
      }
    }
  }

  run({moveDown = false} = {}) {
    const editor = this.editor

    const codeBlock = codeManager.findCodeBlock(editor)
    if (!codeBlock) return
    const [text, row] = codeBlock

    if (!text) return
    if (moveDown) codeManager.moveDown(editor, row)

    this.executeText(editor, text, row)
  }

  runAllAbove() {
    const editor = this.editor
    bubbleManager.clear(editor)

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All Above" is not supported for this file type!')
      return
    }

    const cursor = editor.getLastCursor()
    const row = codeManager.escapeBlankRows(editor, 0, cursor.getBufferRow())
    const text = codeManager.normalizeString(editor.getTextInBufferRange([[0, 0], [row, Infinity]]))
    if (!text) return

    this.executeText(editor, text, row)
  }

  runCell({moveDown = false} = {}) {
    const editor = this.editor

    const range = codeManager.getCurrentCell(editor)
    const {start, end} = range

    // FIXME: recheck
    const _range = new Range(start, [end.row, Infinity])

    for (const marker of bubbleManager.getMarkers(editor)) {
      if (_range.containsPoint(marker.getStartBufferPosition())) {
        marker.destroy()
      }
    }

    const endRow = codeManager.escapeBlankRows(editor, start.row, end.row)
    const text = codeManager.normalizeString(
      editor.getTextInBufferRange([[start.row, 0], [endRow, Infinity]])
    )
    if (!text) return

    if (moveDown) codeManager.moveDown(editor, endRow)

    this.executeText(editor, text, endRow)
  }
}
