"use babel"

import React from "react"
import ReactDOM from "react-dom"

import ResultViewComponent from "./result-view"
import {mountComponent} from "../../utils"

export default class ResultView {
  destroy = () => {
    ReactDOM.unmountComponentAtNode(this.element)
    this.marker.destroy()
  }

  setMarker(marker) {
    this.marker = marker

    marker.onDidChange(event => {
      if (!event.isValid) {
        this.destroy()
      } else {
        this.outputStore.updatePosition({
          lineLength: marker.getStartBufferPosition().column,
        })
      }
    })
  }

  constructor(outputStore, kernel, showResult = true) {
    this.outputStore = outputStore
    this.element = mountComponent(
      <ResultViewComponent
        outputStore={outputStore}
        kernel={kernel}
        destroy={this.destroy}
        showResult={showResult}
      />,
      ["marker"]
    )
  }
}
