"use babel"

import fs from "fs"
import {Message, Socket} from "jmp"
import v4 from "uuid/v4"
import {launchSpecFromConnectionInfo} from "spawnteract"

import Kernel from "./kernel"
import InputView from "./input-view"
import {log, getNewPromiseAsObject} from "./utils"

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

  constructor(kernelSpec, grammar, connection, connectionFile, kernelProcess, options = {}) {
    super(kernelSpec, grammar)
    this.connection = connection
    this.connectionFile = connectionFile
    this.options = options

    if (!kernelProcess) {
      atom.notifications.addInfo("Using an existing kernel connection")
      return
    }
    this.kernelProcess = kernelProcess

    const stdout = data => console.info(data)
    this.kernelProcess.stdout.on("data", stdout)

    const stderr = data => console.error(data)
    this.kernelProcess.stderr.on("data", stderr)
  }

  connect(done) {
    // FIXME: at this point, socket are already connected by launchSpec ???
    // If so, move that logic to here, already connected BEFORE calling connect is confusing.

    const scheme = this.connection.signature_scheme.slice("hmac-".length)
    const {key} = this.connection
    const id = v4()
    const address = `${this.connection.transport}://${this.connection.ip}:`

    const createSocketAndConnect = (socketName, options) => {
      const {socketType, identity, onMessage, port} = options
      const socket = new Socket(socketType, scheme, key)
      this.socketTable[socketName] = socket
      socket.identity = identity
      if (onMessage) socket.on("message", onMessage)
      socket.connect(address + port)
      return socket
    }

    createSocketAndConnect("shell", {
      socketType: "dealer",
      identity: "dealer" + id,
      onMessage: this.handleShellMessage.bind(this),
      port: this.connection.shell_port,
    })

    createSocketAndConnect("control", {
      socketType: "dealer",
      identity: "control" + id,
      port: this.connection.control_port,
    })

    createSocketAndConnect("stdin", {
      socketType: "dealer",
      identity: "dealer" + id,
      onMessage: this.handleStdinMessage.bind(this),
      port: this.connection.stdin_port,
    })

    createSocketAndConnect("io", {
      socketType: "sub",
      identity: "sub" + id,
      onMessage: this.handleIOMessage.bind(this),
      port: this.connection.iopub_port,
    })
    this.socketTable.io.subscribe("")

    this.monitorConnect(done)
  }

  monitorConnect(done) {
    try {
      let socketNames = ["shell", "control", "io"]
      let connectPendingCount = socketNames.length

      for (const socketName of socketNames) {
        const socket = this.socketTable[socketName]
        socket.on("connect", () => {
          socket.unmonitor()
          connectPendingCount--
          if (connectPendingCount === 0) {
            this.setExecutionState("idle")
            if (done) done()
          }
        })
        socket.monitor()
      }
    } catch (err) {
      console.error("ZMQKernel:", err)
    }
  }

  destroy() {
    log("ZMQKernel: destroy:", this)

    this.shutdown()

    if (this.kernelProcess) {
      this._kill()
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
    } else if (this.kernelProcess) {
      log("ZMQKernel: sending SIGINT")
      this.kernelProcess.kill("SIGINT")
    } else {
      log("ZMQKernel: cannot interrupt an existing kernel")
      atom.notifications.addWarning("Cannot interrupt an existing kernel")
    }
  }

  _kill() {
    if (this.kernelProcess) {
      log("ZMQKernel: sending SIGKILL")
      this.kernelProcess.kill("SIGKILL")
    } else {
      log("ZMQKernel: cannot kill an existing kernel")
      atom.notifications.addWarning("Cannot kill this kernel")
    }
  }

  restart(onRestarted) {
    if (!this.kernelProcess) {
      log("ZMQKernel: restart ignored:", this)
      atom.notifications.addWarning("Cannot restart this kernel")
      return
    }
    if (this.executionState === "restarting") return

    this.setExecutionState("restarting")
    this.shutdown(true)
    this._kill()
    const {spawn} = launchSpecFromConnectionInfo(
      this.kernelSpec,
      this.connection,
      this.connectionFile,
      this.options
    )
    this.kernelProcess = spawn

    return new Promise(resolve => {
      this.monitorConnect(() => {
        resolve(true)
      })
    })
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
