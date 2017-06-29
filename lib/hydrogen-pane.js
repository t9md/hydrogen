"use babel"

export const URI_INSPECTOR = "atom://hydrogen/inspector"
export const URI_WATCHES = "atom://hydrogen/watch-sidebar"
export const URI_OUTPUT_AREA = "atom://hydrogen/output-area"

import store from "./store"

import React from "react"
import ReactDOM from "react-dom"

import Watches from "./components/watch-sidebar"
import Inspector from "./components/inspector"
import OutputArea from "./components/output-area"
import {mountComponent} from "./utils"

class HydrogenPane {
  static isOpenable(uri) {
    return [URI_INSPECTOR, URI_WATCHES, URI_OUTPUT_AREA].includes(uri)
  }

  static findOutputArea() {
    return atom.workspace.getPaneItems().find(item => item.getURI() === URI_OUTPUT_AREA)
  }

  static destroyPanes() {
    for (const item of atom.workspace.getPaneItems()) {
      if (this.isOpenable(item.getURI())) {
        item.destroy()
      }
    }
  }

  static open(uri) {
    switch (uri) {
      case URI_INSPECTOR:
        return {
          element: mountComponent(<Watches store={store} />, ["inspector"]),
          getTitle: () => "Hydrogen Inspector",
          getURI: () => uri,
          getDefaultLocation: () => "bottom",
          getAllowedLocations: () => ["bottom", "left", "right"],
          destroy() {
            ReactDOM.unmountComponentAtNode(this.element)
            this.element.remove()
          },
        }
      case URI_WATCHES:
        return {
          element: mountComponent(<Watches store={store} />),
          getTitle: () => "Hydrogen Watch",
          getURI: () => uri,
          getDefaultLocation: () => "right",
          getAllowedLocations: () => ["left", "right"],
          destroy() {
            ReactDOM.unmountComponentAtNode(this.element)
            this.element.remove()
          },
        }
      case URI_OUTPUT_AREA:
        return {
          element: mountComponent(<OutputArea store={store} />),
          getTitle: () => "Hydrogen Output Area",
          getURI: () => uri,
          getDefaultLocation: () => "right",
          getAllowedLocations: () => ["left", "right", "bottom"],
          destroy() {
            ReactDOM.unmountComponentAtNode(this.element)
            this.element.remove()

            if (store.kernel) {
              store.kernel.outputStore.clear()
            }
          },
        }
    }
  }
}

export default HydrogenPane
