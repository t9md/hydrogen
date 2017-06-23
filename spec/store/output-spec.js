"use babel"

import OutputStore, {reduceOutputs, isSingeLine} from "../../lib/store/output"
import Immutable from "immutable"

// Adapted from https://github.com/nteract/nteract/blob/master/test/renderer/reducers/document-spec.js#L33
describe("reduceOutputs", () => {
  it("puts new outputs at the end by default", () => {
    const outputs = [
      Immutable.Map({output_type: "stream", name: "stdout", text: "Woo"}),
      Immutable.Map({
        output_type: "error",
        ename: "well",
        evalue: "actually",
        traceback: Immutable.List(),
      }),
    ]
    const newOutputs = reduceOutputs(outputs, {
      output_type: "display_data",
      data: {},
      metadata: {},
    })

    expect(newOutputs.toString()).toEqual(
      [
        Immutable.Map({output_type: "stream", name: "stdout", text: "Woo"}),
        Immutable.Map({
          output_type: "error",
          ename: "well",
          evalue: "actually",
          traceback: Immutable.List(),
        }),
        Immutable.Map({
          output_type: "display_data",
          data: Immutable.Map(),
          metadata: Immutable.Map(),
        }),
      ].toString()
    )
  })

  it("handles the case of a single stream output", () => {
    const outputs = [Immutable.Map({name: "stdout", text: "hello", output_type: "stream"})]
    const newOutputs = reduceOutputs(outputs, {
      name: "stdout",
      text: " world",
      output_type: "stream",
    })

    expect(newOutputs.toString()).toEqual(
      [
        Immutable.Map({
          name: "stdout",
          text: "hello world",
          output_type: "stream",
        }),
      ].toString()
    )
  })

  it("merges streams of text", () => {
    let outputs = []

    outputs = reduceOutputs(outputs, {
      name: "stdout",
      text: "hello",
      output_type: "stream",
    })
    expect(outputs.toString()).toEqual(
      [Immutable.Map({output_type: "stream", name: "stdout", text: "hello"})].toString()
    )

    outputs = reduceOutputs(outputs, {
      name: "stdout",
      text: " world",
      output_type: "stream",
    })
    expect(outputs.toString()).toEqual(
      [
        Immutable.Map({
          output_type: "stream",
          name: "stdout",
          text: "hello world",
        }),
      ].toString()
    )
  })

  it("keeps respective streams together", () => {
    const outputs = [
      Immutable.Map({name: "stdout", text: "hello", output_type: "stream"}),
      Immutable.Map({
        name: "stderr",
        text: "errors are",
        output_type: "stream",
      }),
    ]
    const newOutputs = reduceOutputs(outputs, {
      name: "stdout",
      text: " world",
      output_type: "stream",
    })

    expect(newOutputs.toString()).toEqual(
      [
        Immutable.Map({
          name: "stdout",
          text: "hello world",
          output_type: "stream",
        }),
        Immutable.Map({
          name: "stderr",
          text: "errors are",
          output_type: "stream",
        }),
      ].toString()
    )

    const evenNewerOutputs = reduceOutputs(newOutputs, {
      name: "stderr",
      text: " informative",
      output_type: "stream",
    })
    expect(evenNewerOutputs.toString()).toEqual(
      [
        Immutable.Map({
          name: "stdout",
          text: "hello world",
          output_type: "stream",
        }),
        Immutable.Map({
          name: "stderr",
          text: "errors are informative",
          output_type: "stream",
        }),
      ].toString()
    )
  })
})

describe("isSingeLine", () => {
  it("checks for single line output", () => {
    const textSingle = "hello world"
    expect(isSingeLine(textSingle, textSingle.length + 1)).toEqual(true)
    expect(isSingeLine(textSingle, textSingle.length)).toEqual(false)
  })
  it("checks for multiple line output", () => {
    const textMultiple = "hello \n world"
    expect(isSingeLine(textMultiple, textMultiple.length + 1)).toEqual(false)
    expect(isSingeLine(textMultiple, textMultiple.length)).toEqual(false)
  })
  it("checks for single line output with line break at the end ", () => {
    const textEndlinebreak = "hello world \n"
    expect(isSingeLine(textEndlinebreak, textEndlinebreak.length + 1)).toEqual(true)
    expect(isSingeLine(textEndlinebreak, textEndlinebreak.length)).toEqual(false)
  })
})

describe("OutputStore", () => {
  let store
  beforeEach(() => {
    store = new OutputStore()
  })
  describe("updatePosition", () => {
    it("checks if output lineHeight position gets updated", () => {
      store.updatePosition({lineHeight: 10})
      expect(store.position).toEqual({
        lineHeight: 10,
        lineLength: 0,
        editorWidth: 0,
      })
    })
    it("checks if output lineLength position gets updated", () => {
      store.updatePosition({lineLength: 10})
      expect(store.position).toEqual({
        lineHeight: 0,
        lineLength: 10,
        editorWidth: 0,
      })
    })
    it("checks if output editorWidth position gets updated", () => {
      store.updatePosition({editorWidth: 10})
      expect(store.position).toEqual({
        lineHeight: 0,
        lineLength: 0,
        editorWidth: 10,
      })
    })
    it("checks if all output positions get updated", () => {
      store.updatePosition({
        lineHeight: 10,
        lineLength: 10,
        editorWidth: 10,
      })
      expect(store.position).toEqual({
        lineHeight: 10,
        lineLength: 10,
        editorWidth: 10,
      })
    })
  })
  describe("setIndex", () => {
    it("checks if index is set up right ", () => {
      store.outputs = [1, 2]
      store.setIndex(0)
      expect(store.index).toEqual(0)
      store.setIndex(1)
      expect(store.index).toEqual(1)
      store.setIndex(2)
      expect(store.index).toEqual(1)
      store.setIndex(-2)
      expect(store.index).toEqual(0)
    })
  })
  describe("incrementIndex", () => {
    it("checks if index incrementing works ", () => {
      store.outputs = [1, 2]
      store.setIndex(0)
      store.incrementIndex()
      expect(store.index).toEqual(1)
    })
  })
  describe("decrementIndex", () => {
    it("checks if index decrementing works ", () => {
      store.outputs = [1, 2]
      store.setIndex(1)
      store.decrementIndex()
      //index is now at 0
      expect(0).toEqual(store.index)
      store.decrementIndex()
      //index is now at -1
      expect(0).toEqual(store.index)
    })
    describe("clear", () => {
      it("checks if output clearing works ", () => {
        store.outputs.push("foo")
        expect(store.outputs.length).toEqual(1)
        store.setIndex(0)
        expect(store.index).toEqual(0)
        store.clear()
        expect(store.outputs.length).toEqual(0)
        expect(store.index).toEqual(-1)
      })
    })
  })
})
