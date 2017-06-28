"use babel"

class BubbleManager {
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

  clearMarkersAtRow(row) {
    let cleared = false

    const markersInRow = this.markerLayer.findMarkers({startBufferRow: row})
    if (markersInRow.length) {
      for (const marker of markersInRow) marker.destroy()
      cleared = true
    }
    return cleared
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

export default BubbleManager
