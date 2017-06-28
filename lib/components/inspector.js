"use babel"

import React from "react"
import {observer} from "mobx-react"
import {richestMimetype, transforms} from "@nteract/transforms"
import * as Immutable from "immutable"

import {URI_INSPECTOR} from "../hydrogen-pane"

const displayOrder = new Immutable.List(["text/html", "text/markdown", "text/plain"])

function hide() {
  atom.workspace.hide(URI_INSPECTOR)
  return null
}

const Inspector = observer(({store: {kernel}}) => {
  if (!kernel) return hide()

  const bundle = kernel.inspector.bundle
  const mimetype = richestMimetype(bundle, displayOrder, transforms)

  if (!mimetype) return hide()
  // $FlowFixMe React element `Transform`. Expected React component instead of Transform
  const Transform = transforms.get(mimetype)
  return <Transform data={bundle.get(mimetype)} />
})

export default Inspector
