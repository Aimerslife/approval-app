<template>
  <!--
      不再是 persistent：ESC / 点遮罩 = 「返回」（不保存）——
      进得去出不来是硬伤（底部按钮在小屏上会被滚出视野）。
    -->
  <v-dialog
    max-width="1100"
    :model-value="visible"
    scrollable
    @after-enter="canvasReady = true"
    @update:model-value="onToggle"
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <!-- 返回放在**头部**：无论内容多长、滚动到哪儿，都退得出去 -->
        <v-btn prepend-icon="mdi-arrow-left" size="small" variant="text" @click="emit('close')">返回</v-btn>
        <v-spacer />

        <span class="dialog-sub">每个组都会把下面这段子流程走一遍</span>
      </v-card-title>

      <v-card-text>
        <div class="dialog-tip">
          轮询条件（组字段、排序、行条件、统计范围…）在画布上的**卡片**里直接修改；
          这里画的是"每个组各走一遍"的那段子流程。改完点「保存」，点「返回」则这次修改不生效。
        </div>

        <!--
          ⚠️ `v-if="canvasReady"`：**等对话框完全展开（after-enter）之后再挂载内部画布**。
          实测（同一组件、同一份数据、同一套 DOM 变换）：
            · 脱离对话框单独挂载 → 线的两端与圆点 x **完全一致** ✓；
            · 放进对话框（展开过程中挂载）→ 线的两端比圆点少约 **10% 的节点宽度**
              （300px 卡片偏 19px、58px 胶囊偏 3~4px，严格成比例）。
          差别只剩"挂载时机"：vue-flow 在对话框还没定型时量到的节点比它最终的样子窄，
          而且 `updateNodeInternals` 重算也救不回来（试过）。所以干脆等布局定下来再挂。
        -->
        <LoopCardCanvas
          v-if="canvasReady"
          class="mt-3"
          :graph="draft"
          :outer-approvals="outerApprovals"
        />
      </v-card-text>

      <v-card-actions>
        <span class="dialog-foot">{{ footNote }}</span>

        <v-spacer />

        <v-btn variant="text" @click="emit('close')">返回</v-btn>
        <v-btn color="primary" variant="flat" @click="save">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { LoopNodeData } from '@/types/approval'
  import type { CardGraph } from '@/utils/loopCardGraph'
  import LoopCardCanvas from '@/components/flow/LoopCardCanvas.vue'

  /**
   * 「组间轮询」卡片的**内部流程**编辑对话框。
   *
   * 分工（与"节点卡片上直接配"的既有习惯一致）：
   *   · 卡片（画布上）：轮询条件 —— 组字段 / 排序 / 汇总 / 上限 / 同团队 / 无组处理 / 行条件 / 统计范围；
   *   · 本对话框：内部那段子流程（小画布）—— 审批节点 / 条件分支 / 飞书提醒，每个组各走一遍。
   *
   * ⚠️ 编辑的是**草稿**（打开时深拷贝一份），点「保存」才写回卡片 ——
   *    否则「返回」和「保存」就只是两个一模一样的关闭按钮，标签会骗人。
   */
  const props = defineProps<{
    open: boolean
    /** 卡片数据（保存时把草稿写回它的 graph） */
    data: LoopNodeData
    /**
     * **卡片外**的审批环节（`{ id, label }`）：原样透传给内部画布，
     * 供内部连线选「提前结束轮询 → 跳到卡片外哪个环节」（见 LoopCardCanvas 的同名 prop）。
     */
    outerApprovals?: { id: string, label: string }[]
  }>()

  const emit = defineEmits<{
    close: []
  }>()

  /** 取卡片数据引用（绕开"直接改 prop"的告警，见项目里 roleOf / rotationOf 的同一写法） */
  function dataRef (): LoopNodeData {
    return props.data
  }

  /** 内部流程的草稿（打开对话框时从卡片深拷贝；小画布直接改它） */
  const draft = ref<CardGraph>({ nodes: [], edges: [] })

  /**
   * 深拷贝一份内部画布快照（**只用纯数据**）。
   *
   * 为什么不用 `structuredClone`（哪怕套了 `toRaw`）：
   *   `toRaw` 只脱掉**最外层**的 Proxy，里层仍可能是 Proxy —— 只要卡片数据里
   *   带过任何一层代理，克隆就抛 `DataCloneError: #<Object> could not be cloned.`。
   *   实测路径（点卡片内部「保存」之后再打开）：save() 把 draft（ref 里的响应式对象，
   *   本身就是 Proxy）写回了卡片 → 下次打开 resetDraft 克隆它 → 抛错 → 对话框崩掉。
   *   表现就是「保存后点不进去修改、重进页面又好了」——**只有保存会中招**，
   *   因为「返回」不写回卡片。而 Vue 的组件 setup 异常默认被吞，界面上**看不到报错**。
   *
   * JSON 往返对 Proxy 是安全的（`JSON.stringify` 会照常读值），且这里的数据本来就
   * 全是可 JSON 化的字段（画布快照：id / 节点 / 连线 / 视口）—— 项目里其他画布快照
   * （loadGraph、serializeGraph、FlowPreview）也都是这个写法。
   */
  function cloneGraph (g?: CardGraph): CardGraph {
    // eslint-disable-next-line unicorn/prefer-structured-clone -- 见上：Proxy 会让 structuredClone 抛 DataCloneError
    return g ? JSON.parse(JSON.stringify(g)) as CardGraph : { nodes: [], edges: [] }
  }

  function resetDraft () {
    draft.value = cloneGraph(props.data?.graph)
  }

  /*
   * 弹层可见性自己持一份（`:model-value="visible"`），由 props.open 同步过来：
   * 开关状态只有这一处驱动，父级只表达"该不该开" ——
   * 父级用 v-if 按需挂载本组件时，`open` 只在挂载那一刻传进来，这样更稳。
   * （说明：这不是本次「保存后打不开」的根因 —— 那个是 cloneGraph 里写的 DataCloneError，
   * 两者都已用真机复现验证过。）
   */
  const visible = ref(false)

  /**
   * 内部画布**什么时候挂载**：等对话框完全展开（`@after-enter`）之后。
   * 见模板上的实测说明 —— 在对话框展开过程中挂载，vue-flow 量到的节点会偏小（线端与圆点差 ~10%）。
   */
  const canvasReady = ref(false)

  // 每次打开都重新取一份草稿：否则第二次打开看到的还是上次那份
  watch(() => props.open, v => {
    visible.value = v
    // 每次开合都重新走一遍"展开完成再挂画布"，保证第一次和后面每次的表现一致
    canvasReady.value = false
    if (v) {
      resetDraft()
    }
  }, { immediate: true })

  /**
   * 保存：把草稿写回卡片（内部流程的快照），再关闭。
   *
   * ⚠️ 必须写**纯数据副本**，不能直接把 `draft.value` 交出去：
   *    它是 ref 里的响应式对象（Proxy），存进卡片后就成了卡片数据的一部分 ——
   *    下次打开克隆它时会抛 DataCloneError（见 cloneGraph 的说明），
   *    表现就是「保存后点不进去修改、重进页面又好了」。**问题的源头就在这一行。**
   */
  function save () {
    dataRef().graph = cloneGraph(draft.value)
    emit('close')
  }

  /** 点遮罩 / ESC 走这里：等同「返回」（不保存） */
  function onToggle (v: boolean) {
    // `:model-value` 是单向绑定，得自己接住更新 —— 否则点了遮罩也关不掉
    visible.value = v
    if (!v) {
      emit('close')
    }
  }

  const footNote = '内部环节的默认审批人是「本环的组负责人」（展开时按这一环轮到的组解析），可改成固定部门负责人或组织管理员'
</script>

<style lang="scss" scoped>
.dialog-title-text {
  font-size: 16px;
  font-weight: 600;
}

.dialog-sub,
.dialog-foot {
  font-size: 11px;
  font-weight: 400;
  color: #6b7280;
}

.dialog-tip {
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
}
</style>
