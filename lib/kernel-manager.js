"use babel"

// import _ from "lodash"
// import {exec} from "child_process"
import {launchSpec} from "spawnteract"
import fs from "fs"
import path from "path"
import os from "os"

import Config from "./config"
import ZMQKernel from "./zmq-kernel"

// import KernelPicker from "./kernel-picker"
import store from "./store"
import {log, getGrammar} from "./utils"

function matchesSpecWithGrammar(grammar, kernelSpec) {
  const grammarName = grammar.name.toLowerCase()
  const kernelLanguage = kernelSpec.language.toLowerCase()
  const languageMapping = Config.getJson("languageMappings")[kernelLanguage] || ""

  return kernelLanguage === grammarName || languageMapping.toLowerCase() === grammarName
}

class KernelManager {
  constructor() {
    this._kernelSpecs = this.getKernelSpecsFromSettings()
    this.kernelByEditor = new Map()
    this.kernelIsStarting = new Set()
  }

  getKernelSpecsFromSettings() {
    return Config.getJson("kernelspec").kernelspecs || {}
  }

  getKernelForEditor(editor) {
    return this.kernelByEditor.get(editor)
  }

  hasKernelForEditor(editor) {
    return this.kernelByEditor.has(editor)
  }

  getKernelSpecForGrammar(grammar) {
    const specs = Object.values(this._kernelSpecs)
      .map(kernelSpec => kernelSpec.spec)
      .filter(spec => matchesSpecWithGrammar(grammar, spec))
    return specs[0]
  }

  startKernel(editor, grammar, kernelSpec) {
    if (this.kernelIsStarting.has(editor)) {
      return
    }

    this.kernelIsStarting.add(editor)

    // const grammar = getGrammar(editor)
    const filePath = editor.getPath()
    let editorDirectory = filePath ? path.dirname(filePath) : os.homedir()
    let projectPath

    switch (atom.config.get("Hydrogen.startDir")) {
      case "firstProjectDir":
        projectPath = atom.project.getPaths()[0]
        break
      case "projectDirOfFile":
        projectPath = atom.project.relativizePath(editorDirectory)[0]
        break
    }

    const cwd = projectPath != null ? projectPath : editorDirectory
    const options = {cwd, stdio: ["ignore", "pipe", "pipe"]}

    let resolve
    const connectPromise = new Promise(_resolve => (resolve = _resolve))

    launchSpec(kernelSpec, options).then(({config, connectionFile, spawn}) => {
      const kernel = new ZMQKernel(kernelSpec, grammar, config, connectionFile, spawn, options)
      this.kernelByEditor.set(editor, kernel)

      kernel.connect(() => {
        const startupCode = Config.getJson("startupCode")[kernelSpec.display_name]
        if (startupCode) {
          kernel.execute(startupCode + " \n")
        }

        store.kernel = kernel
        this.kernelIsStarting.delete(editor)
        resolve(kernel)
      })
    })

    return connectPromise
  }
}

export default new KernelManager()
