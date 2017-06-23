/*  */

import {CompositeDisposable} from "atom"
import React from "react"

import {reactFactory} from "./../../utils"
import ResultViewComponent from "./result-view"

export default class ResultView {
  destroy = () => {
    this.disposer.dispose()
    if (this.marker) this.marker.destroy()
  }

  constructor(store, kernel, marker, showResult = true) {
    this.marker = marker
    this.element = document.createElement("div")
    this.element.classList.add("hydrogen", "marker")

    this.disposer = new CompositeDisposable()

    reactFactory(
      <ResultViewComponent
        store={store}
        kernel={kernel}
        destroy={this.destroy}
        showResult={showResult}
      />,
      this.element,
      null,
      this.disposer
    )
  }
}
