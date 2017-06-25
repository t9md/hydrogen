"use babel"

import {CompositeDisposable} from "atom"

export default class BubbleManager {
  constructor(hydrogen) {
    hydrogen.onDidDestroy(() => this.destroy())

    this.editor = hydrogen.editor
    this.markerLayer = this.editor.addMarkerLayer()
  }

  destroy() {
    this.markerLayer.destroy()
  }

  getStartPositions() {
    return this.markerLayer.getMarkers().map(marker => marker.getStartBufferPosition())
  }

  clear() {
    this.markerLayer.clear()
  }

  findMarkers(...args) {
    return this.markerLayer.findMarkers(...args)
  }

  getMarkers() {
    return this.markerLayer.getMarkers()
  }

  // return decoration
  createBubble({row, view}) {
    const marker = this.markerLayer.markBufferPosition([row, Infinity], {invalidate: "touch"})
    const {outputStore} = view

    const decoration = this.editor.decorateMarker(marker, {
      type: "block",
      item: view.element,
      position: "after",
    })

    marker.onDidChange(event => {
      if (!event.isValid) {
        view.destroy()
        marker.destroy()
      } else {
        outputStore.updatePosition({
          lineLength: marker.getStartBufferPosition().column,
        })
      }
    })

    return decoration
  }
}
