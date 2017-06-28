"use babel"

import React from "react"
import {mountComponent, OUTPUT_AREA_URI} from "./../utils"
import OutputArea from "./../components/output-area"

export default class OutputPane {
  constructor(store) {
    this.store = store
    const {element, unmount} = mountComponent(<OutputArea store={store} />)
    this.element = element
    this.unmount = unmount

  }

  getTitle = () => "Hydrogen Output Area"

  getURI = () => OUTPUT_AREA_URI

  getDefaultLocation = () => "right"

  getAllowedLocations = () => ["left", "right", "bottom"]

  destroy() {
    if (this.store.kernel) {
      this.store.kernel.outputStore.clear()
    }
    this.unmount()
  }
}
