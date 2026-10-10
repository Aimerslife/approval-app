<template>
  <v-dialog max-width="1040" :model-value="visible" scrollable @update:model-value="onDialogInput">
    <v-card class="overflow-hidden" rounded="xl">
      <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
        <div class="d-flex align-center ga-2">
          <v-avatar color="#0d9488" size="28" variant="tonal">
            <v-icon icon="mdi-puzzle-outline" size="16" />
          </v-avatar>

          <span class="text-[15px] font-bold">引用模板预览</span>
          <v-chip v-if="record" label size="small" variant="tonal">{{ record.name || '（未命名模板）' }}</v-chip>
        </div>

        <v-icon-btn icon="mdi-close" size="small" variant="text" @click="close" />
      </v-card-title>

      <v-divider />

      <v-card-text class="px-6 py-5">
        <div v-if="loading" class="d-flex align-center ga-2 py-10 text-[13px] text-medium-emphasis">
          <v-progress-circular indeterminate size="18" width="2" />
          <span>正在读取源模板…</span>
        </div>

        <div v-else-if="error" class="d-flex align-center ga-2 py-10 text-[13px] text-error">
          <v-icon size="16">mdi-alert-circle-outline</v-icon>
          <span>{{ error }}</span>
        </div>

        <template v-else-if="record">
          <!--
            只读渲染**源模板自己**的画布（优先 graph，与模板管理页的预览同一份口径）。
            FlowPreview 自己会等宿主定型再挂画布（见它的 settleHost），
            所以这里不需要像 LoopCardDialog 那样手动等 @after-enter。
          -->
          <FlowPreview
            v-if="hasFlowData"
            :chain="record.chain?.chain"
            controls
            :flow="record.chain?.flow"
            :graph="record.chain?.graph"
            height="520px"
          />

          <!-- 记录在、但里面没有流程：说清楚，别给一片空白（那看着像"预览坏了"） -->
          <div v-else class="d-flex align-center ga-2 py-10 text-[13px] text-medium-emphasis">
            <v-icon size="16">mdi-information-outline</v-icon>
            <span>这张模板里还没有流程（没保存过内容）—— 去模板编辑器里画一段并保存后再来看</span>
          </div>

          <div v-if="hasFlowData" class="d-flex align-center flex-wrap ga-2 mt-3 text-[11px] text-medium-emphasis">
            <span>上面预览的是<b>源模板</b>本身（它的画布与分支）；建单时这一整段会被搬进当前流程。</span>

            <v-chip
              v-if="innerRefCount > 0"
              color="warning"
              label
              size="x-small"
              variant="tonal"
            >
              这张模板里还有 {{ innerRefCount }} 处「引用模板」，建单时会一并展开
            </v-chip>
          </div>
        </template>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-6 py-3">
        <v-btn v-if="record" size="small" variant="text" @click="openSourceTemplate">
          在新标签页打开源模板
        </v-btn>

        <v-spacer />
        <v-btn color="primary" variant="flat" @click="close">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ApprovalModal } from '@/types/approval'
  import FlowPreview from '@/components/FlowPreview.vue'
  import { getApprovalOne } from '@/utils/collection'
  // 数一数源模板里还有几处引用（纯逻辑），给作者一句"还会一起展开"的提示
  import { collectTemplateRefs } from '@/utils/templateRef'

  /**
   * 「引用模板」卡片的**展开预览**：只读看一眼源模板里到底有什么。
   *
   * 为什么需要它：引用卡片按设计**不显示**被引用的流程（内容只有一份，在源模板里），
   * 于是"我到底引了啥"在画布上完全看不到 —— 这个弹窗就是补这一眼，
   * 让作者不必离开编辑器去模板管理页翻。
   *
   * 预览**只读**，也不会把展开结果写回任何地方：
   * 真正"展开"发生在**建单那一刻**（见 utils/templateRef），这里只是给你看清楚。
   */
  const props = defineProps<{
    /** 打开状态（`v-if` 挂在父级，这里只做受控显隐） */
    open: boolean
    /** 要预览的**源模板** id */
    templateId: string
  }>()

  const emit = defineEmits<{
    'close': []
    /**
     * 想在新标签页打开源模板（父级处理跳转）。
     * 事件名用 **kebab**（`vue/custom-event-name-casing`）：项目里多词事件一律这个写法
     * （如 ConditionNode 的 `branch-click`、EdgeOptionTreeDialog 的 `update:model-value`）。
     */
    'open-template': [templateId: string]
  }>()

  /** 与 LoopCardDialog 同一套受控写法：对外只读 props.open，自己维护内部显隐 */
  const visible = ref(props.open)
  watch(() => props.open, v => {
    visible.value = v
    if (v) {
      void load()
    }
  })

  const loading = ref(false)
  const error = ref('')
  const record = ref<ApprovalModal | null>(null)

  /*
   * 首次加载放在 onMounted，**不能**写成 `watch(..., { immediate: true })`：
   * immediate 的回调在 **setup 阶段**就执行，而 load() 里要写上面那几个 ref ——
   * 那一刻它们还没初始化，会命中 TDZ（`Cannot access 'loading' before initialization`），
   * 组件挂载直接失败、弹窗里一片空白（踩过，就是这次"展开预览空白"的原因）。
   */
  onMounted(() => {
    if (props.open) {
      void load()
    }
  })

  /** 换了一张源模板（父级复用同一个弹窗实例时）重新加载 */
  watch(() => props.templateId, () => {
    if (props.open) {
      void load()
    }
  })

  /** 源模板里还嵌套了几处引用（提示用；纯逻辑，读不到记录时为 0） */
  const innerRefCount = computed(() => collectTemplateRefs(record.value?.chain?.flow).length)

  /**
   * 这条记录里到底有没有可画的东西。
   *
   * 为什么单独判一次：`FlowPreview` 在没有 graph / flow / chain 时会把画布画成**空白的**，
   * 看着像"预览坏了"。这种记录确实存在（模板建了但没保存过流程），
   * 与其给一片空白，不如直接说清楚该怎么办。
   */
  const hasFlowData = computed(() => {
    const chain = record.value?.chain
    return Boolean(chain?.graph?.nodes?.length || chain?.flow?.length || chain?.chain?.length)
  })

  async function load () {
    if (!props.templateId) {
      error.value = '这张卡片还没有选择源模板'
      return
    }
    loading.value = true
    error.value = ''
    record.value = null
    try {
      const rec = await getApprovalOne(props.templateId)
      if (!rec) {
        /*
         * 读不到就是一句人话，不区分"被删了"还是"这次没读到" ——
         * 但两句都要提示"去模板管理页确认一下"，因为这两种情况用户要做的事不同却又都可能。
         */
        error.value = '读不到这张模板：可能已被删除，或当前网络 / 权限异常（请到模板管理页确认）'
        return
      }
      record.value = rec
    } finally {
      loading.value = false
    }
  }

  function close () {
    emit('close')
  }

  function openSourceTemplate () {
    emit('open-template', props.templateId)
  }

  /** 点遮罩 / ESC 关闭（v-dialog 的受控写法：false 时向外抛 close） */
  function onDialogInput (v: boolean) {
    if (!v) {
      close()
    }
  }
</script>
