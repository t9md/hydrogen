"use babel"

import {CompositeDisposable} from "atom"

class BubbleManager {
  constructor() {
    this.markerLayerByEditor = new Map()
    this.subscriptions = new CompositeDisposable()
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

  destroy() {
    this.subscriptions.dispose()

    this.markerLayerByEditor.forEach(markerLayer => markerLayer.destroy())
    this.markerLayerByEditor.clear()
    this.markerLayerByEditor = null
  }
}

export default new BubbleManager()
