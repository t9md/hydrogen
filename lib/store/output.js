"use babel"

import {action, computed, observable} from "mobx"
import {createImmutableOutput} from "@nteract/commutable"
import {richestMimetype} from "@nteract/transforms"
import {escapeCarriageReturn, escapeCarriageReturnSafe} from "escape-carriage"

import {transforms, displayOrder} from "./../components/result-view/transforms"
import {limitNumber} from "../utils"

/**
 * https://github.com/nteract/hydrogen/issues/466#issuecomment-274822937
 * An output can be a stream of data that does not arrive at a single time. This
 * function handles the different types of outputs and accumulates the data
 * into a reduced output.
 *
 * @param {Array<Object>} outputs - Kernel output messages
 * @param {Object} output - Outputted to be reduced into list of outputs
 * @return {Array<Object>} updated-outputs - Outputs + Output
 */
export function reduceOutputs(outputs, message) {
  const lastIndex = outputs.length - 1
  if (
    outputs.length > 0 &&
    message.output_type === "stream" &&
    outputs[lastIndex].get("output_type") === "stream"
  ) {
    function appendText(previous, next) {
      return previous.update("text", text => escapeCarriageReturnSafe(text + next.text))
    }

    const last = outputs[lastIndex]
    if (last.get("name") === message.name) {
      outputs[lastIndex] = appendText(last, message)
      return outputs
    }

    // Doesn't need to find same stream from all outputs?
    // Why checking only nextToLast index is enough?
    const nextToLast = outputs[lastIndex - 1]
    if (nextToLast && nextToLast.get("name") === message.name) {
      outputs[lastIndex - 1] = appendText(nextToLast, message)
      return outputs
    }
  }
  outputs.push(createImmutableOutput(message))
  return outputs
}

export function isSingeLine(text, availableSpace) {
  // If it turns out escapeCarriageReturn is a bottleneck, we should remove it.
  return (
    (text.indexOf("\n") === -1 || text.indexOf("\n") === text.length - 1) &&
    availableSpace > escapeCarriageReturn(text).length
  )
}

export default class OutputStore {
  outputs = observable.shallowArray()
  @observable status = "running"
  @observable executionCount = null
  @observable index = -1
  @observable
  position = {
    lineHeight: 0,
    lineLength: 0,
    editorWidth: 0,
  }

  @computed
  get isPlain() {
    if (this.outputs.length !== 1) return false

    const availableSpace = this.position.editorWidth - this.position.lineLength
    if (availableSpace <= 0) return false

    const output = this.outputs[0]
    switch (output.get("output_type")) {
      case "execute_result":
      case "display_data": {
        const bundle = output.get("data")
        const mimetype = richestMimetype(bundle, displayOrder, transforms)
        return mimetype === "text/plain" ? isSingeLine(bundle.get(mimetype), availableSpace) : false
      }
      case "stream": {
        return isSingeLine(output.get("text"), availableSpace)
      }
      default: {
        return false
      }
    }
  }

  @action
  appendOutput(message) {
    if (message.stream === "execution_count") {
      this.executionCount = message.data
      return
    }

    if (message.stream === "status") {
      this.status = message.data
      return
    }

    if (this.isInterestingMessage(message)) {
      this.outputs = reduceOutputs(this.outputs, message)
      this.setIndexToLast()
      return
    }
  }

  isInterestingMessage({output_type}) {
    return ["execute_result", "display_data", "stream", "error"].includes(output_type)
  }

  @action
  updatePosition(position) {
    Object.assign(this.position, position)
  }

  @action
  setIndex = index => {
    const max = this.outputs.length - 1
    this.index = limitNumber(index, {min: 0, max: max})
    return this.index
  }

  @action
  setIndexToLast = () => {
    return this.setIndex(this.outputs.length - 1)
  }

  @action
  incrementIndex = () => {
    return this.setIndex(this.index + 1)
  }

  @action
  decrementIndex = () => {
    return this.setIndex(this.index - 1)
  }

  @action
  clear = () => {
    this.outputs.clear()
    this.index = -1
  }
}
