<template>
  <v-container class="p-8" fluid>
    <div class="d-flex align-center gap-1 mb-3 justify-between">
      <BackNode :title="id ? '修改文档' : '新增文档'"/>

      <div class="d-flex align-center ga-2">
        <!--
          暗色开关。翻的是**全局**主题（theme.global.name），与 App.vue 顶栏那个按钮
          是同一份状态、同一份 localStorage 'app-theme' —— 所以编辑器、预览、整页一起切，
          也不会出现"顶栏亮着、编辑器黑着"的错位。
        -->
        <v-btn size="small" variant="tonal" @click="toggleTheme">
          <v-icon start size="16">{{ isDark ? 'mdi-weather-night' : 'mdi-white-balance-sunny' }}</v-icon>
          {{ isDark ? '暗色' : '亮色' }}
        </v-btn>

        <v-btn color="primary" size="small" variant="flat" @click="openPublish">发布</v-btn>
      </div>
    </div>

    <!--
      md-editor-v3（v7）—— 取代原来的 @kangc/v-md-editor。

      不传 toolbars = 用它的 allToolbar，也就是**完整工具栏**：
        bold / underline / italic / strikeThrough / title / sub / sup / quote /
        unorderedList / orderedList / task / codeRow / code / link / image / table /
        mermaid / katex / revoke / next / save / prettier / pageFullscreen / fullscreen /
        preview / previewOnly / htmlPreview / catalog
      只把 github 剔掉 —— 那是跳到编辑器自己仓库的外链，内部系统里没有意义。
      （prettier / echarts 两个按钮单独关掉，本仓库没装这两个依赖，留着点了会抛错。）

      几个关键 prop：
        · theme        'light' | 'dark'（**不是** 'default'，见 lib/types 里的 Themes）
        · previewTheme 'github'，跟原来那套 v-md-editor 的观感保持一致
        · codeTheme    亮色用 github、暗色用 atom（后者本身就是深色底）
        · style        高度沿用旧版的 87vh

      回调是 **prop 不是 emit**（包里的声明是 `editorProps.onSave`），
      所以写 `:on-save` 而不是 `@on-save`。
    -->
    <v-sheet class="z-1000">
      <MdEditor v-model="content" :code-theme="isDark ? 'atom' : 'github'" :footers="editorFooters" :language="'zh-CN'"
        :no-echarts="true" :no-prettier="true" :on-save="onSave" :on-upload-img="onUploadImg"
        :preview-theme="'github'" :show-code-row-number="true" :style="{ height: editorHeight }"
        :theme="isDark ? 'dark' : 'light'" :toolbars-exclude="['github']" />
    </v-sheet>

    <v-layout min-height="100">
      <v-snackbar v-model="loading" contained loading text="保存中" :timeout="-1" />

      <v-snackbar v-model="success" color="success" contained prepend-icon="$complete" text="已保存!" :timeout="2000" />

      <!-- 发布 / 未发布等结果提示（与其它页同款 snackbar 形状） -->
      <v-snackbar v-model="hint.show" :color="hint.color" contained :text="hint.text" :timeout="3000" />
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

          <v-text-field v-model="publishForm.title" density="compact" hide-details="auto" label="标题"
            :rules="[requiredRule]" variant="outlined" />

          <v-text-field v-model="publishForm.subscribe" class="mt-3" density="compact" hide-details="auto" label="简略信息"
            :rules="[requiredRule]" variant="outlined" />
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
import { type Footers, MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useTheme } from 'vuetify'
import BackNode from '@/components/BackNode.vue'
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
function showHint(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  hint.value = { show: true, text, color }
}

/* ============================ 主题（明 / 暗） ============================ */

const theme = useTheme()
/** 当前是否暗色。编辑器 / 预览 / 代码高亮三处都跟着它走 */
const isDark = computed(() => theme.global.name.value === 'dark')

/**
 * 切换明暗。与 App.vue 顶栏那个按钮**完全同源**：翻全局主题 + 记进 localStorage，
 * 刷新后仍生效（App.vue 启动时读的就是这个键）。
 */
function toggleTheme() {
  const next = isDark.value ? 'light' : 'dark'
  theme.global.name.value = next
  localStorage.setItem('app-theme', next)
}

/* ============================ 编辑器配置 ============================ */

/** 编辑器高度：沿用旧版 v-md-editor 的 87vh，与顶部按钮行、页面留白大致齐平 */
const editorHeight = '87vh'

/**
 * 底部状态栏：字数统计 / 分隔符 / 「跟随滚动」开关。
 * 这三个就是 md-editor-v3 的默认组合（见类型里的 Footers），显式写出来是为了将来好改。
 */
// 组件 prop 要的是可变的 `Footers[]`，所以这里标注类型而不是 `as const`（只读元组赋不过去）
const editorFooters: Footers[] = ['markdownTotal', '=', 'scrollSwitch']

/**
 * 图片上传。
 *
 * ⚠️ 现在**没有后端可传**：`document` 集合只有 title / content / subscribe 这几列，
 * 没有 file 字段（见 pocketbase/pb_migrations/*document*）。所以这里把文件读成 dataURL
 * 直接插进正文 —— 「上传图片」这条链是通的，代价是 base64 会一起存进 content。
 *
 * 以后要真上传：给 document 集合加一个 file 字段，把下面换成 pb 的 FormData 上传，
 * 再 `callback([pb.files.getURL(record, filename)])` 即可。回调签名是
 * `(files: File[], callback: (urls: string[] | {url,alt,title}[]) => void) => void`。
 */
function onUploadImg(files: File[], callback: (urls: string[]) => void) {
  Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  }))).then(callback).catch(() => showHint('图片读取失败，请重试', 'error'))
}

/**
 * 保存正文（编辑器里 Ctrl+S，或工具栏的保存按钮）。
 *
 * id 用 `targetIdOf()` 而不是 `data.value.id`：读单条失败时 `data` 还是 `{}`，
 * 那一刻只有地址栏的 id 可用 —— 用 `data.value.id` 等于拿空 id 去写，必然失败。
 *
 * 结果按 `code` 分岔：`saveDocument` 失败时**不能**再弹「已保存!」（那是静默失败），
 * 否则用户以为存住了，回头一看内容没了。
 */
async function onSave(text: string) {
  const targetId = targetIdOf()
  if (!targetId) {
    showHint('这篇文档还没有保存过（没有可写入的记录）：请从列表页进入已有文档再改', 'warning')
    return
  }
  loading.value = true
  success.value = false
  try {
    const res = await saveDocument(text, targetId, data.value.published)
    if (res.code !== 0) {
      showHint(res.message, 'error')
      return
    }
    success.value = true
  } finally {
    loading.value = false
  }
}
async function getDates(id: string) {
  const dates = await getDocumentByOne(id)
  if (dates) {
    data.value = dates
    content.value = data.value.content
  }
  console.log(dates)
}

/*
 * 这里原来有个 `@fullscreen-change` 回调，用来把 isEditorFullscreen 置位、
 * 好让 App.vue 把顶栏和侧边栏 v-show 掉。换成 md-editor-v3 后不需要了：
 * 它的全屏是 `position: fixed; inset: 0; z-index: 10000`（见 lib/style.css 的
 * .md-editor-fullscreen），已经压住顶栏(1000)、侧边栏(1004) 与菜单浮层(2400+)，
 * 不需要再靠隐藏布局给它腾地方。
 */

/** 发布弹窗：标题 + 简略信息（库里是 title / subscribe，也正是列表卡片显示的两项） */
const publishOpen = ref(false)
const publishForm = ref({ title: '', subscribe: '' })

/** 两个输入都必填（"要求输入标题和简略信息"）：空 / 纯空白都算没填 */
const requiredRule = (v: unknown) => String(v ?? '').trim() !== '' || '请填写'

/** 当前要发布的那篇的 id（地址栏带的 id，与加载正文时同一份来源） */
function targetIdOf(): string {
  return data.value.id || String(route.query.id ?? '').trim()
}

/**
 * 打开发布弹窗。
 *
 * 预填库里已有的 title / subscribe：改一下简介再发一次是很常见的操作，
 * 每次都让人重打一遍纯属折腾。
 * 没有 id（新增的文档还没落库）就没得发布 —— 现在没有 create 接口，提示先去保存。
 */
function openPublish() {
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
async function confirmPublish() {
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
