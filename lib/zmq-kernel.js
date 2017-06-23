/*  */

import fs from "fs"
import {Message, Socket} from "jmp"
import v4 from "uuid/v4"
import {launchSpecFromConnectionInfo} from "spawnteract"

import Kernel from "./kernel"
import InputView from "./input-view"
import {log} from "./utils"

export default class ZMQKernel extends Kernel {
  executionCallbacks = {}

  constructor(kernelSpec, grammar, connection, connectionFile, kernelProcess, options) {
    super(kernelSpec, grammar)
    this.connection = connection
    this.connectionFile = connectionFile
    this.options = options || {}

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

    this.shellSocket.on("message", this.onShellMessage.bind(this))
    this.ioSocket.on("message", this.onIOMessage.bind(this))
    this.stdinSocket.on("message", this.onStdinMessage.bind(this))

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

  shutdown(restart = false) {
    const requestId = `shutdown_${v4()}`
    const message = this._createMessage("shutdown_request", requestId)

    message.content = {restart}

    this.shellSocket.send(new Message(message))
  }

  restart(onRestarted) {
    if (this.kernelProcess) {
      if (this.executionState === "restarting") {
        return
      }
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
      this.monitor(() => {
        if (onRestarted) onRestarted(this)
      })
    } else {
      log("ZMQKernel: restart ignored:", this)
      atom.notifications.addWarning("Cannot restart this kernel")
      if (onRestarted) onRestarted(this)
    }
  }

  // onResults is a callback that may be called multiple times
  // as results come in from the kernel
  _execute(code, requestId, onResults) {
    const message = this._createMessage("execute_request", requestId)

    message.content = {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: true,
    }

    this.executionCallbacks[requestId] = onResults

    this.shellSocket.send(new Message(message))
  }

  execute(code, onResults) {
    log("Kernel.execute:", code)

    const requestId = `execute_${v4()}`
    this._execute(code, requestId, onResults)
  }

  executeWatch(code, onResults) {
    log("Kernel.executeWatch:", code)

    const requestId = `watch_${v4()}`
    this._execute(code, requestId, onResults)
  }

  complete(code, onResults) {
    log("Kernel.complete:", code)

    const requestId = `complete_${v4()}`

    const message = this._createMessage("complete_request", requestId)

    message.content = {
      code,
      text: code,
      line: code,
      cursor_pos: code.length,
    }

    this.executionCallbacks[requestId] = onResults

    this.shellSocket.send(new Message(message))
  }

  inspect(code, cursorPos, onResults) {
    log("Kernel.inspect:", code, cursorPos)

    const requestId = `inspect_${v4()}`

    const message = this._createMessage("inspect_request", requestId)

    message.content = {
      code,
      cursor_pos: cursorPos,
      detail_level: 0,
    }

    this.executionCallbacks[requestId] = onResults

    this.shellSocket.send(new Message(message))
  }

  inputReply(input) {
    const requestId = `input_reply_${v4()}`

    const message = this._createMessage("input_reply", requestId)

    message.content = {value: input}

    this.stdinSocket.send(new Message(message))
  }

  onShellMessage(message) {
    log("shell message:", message)

    if (!this._isValidMessage(message)) {
      return
    }

    const {msg_id} = message.parent_header
    let callback
    if (msg_id) {
      callback = this.executionCallbacks[msg_id]
    }

    if (!callback) {
      return
    }

    const {status} = message.content
    if (status === "error") {
      callback({
        data: "error",
        stream: "status",
      })
    } else if (status === "ok") {
      const {msg_type} = message.header

      if (msg_type === "execution_reply") {
        callback({
          data: "ok",
          stream: "status",
        })
      } else if (msg_type === "complete_reply") {
        callback(message.content)
      } else if (msg_type === "inspect_reply") {
        callback({
          data: message.content.data,
          found: message.content.found,
        })
      } else {
        callback({
          data: "ok",
          stream: "status",
        })
      }
    }
  }

  onStdinMessage(message) {
    log("stdin message:", message)

    if (!this._isValidMessage(message)) {
      return
    }

    const {msg_type} = message.header

    if (msg_type === "input_request") {
      const {prompt} = message.content

      const inputView = new InputView({prompt}, input => this.inputReply(input))

      inputView.attach()
    }
  }

  onIOMessage(message) {
    log("IO message:", message)

    if (!this._isValidMessage(message)) {
      return
    }

    const {msg_type} = message.header

    if (msg_type === "status") {
      const status = message.content.execution_state
      this.setExecutionState(status)

      const msg_id = message.parent_header ? message.parent_header.msg_id : null
      if (msg_id && status === "idle" && msg_id.startsWith("execute")) {
        this._callWatchCallbacks()
      }
      return
    }

    const {msg_id} = message.parent_header
    let callback
    if (msg_id) {
      callback = this.executionCallbacks[msg_id]
    }

    if (!callback) {
      return
    }

    const result = this._parseIOMessage(message)

    if (result) {
      callback(result)
    }
  }

  _isValidMessage(message) {
    if (!message) {
      log("Invalid message: null")
      return false
    }

    if (!message.content) {
      log("Invalid message: Missing content")
      return false
    }

    if (message.content.execution_state === "starting") {
      // Kernels send a starting status message with an empty parent_header
      log("Dropped starting status IO message")
      return false
    }

    if (!message.parent_header) {
      log("Invalid message: Missing parent_header")
      return false
    }

    if (!message.parent_header.msg_id) {
      log("Invalid message: Missing parent_header.msg_id")
      return false
    }

    if (!message.parent_header.msg_type) {
      log("Invalid message: Missing parent_header.msg_type")
      return false
    }

    if (!message.header) {
      log("Invalid message: Missing header")
      return false
    }

    if (!message.header.msg_id) {
      log("Invalid message: Missing header.msg_id")
      return false
    }

    if (!message.header.msg_type) {
      log("Invalid message: Missing header.msg_type")
      return false
    }

    return true
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

  _getUsername() {
    return process.env.LOGNAME || process.env.USER || process.env.LNAME || process.env.USERNAME
  }

  _createMessage(msgType, msgId = v4()) {
    const message = {
      header: {
        username: this._getUsername(),
        session: "00000000-0000-0000-0000-000000000000",
        msg_type: msgType,
        msg_id: msgId,
        date: new Date(),
        version: "5.0",
      },
      metadata: {},
      parent_header: {},
      content: {},
    }

    return message
  }
}
