"use babel"

import {CompositeDisposable} from "atom"
import {observable, computed, action} from "mobx"
import {isMultilanguageGrammar, getEmbeddedScope} from "./../utils"

import Config from "./../config"
// import kernelManager from "./../kernel-manager"

class Store {
  subscriptions = new CompositeDisposable()
  @observable runningKernels = new Map()
  @observable editor = null //atom.workspace.getActiveTextEditor()
  @observable kernel = null //atom.workspace.getActiveTextEditor()
  // kernel = null //atom.workspace.getActiveTextEditor()

  @action
  newKernel(kernel) {
    const mappedLanguage = Config.getJson("languageMappings")[kernel.language] || kernel.language
    this.runningKernels.set(mappedLanguage, kernel)
  }

  @action
  deleteKernel(kernel) {
    for (let [language, runningKernel] of this.runningKernels.entries()) {
      if (kernel === runningKernel) {
        this.runningKernels.delete(language)
      }
    }
  }

  @action
  destroy() {
    this.subscriptions.dispose()
    this.runningKernels.forEach(kernel => kernel.destroy())
    this.runningKernels.clear()
    this.runningKernels = null
  }

  @action
  updateEditor(editor) {
    this.editor = editor
  }
}

const store = new Store()
export default store

// For debugging
window.hydrogen_store = store
