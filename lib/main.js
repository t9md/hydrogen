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

  activate() {
    console.log("activated!!")
    this.emitter = new Emitter()
    this.bubbleMarkerByRow = {}

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

    this.registerOpener()
    this.registerCommands()

    subs.add(
      atom.workspace.observeActivePaneItem(item => {
        if (atom.workspace.isTextEditor(item)) store.updateEditor(item)
      })
    )

    if (atom.config.get("Hydrogen.debug")) {
      renderMobxReactDevtools()
    }
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
      this.subscriptions.add(
        atom.commands.add("atom-workspace", {
          "hydrogen:hot-reload-package": () => hotReloadPackage(),
        })
      )
    }
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

  clearResultBubbles() {
    for (const row in this.bubbleMarkerByRow) {
      this.bubbleMarkerByRow[row].destroy()
    }
    this.bubbleMarkerByRow = {}
  },

  async restartKernelAndReEvaluateBubbles() {
    const editor = atom.workspace.getActiveTextEditor()

    if (kernelManager.hasKernelForEditor(editor)) {
      const kernel = kernelManager.getKernelForEditor(editor)
      const restartSucceeded = await kernel.restart()
      if (!restartSucceeded) return
    }

    const breakpoints = []
    for (const row in this.bubbleMarkerByRow) {
      breakpoints.push(this.bubbleMarkerByRow[row].getStartBufferPosition())
    }

    this.runAll(breakpoints)
  },

  toggleBubble() {
    const editor = atom.workspace.getActiveTextEditor()
    const [startRow, endRow] = editor.getLastSelection().getBufferRowRange()

    for (let row = startRow; row <= endRow; row++) {
      let destroyed = false

      const marker = this.bubbleMarkerByRow[row]
      if (marker) {
        marker.destroy()
        delete this.bubbleMarkerByRow[row]
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

  run(moveDown = false) {
    const editor = atom.workspace.getActiveTextEditor()
    const codeBlock = codeManager.findCodeBlock(editor)
    if (!codeBlock) return
    const [code, row] = codeBlock

    if (!code) return
    if (moveDown === true) codeManager.moveDown(editor, row)

    this.executeCode(editor, code, row)
  },

  async runAll(breakpoints) {
    this.clearResultBubbles()
    const editor = atom.workspace.getActiveTextEditor()

    if (isMultilanguageGrammar(editor.getGrammar())) {
      atom.notifications.addError('"Run All" is not supported for this file type!')
      return
    }

    const kernel = await this.getOrStartKernelIfNecessary(editor)

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

  async getOrStartKernelIfNecessary(editor) {
    let kernel = kernelManager.getKernelForEditor(editor)
    if (!kernel) {
      const grammar = getGrammar(editor)
      const kernelSpec = kernelManager.getKernelSpecForGrammarNew(grammar)
      kernel = await kernelManager.startKernelNew(editor, grammar, kernelSpec)
    }
    return kernel
  },

  // BUG: this is not enough, managing marker by row is BAD idea.
  // since marker row is changing while add/removing editor text.
  // So should consult actual marker
  clearResultBubblesInRange(range) {
    const startRow = range.start.row
    const endRow = range.end.row

    for (const row in this.bubbleMarkerByRow) {
      if (row >= startRow && row <= endRow) {
        this.bubbleMarkerByRow[row].destroy()
        delete this.bubbleMarkerByRow[row]
      }
    }
  },

  async executeCode(editor, code, bubbleRow) {
    if (!code) return

    const kernel = await this.getOrStartKernelIfNecessary(editor)
    const outputStore = this.createOutputStore(editor, bubbleRow)
    const resultView = new ResultView(outputStore, kernel, true)
    this.createBubbleAndBindToView(editor, bubbleRow, resultView)

    kernel.execute(code, message => {
      outputStore.appendOutput(message)
    })
  },

  runAllAbove() {
    this.clearResultBubbles()

    const editor = atom.workspace.getActiveTextEditor()
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

  runCell(moveDown = false) {
    const editor = atom.workspace.getActiveTextEditor()

    const range = codeManager.getCurrentCell(editor)
    this.clearResultBubblesInRange(range)
    const endRow = codeManager.escapeBlankRows(editor, range.start.row, range.end.row)

    const text = editor.getTextInBufferRange([[0, 0], [endRow, Infinity]])
    const code = codeManager.normalizeString(text)

    if (!code) return

    if (moveDown === true) {
      codeManager.moveDown(editor, endRow)
    }
    this.executeCode(editor, code, endRow)
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
