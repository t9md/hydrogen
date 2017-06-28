"use babel"

import React from "react"
import {mountComponent, WATCHES_URI} from "./../utils"
import Watches from "./../components/watch-sidebar"

export default class WatchesPane {
  constructor(store) {
    const {element, unmount} = mountComponent(<Watches store={store} />)
    this.element = element
    this.unmount = unmount
  }

  getTitle = () => "Hydrogen Watch"

  getURI = () => WATCHES_URI

  getDefaultLocation = () => "right"

  getAllowedLocations = () => ["left", "right"]

  destroy() {
    this.unmount()
  }
}
