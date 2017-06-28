"use babel"

import * as Immutable from "immutable"

import {log, INSPECTOR_URI} from "./utils"
import {getCodeToInspect} from "./code-manager"

export function toggleInspector(store) {
  const {editor, kernel} = store
  if (!editor || !kernel) {
    atom.notifications.addInfo("No kernel running!")
    return
  }

  const [code, cursorPos] = getCodeToInspect(editor)
  if (!code || cursorPos === 0) {
    atom.notifications.addInfo("No code to introspect!")
    return
  }

  kernel.inspect(code, cursorPos, result => {
    log("Inspector: Result:", result)

    if (!result.found) {
      atom.workspace.hide(INSPECTOR_URI)
      atom.notifications.addInfo("No introspection available!")
      return
    }
    const bundle = new Immutable.Map(result.data)

    kernel.setInspectorResult(bundle, editor)
  })
}
