"use babel"

import {Emitter, CompositeDisposable, Disposable} from "atom"

import React from "react"
import ReactDOM from "react-dom"

import KernelPicker from "./kernel-picker"
import WSKernelPicker from "./ws-kernel-picker"
import SignalListView from "./signal-list-view"

import StatusBar from "./components/status-bar"

import {toggleInspector} from "./commands"

import store from "./store"

import Config from "./config"
import kernelManager from "./kernel-manager"
import ZMQKernel from "./zmq-kernel"
import AutocompleteProvider from "./autocomplete-provider"
import {renderMobxReactDevtools, hotReloadPackage, mountComponent} from "./utils"

import {INSPECTOR_URI, WATCHES_URI, OUTPUT_AREA_URI} from "./hydrogen-pane"

import HydrogenPane from "./hydrogen-pane"

import Hydrogen from "./hydrogen"

export default {
  config: Config.schema,

  activate() {
    console.log("activated!!")
    this.emitter = new Emitter()

    this.subscriptions = new CompositeDisposable()
    this.hydrogenByEditor = new Map()

    this.subscriptions.add(atom.workspace.addOpener(HydrogenPane.open))
    this.registerCommands()

    this.subscriptions.add(
      atom.workspace.observeActivePaneItem(item => {
        if (atom.workspace.isTextEditor(item)) store.updateEditor(item)
      })
    )

    if (atom.config.get("Hydrogen.debug")) renderMobxReactDevtools()
  },

  getHydrogen() {
    const editor = atom.workspace.getActiveTextEditor()

    if (!this.hydrogenByEditor.has(editor)) {
      this.hydrogenByEditor.set(editor, new Hydrogen(editor))
    }
    return this.hydrogenByEditor.get(editor)
  },

  registerCommands() {
    const h = this.getHydrogen.bind(this)

    this.subscriptions.add(
      atom.commands.add("atom-text-editor:not([mini])", {
        // Hydrogen instance commands
        "hydrogen:run": () => h().run(),
        "hydrogen:run-and-move-down": () => h().run({moveDown: true}),
        "hydrogen:run-cell": () => h().runCell(),
        "hydrogen:run-cell-and-move-down": () => h().runCell({moveDown: true}),
        "hydrogen:run-all": () => h().runAll(),
        "hydrogen:run-all-above": () => h().runAllAbove(),
        "hydrogen:toggle-bubble": () => h().toggleBubble(),
        "hydrogen:clear-results": () => h().clearBubbles(),
        "hydrogen:restart-kernel-and-re-evaluate-bubbles": () =>
          h().restartKernelAndReEvaluateBubbles(),
        "hydrogen:interrupt-kernel": () => h().interruptKernel(),
        "hydrogen:restart-kernel": () => h().restartKernel(),
        "hydrogen:shutdown-kernel": () => h().shutdownKernel(),

        // TODO
        "hydrogen:toggle-watches": () => atom.workspace.toggle(WATCHES_URI),
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
        // "hydrogen:update-kernels": () => kernelManager.updateKernelSpecs(),
        "hydrogen:toggle-inspector": () => toggleInspector(store),
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
    // store.destroy()
    this.subscriptions.dispose()

    this.hydrogenByEditor.forEach(hydrogen => hydrogen.destroy())
    this.hydrogenByEditor.clear()
    this.hydrogenByEditor = null

    HydrogenPane.destroyPanes()
  },

  consumeStatusBar(statusBar) {
    const onClick = this.showKernelCommands.bind(this)
    const element = mountComponent(<StatusBar store={store} onClick={onClick} />, ["inline-block"])
    const tile = statusBar.addLeftTile({item: element, priority: 100})
    this.subscriptions.add(new Disposable(() => tile.destroy()))
  },

  // Section: Ignore these in the meanwhile.
  //==================================================
  // For autocomplete
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
        // bubbleManager.clear(editor) // FIXME

        if (kernel instanceof ZMQKernel) kernel.destroy()

        store.newKernel(kernel)
      })
    }

    this.wsKernelPicker.toggle(store.grammar, kernelSpec =>
      kernelManager.kernelSpecProvidesGrammar(kernelSpec, store.grammar)
    )
  },
}
