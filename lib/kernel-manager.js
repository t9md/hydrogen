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

export default class KernelManager {
  constructor(hydrogen) {
    hydrogen.onDidDestroy(() => this.destroy())

    this.editor = hydrogen.editor
    this._kernelSpecs = this.getKernelSpecsFromSettings()
    this.kernel = null
    this.isStarting = false
  }

  destroy() {
  }

  getKernelSpecsFromSettings() {
    return Config.getJson("kernelspec").kernelspecs || {}
  }

  getKernelSpecForGrammar(grammar) {
    const specs = Object.values(this._kernelSpecs)
      .map(kernelSpec => kernelSpec.spec)
      .filter(spec => matchesSpecWithGrammar(grammar, spec))
    return specs[0]
  }

  async start() {
    if (this.isStarting) return
    this.isStarting = true

    const editor = this.editor

    const grammar = getGrammarWithNormalizeEmbedded(editor)
    const kernelSpec = this.getKernelSpecForGrammar(grammar)

    const options = {
      cwd: getCWD(editor),
      stdio: ["ignore", "pipe", "pipe"],
    }

    const {resolve, promise} = getNewPromiseAsObject()

    launchSpec(kernelSpec, options).then(({config, connectionFile, spawn}) => {
      const kernel = new ZMQKernel(kernelSpec, grammar, config, connectionFile, spawn, options)

      kernel.connect(() => {
        const startupCode = Config.getJson("startupCode")[kernelSpec.display_name]
        if (startupCode) {
          kernel.execute(startupCode + " \n")
        }

        this.kernel = kernel
        store.kernel = kernel
        this.isStarting = false
        resolve(kernel)
      })
    })

    await promise
  }

  async startIfNeeded() {
    if (!this.kernel) {
      await this.start()
    }
    return this.kernel
  }

  async controlKernel(fn) {
    return this.kernel ? await fn(this.kernel) : false
  }

  // Return promise
  interrupt() {
    return this.controlKernel(kernel => kernel.interrupt())
  }

  // Return promise
  restart() {
    return this.controlKernel(kernel => kernel.restart())
  }

  shutdown() {
    return this.controlKernel(async kernel => {
      // FIXME these mesthod not return promise, so caller cannot know
      // proper timing of shutdown&destroy
      await kernel.shutdown()
      await kernel.destroy() // Note that destroy alone does not shut down a WSKernel
    })
  }

  renameWSKernel() {
    // What's WSKernel??
    return this.controlKernel(kernel => {
      if (kernel instanceof WSKernel) {
        kernel.promptRename()
      }
    })
  }

  disconnect() {
    return this.controlKernel(kernel => kernel.destroy())
  }
}
