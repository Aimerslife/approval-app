<template>
  <div class="card-canvas">
    <div class="card-canvas__bar">
      <v-btn
        color="primary"
        prepend-icon="mdi-account-check"
        size="small"
        variant="tonal"
        @click="addNode('approval')"
      >
        审批节点
      </v-btn>

      <v-btn
        color="warning"
        prepend-icon="mdi-source-branch"
        size="small"
        variant="tonal"
        @click="addNode('condition')"
      >
        条件分支
      </v-btn>

      <v-btn
        color="info"
        prepend-icon="mdi-bell-ring-outline"
        size="small"
        variant="tonal"
        @click="addNode('notify')"
      >
        飞书提醒
      </v-btn>

      <span class="card-canvas__hint">{{ hint || '这里的环节，每个组各走一遍' }}</span>
    </div>

    <div class="card-canvas__stage flow-canvas">
      <VueFlow
        :id="flowId"
        v-model:edges="edges"
        v-model:nodes="nodes"
        :connection-radius="30"
        :delete-key-code="['Backspace', 'Delete']"
        fit-view-on-init
        :max-zoom="1.6"
        :min-zoom="0.4"
        @connect="onConnect"
        @edge-click="onEdgeClick"
        @node-click="onNodeClick"
        @pane-click="clearSelection"
      >
        <Background :gap="16" />
        <Controls position="bottom-left" />

        <template #node-start="{ id }">
          <StartEndNode :key="id" kind="start" />
        </template>

        <template #node-end="{ id }">
          <StartEndNode :key="id" kind="end" />
        </template>

        <!-- 审批 / 提醒复用主画布同一批卡片组件：成员、动态负责人、删除全都能用 -->
        <template #node-approval="{ id, data, selected }">
          <ApprovalNode
            :active-edge-id="selectedEdgeId"
            :branches="outBranches(id)"
            :data="data"
            :selected="selected"
            @add-member="addLeaderTo(id)"
            @add-role="addRoleMemberTo(id)"
            @branch-click="selectBranch"
            @remove="removeNodeById(id)"
          />
        </template>

        <template #node-condition="{ id, selected }">
          <ConditionNode
            :active-edge-id="selectedEdgeId"
            :branches="branchesOf(id)"
            :selected="selected"
            @branch-click="selectBranch"
            @remove="removeNodeById(id)"
          />
        </template>

        <template #node-notify="{ id, data, selected }">
          <ApprovalNode
            :active-edge-id="selectedEdgeId"
            :branches="outBranches(id)"
            :data="data"
            kind="notify"
            :selected="selected"
            @add-member="addLeaderTo(id)"
            @add-role="addRoleMemberTo(id)"
            @branch-click="selectBranch"
            @remove="removeNodeById(id)"
          />
        </template>

        <!--
          手动拖拽曲线（自定义类型 adjustable）：与主画布 / 预览页同一接法。
          不注册它的话，选了「手动拖拽曲线」这条线就画不出来（vue-flow 找不到该类型就退回默认）。
        -->
        <template #edge-adjustable="edgeProps">
          <AdjustableEdge
            v-bind="(edgeProps as any)"
            :interactive="true"
            @update-cp="onEdgeCpUpdate((edgeProps as any).id, $event)"
          />
        </template>
      </VueFlow>
    </div>

    <div v-if="selectedEdge" class="card-canvas__edge">
      <!--
        线条形状：与主画布**同一份清单**（src/utils/edgeStyles.ts），五种里挑一种。
        只影响画布怎么画，随卡片快照一起持久化（serializeGraph 会带上 type / pathOptions / data）。
      -->
      <div class="edge-row">
        <span class="edge-label">线条形状</span>

        <select v-model="edgeShape" class="edge-input" style="width: 148px">
          <option v-for="s in EDGE_STYLES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>

        <template v-if="edgeShape === 'default'">
          <span class="edge-label" title="0 = 接近直线，1 = 弯曲最明显">弯曲程度</span>

          <input
            v-model.number="edgeCurvature"
            class="edge-range"
            max="1"
            min="0"
            step="0.05"
            type="range"
          >

          <span class="edge-note">{{ edgeCurvature.toFixed(2) }}</span>
        </template>

        <template v-else-if="edgeShape === 'smoothstep'">
          <span class="edge-label">圆角大小</span>

          <input
            v-model.number="edgeBorderRadius"
            class="edge-range"
            max="30"
            min="0"
            step="1"
            type="range"
          >

          <span class="edge-note">{{ Math.round(edgeBorderRadius) }}</span>
        </template>

        <span v-else-if="edgeShape === 'adjustable'" class="edge-note">拖动线上的圆点可绕开交叉，双击复位</span>
      </div>

      <div class="edge-row">
        <span class="edge-label">走向</span>

        <select v-model="edgeExitMode" class="edge-input" style="width: 160px">
          <option value="end">这一环结束（继续下一组）</option>
          <option :disabled="outerList.length === 0" value="jump">提前结束轮询 → 跳到外面</option>
        </select>

        <template v-if="edgeExitMode === 'jump'">
          <select v-model="edgeExitTo" class="edge-input" style="width: 196px">
            <option value="">{{ emptyTargetText }}</option>
            <optgroup v-if="earlyList.length" label="卡片上的「提前跳出」线">
              <option v-for="e in earlyList" :key="e.id" :value="e.targetId">
                {{ e.label }}{{ outerLabelOf(e.targetId) }}
              </option>
            </optgroup>
            <optgroup label="卡片外的环节">
              <option v-for="t in outerList" :key="t.id" :value="t.id">{{ t.label }}</option>
            </optgroup>
          </select>
        </template>

        <span v-if="edgeExitMode === 'jump'" class="edge-note">{{ jumpNote }}</span>
        <span v-else-if="outerList.length === 0" class="edge-note">外面还没有可跳的环节</span>
      </div>

      <!--
        「审批结论」：审批环节分出来的支**可以**绑定一个结论（引擎按结论选路），
        卡片内部最经典的写法「通过 → 这一环结束 / 驳回 → 这一环结束」就是这种支。

        **也可以不绑**：直接在下面给这条线写条件（业务字段 / 办理期字段，如
        `confirmed = 接收`、`剩余接收数量 > 0`、`qty > 100`）—— 引擎选路时会带上
        办理人填的值，条件命中即走这条线（见 utils/approvalFlow 的校验说明）。
        数据格式与 pages/createStream.vue 的 selectedEdgeResult 完全一致：
          · 选一个结论 = 替换 conditions 里的 { field:'result', op:'eq', value }，并顺手把结论文案当分支名；
          · 选「主线」 = 去掉结论条件（无条件 → 通过 / 其它结论未命中时走它）。
      -->
      <div v-if="edgeIsResult" class="edge-row">
        <span class="edge-label">审批结论</span>

        <select v-model="edgeResult" class="edge-input" style="width: 168px">
          <option value="">主线（通过 / 其它结论未命中时走这条）</option>
          <option v-for="r in APPROVAL_RESULTS" :key="r.value" :value="r.value">{{ r.label }}</option>
        </select>

        <!--
          选项树（类别 → 一级 + 二级，与主画布同一口径 / 同一个组件）**不在面板里铺开** ——
          三层结构会把卡片面板一路撑长，所以整块搬进弹出框（EdgeOptionTreeDialog），
          这里只留一个入口按钮。
          ⚠️ 配置是**本审批环节共用的一份**（存在节点上）：本环节各条结果分支点开看到的都是它；
          且只在本环节已形成结果分支（≥2 条出线）时才有意义 —— 见 edgeHasResultBranches。
        -->
        <button v-if="edgeHasResultBranches" class="edge-btn"
          title="配置本审批环节的办理选项（类别 → 一级 → 二级；一级的「实际链路」决定实际走哪条线）；同一环节的各条结果分支共用这一份"
          @click="optionDialog = true">
          <v-icon size="11">mdi-format-list-bulleted-type</v-icon>
          <span>配置选项{{ optionSummary }}</span>
        </button>

        <span class="edge-note">绑结论不是必须的：也可以在下面直接写业务 / 办理期字段的条件</span>
      </div>

      <div class="edge-row">
        <span class="edge-label">分支名</span>
        <input v-model="selectedEdgeLabel" class="edge-input" placeholder="如 A组走财务">

        <span class="edge-label ml-3">满足</span>

        <select v-model="edgeLogic" class="edge-input" style="width: 92px">
          <option value="and">全部条件</option>
          <option value="or">任一条件</option>
        </select>
      </div>

      <div v-for="(c, i) in conditions" :key="i" class="edge-row">
        <!-- 左值：普通情况是字段下拉；配了运算时显示表达式（点铅笔改，见 openMath） -->
        <div v-if="c.lhsExpr" class="edge-expr" :title="c.lhsExpr" @click="openMath(c)">{{ c.lhsExpr }}</div>
        <input v-else v-model="c.field" class="edge-input" list="card-field-options"
          placeholder="字段，如 当前环节对应的组别">

        <!-- 运算：把几个字段加减乘除后再比较（结论码不参与，见主画布 opsFor 的说明） -->
        <v-icon-btn v-if="!isResultCondition(c)" class="ml--2" size="x-small"
          title="编辑运算：用几个字段做加减乘除再比较" variant="text"
          :color="c.lhsExpr ? 'primary' : undefined" @click="openMath(c)">
          <v-icon size="12">mdi-pencil</v-icon>
        </v-icon-btn>

        <select v-model="c.op" class="edge-input" style="width: 84px">
          <option value="eq">等于</option>
          <option value="ne">不等于</option>
          <option value="gt">大于</option>
          <option value="gte">大于等于</option>
          <option value="lt">小于</option>
          <option value="lte">小于等于</option>
          <option value="contains">包含</option>
        </select>

        <!--
          值一侧也给候选（与主画布同一套「@字段名」引用写法）：
          之前的版本这里是裸输入框，对比"另一个字段的值"只能靠手打字段名，写错一个字母就永远不命中。
          下拉里给的是 `@剩余接收数量` 这类引用；要写常量（如 5000、美2组）直接手打即可。
        -->
        <input v-model="c.value" class="edge-input" list="card-field-ref-options" placeholder="值 / @引用字段">

        <button class="edge-del" title="删除这条条件" @click="removeCondition(c)">✕</button>
      </div>

      <datalist id="card-field-options">
        <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </datalist>

      <!--
        条件**值**侧的候选：带 @ 前缀的「引用另一字段」写法（见 types/approval 的 FIELD_REF_PREFIX）。
        不复用上面那个 datalist —— 它给的是字段名本身，直接选进 value 会变成
        "总库存金额 == 总库存金额" 这种常量比较，而不是引用。
      -->
      <datalist id="card-field-ref-options">
        <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="FIELD_REF_PREFIX + f.value">{{ f.label }}</option>
      </datalist>

      <div class="edge-row">
        <button class="edge-add" @click="addCondition">+ 条件</button>
        <span class="edge-note">无条件 = 兜底分支</span>
      </div>
    </div>

    <div v-else-if="selectedNode" class="card-canvas__edge">
      <!--
        选中**环节**（而不是某条线）时的面板：按环节一次设置它的**全部出线形状**。

        为什么要有它：审批环节配了多个办理选项时，几条线都从同一个出线点出发，天然会交织在一起；
        而逐条改得先"点中那条线" —— 线叠在一起时恰恰点不准（面板又只在对选中那条线时出现）。
        这里一次改完，单条微调仍走上面那个「线条形状」（点线后出现）。
      -->
      <div class="edge-row">
        <span class="edge-label">环节</span>
        <span class="edge-node">{{ selectedNodeTitle }}</span>
        <span class="edge-note">{{ selectedNodeOutEdges.length }} 条出线</span>
      </div>

      <div class="edge-row">
        <span class="edge-label">出线形状</span>

        <select
          v-model="nodeEdgeShape"
          class="edge-input"
          :disabled="selectedNodeOutEdges.length === 0"
          style="width: 148px"
          title="一次改这个环节的全部出线；单条微调请点那条线，在上面的面板里改"
        >
          <!-- 各条出线形状不一致时的**状态**（不是一种可选形状，所以不可选） -->
          <option v-if="nodeEdgeShape === ''" disabled value="">多条不一致</option>
          <option v-for="s in EDGE_STYLES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>

        <span v-if="selectedNodeOutEdges.length === 0" class="edge-note">这个环节还没有出线</span>
        <span v-else-if="nodeEdgeShape === 'adjustable'" class="edge-note">拖动线上的圆点可绕开交叉，双击复位</span>
        <span v-else class="edge-note">多条选项叠在一起时，先整体换成「圆角折线」这类走向更清楚</span>
      </div>
    </div>

    <!--
      办理下拉的选项配置：整棵选项树（类别 → 一级 → 二级）在弹出框里编辑，
      面板上只留「配置选项」按钮当入口（与主画布同一口径 / 同一个组件）。
    -->
    <EdgeOptionTreeDialog :link-options="edgeLinkOptions" :model-value="edgeOptionGroups" :open="optionDialog"
      @close="optionDialog = false" @update:model-value="commitEdgeOptionGroups" />

    <!-- 条件左值的四则运算：与主画布共用同一个弹窗（语法检查 / 字段候选都在组件里） -->
    <ConditionMathDialog :expr="mathExpr" :fields="FIELD_OPTIONS" :open="mathOpen" @close="mathOpen = false"
      @save="applyMath" />
  </div>
</template>

<script lang="ts" setup>
  import type { CardGraph } from '@/utils/loopCardGraph'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { type Connection, VueFlow } from '@vue-flow/core'
  import AdjustableEdge from '@/components/flow/AdjustableEdge.vue'
  import ApprovalNode from '@/components/flow/ApprovalNode.vue'
  import ConditionNode from '@/components/flow/ConditionNode.vue'
  import EdgeOptionTreeDialog from '@/components/flow/EdgeOptionTreeDialog.vue'
  // 条件左值的「四则运算」弹窗：与主画布共用同一个（校验与候选只写一处）
  import ConditionMathDialog from '@/components/flow/ConditionMathDialog.vue'
  import StartEndNode from '@/components/flow/StartEndNode.vue'
  import {
    APPROVAL_RESULTS,
    type ApprovalOptionGroup,
    type BranchCondition,
    type ConditionExpr,
    collapseConditionValue,
    FIELD_REF_PREFIX,
    isConditionGroup,
    isResultCondition,
    uid,
  } from '@/types/approval'
  // 条件字段候选：与主画布共用同一份（见 utils/conditionFields 的文件头）
  import { CONDITION_FIELD_OPTIONS } from '@/utils/conditionFields'
  // 条件左值的四则运算：语法由弹窗查，这里只要"表达式里第一个变量是谁"
  import { parseArithmetic } from '@/utils/conditionMath'
  // 连线形状清单：与主画布共用同一份（别在这里再写一份，否则两处的五种会走偏）
  import { applyEdgeShape, DEFAULT_EDGE_BORDER_RADIUS, DEFAULT_EDGE_CURVATURE, EDGE_STYLES } from '@/utils/edgeStyles'

  const props = defineProps<{
    /** 卡片内部的画布快照（直接改它 —— 与项目里"父子共享同一引用"的写法一致） */
    graph: CardGraph
    /**
     * **卡片外**能跳过去的环节（`{ id, label }`）：供内部分支配「提前结束轮询 → 跳到哪个环节」。
     * 由 createStream 传入（utils/exitTargets：审批 / 提醒 / 引用模板 / 轮询，
     * 与主画布 exitTargets、保存期白名单同一份口径）。
     * 没传 = 外面没有可选环节 → 控件禁用并提示，而不是给一个选了也没用的空下拉。
     */
    outerApprovals?: { id: string, label: string }[]
    /**
     * 卡片上已经接出去的**「提前跳出」出线**（可以多条）。
     *
     * 只作**快捷候选**：选它就等于选了它连到的那个环节（数据仍写 `edge.data.exitTo` =
     * 目标环节 id，见 createStream 的 loopCardEarlyExitsFor）。多条线时这一份尤其有用 ——
     * 卡片上叫「提前跳出2」的那条，在这里一眼能看出它到底通向哪。
     */
    earlyExits?: { id: string, label: string, targetId: string }[]
  }>()

  /** 可选的外部目标（缺省空数组，模板里不用到处判 undefined） */
  const outerList = computed(() => props.outerApprovals ?? [])

  /** 卡片上的提前跳出线（同上，缺省空数组） */
  const earlyList = computed(() => props.earlyExits ?? [])

  /** 提前跳出线的名字后面补上它通向的环节名，避免"提前跳出2 到底去哪" */
  function outerLabelOf (id: string): string {
    const t = outerList.value.find(x => x.id === id)
    return t ? ` → ${t.label}` : ''
  }

  /**
   * 目标留空时的占位文案。
   *
   * 只有**恰好一条**提前跳出线时留空才合法（用那条的目标）；多条时留空必然报错
   * （见 utils/loopCardGraph），所以占位直接改成"请选择"，别给人留一个会失败的默认值。
   */
  const emptyTargetText = computed(() =>
    earlyList.value.length > 1 ? '请选择目标环节（卡片有多条提前跳出线）' : '用卡片上的「提前跳出」出线',
  )

  const jumpNote = computed(() =>
    earlyList.value.length > 1
      ? `这一组办完就不再往后轮；卡片接了 ${earlyList.value.length} 条「提前跳出」线，必须指明跳到哪一条`
      : '这一组办完就不再往后轮；目标留空 = 用卡片上那条「提前跳出」出线',
  )

  /**
   * 画布实例 id：**必须**用它自己的 store。
   *
   * 主画布用的是默认 store（createStream 的 `useVueFlow()` 没带 id），这里不给 id 就会跟主画布
   * **共用同一份 nodes/edges** —— 两边的节点会串在一起（"卡片里一加节点，主画布上也冒出来"）。
   * 与 FlowPreview.vue 同一套做法（那里也是多实例共存）。
   */
  const flowId = `loop-card-${uid()}`

  const nodes = ref<any[]>(props.graph?.nodes ?? [])
  const edges = ref<any[]>(props.graph?.edges ?? [])

  /**
   * 拿到卡片数据的引用。
   *
   * 为什么要绕一层：**直接**改 prop（`props.graph.nodes = …`）会被 `vue/no-mutating-props` 拦下，
   * 而"父子共享同一引用、就地改"是这个项目的既定写法（见 ApprovalNode 的 roleOf / rotationOf）。
   * 这里改成"先取引用再改"，语义完全一样。
   */
  function graphRef (): CardGraph | null {
    return (props as { graph?: CardGraph }).graph ?? null
  }

  /** vue-flow 的改动（拖动 / 连线 / 删除）写回卡片数据，随画布快照一起持久化 */
  watch([nodes, edges], () => {
    const g = graphRef()
    if (!g) {
      return
    }
    g.nodes = nodes.value
    g.edges = edges.value
  }, { deep: true })

  const selectedEdgeId = ref<string | null>(null)
  const selectedEdge = computed(() => edges.value.find(e => e.id === selectedEdgeId.value) ?? null)

  /** 选中的**环节**（点卡片选中）：面板切成"按环节改它全部出线的形状"，见模板那段 */
  const selectedNodeId = ref<string | null>(null)

  /** 一句临时提示（卡片内部不支持轮询之类） */
  const hint = ref('')
  let hintTimer: ReturnType<typeof setTimeout> | undefined
  function say (text: string) {
    hint.value = text
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      hint.value = ''
    }, 4000)
  }
  onBeforeUnmount(() => clearTimeout(hintTimer))

  // ===== 节点 =====

  /**
   * 新节点放在**最下面那个节点的下方**：卡片画布很小，按视口中心算容易叠在一起，
   * "往下长"既不会重叠，也符合"流程往下走"的读图习惯。
   */
  function addNode (kind: 'approval' | 'condition' | 'notify') {
    const bottom = Math.max(...nodes.value.map(n => Number(n.position?.y) || 0), 0)
    const id = uid()
    if (kind === 'approval') {
      const n = nodes.value.filter(x => x.type === 'approval').length + 1
      nodes.value.push({
        id,
        type: 'approval',
        position: { x: 120, y: bottom + 140 },
        data: { title: `环节${n}`, members: [leaderMember()] },
      })
      return
    }
    if (kind === 'notify') {
      const n = nodes.value.filter(x => x.type === 'notify').length + 1
      nodes.value.push({
        id,
        type: 'notify',
        position: { x: 120, y: bottom + 140 },
        data: { title: `提醒${n}`, members: [] },
      })
      return
    }
    nodes.value.push({ id, type: 'condition', position: { x: 120, y: bottom + 140 } })
  }

  /**
   * 卡片内部审批节点的**默认审批人 = 本环的组负责人**。
   * 展开时按"这一环轮到哪个组"填成 `dept_leader + dept = 组名`，再解析成真人
   * （见 utils/approvalRotation 的 stampRing）。想换成固定部门 / 组织管理员，
   * 在成员那一行改即可。
   */
  function leaderMember () {
    return { type: 'manager', name: '', email: '', role: { kind: 'loop_leader' } }
  }

  function nodeDataOf (id: string) {
    const node = nodes.value.find(n => n.id === id)
    if (!node) {
      return null
    }
    if (!node.data) {
      node.data = { title: '', members: [] }
    }
    if (!Array.isArray(node.data.members)) {
      node.data.members = []
    }
    return node.data
  }

  /** 「+ 成员」= 加一个本环的组负责人（见组件头部的差别说明） */
  function addLeaderTo (id: string) {
    nodeDataOf(id)?.members.push(leaderMember())
    say('已加「本环的组负责人」：展开时按这一环轮到的组解析')
  }

  function addRoleMemberTo (id: string) {
    nodeDataOf(id)?.members.push({
      type: 'manager',
      name: '',
      email: '',
      role: { kind: 'dept_leader', deptFrom: '' },
    })
  }

  function removeNodeById (id: string) {
    const node = nodes.value.find(n => n.id === id)
    if (!node || node.type === 'start' || node.type === 'end') {
      return
    }
    nodes.value = nodes.value.filter(n => n.id !== id)
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id)
    if (selectedEdgeId.value && !edges.value.some(e => e.id === selectedEdgeId.value)) {
      selectedEdgeId.value = null
    }
  }

  // ===== 连线 =====

  function onConnect (params: Connection) {
    if (!params.source || !params.target || params.source === params.target) {
      return
    }
    /*
     * ⚠️ 这里以前按 `source + target` 一刀切去重，于是「同一个审批节点拉两条线到**同一个**目标」
     * 的第二条会被**静默丢掉**（连提示都没有）—— 用户看到的就是"同一审批节点不支持拉两条线
     * 到结束节点"。
     *
     * 可这对**可分叉的节点**恰恰是正常用法：卡片内部最常见的写法就是
     *   「通过 → 这一环结束」「驳回 → 这一环结束」
     * 两条分支都指向内部结束节点（与主画布"多条分支汇聚到同一节点 / 都接结束"同一口径）。
     *
     * 所以只在**不可分叉**的节点上保留去重（start 只有一个出口，连两条重复线没有意义），
     * 条件分支 / 审批 / 提醒都放行。顺带把 handle 一起带上，与主画布保持一致。
     */
    const sourceType = nodes.value.find(n => n.id === params.source)?.type
    const branchable = ['condition', 'approval', 'notify'].includes(String(sourceType))
    const dup = edges.value.some(e => e.source === params.source && e.target === params.target)
    if (dup && !branchable) {
      return
    }
    edges.value.push({
      id: uid(),
      source: params.source,
      target: params.target,
      ...(params.sourceHandle ? { sourceHandle: params.sourceHandle } : {}),
      ...(params.targetHandle ? { targetHandle: params.targetHandle } : {}),
    })
  }

  function onEdgeClick ({ edge }: { edge: any }) {
    selectedEdgeId.value = edge?.id ?? null
    // 选中连线就撤掉环节面板：两个面板同时开着会互相盖住，也看不出形状控件作用在谁身上
    selectedNodeId.value = null
  }

  function selectBranch (edgeId: string) {
    selectedEdgeId.value = edgeId
    selectedNodeId.value = null
  }

  /** 点空白处：两个面板都收起来 */
  function clearSelection () {
    selectedEdgeId.value = null
    selectedNodeId.value = null
  }

  /**
   * 点环节卡片：选中它 —— 下方面板切成"这个环节的出线形状"。
   *
   * 面板只认"最后点了什么"（线 or 环节），所以这里同时清掉连线选中，反之亦然（见 onEdgeClick）。
   */
  function onNodeClick ({ node }: { node: any }) {
    selectedNodeId.value = String(node?.id ?? '') || null
    selectedEdgeId.value = null
  }

  function isEndTarget (targetId?: string) {
    return !!targetId && nodes.value.some(n => n.id === targetId && n.type === 'end')
  }

  function branchesOf (nodeId: string) {
    return edges.value
      .filter(e => e.source === nodeId)
      .map(e => ({ id: e.id, label: String(e.label ?? '').trim(), toEnd: isEndTarget(e.target) }))
  }

  /** 审批 / 提醒卡片只在**多条出线**（结果分支）时才列分支名，与主画布同一口径 */
  function outBranches (nodeId: string) {
    const list = branchesOf(nodeId)
    return list.length > 1 ? list : []
  }

  /*
   * ===== 连线形状 =====
   *
   * 与主画布**同一份清单**（src/utils/edgeStyles.ts）与同一套写法，差别只是这里的边默认
   * 没有 type（= vue-flow 缺省贝塞尔）。以前卡片内部**完全没有**形状选择器，
   * 于是卡片里画出来的线只能是默认贝塞尔。
   */
  const edgeShape = computed<string>({
    get: () => selectedEdge.value?.type ?? 'default',
    set: v => applyEdgeShape(selectedEdge.value, v),
  })

  /** 改形状参数；整体替换 pathOptions 以保证连线重渲染（与主画布同一写法） */
  function setEdgePathOptions (mutate: (o: Record<string, any>) => void) {
    const edge = selectedEdge.value
    if (!edge) return
    const next = { ...edge.pathOptions }
    mutate(next)
    edge.pathOptions = next
  }

  const edgeCurvature = computed<number>({
    get: () => Number(selectedEdge.value?.pathOptions?.curvature ?? DEFAULT_EDGE_CURVATURE),
    set: v => setEdgePathOptions(o => (o.curvature = v)),
  })

  const edgeBorderRadius = computed<number>({
    get: () => Number(selectedEdge.value?.pathOptions?.borderRadius ?? DEFAULT_EDGE_BORDER_RADIUS),
    set: v => setEdgePathOptions(o => (o.borderRadius = v)),
  })

  /**
   * 手动拖拽曲线的弯点写回：存在 `edge.data.cp`，随卡片快照持久化（null = 复位）。
   * 与主画布的 onEdgeCpUpdate 同一口径。
   */
  function onEdgeCpUpdate (id: string, cp: { x: number, y: number } | null) {
    const edge = edges.value.find(e => e.id === id)
    if (!edge) return
    if (!edge.data) edge.data = {}
    if (cp) edge.data.cp = cp
    else delete edge.data.cp
  }

  /* ===== 按「环节」批量改出线形状（选中环节时才有，见模板） ===== */

  /** 选中的那个环节节点（点卡片选中；点线 / 点空白都会清掉，见 onNodeClick / onEdgeClick） */
  const selectedNode = computed(() => nodes.value.find(n => n.id === selectedNodeId.value) ?? null)

  /** 这个环节的**全部出线** —— 形状控件作用的就是它们 */
  const selectedNodeOutEdges = computed(() => edges.value.filter(e => e.source === selectedNodeId.value))

  /** 环节名（就是卡片标题；条件分支卡片没有标题，给个叫法） */
  const selectedNodeTitle = computed(() => {
    const node = selectedNode.value as { type?: string, data?: { title?: string } } | null
    return String(node?.data?.title ?? '').trim()
      || (node?.type === 'condition' ? '条件分支' : '未命名环节')
  })

  /**
   * 「出线形状」：这个环节的多条**选项**线一次改完。
   *
   * get：各条形状一致才算"就是这个形状"，否则给空串（下拉里显示「多条不一致」这个状态）。
   * set：逐条 `applyEdgeShape` —— 改的是画布自己这份 `edges`，卡片快照由上面的 deep watch 落库；
   *      与"点线改单条"走的是同一条路径，所以保存 / 还原的口径完全一致。
   */
  const nodeEdgeShape = computed<string>({
    get: () => {
      const list = selectedNodeOutEdges.value
      if (list.length === 0) {
        return 'default'
      }
      const first = String(list[0].type ?? 'default')
      return list.every(e => String(e.type ?? 'default') === first) ? first : ''
    },
    set: (v: string) => {
      if (!v) {
        return
      }
      for (const e of selectedNodeOutEdges.value) {
        applyEdgeShape(e, v)
      }
    },
  })

  // ===== 分支名与条件 =====

  const selectedEdgeLabel = computed({
    get: () => String(selectedEdge.value?.label ?? ''),
    set: (v: string) => {
      if (selectedEdge.value) {
        selectedEdge.value.label = v
      }
    },
  })

  /**
   * 「提前结束轮询」的两个面板字段 —— 与主画布**同一份数据格式**
   * （`edge.data.exitMode` + `edge.data.exitTo`，见 pages/createStream.vue 的同名计算属性），
   * 所以转换、校验、展开三处都能直接复用主流程那套，一点新语义都不用加。
   *
   * 默认（end）**不写任何字段**：既有的连线数据保持原样，旧卡片零影响。
   */
  /*
   * 「选项文本」（`edge.data.options`）以前在面板上是个纯文本框，**跟主画布一起去掉了** ——
   * 它想表达的"多个说法走同一条线"，选项树的「实际链路」表达得更清楚（还能分组、带二级）。
   * 数据层仍兼容它：旧卡片里配过 `options` 的分支照常渲染（见 collectStepOptionItems）。
   */

  /* ===== 选项树（类别 → 一级 + 实际链路 → 二级，见 ApprovalOptionGroup）===== */

  /** 弹出框开关（选项树整块在弹出框里编辑，见 EdgeOptionTreeDialog） */
  const optionDialog = ref(false)

  /** 选中连线源头的**审批环节节点**：选项树挂在它身上（一个环节一份，见 ApprovalNodeData.optionGroups） */
  const selectedEdgeApprovalNode = computed(() => (
    nodes.value.find(n => n.id === selectedEdge.value?.source) ?? null
  ))

  /** 老数据兜底：选项树以前配在连线上（`edge.data.optionGroups`）；节点没配时读一次 */
  function legacyEdgeOptionGroups (): ApprovalOptionGroup[] {
    const edge = selectedEdge.value
    if (!edge) return []
    const of = (e: any): ApprovalOptionGroup[] => (Array.isArray(e?.data?.optionGroups) ? e.data.optionGroups : [])
    const own = of(edge)
    return own.length > 0 ? own : of(edges.value.find(e => e.source === edge.source && of(e).length > 0))
  }

  /**
   * 本**环节**共用（挂在节点上）的选项树 —— 与主画布同一口径
   * （见 pages/createStream.vue 的 selectedEdgeOptionGroups）。
   *
   * 树里每个一级选项自带「实际链路」，能指到本环节任意一条出线 → 一棵树本来就覆盖整个环节。
   */
  const edgeOptionGroups = computed<ApprovalOptionGroup[]>(() => {
    const own = selectedEdgeApprovalNode.value?.data?.optionGroups
    return Array.isArray(own) ? own : legacyEdgeOptionGroups()
  })

  /**
   * 本环节是否已形成**结果分支**（审批节点且 ≥2 条出线）：
   * 环节级选项树只在这时才有意义（编译时它挂在"审批环节 + 结果分支组"上，与主画布同一口径），
   * 单出线时配了也不会生效，所以按钮不出现 —— 免得配了却看不到效果。
   */
  const edgeHasResultBranches = computed(() => {
    const src = selectedEdge.value?.source
    if (!src) return false
    const isApproval = nodes.value.find(n => n.id === src)?.type === 'approval'
    return isApproval && edges.value.filter(e => e.source === src).length > 1
  })

  /** 「配置选项」按钮上的概览：不打开也知道配没配（卡片面板更窄，这行字要短） */
  const optionSummary = computed(() => {
    const groups = edgeOptionGroups.value
    if (groups.length === 0) {
      return '（未配置）'
    }
    const items = groups.reduce((n, g) => n + (g.items?.length ?? 0), 0)
    return `（已配 ${items} 个一级）`
  })

  /** 「实际链路」候选 = **本节点各条出线**（结论码 → 分支名/结论文案），与主画布同一口径 */
  const edgeLinkOptions = computed(() => {
    const src = selectedEdge.value?.source
    if (!src) {
      return []
    }
    const out: Array<{ value: string, label: string }> = []
    const seen = new Set<string>()
    for (const e of edges.value.filter(x => x.source === src)) {
      const list = Array.isArray(e.data?.conditions) ? e.data.conditions : []
      const c = list.find(isResultCondition) as BranchCondition | undefined
      const code = (c && c.op === 'eq' ? String(c.value ?? '') : '') || 'pass'
      if (seen.has(code)) {
        continue
      }
      seen.add(code)
      const name = String(e.label ?? '').trim()
      out.push({ value: code, label: `${name || APPROVAL_RESULTS.find(r => r.value === code)?.label || code}（${code}）` })
    }
    return out
  })

  /**
   * 写回选项树：写到**审批环节节点**上（一个环节一份）；空树就删字段。
   * 老数据配在连线上的那份顺手清掉（内容已写进节点，留着编译时会两处都出选项）。
   */
  function commitEdgeOptionGroups (list: ApprovalOptionGroup[]) {
    const node = selectedEdgeApprovalNode.value
    if (!node) {
      return
    }
    if (!node.data) {
      node.data = {}
    }
    if (list.length === 0) {
      delete node.data.optionGroups
    } else {
      node.data.optionGroups = list
    }
    for (const e of edges.value) {
      if (e.source === node.id && Array.isArray(e.data?.optionGroups)) {
        delete e.data.optionGroups
      }
    }
  }

  /**
   * 这条出线是不是**审批结果分支**（源节点是审批环节）。
   * 只有它需要、也只能它选「审批结论」—— 条件分支 / 开始 / 结束都没有结论可绑。
   */
  const edgeIsResult = computed(() => nodes.value.find(n => n.id === selectedEdge.value?.source)?.type === 'approval')

  /**
   * 分支绑定的审批结论：与 `conditions` 里的 `{ field: 'result', op: 'eq' }` 互转。
   * 口径与主画布一致（见 pages/createStream.vue 的 selectedEdgeResult）：
   * `find` 而不是取下标 0（结论条件未必排首位），写入时只替换结论条件、保留其它条件。
   */
  const edgeResult = computed<string>({
    get: () => {
      const c = (selectedEdge.value?.data?.conditions ?? []).find(isResultCondition) as BranchCondition | undefined
      return c && c.op === 'eq' ? String(c.value ?? '') : ''
    },
    set: (v: string) => {
      const edge = selectedEdge.value
      if (!edge) {
        return
      }
      if (!edge.data) {
        edge.data = {}
      }
      const list = (edge.data.conditions ?? []) as ConditionExpr[]
      const rest = list.filter(x => !isResultCondition(x))
      edge.data.conditions = v ? [{ field: 'result', op: 'eq', value: v }, ...rest] : rest
      // 分支名还空着时直接用结论文案当名字，省一次输入（与主画布同一口径）
      if (v && !edge.label) {
        edge.label = APPROVAL_RESULTS.find(r => r.value === v)?.label ?? ''
      }
    },
  })

  const edgeExitMode = computed<'end' | 'jump'>({
    get: () => (selectedEdge.value?.data?.exitMode === 'jump' ? 'jump' : 'end'),
    set: v => {
      const edge = selectedEdge.value
      if (!edge) {
        return
      }
      if (!edge.data) {
        edge.data = {}
      }
      if (v === 'jump') {
        edge.data.exitMode = 'jump'
        if (!edge.data.exitTo) {
          edge.data.exitTo = ''
        }
      } else {
        delete edge.data.exitMode
        delete edge.data.exitTo
      }
    },
  })

  /**
   * 「提前结束轮询」的目标环节 id。
   *
   * 留空**不是**"这一环结束"（那要选「这一环结束」），而是"用卡片上那条「提前跳出」出线的目标"
   * —— 同一张卡片里"某组接了跳到哪"配一次就够，不必每条线重复选。
   * 卡片上也没拉那条线时会明确报错，不会静默变成"这一环结束"（见 utils/loopCardGraph）。
   */
  const edgeExitTo = computed({
    get: () => String(selectedEdge.value?.data?.exitTo ?? ''),
    set: (v: string) => {
      const edge = selectedEdge.value
      if (!edge) {
        return
      }
      if (!edge.data) {
        edge.data = {}
      }
      edge.data.exitTo = v
    },
  })

  const edgeLogic = computed({
    get: () => (selectedEdge.value?.data?.logic === 'or' ? 'or' : 'and'),
    set: (v: string) => {
      const edge = selectedEdge.value
      if (!edge) {
        return
      }
      if (!edge.data) {
        edge.data = {}
      }
      edge.data.logic = v
    },
  })

  /** 只把**平条件**交给面板编辑；条件组原样留在数组里（见模板上的说明） */
  const conditions = computed<BranchCondition[]>(() => {
    const list = (selectedEdge.value?.data?.conditions ?? []) as ConditionExpr[]
    return list.filter(c => !isConditionGroup(c)) as BranchCondition[]
  })

  function addCondition () {
    const edge = selectedEdge.value
    if (!edge) {
      return
    }
    if (!edge.data) {
      edge.data = {}
    }
    if (!Array.isArray(edge.data.conditions)) {
      edge.data.conditions = []
    }
    edge.data.conditions.push({ field: '', op: 'eq', value: '' })
  }

  function removeCondition (c: BranchCondition) {
    const list = (selectedEdge.value?.data?.conditions ?? []) as ConditionExpr[]
    const i = list.indexOf(c)
    if (i !== -1) {
      list.splice(i, 1)
    }
  }

  /* ==================== 条件的「左值运算」（四则运算） ==================== */

  const mathOpen = ref(false)
  /** 正在编辑运算的那条条件 */
  const mathTarget = ref<BranchCondition | null>(null)
  /** 弹窗打开时带给它的表达式（空 = 这条条件还没配运算） */
  const mathExpr = ref('')

  /**
   * 打开运算弹窗。
   * 结论条件（`result`）直接不开：结论是**码**不是量，加减乘除对它没有意义 ——
   * 与主画布「result 只给等于」是同一条口径。
   */
  function openMath (c: BranchCondition) {
    if (isResultCondition(c)) {
      return
    }
    mathTarget.value = c
    mathExpr.value = String(c.lhsExpr ?? '')
    mathOpen.value = true
  }

  /**
   * 弹窗提交（空串 = 清除运算）。
   *
   * 写回口径与主画布**完全一致**（createStream 的 applyMath）：主字段取表达式里的第一个变量，
   * 运算是数值语义所以 `contains` 收敛成 `gt`。两处不同的话，同一条条件在两个画布里看就不是一回事了。
   */
  function applyMath (expr: string) {
    const c = mathTarget.value
    mathOpen.value = false
    if (!c) {
      return
    }
    if (!expr) {
      delete c.lhsExpr
      return
    }
    c.lhsExpr = expr
    const fields = parseArithmetic(expr).fields
    if (fields[0]) {
      c.field = fields[0]
    }
    if (c.op === 'contains') {
      collapseConditionValue(c)
      c.op = 'gt'
    }
  }

  /*
   * 字段候选：与主画布**共用同一份**（utils/conditionFields）。
   *
   * 以前这里照抄了一份，于是"主画布能选的字段，卡片里选不到"——踩过：剩余接收数量，
   * 表现为"轮询内没法按剩余判断"。现在只此一份，加字段不会再漏。
   * 卡片内部子流程的条件是**办理期**求值的，所以 result / qty / 剩余接收数量这些都能用
   * （卡片的「行条件」才是建单期，那些字段在那儿会被拦下）。
   */
  const FIELD_OPTIONS = CONDITION_FIELD_OPTIONS
</script>

<style lang="scss" scoped>
.card-canvas {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-canvas__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-canvas__hint {
  font-size: 11px;
  color: #6b7280;
}

/*
 * 只留尺寸：边框 / 圆角 / 底色交给 `flow-canvas` 类（与主画布同一套，
 * 见模板上的说明）—— 两处各写各的会不一致。
 * `flex: none` 是为了让 460px 稳定生效（.flow-canvas 自己有 flex: 1 1 auto）。
 */
.card-canvas__stage {
  height: 460px;
  flex: none;
}

.card-canvas__edge {
  padding: 8px 10px;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  background: #f9fafb;
}

.edge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.edge-label {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
}

.edge-input {
  flex: 1;
  min-width: 60px;
  padding: 3px 6px;
  font-size: 11px;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  background: #fff;

  &:focus {
    outline: 1px solid #a78bfa;
  }
}

/*
 * 左值的**运算表达式**（占了原来"字段"输入框的位置）：
 * 虚线描边 + 单行省略，一眼看出"这不是单个字段"；点它或点旁边的铅笔都能改。
 * 与 .edge-input 同一套尺寸，不会把同一行顶歪。
 */
.edge-expr {
  flex: 1;
  min-width: 60px;
  padding: 3px 6px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  background: #fff;
  border: 1px dashed #a78bfa;
  border-radius: 5px;
}

/* .edge-btn = 面板上的「配置选项」入口（内容在弹出框里，见 EdgeOptionTreeDialog） */
.edge-del,
.edge-add,
.edge-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 11px;
  color: #6d28d9;
  background: #f3e8ff;
  border: 1px solid #ddd6fe;
  border-radius: 5px;
  cursor: pointer;
}

.edge-note {
  font-size: 11px;
  color: #9ca3af;
}

/* 选中环节时面板顶部那个环节名（比 .edge-label 显眼一点，一眼看出改的是谁） */
.edge-node {
  font-size: 11px;
  font-weight: 600;
  color: #374151;
}

/* 形状参数的滑杆：卡片画布的面板比主画布窄，给一个能按下去的尺寸 */
.edge-range {
  width: 92px;
  height: 16px;
  accent-color: #7c3aed;
}
</style>
