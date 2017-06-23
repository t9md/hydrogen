"use babel"

import React from "react"
import ReactDOM from "react-dom"

import ResultViewComponent from "./result-view"

export default class ResultView {
  destroy = () => {
    ReactDOM.unmountComponentAtNode(this.element)
  }

  constructor(outputStore, kernel, showResult = true) {
    this.outputStore = outputStore
    this.element = document.createElement("div")
    this.element.classList.add("hydrogen", "marker")

    ReactDOM.render(
      <ResultViewComponent
        store={outputStore}
        kernel={kernel}
        destroy={this.destroy}
        showResult={showResult}
      />,
      this.element
    )
  }
}
