"use babel"

import {action, observable} from "mobx"
import SelectListView from "atom-select-list"

import WatchStore from "./watch"

class WatchesPicker {
  constructor(watchStore) {
    this.watchStore = watchStore
  }

  focus() {
    const items = this.watchStore.watches
      .map((watch, index) => ({
        text: watch.getCode(),
        index: index,
      }))
      .filter(item => item.index !== 0 || item.text !== "")

    const selectList = new SelectListView({
      items: items,
      elementForItem: item => {
        const element = document.createElement("li")
        element.textContent = item.text || "<empty>"
        return element
      },
      didConfirmSelection: item => {
        this.watchStore.watches.splice(item.index, 1)
        modalPanel.destroy()
        selectList.destroy()
        if (this.watchStore.isEmpty()) {
          this.watchStore.addWatch()
        } else if (previouslyFocusedElement) {
          previouslyFocusedElement.focus()
        }
      },
      filterKeyForItem: item => item.text,
      didCancelSelection: () => {
        modalPanel.destroy()
        if (previouslyFocusedElement) previouslyFocusedElement.focus()
        selectList.destroy()
      },
      emptyMessage: "There are no watches to remove!",
    })

    const modalPanel = atom.workspace.addModalPanel({item: selectList})
    const previouslyFocusedElement = document.activeElement
    selectList.focus()
  }
}

export default class WatchesStore {
  @observable watches = []

  constructor(kernel) {
    this.kernel = kernel

    this.kernel.addWatchCallback(this.run)
    this.addWatch()
  }

  @action
  createWatch() {
    const lastWatch = this.watches[this.watches.length - 1]
    if (!lastWatch || lastWatch.getCode().replace(/\s/g, "") !== "") {
      const watch = new WatchStore(this.kernel)
      this.watches.push(watch)
      return watch
    }
    return lastWatch
  }

  isEmpty() {
    return this.watches.length === 0
  }

  @action
  addWatch = () => {
    this.createWatch().focus()
  }

  @action
  addWatchFromEditor = editor => {
    // if (!editor) return
    const watchText = editor.getSelectedText()
    if (!watchText) {
      this.addWatch()
    } else {
      const watch = this.createWatch()
      watch.setCode(watchText)
      watch.run()
    }
  }

  @action
  removeWatch = () => {
    new WatchesPicker(this).focus()
  }

  @action
  run = () => {
    this.watches.forEach(watch => watch.run())
  }
}
