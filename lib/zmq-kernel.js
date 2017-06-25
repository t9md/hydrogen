"use babel"

import fs from "fs"
import {Message, Socket} from "jmp"
import v4 from "uuid/v4"
import {launchSpecFromConnectionInfo} from "spawnteract"

import Kernel from "./kernel"
import InputView from "./input-view"
import {log, getNewPromseAsObject} from "./utils"

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
      msg_id: msgId || `${msgType}_${v4()}`,
      date: new Date(),
      version: "5.0",
    },
    metadata: {},
    parent_header: {},
    content: content,
  }
}

export default class ZMQKernel extends Kernel {
  messageHandler = {}

  constructor(kernelSpec, grammar, connection, connectionFile, kernelProcess, options = {}) {
    super(kernelSpec, grammar)
    this.connection = connection
    this.connectionFile = connectionFile
    this.options = options

    if (kernelProcess) {
      this.kernelProcess = kernelProcess
      log("ZMQKernel: @kernelProcess:", this.kernelProcess)

      this.kernelProcess.stdout.on("data", data => {
        data = data.toString()

        if (atom.config.get("Hydrogen.kernelNotifications")) {
          atom.notifications.addInfo(this.kernelSpec.display_name, {
            description: data,
            dismissable: true,
          })
        } else {
          log("ZMQKernel: stdout:", data)
        }
      })

      this.kernelProcess.stderr.on("data", data => {
        atom.notifications.addError(this.kernelSpec.display_name, {
          description: data.toString(),
          dismissable: true,
        })
      })
    } else {
      log("ZMQKernel: connectionFile:", this.connectionFile)
      atom.notifications.addInfo("Using an existing kernel connection")
    }
  }

  connect(done) {
    const scheme = this.connection.signature_scheme.slice("hmac-".length)
    const {key} = this.connection

    this.shellSocket = new Socket("dealer", scheme, key)
    this.controlSocket = new Socket("dealer", scheme, key)
    this.stdinSocket = new Socket("dealer", scheme, key)
    this.ioSocket = new Socket("sub", scheme, key)

    const id = v4()
    this.shellSocket.identity = `dealer${id}`
    this.controlSocket.identity = `control${id}`
    this.stdinSocket.identity = `dealer${id}`
    this.ioSocket.identity = `sub${id}`

    const address = `${this.connection.transport}://${this.connection.ip}:`
    this.shellSocket.connect(address + this.connection.shell_port)
    this.controlSocket.connect(address + this.connection.control_port)
    this.ioSocket.connect(address + this.connection.iopub_port)
    this.ioSocket.subscribe("")
    this.stdinSocket.connect(address + this.connection.stdin_port)

    this.shellSocket.on("message", this.handleShellMessage.bind(this))
    this.ioSocket.on("message", this.handleIOMessage.bind(this))
    this.stdinSocket.on("message", this.handleStdinMessage.bind(this))

    this.monitor(done)
  }

  monitor(done) {
    try {
      let socketNames = ["shellSocket", "controlSocket", "ioSocket"]

      let waitGroup = socketNames.length

      const onConnect = ({socketName, socket}) => {
        log("ZMQKernel: " + socketName + " connected")
        socket.unmonitor()

        waitGroup--
        if (waitGroup === 0) {
          log("ZMQKernel: all main sockets connected")
          this.setExecutionState("idle")
          if (done) done()
        }
      }

      const monitor = (socketName, socket) => {
        log("ZMQKernel: monitor " + socketName)
        socket.on("connect", onConnect.bind(this, {socketName, socket}))
        socket.monitor()
      }

      monitor("shellSocket", this.shellSocket)
      monitor("controlSocket", this.controlSocket)
      monitor("ioSocket", this.ioSocket)
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

    this.shellSocket.close()
    this.controlSocket.close()
    this.ioSocket.close()
    this.stdinSocket.close()

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
      this.monitor(() => {
        resolve(true)
      })
    })
  }

  //--------------------------
  sendMessageToShellSocket({msgType, msgId, content, handler}) {
    if (handler) {
      this.messageHandler[msgId] = handler
    }
    const message = buildMessage(msgType, msgId, content)
    this.shellSocket.send(new Message(message))
  }

  shutdown(restart = false) {
    this.sendMessageToShellSocket({
      msgType: "shutdown_request",
      content: {restart},
    })
  }

  execute(code, handler, msgId) {
    this.sendMessageToShellSocket({
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
    this.sendMessageToShellSocket({
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
    this.sendMessageToShellSocket({
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
    if (!isValidMessage(message)) return

    const handler = this.messageHandler[message.parent_header.msg_id]
    if (!handler) return
    handler(translateShellMessage(message))

    function translateShellMessage({content}) {
      if (content.status === "error") {
        return {data: "error", stream: "status"}
      }

      // FIXME: maybe this is NOT necessary
      // But want to explicit, since for now, I'm not familiar with jupyter mesg protocol.
      if (content.status !== "ok") {
        throw new Error(
          `ZMQKernel: unexpected content.status on handleShellMessage ${content.status}`
        )
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
  }

  handleStdinMessage(message) {
    if (!isValidMessage(message)) return

    if (message.header.msg_type === "input_request") {
      const sendInputReply = this.sendInputReply.bind(this)
      const {prompt} = message.content
      const inputView = new InputView({prompt}, sendInputReply)
      inputView.attach()
    }
  }

  sendInputReply(input) {
    const message = buildMessage("input_reply", null, {value: input})
    this.stdinSocket.send(new Message(message))
  }

  handleIOMessage(message) {
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
