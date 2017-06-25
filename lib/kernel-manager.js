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
import {log, getGrammarWithNormalizeEmbedded, getNewPromiseAsObject} from "./utils"

import WSKernel from "./ws-kernel" // to get Class for typecheck

function matchesSpecWithGrammar(grammar, kernelSpec) {
  const grammarName = grammar.name.toLowerCase()
  const kernelLanguage = kernelSpec.language.toLowerCase()
  const languageMapping = Config.getJson("languageMappings")[kernelLanguage] || ""

  return kernelLanguage === grammarName || languageMapping.toLowerCase() === grammarName
}

function getCWD(editor) {
  const filePath = editor.getPath()
  const editorDirectory = filePath ? path.dirname(filePath) : os.homedir()

  let projectPath
  switch (atom.config.get("Hydrogen.startDir")) {
    case "firstProjectDir":
      projectPath = atom.project.getPaths()[0]
      break
    case "projectDirOfFile":
      projectPath = atom.project.relativizePath(editorDirectory)[0]
      break
  }

  return projectPath != null ? projectPath : editorDirectory
}

class KernelManager {
  constructor() {
    this._kernelSpecs = this.getKernelSpecsFromSettings()
    this.kernelByEditor = new Map()
    this.kernelStartingIsInProgressEditors = new Set()
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

  async startKernel(editor) {
    if (this.kernelStartingIsInProgressEditors.has(editor)) {
      return
    }
    this.kernelStartingIsInProgressEditors.add(editor)

    const grammar = getGrammarWithNormalizeEmbedded(editor)
    const kernelSpec = this.getKernelSpecForGrammar(grammar)

    const options = {
      cwd: getCWD(editor),
      stdio: ["ignore", "pipe", "pipe"],
    }

    const {resolve, promise} = getNewPromiseAsObject()

    launchSpec(kernelSpec, options).then(({config, connectionFile, spawn}) => {
      const kernel = new ZMQKernel(kernelSpec, grammar, config, connectionFile, spawn, options)
      this.kernelByEditor.set(editor, kernel)

      kernel.connect(() => {
        const startupCode = Config.getJson("startupCode")[kernelSpec.display_name]
        if (startupCode) {
          kernel.execute(startupCode + " \n")
        }

        store.kernel = kernel
        this.kernelStartingIsInProgressEditors.delete(editor)
        resolve(kernel)
      })
    })

    await promise
  }

  async startKernelIfNeeded(editor) {
    if (!this.hasKernelForEditor(editor)) {
      await this.startKernel(editor)
    }
    this.getKernelForEditor(editor)
  }

  async controlKernel(editor, fn) {
    const kernel = this.getKernelForEditor(editor)
    return kernel ? await fn(kernel) : false
  }

  // Return promise
  interrupt(editor) {
    return this.controlKernel(editor, kernel => kernel.interrupt())
  }

  // Return promise
  restart(editor) {
    return this.controlKernel(editor, kernel => kernel.restart())
  }

  shutdown(editor) {
    return this.controlKernel(editor, async kernel => {
      // FIXME these mesthod not return promise, so caller cannot know
      // proper timing of shutdown&destroy
      await kernel.shutdown()
      await kernel.destroy() // Note that destroy alone does not shut down a WSKernel
    })
  }

  renameWSKernel(editor) {
    // What's WSKernel??
    return this.controlKernel(editor, kernel => {
      if (kernel instanceof WSKernel) {
        kernel.promptRename()
      }
    })
  }

  disconnect(editor) {
    return this.controlKernel(editor, kernel => kernel.destroy())
  }
}

export default new KernelManager()
