"use babel"

import React from "react"
import ReactDOM from "react-dom"
import _ from "lodash"
import os from "os"
import path from "path"
// $FlowFixMe
import {shell} from "electron"

import Config from "./config"
import store from "./store"

export function focus(item) {
  if (item) {
    const editorPane = atom.workspace.paneForItem(item)
    if (editorPane) editorPane.activate()
  }
}

export function grammarToLanguage(grammar) {
  if (!grammar) return null
  const grammarLanguage = grammar.name.toLowerCase()

  const mappings = Config.getJson("languageMappings")
  const kernelLanguage = _.findKey(mappings, l => l.toLowerCase() === grammarLanguage)

  return kernelLanguage ? kernelLanguage.toLowerCase() : grammarLanguage
}

/**
 * Copied from https://github.com/nteract/nteract/blob/master/src/notebook/epics/execute.js#L37
 * Create an object that adheres to the jupyter notebook specification.
 * http://jupyter-client.readthedocs.io/en/latest/messaging.html
 *
 * @param {Object} msg - Message that has content which can be converted to nbformat
 * @return {Object} formattedMsg  - Message with the associated output type
 */
export function msgSpecToNotebookFormat(message) {
  return Object.assign({}, message.content, {
    output_type: message.header.msg_type,
  })
}

/**
  * A very basic converter for supporting jupyter messaging protocol v4 replies
  */
export function msgSpecV4toV5(message) {
  switch (message.header.msg_type) {
    case "pyout":
      message.header.msg_type = "execute_result"
      break
    case "pyerr":
      message.header.msg_type = "error"
      break
    case "stream":
      if (!message.content.text) message.content.text = message.content.data
      break
  }
  return message
}

const markupGrammars = new Set([
  "source.gfm",
  "source.asciidoc",
  "text.restructuredtext",
  "text.tex.latex.knitr",
  "text.md",
  "source.weave.noweb",
  "source.weave.md",
  "source.pweave.noweb",
  "source.pweave.md",
])

export function isMultilanguageGrammar(grammar) {
  return markupGrammars.has(grammar.scopeName)
}

export function getEmbeddedScope(editor, position) {
  const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray()
  return _.find(scopes, s => s.indexOf("source.embedded.") === 0)
}

export function getEditorDirectory(editor) {
  if (!editor) return os.homedir()
  const editorPath = editor.getPath()
  return editorPath ? path.dirname(editorPath) : os.homedir()
}

export function log(...message) {
  if (atom.config.get("Hydrogen.debug")) {
    console.trace("Hydrogen:", ...message)
  }
}

export function renderMobxReactDevtools() {
  const devTools = require("mobx-react-devtools")
  const div = document.createElement("div")
  document.getElementsByTagName("body")[0].appendChild(div)
  devTools.setLogEnabled(true)
  ReactDOM.render(<devTools.default noPanel />, div)
}

export function deprecationNote() {
  atom.notifications.addWarning("This feature will be deprecated soon!", {
    description:
      "Connecting to existing kernels via a `connection.json` file will be deprecated soon.\n\nFor some time now Hydrogen supports using [kernel gateways](https://nteract.gitbooks.io/hydrogen/docs/Usage/RemoteKernelConnection.html) for connection to existing kernels. Using that option is a lot simpler yet very powerful.\n\nPlease get in touch with us if using remote kernels isn't a option for you.",
    dismissable: true,
    buttons: [
      {
        className: "icon icon-x",
        text: "I really need this feature",
        onDidClick: () => {
          shell.openExternal("https://github.com/nteract/hydrogen/issues/858")
        },
      },
      {
        className: "icon icon-check",
        text: "I'll try remote kernels",
        onDidClick: () => {
          shell.openExternal(
            "https://nteract.gitbooks.io/hydrogen/docs/Usage/RemoteKernelConnection.html"
          )
        },
      },
    ],
  })
}

export function hotReloadPackage() {
  const packName = "Hydrogen"
  const packPath = atom.packages.resolvePackagePath(packName)
  if (!packPath) return
  const packPathPrefix = packPath + path.sep
  const zeromqPathPrefix = path.join(packPath, "node_modules", "zeromq") + path.sep

  console.info(`deactivating ${packName}`)
  atom.packages.deactivatePackage(packName)
  atom.packages.unloadPackage(packName)

  // Delete require cache to re-require on activation.
  // But except zeromq native module which is not re-requireable.
  const packageLibsExceptZeromq = filePath =>
    filePath.startsWith(packPathPrefix) && !filePath.startsWith(zeromqPathPrefix)

  Object.keys(require.cache)
    .filter(packageLibsExceptZeromq)
    .forEach(filePath => delete require.cache[filePath])

  atom.packages.loadPackage(packName)
  atom.packages.activatePackage(packName)
  console.info(`activated ${packName}`)
}

export function findEmbeddedScope(editor, position) {
  const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray()
  return _.find(scopes, s => s.indexOf("source.embedded.") === 0)
}

export function getGrammarWithNormalizeEmbedded(editor) {
  const grammar = editor.getGrammar()
  if (isMultilanguageGrammar(grammar)) {
    const embeddedScope = findEmbeddedScope(editor, editor.getCursorBufferPosition())
    if (embeddedScope) {
      const scopeName = embeddedScope.replace(".embedded", "")
      return atom.grammars.grammarForScopeName(scopeName)
    }
  }
  return grammar
}

// Unused
export function getNewPromiseAsObject() {
  const obj = {}
  obj.promise = new Promise((resolve, reject) => {
    obj.resolve = resolve
    obj.reject = reject
  })
  return obj
}

export function limitNumber(number, {min, max} = {}) {
  if (min != null) number = Math.max(number, min)
  if (max != null) number = Math.min(number, max)
  return number
}

// WIP
//==================================================
import {execSync} from "child_process"

export function detectKernelSpec() {
  const commandArgs = "kernelspec list --json --log-level=CRITICAL"

  for (const command of ["jupyter", "ipython"]) {
    const result = execSync(command + commandArgs, {killSignal: "SIGINT"})
    const json = JSON.parse(result.toString())
    if (json.kernelspecs) {
      return json.kernelspecs
    }
  }
}
