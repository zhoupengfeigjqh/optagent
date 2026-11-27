<script setup lang="ts">
import { ref } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { installSkill } from '../../api/skills'
import type { ErrorInfo, ReferenceItem, SkillInstallResult } from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'installed', result: SkillInstallResult): void
  (e: 'error', message: string): void
}>()

const file = ref<File | null>(null)
const uploading = ref(false)
const error = ref<ErrorInfo | null>(null)
const localMessage = ref<string | null>(null)
const conflict = ref<{ name: string; affected: ReferenceItem[] } | null>(null)

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  error.value = null
  localMessage.value = null
}

async function upload(overwrite: boolean): Promise<void> {
  localMessage.value = null
  if (!file.value) {
    localMessage.value = '请先选择 ZIP 文件'
    return
  }
  uploading.value = true
  error.value = null
  try {
    const result = await installSkill(file.value, overwrite)
    emit('installed', result)
    conflict.value = null
    file.value = null
    emit('update:open', false)
  } catch (err) {
    const info = err as ErrorInfo
    if (info.code === 'ADM_SKILL_NAME_TAKEN') {
      const name = file.value?.name.replace(/\.zip$/i, '') ?? ''
      const affected: ReferenceItem[] = await fetchReferences('skill', name)
        .then((res) => res.affected)
        .catch(() => [])
      conflict.value = { name, affected }
    } else {
      error.value = info
      emit('error', '安装未完成，请查看错误原因')
    }
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <ConfirmDialog
    :open="props.open"
    title="上传安装 SKILL"
    confirm-label="开始安装"
    cancel-label="关闭"
    @update:open="emit('update:open', $event)"
    @confirm="upload(false)"
  >
    <label class="field" for="skill-zip">
      <span class="field__label">
        ZIP 压缩包<span class="field__required" aria-hidden="true">*</span>
      </span>
      <input id="skill-zip" type="file" accept=".zip,application/zip" @change="onFileChange" />
      <span class="field__hint">
        需含 <code>SKILL.md</code>（根级或单层目录下），元数据的 name 与 description 非空；
        越界路径、符号链接与超大包会被拒绝，安装失败不会留下任何残留。
      </span>
    </label>

    <p v-if="uploading" role="status">校验并安装中…</p>
    <p v-if="localMessage" class="skill-upload__local" role="alert">{{ localMessage }}</p>
    <ErrorNotice v-if="error" :error="error" title="安装未完成" />
  </ConfirmDialog>

  <ConfirmDialog
    :open="conflict !== null"
    title="库中已有同名 SKILL"
    :message="
      conflict && conflict.affected.length > 0
        ? `将原子替换库中版本，并有 ${conflict.affected.length} 个数字人在下次部署时同步获得新内容。`
        : '将原子替换库中版本；当前没有数字人引用它。'
    "
    confirm-label="覆盖"
    cancel-label="取消"
    danger
    @update:open="
      (value) => {
        if (!value) conflict = null
      }
    "
    @confirm="upload(true)"
  >
    <ul v-if="conflict && conflict.affected.length > 0">
      <li v-for="(item, index) in conflict.affected" :key="index">
        <span class="mono">{{ item.user_id }}</span> 的
        <span class="mono">{{ item.agent_name }}</span>
      </li>
    </ul>
  </ConfirmDialog>
</template>

<style scoped>
.skill-upload__local {
  margin: var(--space-2) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}
</style>
