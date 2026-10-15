<template>
  <v-container fluid>
    <div class="mb-4 mt-3">
      <div class="block-title">文档列表</div>
      <div class="m-2 text-[12px] text-[#8D8D8D]">本页面包含</div>
    </div>

    <div class="d-flex align-center gap-2 flex-wrap">
      <v-card v-for="item in data" :key="item.id" border class="p-1" max-width="400" min-width="300" rounded="5px"
        variant="flat">
        <v-card-title class="text-[13px] d-flex align-center gap-2">
          <div class="card-border p-1 rounded-2">
            <v-icon size="25">mdi-podium-silver</v-icon>
          </div>

          <div class="d-flex flex-col gap-0.5">
            <span>{{ item.title }}</span>
            <span class="text-[11px] text-[#8D8D8D]">{{ formatDate(item.created) }}</span>
          </div>

          <v-spacer />
          <v-icon>mdi-dots-vertical</v-icon>
        </v-card-title>

        <v-card-text>
          <div class="text-[12px] text-[#8D8D8D]">{{ item.subscribe }}</div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="d-flex justify-between">
          <!-- 详情：带上这一篇的 id 跳 /logic，那边按 query.id 读它（见 pages/logic.vue） -->
          <v-btn size="small" text="详情" @click="goDetail(item)" />

          <!-- 删除：先弹确认（删掉不可恢复），确认后走 utils/collection 的 deleteDocument -->
          <v-btn color="error" icon="mdi-trash-can" size="small" @click="askDelete(item)" />
        </v-card-actions>
      </v-card>

      <div v-if="data.length === 0" class="m-2 text-[12px] text-[#8D8D8D]">
        {{ loading ? '正在读文档…' : '还没有文档' }}
      </div>
    </div>

    <v-fab app color="primary" location="right bottom" size="default" @click="goAdd">新增</v-fab>

    <!-- 删除确认：库里删掉就没了，所以不提供"误点即删" -->
    <v-dialog v-model="confirmDelete" max-width="420">
      <v-card>
        <v-card-title class="text-[15px]">删除这篇文档？</v-card-title>

        <v-card-text class="text-[13px]">
          「{{ pending?.title || '(未命名文档)' }}」删除后不能恢复。
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDelete = false">取消</v-btn>
          <v-btn color="error" :loading="deleting" variant="flat" @click="runDelete">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="hint.show" :color="hint.color" location="top" timeout="3000" variant="tonal">
      {{ hint.text }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { deleteDocument, type DocumentModel, getDocument } from '@/utils/collection'
import { formatDate } from '@/utils/utils'

const router = useRouter()
const data = ref<DocumentModel[]>([])
const loading = ref(false)
const deleting = ref(false)
/** 待删除的那一篇（确认弹窗里显示标题，也保证"删的就是点的那篇"） */
const pending = ref<DocumentModel | null>(null)
const confirmDelete = ref(false)
const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
  show: false,
  text: '',
  color: 'success',
})

/** 统一提示（与其它页同款，避免到处手写 snackbar 三连） */
function showHint(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  hint.value = { show: true, text, color }
}

async function getDates() {
  loading.value = true
  try {
    data.value = (await getDocument()) ?? []
  } finally {
    loading.value = false
  }
}

function goAdd() {
  router.push('/editRule')
}
onMounted(() => {
  void getDates()
})

/**
 * 详情：把这一篇的 id 带过去。
 *
 * 以前是 `router.push('/logic')`（不带 id），而 /logic 读的是列表第一条 ——
 * 于是"点哪一篇都打开同一篇"，标题对不上内容。
 */
function goDetail(item: DocumentModel) {
  router.push({
    path: '/logic',
    query: {
      id: item.id,
    },
  })
}

/** 删除第一步：先把要删的那篇记下来、弹确认 */
function askDelete(item: DocumentModel) {
  pending.value = item
  confirmDelete.value = true
}

/**
 * 删除第二步：真删 + 刷新列表。
 *
 * `deleteDocument` 返回 `{ code, message }`（与 deleteApproval 同一口径）：
 * 失败时**不能**当成删成功 —— 提示失败原因并保留列表，否则用户只会看到"删了还在"。
 */
async function runDelete() {
  const item = pending.value
  if (!item) {
    return
  }
  deleting.value = true
  try {
    const res = await deleteDocument(item.id)
    if (res.code !== 0) {
      showHint(res.message, 'error')
      return
    }
    confirmDelete.value = false
    pending.value = null
    showHint('文档已删除', 'success')
    await getDates()
  } finally {
    deleting.value = false
  }
}
</script>
