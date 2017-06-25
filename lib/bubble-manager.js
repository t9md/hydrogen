"use babel"

import {CompositeDisposable} from "atom"

export default class BubbleManager {
  constructor(editor) {
    this.editor = editor
    this.subscriptions = new CompositeDisposable()

    this.markerLayer = editor.addMarkerLayer()

    this.subscriptions.add(editor.onDidDestroy(() => this.markerLayer.destroy()))
  }

  destroy() {
    this.markerLayer.destroy()
    this.subscriptions.dispose()
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
