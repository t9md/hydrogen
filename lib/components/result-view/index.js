"use babel"

import React from "react"
import ReactDOM from "react-dom"

import ResultViewComponent from "./result-view"
import {mountComponent} from "../../utils"

export default class ResultView {
  destroy = () => {
    ReactDOM.unmountComponentAtNode(this.element)
  }

  constructor(outputStore, kernel, showResult = true) {
    this.outputStore = outputStore
    this.element = mountComponent(
      <ResultViewComponent
        store={outputStore}
        kernel={kernel}
        destroy={this.destroy}
        showResult={showResult}
      />,
      ["marker"]
    )
  }
}
