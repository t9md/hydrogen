"use babel"

import {Emitter} from "atom"
import {observable, action} from "mobx"
import {is, Map as ImmutableMap} from "immutable"

// import store from "./store"
import {INSPECTOR_URI} from "./hydrogen-pane"
import {log, focus, msgSpecToNotebookFormat, msgSpecV4toV5} from "./utils"

import WatchesStore from "./store/watches"
import OutputStore from "./store/output"

export default class Kernel {
  @observable executionState = "loading"
  @observable inspector = {
    bundle: new ImmutableMap(),
  }
  outputStore = new OutputStore()

  watchCallbacks = []
  emitter = new Emitter()
  pluginWrapper = null

  constructor(kernelSpec, grammar) {
    this.kernelSpec = kernelSpec
    this.grammar = grammar

    this.language = kernelSpec.language.toLowerCase()
    this.displayName = kernelSpec.display_name

    this.watchesStore = new WatchesStore(this)
  }

  @action
  setExecutionState(state) {
    this.executionState = state
  }

  @action
  async setInspectorResult(bundle, editor) {
    if (is(this.inspector.bundle, bundle)) {
      await atom.workspace.toggle(INSPECTOR_URI)
    } else if (bundle.size !== 0) {
      this.inspector.bundle = bundle
      await atom.workspace.open(INSPECTOR_URI, {searchAllPanes: true})
    }
    focus(editor)
  }

  addWatchCallback(watchCallback) {
    this.watchCallbacks.push(watchCallback)
  }

  _callWatchCallbacks() {
    this.watchCallbacks.forEach(watchCallback => watchCallback())
  }

  interrupt() {
    throw new Error("Kernel: interrupt method not implemented")
  }

  shutdown() {
    throw new Error("Kernel: shutdown method not implemented")
  }

  restart(onRestarted) {
    throw new Error("Kernel: restart method not implemented")
  }

  execute(code, onResults) {
    throw new Error("Kernel: execute method not implemented")
  }

  executeWatch(code, onResults) {
    throw new Error("Kernel: executeWatch method not implemented")
  }

  complete(code, onResults) {
    throw new Error("Kernel: complete method not implemented")
  }

  inspect(code, curorPos, onResults) {
    throw new Error("Kernel: inspect method not implemented")
  }

  _parseIOMessage(message) {
    let result = this._parseExecuteInputIOMessage(message)

    if (!result) {
      result = msgSpecToNotebookFormat(msgSpecV4toV5(message))
    }

    return result
  }

  _parseExecuteInputIOMessage(message) {
    if (message.header.msg_type === "execute_input") {
      return {
        data: message.content.execution_count,
        stream: "execution_count",
      }
    }

    return null
  }

  destroy() {
    log("Kernel: Destroying base kernel")
    // store.deleteKernel(this)
    if (this.pluginWrapper) {
      this.pluginWrapper.destroyed = true
    }
    this.emitter.emit("did-destroy")
    this.emitter.dispose()
  }
}
