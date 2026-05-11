<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PermissionRequestEvent } from '@renderer/types/runtimeEvents'

const props = defineProps<{
  request: PermissionRequestEvent
}>()

const emit = defineEmits<{
  approve: []
  deny: [feedback?: string]
}>()

const showDenyFeedback = ref(false)
const feedback = ref('')

const formattedArguments = computed(() => {
  try {
    return JSON.stringify(JSON.parse(props.request.arguments), null, 2)
  } catch {
    return props.request.arguments
  }
})

const question = computed(() => `是否允许执行 ${props.request.tool}？`)

function submitFeedback(): void {
  emit('deny', feedback.value.trim() || undefined)
}
</script>

<template>
  <section class="permission-composer" role="group" aria-labelledby="permission-title">
    <header class="permission-heading">
      <p id="permission-title">{{ question }}</p>
      <span>{{ request.detail }}</span>
    </header>

    <pre v-if="formattedArguments" class="permission-command">{{ formattedArguments }}</pre>

    <div v-if="!showDenyFeedback" class="permission-options" aria-label="权限选择">
      <button class="permission-option" type="button" @click="emit('approve')">
        <span>1.</span>
        <strong>是，允许本次操作</strong>
      </button>
      <button class="permission-option" type="button" @click="showDenyFeedback = true">
        <span>2.</span>
        <strong>否，告诉 Agent 如何调整</strong>
      </button>
    </div>

    <div v-else class="permission-feedback">
      <textarea
        v-model="feedback"
        rows="3"
        placeholder="可选：告诉 Agent 如何调整方案，比如不要联网、改用本地文件、换一个命令..."
        @keydown.enter.meta.prevent="submitFeedback"
        @keydown.enter.ctrl.prevent="submitFeedback"
      ></textarea>

      <footer class="permission-actions">
        <button class="permission-skip" type="button" @click="emit('deny')">跳过</button>
        <button class="permission-back" type="button" @click="showDenyFeedback = false">
          返回
        </button>
        <button class="permission-submit" type="button" @click="submitFeedback">提交</button>
      </footer>
    </div>
  </section>
</template>
