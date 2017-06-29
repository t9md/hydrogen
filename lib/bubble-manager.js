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
  createBubble({row, item}) {
    const marker = this.markerLayer.markBufferPosition([row, Infinity], {invalidate: "touch"})
    return this.editor.decorateMarker(marker, {
      type: "block",
      item: item,
      position: "after",
    })
  }
}

export default BubbleManager
