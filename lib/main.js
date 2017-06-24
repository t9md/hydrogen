"use babel"

import {Emitter, CompositeDisposable, Disposable, Point, TextEditor} from "atom"

// import _ from "lodash"
// import {autorun} from "mobx"
import React from "react"
import ReactDOM from "react-dom"

import KernelPicker from "./kernel-picker"
import WSKernelPicker from "./ws-kernel-picker"
import SignalListView from "./signal-list-view"
import * as codeManager from "./code-manager"

import Inspector from "./components/inspector"
import ResultView from "./components/result-view"
import StatusBar from "./components/status-bar"

import InspectorPane from "./panes/inspector"
import WatchesPane from "./panes/watches"
import OutputPane from "./panes/output-area"

import {toggleInspector} from "./commands"

import store from "./store"
import OutputStore from "./store/output"

import Config from "./config"
import kernelManager from "./kernel-manager"
import ZMQKernel from "./zmq-kernel"
import WSKernel from "./ws-kernel"
import AutocompleteProvider from "./autocomplete-provider"
import HydrogenProvider from "./plugin-api/hydrogen-provider"
import {
  log,
  reactFactory,
  isMultilanguageGrammar,
  renderMobxReactDevtools,
  INSPECTOR_URI,
  WATCHES_URI,
  OUTPUT_AREA_URI,
  hotReloadPackage,
  getGrammar,
} from "./utils"

function getEditor() {
  return atom.workspace.getActiveTextEditor()
}

const Hydrogen = {
  config: Config.schema,

  activate() {
    console.log("activated!!")
    this.emitter = new Emitter()

    this.markerLayerByEditor = new Map() // used to manager bubble marker
    this.subscriptions = new CompositeDisposable()
    this.hydrogenProvider = null

    this.registerOpener()
    this.registerCommands()

    this.subscriptions.add(
      atom.workspace.observeActivePaneItem(item => {
        if (atom.workspace.isTextEditor(item)) this.initializeEditor(item)
      })
    )

    if (atom.config.get("Hydrogen.debug")) renderMobxReactDevtools()
  },

  initializeEditor(editor) {
    store.updateEditor(editor)
    if (!this.markerLayerByEditor.has(editor)) {
      this.markerLayerByEditor.set(editor, editor.addMarkerLayer())
    }

    const disposable = editor.onDidDestroy(() => {
      if (this.markerLayerByEditor.has(editor)) {
        this.markerLayerByEditor.get(editor).destroy()
        this.markerLayerByEditor.delete(editor)
      }
    })
    this.subscriptions.add(disposable)
  },

  registerOpener() {
    this.subscriptions.add(
      atom.workspace.addOpener(uri => {
        switch (uri) {
          case INSPECTOR_URI:
            return new InspectorPane(store)
          case WATCHES_URI:
            return new WatchesPane(store)
          case OUTPUT_AREA_URI:
            return new OutputPane(store)
        }
      })
    )
  },

  registerCommands() {
    this.subscriptions.add(
      atom.commands.add("atom-text-editor:not([mini])", {
        "hydrogen:run": () => this.run(),
        "hydrogen:run-and-move-down": () => this.run({moveDown: true}),
        "hydrogen:run-cell": () => this.runCell(),
        "hydrogen:run-cell-and-move-down": () => this.runCell({moveDown: true}),
        "hydrogen:run-all": () => this.runAll(),
        "hydrogen:run-all-above": () => this.runAllAbove(),
        "hydrogen:toggle-bubble": () => this.toggleBubble(),
        "hydrogen:clear-results": () => this.clearResultBubbles(),
        "hydrogen:restart-kernel-and-re-evaluate-bubbles": () =>
          this.restartKernelAndReEvaluateBubbles(),

        // TODO
        // "hydrogen:toggle-watches": () => atom.workspace.toggle(WATCHES_URI),
        // "hydrogen:toggle-output-area": () => atom.workspace.toggle(OUTPUT_AREA_URI),
        // "hydrogen:select-kernel": () => this.selectKernel(),
        // "hydrogen:connect-to-remote-kernel": () => this.showWSKernelPicker(),
        // "hydrogen:add-watch": () => {
        //   if (store.kernel) {
        //     store.kernel.watchesStore.addWatchFromEditor(store.editor)
        //     atom.workspace.open(WATCHES_URI, {searchAllPanes: true})
        //   }
        // },
        // "hydrogen:remove-watch": () => {
        //   if (store.kernel) {
        //     store.kernel.watchesStore.removeWatch()
        //     atom.workspace.open(WATCHES_URI, {searchAllPanes: true})
        //   }
        // },
        "hydrogen:update-kernels": () => kernelManager.updateKernelSpecs(),
        "hydrogen:toggle-inspector": () => toggleInspector(store),
        "hydrogen:interrupt-kernel": () => this.interruptKernel(),
        "hydrogen:restart-kernel": () => this.restartKernel(),
        "hydrogen:shutdown-kernel": () => this.shutdownKernel(),
      })
    )

    if (atom.inDevMode()) {
      this.subscriptions.add(
        atom.commands.add("atom-workspace", {
          "hydrogen:hot-reload-package": () => hotReloadPackage(),
        })
      )
    }
  },

  deactivate() {
    store.destroy()
    this.subscriptions.dispose()

    // Destroy markers for bubbles
    this.markerLayerByEditor.forEach(markerLayer => markerLayer.destroy())
    this.markerLayerByEditor.clear()

    // Destroy Hydrogen panes
    const URIs = [INSPECTOR_URI, WATCHES_URI, OUTPUT_AREA_URI]
    for (const item of atom.workspace.getPaneItems()) {
      if (URIs.includes(item.getURI())) {
        item.destroy()
      }
    }
  },

  consumeStatusBar(statusBar) {
    const element = document.createElement("div")
    element.className = "inline-block"
    const onClick = this.showKernelCommands.bind(this)
    ReactDOM.render(<StatusBar store={store} onClick={onClick} />, element)

    const tile = statusBar.addLeftTile({item: element, priority: 100})
    this.subscriptions.add(new Disposable(() => tile.destroy()))
  },

  clearResultBubbles() {
    this.markerLayerByEditor.get(getEditor()).clear()
  },

  getKernel() {
    return kernelManager.getKernelForEditor(getEditor())
  },

  switchKernel(kernelSpec) {
    if (!kernelSpec) return
    this.clearResultBubbles()

    const editor = getEditor()
    const kernel = kernelManager.getKernelForEditor(editor)
    if (kernel) kernel.destroy()

    const grammar = getGrammar(editor)
    kernelManager.startKernelNew(editor, grammar, kernelSpec)
  },

  interruptKernel() {
    const kernel = this.getKernel()
    if (kernel) kernel.interrupt()
  },

  async restartKernel() {
    let restarted = false

    const kernel = this.getKernel()
    if (kernel) {
      restarted = await kernel.restart()
    }
    return restarted
  },

  shutdownKernel() {
    const kernel = this.getKernel()
    if (!kernel) return

    this.clearResultBubbles()
    // Note that destroy alone does not shut down a WSKernel
    kernel.shutdown()
    kernel.destroy()
  },

  renameWSKernel() {
    // What's WSKernel??
    const kernel = this.getKernel()
    if (kernel && kernel instanceof WSKernel) {
      kernel.promptRename()
    }
  },

  disconnectKernel() {
    const kernel = this.getKernel()
    if (!kernel) return
    this.clearResultBubbles()
    kernel.destroy()
  },

  async restartKernelAndReEvaluateBubbles() {
    const editor = getEditor()

    if (kernelManager.hasKernelForEditor(editor)) {
      const restarted = this.restartKernel()
      if (!restarted) return
    }

    const markerLayer = this.markerLayerByEditor.get(editor)
    const breakpoints = markerLayer.getMarkers().map(marker => marker.getStartBufferPosition())

    this.runAll(breakpoints)
  },

  toggleBubble() {
    const editor = getEditor()
    const [startRow, endRow] = editor.getLastSelection().getBufferRowRange()

    const markerLayer = this.markerLayerByEditor.get(editor)

    for (let row = startRow; row <= endRow; row++) {
      let destroyed = false

      for (const marker of markerLayer.findMarkers({startBufferRow: row})) {
        marker.destroy()
        destroyed = true
      }

      if (!destroyed) {
        const outputStore = this.createOutputStore(editor, row)
        const resultView = new ResultView(outputStore, null, true)
        this.createBubbleAndBindToView(editor, row, resultView)
        outputStore.status = "empty"
      }
    }
  },

  run({moveDown = false} = {}) {
    const editor = getEditor()
    const codeBlock = codeManager.findCodeBlock(editor)
    if (!codeBlock) return
    const [code, row] = codeBlock

    if (!code) return
    if (moveDown) codeManager.moveDown(editor, row)

    this.executeCode(editor, code, row)
  },

  async runAll(breakpoints) {
    this.clearResultBubbles()
    const editor = getEditor()

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All" is not supported for this file type!')
      return
    }

    await this.getOrStartKernel(editor)

    for (const range of codeManager.getCells(editor, breakpoints)) {
      const {start, end} = range
      const code = codeManager.normalizeString(editor.getTextInBufferRange(range))
      const bubbleRow = codeManager.escapeBlankRows(editor, start.row, end.row)
      this.executeCode(editor, code, bubbleRow)
    }
  },

  createOutputStore(editor, row) {
    const outputStore = new OutputStore()
    outputStore.updatePosition({
      lineLength: editor.buffer.lineLengthForRow(row),
      lineHeight: editor.getLineHeightInPixels(),
      editorWidth: editor.getEditorWidthInChars(),
    })
    return outputStore
  },

  createBubbleAndBindToView(editor, row, resultView) {
    const markerLayer = this.markerLayerByEditor.get(editor)
    const marker = markerLayer.markBufferPosition([row, Infinity], {invalidate: "touch"})

    const decoration = editor.decorateMarker(marker, {
      type: "block",
      item: resultView.element,
      position: "after",
    })

    marker.onDidChange(event => {
      if (!event.isValid) {
        resultView.destroy()
        marker.destroy()
      } else {
        resultView.outputStore.updatePosition({
          lineLength: marker.getStartBufferPosition().column,
        })
      }
    })

    return decoration
  },

  async getOrStartKernel(editor) {
    let kernel = kernelManager.getKernelForEditor(editor)
    if (!kernel) {
      const grammar = getGrammar(editor)
      const kernelSpec = kernelManager.getKernelSpecForGrammarNew(grammar)
      kernel = await kernelManager.startKernelNew(editor, grammar, kernelSpec)
    }
    return kernel
  },

  async executeCode(editor, code, bubbleRow) {
    const kernel = await this.getOrStartKernel(editor)

    const outputStore = this.createOutputStore(editor, bubbleRow)
    const resultView = new ResultView(outputStore, kernel, true)
    const decoration = this.createBubbleAndBindToView(editor, bubbleRow, resultView)

    kernel.execute(code, message => {
      editor.component.invalidateBlockDecorationDimensions(decoration)
      outputStore.appendOutput(message)
    })
  },

  runAllAbove() {
    this.clearResultBubbles()

    const editor = getEditor()
    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All Above" is not supported for this file type!')
      return
    }

    const cursor = editor.getLastCursor()
    const row = codeManager.escapeBlankRows(editor, 0, cursor.getBufferRow())
    const text = editor.getTextInBufferRange([[0, 0], [row, Infinity]])
    const code = codeManager.normalizeString(text)
    if (!code) return

    this.executeCode(editor, code, row)
  },

  runCell({moveDown = false} = {}) {
    const editor = getEditor()

    const range = codeManager.getCurrentCell(editor)
    const {start, end} = range

    const markerLayer = this.markerLayerByEditor.get(editor)
    for (const marker of markerLayer.getMarkers()) {
      if (range.containsPoint(marker.getStartBufferPosition())) {
        marker.destroy()
      }
    }

    const endRow = codeManager.escapeBlankRows(editor, start.row, end.row)
    const text = editor.getTextInBufferRange([[start.row, 0], [endRow, Infinity]])
    const code = codeManager.normalizeString(text)

    if (!code) return

    if (moveDown) codeManager.moveDown(editor, endRow)

    this.executeCode(editor, code, endRow)
  },

  // TODO
  provideHydrogen() {
    if (!this.hydrogenProvider) {
      this.hydrogenProvider = new HydrogenProvider(this)
    }
    return this.hydrogenProvider
  },

  provide() {
    if (atom.config.get("Hydrogen.autocomplete")) {
      return AutocompleteProvider()
    }
  },

  showKernelCommands() {
    if (!this.signalListView) {
      this.signalListView = new SignalListView()
      // FIXME handleKernelCommand is no longer exists!!!
      this.signalListView.onConfirmed = kernelCommand => this.handleKernelCommand(kernelCommand)
    }
    this.signalListView.toggle()
  },

  selectKernel() {
    kernelManager.getAllKernelSpecsForGrammar(store.grammar, kernelSpecs => {
      if (this.kernelPicker) {
        this.kernelPicker.kernelSpecs = kernelSpecs
      } else {
        this.kernelPicker = new KernelPicker(kernelSpecs)
        this.kernelPicker.onConfirmed = kernelSpec => this.switchKernel(kernelSpec)
      }
      this.kernelPicker.toggle()
    })
  },

  showWSKernelPicker() {
    if (!this.wsKernelPicker) {
      this.wsKernelPicker = new WSKernelPicker(kernel => {
        this.clearResultBubbles()

        if (kernel instanceof ZMQKernel) kernel.destroy()

        store.newKernel(kernel)
      })
    }

    this.wsKernelPicker.toggle(store.grammar, kernelSpec =>
      kernelManager.kernelSpecProvidesGrammar(kernelSpec, store.grammar)
    )
  },
}

export default Hydrogen
