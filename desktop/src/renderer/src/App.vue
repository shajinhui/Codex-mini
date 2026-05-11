<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ChatComposer from '@renderer/components/ChatComposer.vue'
import MessageList from '@renderer/components/MessageList.vue'
import PermissionDialog from '@renderer/components/PermissionDialog.vue'
import TitleBar from '@renderer/components/TitleBar.vue'
import { useChatStore } from '@renderer/stores/chat'
import { useRuntimeStore } from '@renderer/stores/runtime'

const chat = useChatStore()
const runtime = useRuntimeStore()
const sidebarOpen = ref(false)

const composerPlaceholder = computed(() => {
  if (runtime.isSuspended) return '会话已挂起，请先恢复...'
  if (runtime.isConnecting) return '正在连接后端...'
  return '输入消息...'
})

const composerDisabled = computed(() => runtime.isConnecting || runtime.isSuspended)
function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value
}

function formatSessionUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

onMounted(() => {
  void runtime.connect()
})
</script>

<template>
  <main class="app-screen" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="app-sidebar" :aria-hidden="!sidebarOpen">
      <div class="sidebar-top">
        <button
          class="sidebar-toggle in-sidebar"
          type="button"
          :aria-label="sidebarOpen ? '收起侧边栏' : '打开侧边栏'"
          @click="toggleSidebar"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v14H4V5Zm6 0v14" />
          </svg>
        </button>
      </div>

      <label class="sidebar-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m21 21-4.4-4.4M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
        </svg>
        <input type="search" placeholder="搜索" />
      </label>

      <nav class="sidebar-primary" aria-label="侧边栏操作">
        <button
          type="button"
          class="sidebar-action active"
          @click="void runtime.startNewConversation()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>发起新对话</span>
        </button>
        <button type="button" class="sidebar-action">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3 4.5 6v5.8c0 4.2 3.1 7.6 7.5 9 4.4-1.4 7.5-4.8 7.5-9V6L12 3Zm-3 9 2 2 4-4"
            />
          </svg>
          <span>我的内容</span>
        </button>
      </nav>

      <section class="sidebar-list" aria-label="历史会话">
        <h2>{{ runtime.sessionsLoading ? '正在加载' : '历史会话' }}</h2>
        <button
          v-for="session in runtime.sessionHistory"
          :key="session.session_id"
          type="button"
          class="sidebar-item"
          :class="{ selected: session.session_id === runtime.selectedSessionId }"
          :title="session.last_message || session.title"
          @click="void runtime.resumeSession(session.session_id)"
        >
          <span>{{ session.title }}</span>
          <small>{{ formatSessionUpdatedAt(session.updated_at) }}</small>
        </button>
        <p v-if="!runtime.sessionsLoading && !runtime.sessionHistory.length" class="sidebar-empty">
          暂无历史会话
        </p>
      </section>

      <div class="sidebar-account">
        <span class="avatar">C</span>
        <span>Codex-mini</span>
      </div>
    </aside>

    <div v-if="sidebarOpen" class="sidebar-scrim" @click="toggleSidebar"></div>

    <section class="chat-window" aria-label="Codex-mini chat preview">
      <TitleBar
        :title="chat.conversationTitle"
        :title-status="chat.conversationTitleStatus"
        :message-count="chat.messageCount"
        :connection-status="runtime.connectionStatus"
        :is-suspended="runtime.isSuspended"
        :sidebar-open="sidebarOpen"
        @toggle-sidebar="toggleSidebar"
        @connect="runtime.connect"
        @disconnect="runtime.disconnect"
        @resume="runtime.resumeSession"
        @new-conversation="runtime.startNewConversation"
      />
      <MessageList :messages="chat.messages" />
      <div class="composer-zone">
        <PermissionDialog
          v-if="runtime.activePermission"
          :request="runtime.activePermission"
          @approve="runtime.approvePermission"
          @deny="runtime.denyPermission"
        />
        <ChatComposer
          v-else
          :disabled="composerDisabled"
          :placeholder="composerPlaceholder"
          @send="runtime.sendUserInput"
        />
      </div>
    </section>
  </main>
</template>
