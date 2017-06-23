"use babel"

import {CompositeDisposable} from "atom"
import React from "react"

import {reactFactory} from "./../../utils"
import ResultViewComponent from "./result-view"

export default class ResultView {
  destroy = () => {
    this.disposer.dispose()
  }

  constructor(outputStore, kernel, showResult = true) {
    this.outputStore = outputStore
    this.element = document.createElement("div")
    this.element.classList.add("hydrogen", "marker")

    this.disposer = new CompositeDisposable()

    reactFactory(
      <ResultViewComponent
        store={outputStore}
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
