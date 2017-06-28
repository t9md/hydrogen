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
        return new Pane({
          element: mountComponent(<Watches store={store} />, ["inspector"]),
          title: "Hydrogen Inspector",
          URI: uri,
          defaultLocation: "bottom",
          allowedLocations: ["bottom", "left", "right"],
        })
      case WATCHES_URI:
        return new Pane({
          element: mountComponent(<Watches store={store} />),
          title: "Hydrogen Watch",
          URI: uri,
          defaultLocation: "right",
          allowedLocations: ["left", "right"],
        })
      case OUTPUT_AREA_URI:
        return new Pane({
          element: mountComponent(<OutputArea store={store} />),
          title: "Hydrogen Output Area",
          URI: uri,
          defaultLocation: "right",
          allowedLocations: ["left", "right", "bottom"],
          dispose: () => {
            if (store.kernel) {
              store.kernel.outputStore.clear()
            }
          },
        })
    }
  }

  constructor({title, element, URI, defaultLocation, allowedLocations, dispose}) {
    this.title = title
    this.element = element
    this.URI = URI
    this.defaultLocation = defaultLocation
    this.allowedLocations = allowedLocations
    this.dispose = dispose
  }
  getTitle() {
    return this.title
  }
  getURI() {
    return this.URI
  }
  getDefaultLocation() {
    return this.defaultLocation
  }
  getAllowedLocations() {
    return this.allowedLocations
  }
  destroy() {
    if (this.dispose) {
      this.dispose()
    }
    ReactDOM.unmountComponentAtNode(this.element)
  }
}

export default HydrogenPane
