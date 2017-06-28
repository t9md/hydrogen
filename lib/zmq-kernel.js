"use babel"

import fs from "fs"
import {Message, Socket} from "jmp"
import v4 from "uuid/v4"
import {launchSpec, launchSpecFromConnectionInfo} from "spawnteract"

import Kernel from "./kernel"
import InputView from "./input-view"
import {log} from "./utils"

function isValidMessage(message) {
  return (
    message &&
    message.content &&
    // Kernels send a starting status message with an empty parent_header
    message.content.execution_state !== "starting" &&
    message.parent_header &&
    message.parent_header.msg_id &&
    message.parent_header.msg_type &&
    message.header &&
    message.header.msg_id &&
    message.header.msg_type
  )
}

function buildMessage(msgType, msgId, content = {}) {
  return {
    header: {
      username:
        process.env.LOGNAME || process.env.USER || process.env.LNAME || process.env.USERNAME,
      session: "00000000-0000-0000-0000-000000000000",
      msg_type: msgType,
      msg_id: msgId,
      date: new Date(),
      version: "5.0",
    },
    metadata: {},
    parent_header: {},
    content: content,
  }
}

function translateShellMessage(message) {
  const {content} = message
  if (content.status === "error") {
    return {data: "error", stream: "status"}
  }

  // FIXME: maybe this is NOT necessary
  // But want to explicit, since for now, I'm not familiar with jupyter mesg protocol.
  if (content.status !== "ok") {
    throw new Error(`ZMQKernel: unexpected content.status on handleShellMessage ${content.status}`)
  }

  switch (message.header.msg_type) {
    case "execution_reply":
      return {data: "ok", stream: "status"}
    case "complete_reply":
      return content
    case "inspect_reply":
      return {data: content.data, found: content.found}
    default:
      return {data: "ok", stream: "status"}
  }
}

export default class ZMQKernel extends Kernel {
  messageHandler = {}
  socketTable = {}
  handlerTable = {}

  constructor(kernelSpec, grammar) {
    super(kernelSpec, grammar)

    // ????
    // if (!kernelProcess) {
    //   atom.notifications.addInfo("Using an existing kernel connection")
    //   return
    // }
  }

  start(spawnOptions) {
    this.spawnOptions = spawnOptions
    Object.assign(this.spawnOptions, {stdio: ["ignore", "pipe", "pipe"]})

    return launchSpec(this.kernelSpec, this.spawnOptions).then(result => {
      const {config, connectionFile, spawn} = result
      this.connectionInfo = config
      this.connectionFile = connectionFile
      this.kernelProcess = spawn

      // log purpose
      const stdout = data => console.info(data.toString())
      this.kernelProcess.stdout.on("data", stdout)
      const stderr = data => console.error(data.toString())
      this.kernelProcess.stderr.on("data", stderr)
    })
  }

  connect() {
    const scheme = this.connectionInfo.signature_scheme.slice("hmac-".length)
    const {key} = this.connectionInfo
    const id = v4()
    const address = `${this.connectionInfo.transport}://${this.connectionInfo.ip}:`

    const connectToKernel = (socketName, options) => {
      const {socketType, identity, port, handler} = options
      const socket = new Socket(socketType, scheme, key)
      this.socketTable[socketName] = socket

      socket.identity = identity
      if (handler) socket.on("message", handler)
      socket.connect(address + this.connectionInfo[port])
    }

    connectToKernel("shell", {
      socketType: "dealer",
      identity: "dealer" + id,
      handler: this.handleShellMessage.bind(this),
      port: "shell_port",
    })

    connectToKernel("control", {
      socketType: "dealer",
      identity: "control" + id,
      port: "control_port",
    })

    connectToKernel("stdin", {
      socketType: "dealer",
      identity: "dealer" + id,
      handler: this.handleStdinMessage.bind(this),
      port: "stdin_port",
    })

    connectToKernel("io", {
      socketType: "sub",
      identity: "sub" + id,
      handler: this.handleIOMessage.bind(this),
      port: "iopub_port",
    })

    this.socketTable.io.subscribe("")

    return this.monitorAllSocketToConnect("shell", "control", "io")
  }

  monitorSocketToConnect(socket) {
    return new Promise(resolve => {
      socket.on("connect", () => {
        socket.unmonitor()
        resolve()
      })
    })
    socket.monitor()
  }

  monitorAllSocketToConnect(...socketNames) {
    const promises = ocketNames
      .map(socketNames => this.socketTable[socketName])
      .map(socket => this.monitorConnect(socket))

    return Promise.all(promises).then(() => {
      this.setExecutionState("idele")
      return true
    })
  }

  destroy() {
    this.shutdown()

    if (this.kernelProcess) {
      this.kernelProcess.kill("SIGKILL")
      fs.unlinkSync(this.connectionFile)
    }

    for (const socket of Object.values(this.socketTable)) {
      socket.close()
    }
    super.destroy()
  }

  interrupt() {
    if (process.platform === "win32") {
      atom.notifications.addWarning("Cannot interrupt this kernel", {
        detail: "Kernel interruption is currently not supported in Windows.",
      })
      return
    }
    if (!this.kernelProcess) {
      atom.notifications.addWarning("No kernel process to interrupt")
      return
    }
    this.kernelProcess.kill("SIGINT")
  }

  async restart() {
    if (this.executionState === "restarting") return
    if (!this.kernelProcess) {
      atom.notifications.addWarning("NO kernel process to restart")
      return
    }

    this.setExecutionState("restarting")
    this.shutdown(true)
    this.kernelProcess.kill("SIGKILL")

    const {spawn} = launchSpecFromConnectionInfo(
      this.kernelSpec,
      this.connectionInfo,
      this.connectionFile,
      this.spawnOptions
    )
    this.kernelProcess = spawn

    return this.monitorAllSocketToConnect("shell", "control", "io")
  }
  //--------------------------
  sendMessage(socketName, {msgType, msgId, content, handler}) {
    msgId = msgId || `${msgType}_${v4()}`
    if (handler) {
      this.messageHandler[msgId] = handler
    }
    const message = buildMessage(msgType, msgId, content)
    this.socketTable[socketName].send(new Message(message))
  }

  shutdown(restart = false) {
    this.sendMessage("shell", {
      msgType: "shutdown_request",
      content: {restart},
    })
  }

  execute(code, handler, msgId) {
    this.sendMessage("shell", {
      msgId: msgId, // used by executeWatch() to differentiate msgId
      msgType: "execute_request",
      content: {
        code: code,
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: true,
      },
      handler: handler,
    })
  }

  executeWatch(code, handler) {
    this.execute(code, handler, `watch_${v4()}`)
  }

  complete(code, handler) {
    this.sendMessage("shell", {
      msgType: "complete_request",
      content: {
        code: code,
        text: code,
        line: code,
        cursor_pos: code.length,
      },
      handler: handler,
    })
  }

  inspect(code, cursorPosition, handler) {
    this.sendMessage("shell", {
      msgType: "inspect_request",
      content: {
        code,
        cursor_pos: cursorPosition,
        detail_level: 0,
      },
      handler: handler,
    })
  }

  // Message handlers
  //--------------------------
  handleShellMessage(message) {
    // console.log("SHELL", message)
    if (!isValidMessage(message)) return

    const handler = this.messageHandler[message.parent_header.msg_id]
    if (!handler) return
    handler(translateShellMessage(message))
  }

  handleStdinMessage(message) {
    // console.log("STDIN", message)
    if (!isValidMessage(message)) return

    if (message.header.msg_type === "input_request") {
      const {prompt} = message.content
      const inputView = new InputView({prompt}, input =>
        this.sendMessage("stdin", {msgType: "input_reply", content: {value: input}})
      )
      inputView.attach()
    }
  }

  handleIOMessage(message) {
    // console.log("IO", message)
    if (!isValidMessage(message)) return

    const {msg_type} = message.header
    const {msg_id} = message.parent_header

    if (msg_type === "status") {
      const {execution_state} = message.content
      this.setExecutionState(execution_state)
      if (msg_id && msg_id.startsWith("execute_request_") && execution_state === "idle") {
        this._callWatchCallbacks()
      }
      return
    }

    const handler = this.messageHandler[msg_id]
    if (!handler) return
    const parsedIOMessage = this._parseIOMessage(message)
    if (parsedIOMessage) {
      handler(parsedIOMessage)
    }
  }
}
