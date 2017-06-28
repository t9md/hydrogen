"use babel"

import React from "react"
import {mountComponent, WATCHES_URI} from "./../utils"
import Watches from "./../components/watch-sidebar"

export default class WatchesPane {
  constructor(store) {
    this.unmount = mountComponent(<Watches store={store} />)
  }

  getTitle = () => "Hydrogen Watch"

  getURI = () => WATCHES_URI

  getDefaultLocation = () => "right"

  getAllowedLocations = () => ["left", "right"]

  destroy() {
    this.unmount()
  }
}
