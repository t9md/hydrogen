"use babel"

//
// Disable temporarilly for dev-ease
// "activationCommands": {
//   "atom-text-editor": [
//     "hydrogen:select-kernel",
//     "hydrogen:connect-to-remote-kernel",
//     "hydrogen:run",
//     "hydrogen:run-and-move-down",
//     "hydrogen:run-all",
//     "hydrogen:run-all-above",
//     "hydrogen:run-cell",
//     "hydrogen:run-cell-and-move-down",
//     "hydrogen:restart-kernel-and-re-evaluate-bubbles",
//     "hydrogen:toggle-bubble"
//   ]
// },
//

import {Emitter, CompositeDisposable, Disposable} from "atom"

import React from "react"
import ReactDOM from "react-dom"

import KernelPicker from "./kernel-picker"
import WSKernelPicker from "./ws-kernel-picker"
import SignalListView from "./signal-list-view"

import StatusBar from "./components/status-bar"
import InspectorPane from "./panes/inspector"
import WatchesPane from "./panes/watches"
import OutputPane from "./panes/output-area"

import {toggleInspector} from "./commands"

import store from "./store"

import Config from "./config"
import kernelManager from "./kernel-manager"
import bubbleManager from "./bubble-manager"
import ZMQKernel from "./zmq-kernel"
import AutocompleteProvider from "./autocomplete-provider"
import HydrogenProvider from "./plugin-api/hydrogen-provider"
import {
  renderMobxReactDevtools,
  INSPECTOR_URI,
  WATCHES_URI,
  OUTPUT_AREA_URI,
  hotReloadPackage,
} from "./utils"

import Hydrogen from "./hydrogen"

function getEditor() {
  return atom.workspace.getActiveTextEditor()
}

export default {
  config: Config.schema,

  activate() {
    console.log("activated!!")
    this.emitter = new Emitter()

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
    bubbleManager.addMarkerLayerIfNeeded(editor)
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

  getHydrogen() {
    return new Hydrogen(getEditor())
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
        "hydrogen:clear-results": () => bubbleManager.clear(getEditor()),
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

    bubbleManager.destroy()

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

  // Section: Delegate to Hydrogen instance
  //==================================================
  restartKernelAndReEvaluateBubbles() {
    this.getHydrogen().restartKernelAndReEvaluateBubbles()
  },

  toggleBubble() {
    this.getHydrogen().toggleBubble()
  },

  run(...args) {
    this.getHydrogen().run(...args)
  },

  runAll(breakpoints) {
    this.getHydrogen().runAll(breakpoints)
  },

  runAllAbove() {
    this.getHydrogen().runAllAbove()
  },

  runCell(...args) {
    this.getHydrogen().runCell(...args)
  },

  // Section: Proxying to Kernel manager
  //==================================================
  switchKernel(kernelSpec) {
    return this.getHydrogen().switchKernel(kernelSpec)
  },

  interruptKernel() {
    return this.getHydrogen().interruptKernel()
  },

  restartKernel() {
    return this.getHydrogen().restartKernel()
  },

  shutdownKernel() {
    return this.getHydrogen().shutdownKernel()
  },

  renameWSKernel() {
    return this.getHydrogen().renameWSKernel()
  },

  disconnectKernel() {
    return this.getHydrogen().disconnectKernel()
  },

  // Section: Ignore these in the meanwhile.
  //==================================================
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
        bubbleManager.clear(getEditor())

        if (kernel instanceof ZMQKernel) kernel.destroy()

        store.newKernel(kernel)
      })
    }

    this.wsKernelPicker.toggle(store.grammar, kernelSpec =>
      kernelManager.kernelSpecProvidesGrammar(kernelSpec, store.grammar)
    )
  },
}
