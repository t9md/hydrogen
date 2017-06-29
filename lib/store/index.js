"use babel"

import {CompositeDisposable} from "atom"
import {observable, computed, action} from "mobx"
import {isMultilanguageGrammar, getEmbeddedScope} from "./../utils"

import Config from "./../config"

class Store {
  subscriptions = new CompositeDisposable()
  @observable runningKernels = new Map()
  @observable editor = null //atom.workspace.getActiveTextEditor()
  @observable kernel = null //atom.workspace.getActiveTextEditor()
  // kernel = null //atom.workspace.getActiveTextEditor()
  @action
  updateEditor(editor) {
    this.editor = editor
  }
}

const store = new Store()
export default store

// For debugging
window.hydrogen_store = store
