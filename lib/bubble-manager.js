"use babel"

import {CompositeDisposable} from "atom"

class BubbleManager {
  constructor() {
    this.markerLayerByEditor = new Map()
    this.subscriptions = new CompositeDisposable()
  }

  destroy() {
    this.subscriptions.dispose()

    this.markerLayerByEditor.forEach(markerLayer => markerLayer.destroy())
    this.markerLayerByEditor.clear()
    this.markerLayerByEditor = null
  }

  addMarkerLayerIfNeeded(editor) {
    if (this.markerLayerByEditor.has(editor)) return

    this.markerLayerByEditor.set(editor, editor.addMarkerLayer())
    const disposable = editor.onDidDestroy(() => {
      if (this.markerLayerByEditor.has(editor)) {
        this.markerLayerByEditor.get(editor).destroy()
        this.markerLayerByEditor.delete(editor)
      }
    })
    this.subscriptions.add(disposable)
  }

  getStartPositions(editor) {
    const markerLayer = this.markerLayerByEditor.get(editor)
    return markerLayer.getMarkers().map(marker => marker.getStartBufferPosition())
  }

  clear(editor) {
    this.markerLayerByEditor.get(editor).clear()
  }

  getMarkerLayer(editor) {
    return this.markerLayerByEditor.get(editor)
  }

  getMarkers(editor) {
    let markers = []
    const markerLayer = this.markerLayerByEditor.get(editor)
    return markerLayer ? markerLayer.getMarkers() : []
  }

  // return decoration
  createBubble({editor, row, view}) {
    const markerLayer = this.markerLayerByEditor.get(editor)
    const marker = markerLayer.markBufferPosition([row, Infinity], {invalidate: "touch"})
    const {outputStore} = view

    const decoration = editor.decorateMarker(marker, {
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

export default new BubbleManager()
