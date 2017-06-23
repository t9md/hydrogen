"use babel"

import {CompositeDisposable} from "atom"
import {observable, computed, action} from "mobx"
import {isMultilanguageGrammar, getEmbeddedScope} from "./../utils"

import Config from "./../config"
import kernelManager from "./../kernel-manager"

class Store {
  subscriptions = new CompositeDisposable()
  @observable startingKernels = new Map()
  @observable runningKernels = new Map()
  @observable editor = null //atom.workspace.getActiveTextEditor()

  @computed
  get kernel() {
    for (let kernel of this.runningKernels.values()) {
      const kernelSpec = kernel.kernelSpec
      if (kernelManager.kernelSpecProvidesGrammar(kernelSpec, this.grammar)) {
        return kernel
      }
    }
    return null
  }

  @action
  startKernel(kernelDisplayName) {
    this.startingKernels.set(kernelDisplayName, true)
  }

  @action
  newKernel(kernel) {
    const mappedLanguage = Config.getJson("languageMappings")[kernel.language] || kernel.language
    this.runningKernels.set(mappedLanguage, kernel)
    // delete startingKernel since store.kernel now in place to prevent duplicate kernel
    this.startingKernels.delete(kernel.kernelSpec.display_name)
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
    // this.setGrammar(editor)
  }

  getGrammar() {
    let grammar = editor.getGrammar()

    if (isMultilanguageGrammar(grammar)) {
      const embeddedScope = getEmbeddedScope(editor, editor.getCursorBufferPosition())

      if (embeddedScope) {
        const scope = embeddedScope.replace(".embedded", "")
        grammar = atom.grammars.grammarForScopeName(scope)
      }
    }

    return grammar
  }
}

const store = new Store()
export default store

// For debugging
window.hydrogen_store = store
