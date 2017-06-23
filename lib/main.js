"use babel"

import {Emitter, CompositeDisposable, Disposable, Point, TextEditor} from "atom"

import _ from "lodash"
import {autorun} from "mobx"
import React from "react"

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
  focus,
  reactFactory,
  isMultilanguageGrammar,
  renderMobxReactDevtools,
  INSPECTOR_URI,
  WATCHES_URI,
  OUTPUT_AREA_URI,
  hotReloadPackage,
  getGrammar,
} from "./utils"

const Hydrogen = {
  config: Config.schema,

  markerBubbleMap: null,

  activate() {
    console.log("activated!!")
    this.emitter = new Emitter()
    this.bubbleMarkerByRow = {}

    this.markerBubbleMap = {}
    this.subscriptions = new CompositeDisposable()
    this.hydrogenProvider = null

    const subs = this.subscriptions

    let skipLanguageMappingsChange = false
    subs.add(
      atom.config.onDidChange("Hydrogen.languageMappings", ({newValue, oldValue}) => {
        if (skipLanguageMappingsChange) {
          skipLanguageMappingsChange = false
          return
        }

        if (store.runningKernels.size != 0) {
          skipLanguageMappingsChange = true

          atom.config.set("Hydrogen.languageMappings", oldValue)

          atom.notifications.addError("Hydrogen", {
            description: "`languageMappings` cannot be updated while kernels are running",
            dismissable: false,
          })
        }
      })
    )

    subs.add(
      atom.commands.add("atom-text-editor:not([mini])", {
        "hydrogen:run": () => this.run(),
        "hydrogen:run-all": () => this.runAll(),
        "hydrogen:run-all-above": () => this.runAllAbove(),
        "hydrogen:run-and-move-down": () => this.run(true),
        "hydrogen:run-cell": () => this.runCell(),
        "hydrogen:run-cell-and-move-down": () => this.runCell(true),
        "hydrogen:toggle-watches": () => atom.workspace.toggle(WATCHES_URI),
        "hydrogen:toggle-output-area": () => atom.workspace.toggle(OUTPUT_AREA_URI),
        "hydrogen:select-kernel": () => this.selectKernel(),
        "hydrogen:connect-to-remote-kernel": () => this.showWSKernelPicker(),
        "hydrogen:add-watch": () => {
          if (store.kernel) {
            store.kernel.watchesStore.addWatchFromEditor(store.editor)
            atom.workspace.open(WATCHES_URI, {searchAllPanes: true})
          }
        },
        "hydrogen:remove-watch": () => {
          if (store.kernel) {
            store.kernel.watchesStore.removeWatch()
            atom.workspace.open(WATCHES_URI, {searchAllPanes: true})
          }
        },
        "hydrogen:update-kernels": () => kernelManager.updateKernelSpecs(),
        "hydrogen:toggle-inspector": () => toggleInspector(store),
        "hydrogen:interrupt-kernel": () => this.handleKernelCommand({command: "interrupt-kernel"}),
        "hydrogen:restart-kernel": () => this.handleKernelCommand({command: "restart-kernel"}),
        "hydrogen:restart-kernel-and-re-evaluate-bubbles": () =>
          this.restartKernelAndReEvaluateBubbles(),
        "hydrogen:shutdown-kernel": () => this.handleKernelCommand({command: "shutdown-kernel"}),
        "hydrogen:toggle-bubble": () => this.toggleBubble(),
        "hydrogen:clear-results": () => this.clearResultBubbles(),
      })
    )

    if (atom.inDevMode()) {
      subs.add(
        atom.commands.add("atom-workspace", {
          "hydrogen:hot-reload-package": () => hotReloadPackage(),
        })
      )
    }

    subs.add(
      atom.workspace.observeActivePaneItem(item => {
        if (atom.workspace.isTextEditor(item)) store.updateEditor(item)
      })
    )

    subs.add(
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

    renderMobxReactDevtools()
  },

  destroyHydrogenPane() {
    const URIs = [INSPECTOR_URI, WATCHES_URI, OUTPUT_AREA_URI]
    for (const item of atom.workspace.getPaneItems()) {
      if (URIs.includes(item.getURI())) {
        item.destroy()
      }
    }
  },

  deactivate() {
    store.destroy()
    this.subscriptions.dispose()
    this.clearResultBubbles()
    this.destroyHydrogenPane()
  },

  provideHydrogen() {
    if (!this.hydrogenProvider) {
      this.hydrogenProvider = new HydrogenProvider(this)
    }

    return this.hydrogenProvider
  },

  consumeStatusBar(statusBar) {
    const element = document.createElement("div")
    element.className = "inline-block"

    statusBar.addLeftTile({
      item: element,
      priority: 100,
    })

    const onClick = this.showKernelCommands.bind(this)

    reactFactory(<StatusBar store={store} onClick={onClick} />, element)

    // We should return a disposable here but Atom fails while calling .destroy()
    // return new Disposable(statusBarTile.destroy);
  },

  provide() {
    if (atom.config.get("Hydrogen.autocomplete")) {
      return AutocompleteProvider()
    }
  },

  showKernelCommands() {
    if (!this.signalListView) {
      this.signalListView = new SignalListView()
      this.signalListView.onConfirmed = kernelCommand => this.handleKernelCommand(kernelCommand)
    }
    this.signalListView.toggle()
  },

  handleKernelCommand({command, payload}) {
    log("handleKernelCommand:", arguments)

    const {kernel, grammar} = store

    if (!grammar) {
      atom.notifications.addError("Undefined grammar")
      return
    }

    if (command === "switch-kernel") {
      if (!payload) return
      this.clearResultBubbles()
      if (kernel) kernel.destroy()
      kernelManager.startKernel(payload, grammar)
      return
    }

    if (!kernel) {
      const message = `No running kernel for grammar \`${grammar.name}\` found`
      atom.notifications.addError(message)
      return
    }

    if (command === "interrupt-kernel") {
      kernel.interrupt()
    } else if (command === "restart-kernel") {
      kernel.restart()
    } else if (command === "shutdown-kernel") {
      this.clearResultBubbles()
      // Note that destroy alone does not shut down a WSKernel
      kernel.shutdown()
      kernel.destroy()
    } else if (command === "rename-kernel" && kernel.promptRename) {
      // $FlowFixMe Will only be called if remote kernel
      if (kernel instanceof WSKernel) kernel.promptRename()
    } else if (command === "disconnect-kernel") {
      this.clearResultBubbles()
      kernel.destroy()
    }
  },

  createResultBubble(code, row, editor) {
    if (!store.grammar) return

    if (store.kernel) {
      this._createResultBubble(store.kernel, code, row)
      return
    }

    kernelManager.startKernelFor(store.grammar, editor, kernel => {
      this._createResultBubble(kernel, code, row)
    })
  },

  _createResultBubble(kernel, code, row) {
    if (atom.workspace.getActivePaneItem() instanceof WatchesPane) {
      kernel.watchesStore.run()
      return
    }
    const globalOutputStore = atom.workspace.getPaneItems().find(item => item instanceof OutputPane)
      ? kernel.outputStore
      : null

    const outputStore = this.insertResultBubble(store.editor, row, kernel, !globalOutputStore)

    kernel.execute(code, async result => {
      outputStore.appendOutput(result)
      if (globalOutputStore) {
        globalOutputStore.appendOutput(result)

        await atom.workspace.open(OUTPUT_AREA_URI, {searchAllPanes: true})
        focus(store.editor)
      }
    })
  },

  insertResultBubble(editor, row, kernel, showResult) {
    this.clearBubblesOnRow(row)

    const buffer = editor.getBuffer()
    const lineLength = buffer.lineLengthForRow(row)

    const point = new Point(row, lineLength)
    const marker = editor.markBufferPosition(point, {invalidate: "touch"})
    const lineHeight = editor.getLineHeightInPixels()

    const outputStore = new OutputStore()
    outputStore.updatePosition({
      lineLength: lineLength,
      lineHeight: editor.getLineHeightInPixels(),
      // $FlowFixMe: Missing flow type
      editorWidth: editor.getEditorWidthInChars(),
    })

    const view = new ResultView(outputStore, kernel, marker, showResult)
    const {element} = view

    editor.decorateMarker(marker, {
      type: "block",
      item: element,
      position: "after",
    })

    this.markerBubbleMap[marker.id] = view
    marker.onDidChange(event => {
      log("marker.onDidChange:", marker)
      if (!event.isValid) {
        view.destroy()
        delete this.markerBubbleMap[marker.id]
      } else {
        outputStore.updatePosition({
          lineLength: marker.getStartBufferPosition().column,
        })
      }
    })
    return outputStore
  },

  clearResultBubbles() {
    _.forEach(this.markerBubbleMap, bubble => bubble.destroy())
    this.markerBubbleMap = {}
  },

  restartKernelAndReEvaluateBubbles() {
    const {editor, kernel} = store

    let breakpoints = []
    _.forEach(this.markerBubbleMap, bubble => {
      breakpoints.push(bubble.marker.getBufferRange().start)
    })
    this.clearResultBubbles()

    if (!editor || !kernel) {
      this.runAll(breakpoints)
    } else {
      kernel.restart(() => this.runAll(breakpoints))
    }
  },

  toggleBubble() {
    const {editor} = store
    if (!editor) return
    const [startRow, endRow] = editor.getLastSelection().getBufferRowRange()

    for (let row = startRow; row <= endRow; row++) {
      let destroyed = false

      _.forEach(this.markerBubbleMap, bubble => {
        const {marker} = bubble
        if (marker.getStartBufferPosition().row === row) {
          bubble.destroy()
          delete this.markerBubbleMap[marker.id]
          destroyed = true
        }
      })

      if (!destroyed) {
        const outputStore = this.insertResultBubble(editor, row, true)
        outputStore.status = "empty"
      }
    }
  },

  clearBubblesOnRow(row) {
    log("clearBubblesOnRow:", row)
    _.forEach(this.markerBubbleMap, bubble => {
      const {marker} = bubble
      if (!marker) return
      const range = marker.getBufferRange()
      if (range.start.row <= row && row <= range.end.row) {
        log("clearBubblesOnRow:", row, bubble)
        bubble.destroy()
        delete this.markerBubbleMap[marker.id]
      }
    })
  },

  run(moveDown = false) {
    const editor = store.editor
    if (!editor) return
    const codeBlock = codeManager.findCodeBlock(editor)
    if (!codeBlock) {
      return
    }

    const [code, row] = codeBlock
    if (code) {
      if (moveDown === true) {
        codeManager.moveDown(editor, row)
      }
      this.createResultBubble(code, row, editor)
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

  async runAll(breakpoints) {
    editor = atom.workspace.getActiveTextEditor()
    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All" is not supported for this file type!')
      return
    }

    let kernel = kernelManager.getKernelForEditor(editor)
    if (!kernel) {
      const grammar = getGrammar(editor)
      const kernelSpec = kernelManager.getKernelSpecForGrammarNew(grammar)
      kernel = await kernelManager.startKernelNew(editor, grammar, kernelSpec)
    }

    let cells = codeManager.getCells(editor, breakpoints)
    _.forEach(cells, range => {
      const bubbleRow = codeManager.escapeBlankRows(editor, range.start.row, range.end.row)

      // preparation
      const outputStore = this.createOutputStore(editor, bubbleRow)
      const resultView = new ResultView(outputStore, kernel, true)
      this.createBubbleAndBindToView(editor, bubbleRow, resultView)
      // preparation end

      const code = codeManager.normalizeString(editor.getTextInBufferRange(range))
      appendOutput = outputStore.appendOutput.bind(outputStore)
      kernel.execute(code, appendOutput)
    })
  },

  createBubbleAndBindToView(editor, row, resultView) {
    // clear old block decoration
    if (row in this.bubbleMarkerByRow) {
      this.bubbleMarkerByRow[row].destroy()
      delete this.bubbleMarkerByRow[row]
    }
    const marker = editor.markBufferPosition([row, Infinity], {invalidate: "touch"})
    this.bubbleMarkerByRow[row] = marker

    editor.decorateMarker(marker, {
      type: "block",
      item: resultView.element,
      position: "after",
    })

    marker.onDidChange(event => {
      if (!event.isValid) {
        resultView.destroy()
        marker.destroy()
        delete this.bubbleMarkerByRow[row]
      } else {
        resultView.outputStore.updatePosition({
          lineLength: marker.getStartBufferPosition().column,
        })
      }
    })
  },

  _runAll(editor, kernel, breakpoints) {
    let cells = codeManager.getCells(editor, breakpoints)
    _.forEach(cells, ({start, end}) => {
      const code = codeManager.getTextInRange(editor, start, end)
      const endRow = codeManager.escapeBlankRows(editor, start.row, end.row)
      this._createResultBubble(kernel, code, endRow)
    })
  },

  runAllAbove() {
    const editor = store.editor // to make flow happy
    if (!editor) return
    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All Above" is not supported for this file type!')
      return
    }

    const cursor = editor.getLastCursor()
    const row = codeManager.escapeBlankRows(editor, 0, cursor.getBufferRow())
    const code = codeManager.getRows(editor, 0, row)

    if (code) {
      this.createResultBubble(code, row)
    }
  },

  runCell(moveDown = false) {
    const editor = store.editor
    if (!editor) return
    const {start, end} = codeManager.getCurrentCell(editor)
    const code = codeManager.getTextInRange(editor, start, end)
    const endRow = codeManager.escapeBlankRows(editor, start.row, end.row)

    if (code) {
      if (moveDown === true) {
        codeManager.moveDown(editor, endRow)
      }
      this.createResultBubble(code, endRow)
    }
  },

  selectKernel() {
    kernelManager.getAllKernelSpecsForGrammar(store.grammar, kernelSpecs => {
      if (this.kernelPicker) {
        this.kernelPicker.kernelSpecs = kernelSpecs
      } else {
        this.kernelPicker = new KernelPicker(kernelSpecs)

        this.kernelPicker.onConfirmed = kernelSpec =>
          this.handleKernelCommand({
            command: "switch-kernel",
            payload: kernelSpec,
          })
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
