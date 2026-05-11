import { defineStore } from 'pinia'
import { RuntimeSocket, type RuntimeConnectionStatus } from '@renderer/services/runtimeSocket'
import { useChatStore } from '@renderer/stores/chat'
import type { ActivityStepKind } from '@renderer/stores/chat'
import type {
  PermissionRequestEvent,
  RuntimeEvent,
  RuntimeSessionState,
  RuntimeSessionSummary,
  RuntimeToolMetadataMap
} from '@renderer/types/runtimeEvents'

const DEFAULT_ENDPOINT = import.meta.env.VITE_AGENT_WS_URL || 'ws://127.0.0.1:8000/agent/ws'
const MAX_EVENTS = 120
const RECONNECT_DELAY_MS = 1500

let runtimeSocket: RuntimeSocket | null = null
let reconnectTimer: number | null = null
let manualDisconnect = false

function formatToolLabel(event: PermissionRequestEvent): string {
  return event.tool || event.request_id || 'tool'
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function getToolKind(name: string): ActivityStepKind {
  if (name === 'grep') return 'search'
  if (name === 'read_file') return 'read'
  if (name === 'write_file' || name === 'edit_file') return 'edit'
  if (name === 'run_command') return 'command'
  if (name === 'web_fetch') return 'web'
  return 'tool'
}

function formatToolStartLabel(name: string, rawArguments: string): string {
  const args = parseToolArguments(rawArguments)
  const path = typeof args.path === 'string' ? args.path : ''

  switch (name) {
    case 'grep':
      return path ? `正在探索 ${path}` : '正在探索项目'
    case 'read_file':
      return path ? `正在读取 ${path}` : '正在读取文件'
    case 'write_file':
    case 'edit_file':
      return path ? `正在编辑 ${path}` : '正在编辑文件'
    case 'run_command':
      return '正在准备运行命令'
    case 'web_fetch':
      return '正在获取网页'
    default:
      return `正在调用 ${name}`
  }
}

function formatToolResultLabel(name: string, ok: boolean): string {
  if (!ok) {
    switch (name) {
      case 'grep':
        return '探索失败'
      case 'read_file':
        return '读取失败'
      case 'write_file':
      case 'edit_file':
        return '编辑失败'
      case 'run_command':
        return '命令失败'
      case 'web_fetch':
        return '获取失败'
      default:
        return `工具失败：${name}`
    }
  }

  switch (name) {
    case 'grep':
      return '已探索 1 组结果'
    case 'read_file':
      return '已读取 1 个文件'
    case 'write_file':
    case 'edit_file':
      return '已编辑 1 个文件'
    case 'run_command':
      return '已运行 1 条命令'
    case 'web_fetch':
      return '已获取 1 个网页'
    default:
      return `已完成 ${name}`
  }
}

function formatToolDetail(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value !== 'string') return String(value)

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) return

  window.clearTimeout(reconnectTimer)
  reconnectTimer = null
}

export const useRuntimeStore = defineStore('runtime', {
  state: () => ({
    endpoint: DEFAULT_ENDPOINT,
    connectionStatus: 'idle' as RuntimeConnectionStatus,
    sessionId: '',
    schemaVersion: '',
    activeTurnId: '',
    errorMessage: '',
    sessionState: null as RuntimeSessionState | null,
    activePermission: null as PermissionRequestEvent | null,
    sessionHistory: [] as RuntimeSessionSummary[],
    sessionsLoading: false,
    selectedSessionId: '',
    tools: {} as RuntimeToolMetadataMap,
    events: [] as RuntimeEvent[]
  }),
  getters: {
    isConnected: (state) => state.connectionStatus === 'connected',
    isConnecting: (state) => state.connectionStatus === 'connecting',
    isSuspended: (state) => Boolean(state.sessionState?.suspended)
  },
  actions: {
    async connect(options: { silent?: boolean } = {}): Promise<void> {
      if (this.connectionStatus === 'connected' || this.connectionStatus === 'connecting') return

      manualDisconnect = false
      clearReconnectTimer()
      this.connectionStatus = 'connecting'
      this.errorMessage = ''

      runtimeSocket = new RuntimeSocket(this.endpoint, {
        onOpen: () => {
          clearReconnectTimer()
          this.connectionStatus = 'connected'
        },
        onClose: () => {
          this.connectionStatus = 'disconnected'
          if (!manualDisconnect) {
            this.scheduleReconnect()
          }
        },
        onError: (error) => {
          this.connectionStatus = 'error'
          this.errorMessage = error.message
        },
        onEvent: (event) => this.handleEvent(event)
      })

      try {
        await runtimeSocket.connect()
      } catch {
        if (!options.silent) {
          useChatStore().addSystemMessage(`无法连接后端：${this.endpoint}，正在后台重试。`)
        }
        this.scheduleReconnect()
      }
    },

    disconnect(): void {
      manualDisconnect = true
      clearReconnectTimer()
      runtimeSocket?.disconnect()
      runtimeSocket = null
      this.connectionStatus = 'disconnected'
    },

    scheduleReconnect(): void {
      if (manualDisconnect || reconnectTimer) return
      if (this.connectionStatus === 'connected' || this.connectionStatus === 'connecting') return

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void this.connect({ silent: true })
      }, RECONNECT_DELAY_MS)
    },

    async sendUserInput(content: string): Promise<void> {
      const text = content.trim()
      if (!text) return

      const chat = useChatStore()

      if (!runtimeSocket?.isOpen) {
        await this.connect()
      }

      if (!runtimeSocket?.isOpen) {
        chat.addSystemMessage('后端还没有连接，先启动 Python WebSocket 服务后再发送。')
        return
      }

      chat.addUserMessage(text)
      chat.setFallbackConversationTitle()
      runtimeSocket.send({
        type: 'user_input',
        content: text
      })
    },

    approvePermission(): void {
      this.sendPermissionDecision(true)
    },

    denyPermission(feedback?: string): void {
      this.sendPermissionDecision(false, feedback)
    },

    async resumeSession(sessionId?: string): Promise<void> {
      if (!runtimeSocket?.isOpen) {
        await this.connect({ silent: true })
      }

      if (!runtimeSocket?.isOpen) return

      if (sessionId) {
        this.selectedSessionId = sessionId
      }

      runtimeSocket?.send({
        type: 'resume_session',
        session_id: sessionId
      })
    },

    requestSessions(limit = 30): void {
      if (!runtimeSocket?.isOpen) return

      this.sessionsLoading = true
      runtimeSocket.send({
        type: 'list_sessions',
        request_id: `sessions-${Date.now()}`,
        limit
      })
    },

    async startNewConversation(): Promise<void> {
      const chat = useChatStore()
      chat.resetConversation()
      this.activeTurnId = ''
      this.activePermission = null
      this.errorMessage = ''

      if (!runtimeSocket?.isOpen) {
        await this.connect({ silent: true })
      }

      if (!runtimeSocket?.isOpen) {
        this.sessionState = null
        return
      }

      runtimeSocket.send({
        type: 'new_session',
        request_id: `new-session-${Date.now()}`
      })
      this.requestSessions()
    },

    sendPermissionDecision(approved: boolean, feedback?: string): void {
      if (!this.activePermission || !runtimeSocket?.isOpen) return

      runtimeSocket.send({
        type: 'permission_decision',
        request_id: this.activePermission.request_id,
        approved,
        feedback
      })
    },

    requestConversationTitle(): void {
      const chat = useChatStore()
      if (!runtimeSocket?.isOpen || !chat.needsConversationTitle) return

      const messages = chat.getConversationTitleMessages()
      if (!messages.length) return

      const requestId = `title-${Date.now()}`
      chat.startConversationTitleRequest(requestId)
      runtimeSocket.send({
        type: 'conversation_title_request',
        request_id: requestId,
        messages
      })
    },

    handleEvent(event: RuntimeEvent): void {
      const chat = useChatStore()
      this.events.push(event)
      if (this.events.length > MAX_EVENTS) this.events.shift()

      switch (event.type) {
        case 'ready':
          this.sessionId = event.session_id
          this.selectedSessionId = event.session_id
          this.schemaVersion = event.schema_version
          this.tools = event.tools
          this.sessionState = event.session_state
          chat.addSystemMessage(`已连接后端：${event.session_id}`)
          this.requestSessions()
          this.requestConversationTitle()
          break
        case 'turn_started':
          this.activeTurnId = event.turn_id
          this.sessionState = event.session_state
          chat.startActivity()
          break
        case 'session_created':
          this.sessionId = event.session_id
          this.selectedSessionId = event.session_id
          this.sessionState = event.session_state
          this.activeTurnId = ''
          this.activePermission = null
          chat.resetConversation()
          this.requestSessions()
          break
        case 'sessions_list':
          this.sessionHistory = event.sessions
          this.sessionsLoading = false
          break
        case 'assistant_token':
          chat.appendAssistantToken(event.token)
          break
        case 'tool_call_started':
          chat.upsertActivityEvent(formatToolStartLabel(event.name, event.arguments), 'running', {
            requestId: event.request_id,
            kind: getToolKind(event.name),
            detail: formatToolDetail(event.arguments)
          })
          break
        case 'tool_call_result':
          chat.upsertActivityEvent(
            formatToolResultLabel(event.name, event.ok),
            event.ok ? 'success' : 'error',
            {
              requestId: event.request_id,
              kind: getToolKind(event.name),
              detail: event.content
            }
          )
          break
        case 'permission_request':
          this.activePermission = event
          chat.upsertActivityEvent(`等待权限确认：${formatToolLabel(event)}`, 'waiting', {
            requestId: event.request_id,
            kind: 'permission',
            detail: event.detail
          })
          break
        case 'permission_decision_ack':
          this.activePermission = null
          chat.upsertActivityEvent(
            event.approved ? '权限已允许' : '权限已拒绝',
            event.approved ? 'success' : 'error',
            {
              requestId: event.request_id,
              kind: 'permission'
            }
          )
          break
        case 'session_suspended':
        case 'session_blocked':
          this.sessionState = event.session_state
          chat.addSystemMessage(event.detail || event.type)
          break
        case 'session_resumed':
          if (event.session_id) {
            this.sessionId = event.session_id
            this.selectedSessionId = event.session_id
          }
          this.sessionState = event.session_state
          if (event.resumed_from_disk) {
            chat.loadConversation(event.messages || [], event.session?.title || '历史会话')
          } else {
            chat.addSystemMessage(event.detail || '会话已恢复。')
          }
          this.requestSessions()
          this.requestConversationTitle()
          break
        case 'final_answer':
          this.sessionState = event.session_state
          this.activeTurnId = ''
          chat.finishActivity('success')
          chat.finishAssistantStream(event.content)
          this.requestSessions()
          this.requestConversationTitle()
          break
        case 'conversation_title':
          chat.finishConversationTitleRequest(event.title, event.request_id)
          this.requestSessions()
          break
        case 'error':
          this.errorMessage = event.message
          if (event.request_id?.startsWith('sessions-')) {
            this.sessionsLoading = false
          }
          if (event.request_id?.startsWith('title-')) {
            chat.failConversationTitleRequest(event.request_id)
            chat.addSystemMessage(`标题生成失败：${event.message}`)
            break
          }
          chat.upsertActivityEvent('后端错误', 'error', {
            requestId: event.request_id,
            kind: 'error',
            detail: event.message
          })
          chat.finishActivity('error')
          break
      }
    }
  }
})
