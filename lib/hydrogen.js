"use babel"

import {Range, Emitter, CompositeDisposable} from "atom"
import {isMultilanguageGrammar} from "./utils"
import * as codeManager from "./code-manager"

import KernelManager from "./kernel-manager"
import BubbleManager from "./bubble-manager"

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

class Hydrogen {
  constructor(editor) {
    this.editor = editor
    this.emitter = new Emitter()
    this.kernelManager = new KernelManager(this)
    this.bubbleManager = new BubbleManager(this)

    // editor.
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(editor.onDidDestroy(() => this.destroy()))
  }

  onDidDestroy(fn) {
    return this.emitter.on("did-destroy", fn)
  }

  emitDidDestroy() {
    this.emitter.emit("did-destroy")
  }

  destroy() {
    this.subscriptions.dispose()
    this.emitDidDestroy()
  }

  async runAll(breakpoints = []) {
    const editor = this.editor
    this.clearBubbles()

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All" is not supported for this file type!')
      return
    }

    await this.kernelManager.startIfNeeded()

    for (const range of codeManager.getCells(editor, breakpoints)) {
      const {start, end} = range
      const text = codeManager.getTextInRange(editor, range)
      const bubbleRow = codeManager.findNormalRowUpward(editor, {from: end.row, stop: start.row})
      this.executeText(editor, text, bubbleRow)
    }
  }

  async restartKernelAndReEvaluateBubbles() {
    const editor = this.editor
    if (this.kernelManager.kernel) {
      const restarted = await this.kernelManager.restart()
      // Early return if it couldn't restart, e.g. Another restarting was in progress.
      if (!restarted) return
    }
    this.runAll(this.bubbleManager.getStartPositions())
  }

  async executeText(editor, text, bubbleRow) {
    await this.kernelManager.startIfNeeded()
    const {kernel} = this.kernelManager

    const outputStore = createOutputStore(editor, bubbleRow)
    const decoration = this.bubbleManager.createBubble({
      row: bubbleRow,
      view: new ResultView(outputStore, kernel, true),
    })

    // We get multiple response message against one request.
    // So this handler is called multiple time with different message.
    const onShellMessage = message => {
      // from Atom v1.19.0, block-decoration is NOT re-measured unless explicitly invalidate.
      editor.component.invalidateBlockDecorationDimensions(decoration)
      outputStore.appendOutput(message)
    }

    kernel.execute(text, onShellMessage)
  }

  toggleBubble() {
    const editor = this.editor
    const [startRow, endRow] = editor.getLastSelection().getBufferRowRange()

    for (let row = startRow; row <= endRow; row++) {
      const markersInRow = this.bubbleManager.findMarkers({startBufferRow: row})
      if (markersInRow.length) {
        for (const marker of markers) marker.destroy()
      } else {
        const outputStore = createOutputStore(editor, row)
        outputStore.status = "empty"

        this.bubbleManager.createBubble({
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
    this.clearBubbles()

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All Above" is not supported for this file type!')
      return
    }

    const row = codeManager.findNormalRowUpward(editor, {
      from: editor.getCursorBufferPosition().row,
    })
    const text = codeManager.getTextInRange(editor, [[0, 0], [row, Infinity]])
    if (!text) return

    this.executeText(editor, text, row)
  }

  runCell({moveDown = false} = {}) {
    const editor = this.editor

    const range = codeManager.getCurrentCell(editor)
    const {start, end} = range

    // FIXME: recheck
    const _range = new Range(start, [end.row, Infinity])

    for (const marker of this.bubbleManager.getMarkers()) {
      if (_range.containsPoint(marker.getStartBufferPosition())) {
        marker.destroy()
      }
    }

    const row = codeManager.findNormalRowUpward(editor, {from: end.row, stop: start.row})
    const text = codeManager.getTextInRange(editor, [[start.row, 0], [row, Infinity]])

    if (!text) return

    if (moveDown) codeManager.moveDown(editor, row)

    this.executeText(editor, text, row)
  }

  clearBubbles() {
    this.bubbleManager.clear()
  }

  // Section: Proxying to Kernel manager
  //==================================================
  // FIXME: BROKEN
  switchKernel(kernelSpec) {
    if (!kernelSpec) return
    const editor = this.editor
    this.clearBubbles()

    const {kernel} = this.kernelManager
    if (kernel) kernel.destroy()

    // this.kernelManager.start(kernelSpec)
  }

  interruptKernel() {
    return this.kernelManager.interrupt()
  }

  restartKernel() {
    return this.kernelManager.restart()
  }

  shutdownKernel() {
    this.clearBubbles()
    return this.kernelManager.shutdown()
  }

  renameWSKernel() {
    return this.kernelManager.renameWSKernel()
  }

  disconnectKernel() {
    this.clearBubbles()
    return this.kernelManager.disconnect()
  }
}

export default Hydrogen
