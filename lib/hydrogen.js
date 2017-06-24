"use babel"

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
      const restarted = await kernelManager.restartKernel(this.editor)
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
}
