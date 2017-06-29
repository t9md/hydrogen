"use babel"

import {CompositeDisposable} from "atom"
import React from "react"
import {observer} from "mobx-react"

import History from "./result-view/history"
import {URI_OUTPUT_AREA} from "../hydrogen-pane"

const OutputArea = observer(({store: {kernel}}) => {
  if (!kernel) {
    atom.workspace.hide(URI_OUTPUT_AREA)
    return null
  }
  return (
    <div className="sidebar output-area">
      {kernel.outputStore.outputs.length > 0
        ? <div
            className="btn icon icon-trashcan"
            onClick={kernel.outputStore.clear}
            style={{
              left: "100%",
              transform: "translateX(-100%)",
              position: "relative",
              flex: "0 0 auto",
              width: "fit-content",
            }}
          >
            Clear
          </div>
        : <ul className="background-message centered">
            <li>No output to display</li>
          </ul>}
      <History store={kernel.outputStore} />
    </div>
  )
})

export default OutputArea
