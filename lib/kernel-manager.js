"use babel"

import _ from "lodash"
import {exec} from "child_process"
import {launchSpec} from "spawnteract"
import fs from "fs"
import path from "path"
import os from "os"

import Config from "./config"
import ZMQKernel from "./zmq-kernel"

import KernelPicker from "./kernel-picker"
import store from "./store"
import {getEditorDirectory, log, deprecationNote, getGrammar} from "./utils"

function matchesSpecWithGrammar(grammar, kernelSpec) {
  const grammarName = grammar.name.toLowerCase()
  const kernelLanguage = kernelSpec.language.toLowerCase()
  const languageMapping = Config.getJson("languageMappings")[kernelLanguage] || ""

  return kernelLanguage === grammarName || languageMapping.toLowerCase() === grammarName
}

class KernelManager {
  constructor() {
    this._kernelSpecs = this.getKernelSpecsFromSettings() || {}
    this.kernelByEditor = new Map()
  }

  getKernelSpecForGrammarNew(grammar) {
    let specs = _.map(this._kernelSpecs, "spec")
    specs = specs.filter(spec => matchesSpecWithGrammar(grammar, spec))
    return specs[0]
  }

  startKernelFor(grammar, editor, onStarted) {
    this.getKernelSpecForGrammar(grammar, kernelSpec => {
      if (!kernelSpec) {
        const message = `No kernel for grammar \`${grammar.name}\` found`
        const description =
          "Check that the language for this file is set in Atom and that you have a Jupyter kernel installed for it."
        atom.notifications.addError(message, {description})
        return
      }

      this.startKernel(kernelSpec, grammar, onStarted)
    })
  }

  startKernelNew(editor, grammar, kernelSpec) {
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
        resolve(kernel)
      })
    })

    return connectPromise
  }

  getKernelForEditor(editor) {
    return this.kernelByEditor.get(editor)
  }

  hasKernelForEditor(editor) {
    return this.kernelByEditor.has(editor)
  }

  startKernel(kernelSpec, grammar, onStarted) {
    const displayName = kernelSpec.display_name

    // if kernel startup already in progress don't start additional kernel
    if (store.startingKernels.get(displayName)) return

    store.startKernel(displayName)

    let currentPath = getEditorDirectory(store.editor)
    let projectPath

    log("KernelManager: startKernel:", displayName)

    switch (atom.config.get("Hydrogen.startDir")) {
      case "firstProjectDir":
        projectPath = atom.project.getPaths()[0]
        break
      case "projectDirOfFile":
        projectPath = atom.project.relativizePath(currentPath)[0]
        break
    }

    const kernelStartDir = projectPath != null ? projectPath : currentPath
    const options = {
      cwd: kernelStartDir,
      stdio: ["ignore", "pipe", "pipe"],
    }

    launchSpec(kernelSpec, options).then(({config, connectionFile, spawn}) => {
      const kernel = new ZMQKernel(kernelSpec, grammar, config, connectionFile, spawn, options)

      kernel.connect(() => {
        log("KernelManager: startKernel:", displayName, "connected")

        store.newKernel(kernel)

        this._executeStartupCode(kernel)

        if (onStarted) onStarted(kernel)
      })
    })
  }

  _executeStartupCode(kernel) {
    const displayName = kernel.kernelSpec.display_name
    let startupCode = Config.getJson("startupCode")[displayName]
    if (startupCode) {
      log("KernelManager: Executing startup code:", startupCode)
      startupCode = `${startupCode} \n`
      kernel.execute(startupCode)
    }
  }

  getAllKernelSpecs(callback) {
    if (_.isEmpty(this._kernelSpecs)) {
      return this.updateKernelSpecs(() => callback(_.map(this._kernelSpecs, "spec")))
    }
    return callback(_.map(this._kernelSpecs, "spec"))
  }

  getAllKernelSpecsForGrammar(grammar, callback) {
    if (grammar) {
      return this.getAllKernelSpecs(kernelSpecs => {
        const specs = kernelSpecs.filter(spec => this.kernelSpecProvidesGrammar(spec, grammar))

        return callback(specs)
      })
    }
    return callback([])
  }

  getKernelSpecForGrammar(grammar, callback) {
    this.getAllKernelSpecsForGrammar(grammar, kernelSpecs => {
      if (kernelSpecs.length <= 1) {
        callback(kernelSpecs[0])
        return
      }

      if (this.kernelPicker) {
        this.kernelPicker.kernelSpecs = kernelSpecs
      } else {
        this.kernelPicker = new KernelPicker(kernelSpecs)
      }

      this.kernelPicker.onConfirmed = kernelSpec => callback(kernelSpec)
      this.kernelPicker.toggle()
    })
  }

  kernelSpecProvidesLanguage(kernelSpec, grammarLanguage) {
    return kernelSpec.language.toLowerCase() === grammarLanguage.toLowerCase()
  }

  kernelSpecProvidesGrammar(kernelSpec, grammar) {
    if (!grammar || !grammar.name || !kernelSpec || !kernelSpec.language) {
      return false
    }
    const grammarLanguage = grammar.name.toLowerCase()
    const kernelLanguage = kernelSpec.language.toLowerCase()
    if (kernelLanguage === grammarLanguage) {
      return true
    }

    const mappedLanguage = Config.getJson("languageMappings")[kernelLanguage]
    if (!mappedLanguage) {
      return false
    }

    return mappedLanguage.toLowerCase() === grammarLanguage
  }

  getKernelSpecsFromSettings() {
    return Config.getJson("kernelspec").kernelspecs || {}
  }

  mergeKernelSpecs(kernelSpecs) {
    Object.assign(this._kernelSpecs, kernelSpecs)
  }

  updateKernelSpecs(callback) {
    this._kernelSpecs = this.getKernelSpecsFromSettings()
    this.getKernelSpecsFromJupyter((err, kernelSpecsFromJupyter) => {
      if (!err) {
        this.mergeKernelSpecs(kernelSpecsFromJupyter)
      }

      if (_.isEmpty(this._kernelSpecs)) {
        const message = "No kernel specs found"
        const options = {
          description:
            "Use kernelSpec option in Hydrogen or update IPython/Jupyter to a version that supports: `jupyter kernelspec list --json` or `ipython kernelspec list --json`",
          dismissable: true,
        }
        atom.notifications.addError(message, options)
      } else {
        err = null
        const message = "Hydrogen Kernels updated:"
        const options = {
          detail: _.map(this._kernelSpecs, "spec.display_name").join("\n"),
        }
        atom.notifications.addInfo(message, options)
      }

      if (callback) callback(err, this._kernelSpecs)
    })
  }

  getKernelSpecsFromJupyter(callback) {
    const jupyter = "jupyter kernelspec list --json --log-level=CRITICAL"
    const ipython = "ipython kernelspec list --json --log-level=CRITICAL"

    return this.getKernelSpecsFrom(jupyter, (jupyterError, kernelSpecs) => {
      if (!jupyterError) {
        return callback(jupyterError, kernelSpecs)
      }

      return this.getKernelSpecsFrom(ipython, (ipythonError, specs) => {
        if (!ipythonError) {
          return callback(ipythonError, specs)
        }
        return callback(jupyterError, specs)
      })
    })
  }

  getKernelSpecsFrom(command, callback) {
    const options = {killSignal: "SIGINT"}
    let kernelSpecs
    return exec(command, options, (err, stdout) => {
      if (!err) {
        try {
          kernelSpecs = JSON.parse(stdout.toString()).kernelspecs
        } catch (error) {
          err = error
          log("Could not parse kernelspecs:", err)
        }
      }

      return callback(err, kernelSpecs)
    })
  }
}

export default new KernelManager()
