<template>
  <v-container class="p-8" fluid>
    <v-sheet class="d-flex align-center gap-1 mb-3 justify-between">
      <div>
        <v-icon-btn size="20" @click="$router.back()">
          <v-icon size="20">mdi-chevron-left</v-icon>
        </v-icon-btn>

        <span class="text-[13px]">{{ id ? '修改文档' : '新增文档' }}</span>
      </div>
      <!-- 发布：先填标题 / 简略信息，确认后 published 置为 1（列表只显示已发布的） -->
      <v-btn
        color="primary"
        size="small"
        variant="flat"
        @click="openPublish"
      >发布</v-btn>
    </v-sheet>

    <v-sheet class="z-1000">
      <v-md-editor
        v-model="content"
        height="87vh"
        :include-level="[3, 4]"
        @fullscreen-change="hanldeFullScreenChange"
        @save="onSave"
      />
    </v-sheet>

    <v-layout min-height="100">
      <v-snackbar
        v-model="loading"
        contained
        loading
        text="保存中"
        :timeout="-1"
      />

      <v-snackbar
        v-model="success"
        color="success"
        contained
        prepend-icon="$complete"
        text="已保存!"
        :timeout="2000"
      />

      <!-- 发布 / 未发布等结果提示（与其它页同款 snackbar 形状） -->
      <v-snackbar
        v-model="hint.show"
        :color="hint.color"
        contained
        :text="hint.text"
        :timeout="3000"
      />
    </v-layout>

    <!--
      发布弹窗：标题 + 简略信息（对应库里的 title / subscribe）。
      这两项就是文档列表卡片上显示的东西（见 pages/knowledge.vue），所以发布时一起收齐 ——
      否则列表里会出现"没名字的卡片"。两项都必填。
    -->
    <v-dialog v-model="publishOpen" max-width="460">
      <v-card>
        <v-card-title class="text-[15px]">发布文档</v-card-title>

        <v-card-text>
          <div class="text-[12px] text-medium-emphasis mb-3">
            这两项会显示在文档列表的卡片上；确认后这篇文档才会出现在列表里（正文以最近一次保存为准）。
          </div>

          <v-text-field
            v-model="publishForm.title"
            density="compact"
            hide-details="auto"
            label="标题"
            :rules="[requiredRule]"
            variant="outlined"
          />

          <v-text-field
            v-model="publishForm.subscribe"
            class="mt-3"
            density="compact"
            hide-details="auto"
            label="简略信息"
            :rules="[requiredRule]"
            variant="outlined"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="publishOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="publishing" variant="flat" @click="confirmPublish">确认发布</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
<script setup lang="ts">
  import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
  import { type DocumentModel, getDocumentByOne, publishDocument, saveDocument } from '@/utils/collection'
  const route = useRoute()
  const data = ref<DocumentModel>({} as DocumentModel)
  const loading = ref(false)
  const success = ref(false)
  const content = ref('')
  const id = ref('')
  const publishing = ref(false)
  const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
    show: false,
    text: '',
    color: 'success',
  })

  /** 统一提示（与其它页同款，避免到处手写 snackbar 三连） */
  function showHint (text: string, color: 'success' | 'error' | 'warning' = 'success') {
    hint.value = { show: true, text, color }
  }

  async function onSave (text: string, html: string) {
    loading.value = true
    success.value = false
    await saveDocument(text, data.value.id, data.value.published)
    loading.value = false
    success.value = true
  }
  async function getDates (id: string) {
    const dates = await getDocumentByOne(id)
    if (dates) {
      data.value = dates
      content.value = data.value.content
    }
    console.log(dates)
  }
  function hanldeFullScreenChange (isFullscreen: boolean) {
    isEditorFullscreen.value = isFullscreen
  }

  /** 发布弹窗：标题 + 简略信息（库里是 title / subscribe，也正是列表卡片显示的两项） */
  const publishOpen = ref(false)
  const publishForm = ref({ title: '', subscribe: '' })

  /** 两个输入都必填（"要求输入标题和简略信息"）：空 / 纯空白都算没填 */
  const requiredRule = (v: unknown) => String(v ?? '').trim() !== '' || '请填写'

  /** 当前要发布的那篇的 id（地址栏带的 id，与加载正文时同一份来源） */
  function targetIdOf (): string {
    return data.value.id || String(route.query.id ?? '').trim()
  }

  /**
   * 打开发布弹窗。
   *
   * 预填库里已有的 title / subscribe：改一下简介再发一次是很常见的操作，
   * 每次都让人重打一遍纯属折腾。
   * 没有 id（新增的文档还没落库）就没得发布 —— 现在没有 create 接口，提示先去保存。
   */
  function openPublish () {
    if (!targetIdOf()) {
      showHint('这篇文档还没有保存过（没有可发布的记录）：先在编辑器里按 Ctrl+S 保存', 'warning')
      return
    }
    publishForm.value = {
      title: String(data.value.title ?? '').trim(),
      subscribe: String(data.value.subscribe ?? '').trim(),
    }
    publishOpen.value = true
  }

  /**
   * 确认发布：写 **title + subscribe + published = 1**。
   *
   * 三项一起写：列表卡片显示的就是这两项，只置标记不写它们，列表里会出现"没名字的卡片"。
   * 成功后同步本地那份 —— ① 卡片文案立刻对上；② Ctrl+S 时 `onSave` 会把 `data.published`
   * 一起写回去，不同步就会把刚发布的标记又改回未发布。
   */
  async function confirmPublish () {
    const targetId = targetIdOf()
    if (!targetId) {
      publishOpen.value = false
      return
    }
    const title = publishForm.value.title.trim()
    const subscribe = publishForm.value.subscribe.trim()
    if (!title || !subscribe) {
      showHint('请填写标题与简略信息', 'warning')
      return
    }
    publishing.value = true
    try {
      const res = await publishDocument(targetId, { title, subscribe })
      if (res.code !== 0) {
        showHint(res.message, 'error')
        return
      }
      data.value.title = title
      data.value.subscribe = subscribe
      // 口径是 status（1 = 已发布）；published 只是保持同步的旧字段
      data.value.status = 1
      data.value.published = true
      publishOpen.value = false
      showHint('已发布（正文以最近一次保存为准）', 'success')
    } finally {
      publishing.value = false
    }
  }

  onMounted(async () => {
    id.value = route.query.id as string
    if (id.value) {
      await getDates(id.value)
    }
  })
</script>
