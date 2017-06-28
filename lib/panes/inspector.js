"use babel"

import React from "react"

import {mountComponent, INSPECTOR_URI} from "./../utils"
import Inspector from "./../components/inspector"

export default class InspectorPane {
  constructor(store) {
    this.unmount = mountComponent(<Watches store={store} />, ["inspector"])
  }

  getTitle = () => "Hydrogen Inspector"

  getURI = () => INSPECTOR_URI

  getDefaultLocation = () => "bottom"

  getAllowedLocations = () => ["bottom", "left", "right"]

  destroy() {
    this.unmount()
  }
}
