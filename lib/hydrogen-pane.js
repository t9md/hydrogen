"use babel"

export const INSPECTOR_URI = "atom://hydrogen/inspector"
export const WATCHES_URI = "atom://hydrogen/watch-sidebar"
export const OUTPUT_AREA_URI = "atom://hydrogen/output-area"

import store from "./store"

import React from "react"
import ReactDOM from "react-dom"

import Watches from "./components/watch-sidebar"
import Inspector from "./components/inspector"
import OutputArea from "./components/output-area"
import {mountComponent} from "./utils"

class HydrogenPane {
  static isOpenable(uri) {
    return [INSPECTOR_URI, WATCHES_URI, OUTPUT_AREA_URI].includes(uri)
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
      case INSPECTOR_URI:
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
      case WATCHES_URI:
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
      case OUTPUT_AREA_URI:
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
