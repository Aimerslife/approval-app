<template>
  <v-container class="h-[calc(100vh-32px)] mock-page d-flex" fluid>
    <v-sheet class="mock-sheet d-flex flex-column" rounded="16">
      <!-- ============ 配置态：选模板 + 填业务上下文 ============ -->
      <template v-if="phase === 'setup'">
        <div class="mock-kicker mock-mono">Mock Run · 只读演练 · 不入库 · 不发通知</div>

        <div class="d-flex align-center ga-2 mt-2">
          <v-icon class="mock-icon-accent" icon="mdi-flask-outline" size="20" />
          <h2 class="mock-title">模拟运行<span class="mock-title-line" /></h2>
        </div>

        <p class="mock-sub">
          按真实建单口径读审批模板与审批类型（展开引用/数据查询、解析动态审批人、空跑校验），
          在内存里造一张 <span class="mock-no mock-mono">MOCK-*</span> 假单；办理界面与主页审批一致，
          但结论选项由<b>审批类型清单自动匹配</b>（启用的全部类型，不再按模板逐环节配置），
          流转仍按模板分支走向 —— 审批单、编号、附件、飞书通知都不会产生真实数据。
        </p>

        <div class="mock-grid">
          <!-- 卡 1：模拟对象 -->
          <section class="mock-card">
            <div class="mock-card-tag mock-mono">Source · 模拟对象</div>

            <v-select
              v-model="templateId"
              class="mt-3"
              clearable
              density="compact"
              hide-details
              item-title="name"
              item-value="id"
              :items="templateItems"
              label="审批模板（正本）"
              :loading="loading"
              placeholder="选一张要演练的模板"
              variant="outlined"
            >
              <template #item="{ props: ip, item }">
                <v-list-item v-bind="ip">
                  <template #subtitle>
                    <!-- Vuetify 4 的 #item 插槽类型没把 raw 泛型传出来，这里断言回模板对象 -->
                    <span>{{ (item as { raw?: MockTemplate }).raw?.sectionName || '未分组' }}</span>
                    <span v-if="(item as { raw?: MockTemplate }).raw?.steps" class="ml-2">· {{ (item as { raw?: MockTemplate }).raw?.steps }} 个环节</span>
                  </template>
                </v-list-item>
              </template>
            </v-select>

            <div class="d-flex align-center ga-2 mt-3 flex-wrap">
              <v-chip
                v-if="pickedTemplate"
                color="primary"
                label
                size="small"
                variant="tonal"
              >
                {{ pickedTemplate.name }}
              </v-chip>

              <v-chip
                v-if="typeCount > 0"
                color="success"
                label
                size="small"
                variant="tonal"
              >
                审批类型覆盖 {{ typeCount }} 条
              </v-chip>

              <v-spacer />

              <v-btn
                class="text-none mock-start-btn"
                color="primary"
                :disabled="!templateId || starting"
                :loading="starting"
                prepend-icon="mdi-play"
                variant="flat"
                @click="startMock"
              >
                <span class="mb-1">开启模拟</span>
              </v-btn>
            </div>
          </section>

          <!-- 卡 2：业务上下文 -->
          <section class="mock-card">
            <div class="d-flex align-center ga-2">
              <div class="mock-card-tag mock-mono">Context · 业务上下文 JSON</div>

              <v-spacer />

              <v-btn
                density="compact"
                prepend-icon="mdi-code-json"
                size="small"
                variant="text"
                @click="fillSample"
              >
                示例值
              </v-btn>
            </div>

            <p class="mock-card-hint mt-1 mb-2">
              分支条件按这些值选路；「团队」限定接收组别候选，「总库存数量 / 总库存金额」给接收环节
            </p>

            <v-textarea
              v-model="contextText"
              auto-grow
              class="mock-context"
              density="compact"
              hide-details
              label="如 {&quot;团队&quot;: &quot;美1组&quot;, &quot;总库存数量&quot;: 100, &quot;平台&quot;: &quot;淘宝&quot;}"
              max-rows="10"
              variant="outlined"
            />

            <v-alert
              v-if="startError"
              class="mock-static mt-2"
              density="compact"
              type="error"
              variant="tonal"
            >
              {{ startError }}
            </v-alert>
          </section>
        </div>

        <div class="mock-verdict">
          模拟不会写任何数据：审批单不建、编号不占、附件不传、飞书通知只做预演（运行后右侧栏看「本来会发给谁」）。
          模板与审批类型的读取口径与建单完全一致 —— 模拟能走通的流程，真建单也能走通。
        </div>
      </template>

      <!-- ============ 运行态：主页同款详情视图 + 模拟侧栏 ============ -->
      <template v-else>
        <div class="mock-kicker mock-mono flex-grow-0">Mock Run · 模拟数据 · 不入库 · 不发通知</div>

        <div class="d-flex align-center ga-2 mt-2 flex-grow-0 flex-wrap">
          <v-icon class="mock-icon-accent" icon="mdi-flask-outline" size="20" />
          <h2 class="mock-title">模拟运行<span class="mock-title-line" /></h2>

          <span class="mock-no mock-mono font-weight-medium">{{ mockOrder?.order_no }}</span>
          <span class="mock-tpl">模板：{{ pickedTemplate?.name }}</span>

          <v-chip
            v-if="ended"
            color="success"
            label
            size="x-small"
            variant="tonal"
          >流程已走完</v-chip>

          <v-spacer />

          <v-btn
            class="text-none"
            color="warning"
            density="comfortable"
            prepend-icon="mdi-restart"
            size="small"
            variant="tonal"
            @click="backToSetup"
          >
            <span class="mb-1">重新模拟</span>
          </v-btn>
        </div>

        <div class="mock-run-grid">
          <!-- 主办面：与主页审批抽屉同一份组件（头部/信息/时间线/办理栏一体）；办理选项统一由快照里的审批类型全集下发 -->
          <v-sheet class="mock-card mock-detail" rounded="12">
            <ApprovalDetailView :order="mockOrder!" @select="onMockSelect" @submit="onMockSubmit" />
          </v-sheet>

          <!-- 模拟侧栏：上下文值 + 通知预演 -->
          <aside class="mock-card mock-side d-flex flex-column">
            <div class="d-flex align-center ga-2 px-3 pt-3">
              <v-icon class="mock-icon-cyan" icon="mdi-bell-ring-outline" size="16" />
              <span class="mock-card-tag mock-mono">Notify · 通知预演</span>
              <v-spacer />
              <span class="mock-mono mock-count">{{ notifyLogs.length }} 次推进</span>
            </div>

            <div class="mock-side-scroll px-3 pb-3 pt-2">
              <div class="mb-3">
                <div class="d-flex align-center ga-1 mb-1">
                  <span class="mock-card-tag mock-mono mock-card-tag--sm">Context · 业务上下文</span>
                </div>

                <pre class="mock-json">{{ contextText || '（空）' }}</pre>
              </div>

              <div v-if="notifyLogs.length === 0" class="mock-verdict mock-verdict--side">
                每办完一环，这里会列出这一推进本来会发出的飞书消息（收件人 / 文案 / 跳过原因）。
                实际不会发送。
              </div>

              <div v-for="(log, i) in notifyLogs" :key="log.at + i" class="mb-3">
                <div class="d-flex align-center ga-1 mb-1">
                  <v-icon class="mock-icon-accent" icon="mdi-arrow-right-bold-box-outline" size="14" />
                  <span class="text-[12px] font-weight-bold mock-ink">第 {{ notifyLogs.length - i }} 次提交：{{ log.label }}</span>
                </div>

                <div v-if="log.items.length === 0" class="text-[11px] text-medium-emphasis pl-4">
                  这一步没有触发任何通知。
                </div>

                <div v-for="(item, j) in log.items" :key="j" class="mock-notify">
                  <div class="d-flex align-center ga-1">
                    <v-icon
                      :class="item.skip ? 'mock-icon-amber' : 'mock-icon-green'"
                      :icon="item.skip ? 'mdi-skip-next' : 'mdi-email-check-outline'"
                      size="13"
                    />

                    <span class="text-[12px] mock-ink">{{ item.title }}</span>

                    <v-chip
                      v-if="item.skip"
                      color="warning"
                      label
                      size="x-small"
                      variant="tonal"
                    >跳过</v-chip>
                  </div>

                  <div class="text-[11px] text-medium-emphasis mt-0.5">收件人：{{ targetNames(item) || '—' }}</div>
                  <pre class="mock-json mt-0.5">{{ item.text }}</pre>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </v-sheet>

    <v-snackbar v-model="snackbarOpen" :color="mockMessage?.type" location="top" timeout="3500">
      {{ mockMessage?.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue'
  import { useRoute } from 'vue-router'
  // ============ 数据（只读） ============
  import { fetchOrgTreeCache, type OrgTreeData } from '@/api/api'
  // ============ 展示（主页审批抽屉同一份组件） ============
  import ApprovalDetailView from '@/components/approval/ApprovalDetailView.vue'
  // ============ 引擎（全部纯函数，不写库） ============
  import {
    APPROVAL_STATUS, type ApprovalFlow, type ApprovalModal, type ApprovalOrder,
    branchTerminalMapOf, compactBranchTerminal, compactFlowSnapshot, type FlowContext,
    flowToChain, mainOf, type NodeDecision, type NodeSubmitPayload,
    PICK_MEMBERS_RESULT, PICK_TEAM_RESULT, rebuildChain, renameBranchTerminalKeys, slimFlowMembers,
  } from '@/types/approval'
  // 动态审批人（角色）解析：只读
  import { flowHasRoles, resolveFlowRoles } from '@/utils/approvalRoles'
  import { nextStepSameApprover } from '@/utils/approvalRuntime'
  // 审批类型覆盖（global + template 两层）：只读
  import { resolveTypeTemplates, slimTypeTemplates } from '@/utils/approvalTypes'
  import { loadApprovalTypeOverrides } from '@/utils/approvalTypeStore'
  import { getApproval } from '@/utils/collection'
  // 建单期的流程展开（引用/数据查询/组间轮询）：只读
  import { expandFlowForOrder } from '@/utils/expandFlowForOrder'
  import { type NotifyPlanItem, planArrivedNotifies } from '@/utils/notifySteps'
  import { buildOrgDirectory, memberOpenId } from '@/utils/orgDirectory'
  // 正本/副本口径（与审批模板页一致：模拟只用正本）
  import { isTemplateCopy } from '@/utils/templateCopy'

  /** 页面两阶段：配置（选模板/填上下文） → 运行（模拟办理） */
  const phase = ref<'setup' | 'run'>('setup')
  const loading = ref(false)

  /* ==================== 配置态 ==================== */

  /** 模板列表（app_chain 全量，与审批模板页同一数据源；只留**正本**且配了流程的） */
  interface MockTemplate {
    id: string
    name: string
    sectionName: string
    steps: number
    flow: ApprovalFlow
    /** 模板原始 chain 容器（含 graph / branchTerminal）：出口表按建单口径从它算（见 taskPayloadOf） */
    chain: NonNullable<ApprovalModal['chain']>
  }
  const templates = ref<MockTemplate[]>([])
  const templateId = ref<string | null>(null)
  const pickedTemplate = computed(() => templates.value.find(t => t.id === templateId.value) ?? null)
  /** 下拉项（直接用模板对象：item.raw 才带 sectionName/steps 供插槽渲染） */
  const templateItems = computed(() => templates.value)

  const contextText = ref('{\n  "团队": "美1组",\n  "总库存数量": 100\n}')
  const startError = ref('')
  const starting = ref(false)
  /** 模板命中的审批类型覆盖条数（选中后展示） */
  const typeCount = ref(0)

  async function loadTemplates () {
    loading.value = true
    try {
      const list = await getApproval()
      templates.value = (list ?? [])
        .filter(t => !isTemplateCopy(t.name))
        .flatMap(t => {
          const chain = t.chain
          if (!chain?.flow?.length) return []
          return [{
            id: t.id,
            name: t.name,
            sectionName: String(t.section ?? '').trim(),
            steps: chain.flow.length,
            flow: chain.flow,
            chain,
          }]
        })
    } catch (error) {
      console.error('[mockRun] 读模板列表失败:', error)
    } finally {
      loading.value = false
    }
  }

  /** 填一份示例上下文，省得用户猜字段 */
  function fillSample () {
    contextText.value = JSON.stringify({ 团队: '美1组', 总库存数量: 100, 总库存金额: 5000, 平台: '淘宝' }, null, 2)
  }

  function parseContext (): FlowContext | null {
    const raw = contextText.value.trim()
    if (!raw) {
      return {}
    }
    try {
      const obj = JSON.parse(raw)
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
    } catch {
      return null
    }
  }

  /* ==================== 开启模拟（复刻 createTaskForRow 的只读段） ==================== */

  const mockOrder = ref<ApprovalOrder | null>(null)
  const ended = computed(() => {
    const rt = mockOrder.value
    if (!rt) return false
    return rebuildChain(
      rt.chain?.flow ?? [],
      rt.chain?.decisions ?? [],
      branchTerminalMapOf(rt.chain ?? {}),
      rt.chain?.context ?? {},
    ).done
  })

  let orgCache: OrgTreeData | null | undefined
  async function orgTree (): Promise<OrgTreeData | null> {
    if (orgCache !== undefined) return orgCache
    try {
      const res = await fetchOrgTreeCache()
      orgCache = res?.data ?? null
    } catch (error) {
      console.warn('[mockRun] 组织架构缓存取不到，动态审批人无法解析:', error)
      orgCache = null
    }
    return orgCache
  }

  async function startMock () {
    const template = pickedTemplate.value
    if (!template) return
    const context = parseContext()
    if (context === null) {
      startError.value = '业务上下文不是合法的 JSON 对象（示例：{"团队": "美1组"}）'
      return
    }
    startError.value = ''
    starting.value = true
    try {
      // 1. 审批类型覆盖（与建单同口径：global + template 两层合并）
      const [globalTypes, templateTypes] = await Promise.all([
        loadApprovalTypeOverrides({ kind: 'global' }),
        loadApprovalTypeOverrides({ kind: 'template', templateId: template.id }),
      ])
      const resolvedTypes = resolveTypeTemplates([globalTypes.overrides, templateTypes.overrides])
      const types = slimTypeTemplates(resolvedTypes)
      typeCount.value = Object.keys(types).length
      // 办理选项不再单独下发：types 进 mockOrder.chain 快照后，ApprovalDetailView 按
      // 「审批类型自动匹配」口径（enabled 全集，见 enabledTypeOptionsFromSnapshot）自动摆出

      // 2. 建单期展开：引用模板 → 数据查询（留命中分支）→ 组间轮询（与 createTaskForRow 一致）
      const expanded = await expandFlowForOrder(template.flow, context)
      if (expanded.issues.length > 0) {
        startError.value = `流程展开失败 —— ${expanded.issues.join('；')}`
        return
      }
      let flow = expanded.flow

      // 3. 动态审批人（角色）解析成真人；解析不出来当场报（与建单一致）
      if (flowHasRoles(flow)) {
        const resolved = resolveFlowRoles(flow, await orgTree(), context)
        if (resolved.unresolved.length > 0) {
          const why = resolved.unresolved.map(u => `${u.where}：${u.reason}`).join('；')
          startError.value = `动态审批人没解析出来 —— ${why}`
          return
        }
        flow = resolved.flow
      }

      // 4. 成员瘦身 + 快照压缩（与建单写库的那份同构，引擎行为一致）
      const dir = buildOrgDirectory((await orgTree())?.tree)
      const slim = slimFlowMembers(flow, m => memberOpenId(dir, m))
      const compact = compactFlowSnapshot(slim)
      const branchTerminal = renameBranchTerminalKeys(
        compactBranchTerminal(branchTerminalMapOf(template.chain)),
        compact.branchIdMap,
      )

      // 5. 空跑校验（与建单前同一道闸门）：拦"建出来就走完 / 第一个待办环节没人办"
      const preview = rebuildChain(slim, [], branchTerminal, context)
      if (preview.done || preview.outcome !== 'pending' || preview.currentStep < 0) {
        startError.value = '这张模板按当前上下文会直接走到结束（没有需要审批的环节），请调整业务上下文或检查模板'
        return
      }
      if (!mainOf(preview.chain[preview.currentStep])) {
        startError.value = `第一个待办环节（第 ${preview.currentStep + 1} 环）没有审批人，模拟无法继续`
        return
      }

      // 6. 造**内存假单**：不写 approval_chain、不占编号、不建 flow_snapshots
      mockOrder.value = {
        id: `mock-${Date.now()}`,
        order_no: `MOCK-${Date.now()}`,
        status: APPROVAL_STATUS.PENDING,
        chain: {
          chain: flowToChain(compact.flow),
          flow: compact.flow,
          branchTerminal,
          decisions: [],
          types,
          context,
        },
      }
      notifyLogs.value = []
      phase.value = 'run'
    } catch (error) {
      console.error('[mockRun] 开启模拟失败:', error)
      startError.value = error instanceof Error ? error.message : '开启模拟失败（详情见控制台）'
    } finally {
      starting.value = false
    }
  }

  function backToSetup () {
    phase.value = 'setup'
    mockOrder.value = null
    notifyLogs.value = []
  }

  /* ==================== 模拟办理（复刻 useNodeSubmit，副作用全部换成内存操作） ==================== */

  /** 一次提交的通知预演记录 */
  const notifyLogs = ref<{ at: string, label: string, items: NotifyPlanItem[] }[]>([])

  /**
   * 页内轻提示（对应真实提交侧 useNodeSubmit 的 options.onMessage：
   * 校验失败时弹窗保持打开，先给个说明再让人重试）。
   */
  const mockMessage = ref<{ text: string, type: 'error' | 'warning' } | null>(null)
  const snackbarOpen = computed({
    get: () => !!mockMessage.value,
    set: (v: boolean) => {
      if (!v) mockMessage.value = null
    },
  })
  function showMock (text: string, type: 'error' | 'warning') {
    mockMessage.value = { text, type }
  }

  /**
   * 流程终态 → 审批单状态（与 useNodeSubmit 的 STATUS_BY_OUTCOME 同表）。
   * 状态值直接读 APPROVAL_STATUS 常量，避免两处硬编码漂移。
   */
  function statusByOutcome (outcome: 'pending' | 'approved' | 'rejected'): number {
    if (outcome === 'approved') return APPROVAL_STATUS.APPROVED
    if (outcome === 'rejected') return APPROVAL_STATUS.REJECTED
    return APPROVAL_STATUS.PENDING
  }

  /**
   * 「选择接收团队/部门」是否真的选了人 —— 与 useNodeSubmit.hasPickedMember 同一份口径
   * （那边是私有函数，这里按同一实现复刻；两处语义必须一致）。
   */
  function hasPickedMember (raw: unknown): boolean {
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    return arr.some(item => !!item && typeof item === 'object'
      && String((item as { name?: unknown }).name ?? '').trim() !== '')
  }

  async function onMockSubmit (payload: NodeSubmitPayload) {
    const order = mockOrder.value
    const snapshot = order?.chain
    const flow = snapshot?.flow
    if (!order || !snapshot || !flow?.length) {
      payload.done(false)
      return
    }

    const terminalMap = branchTerminalMapOf(snapshot)
    const context = snapshot.context ?? {}
    // stepId 由 flow + decisions 重算得出（与提交侧一致，不从页面注入）
    const before = rebuildChain(flow, snapshot.decisions ?? [], terminalMap, context)
    const stepId = before.stepIds[payload.index]
    if (!stepId) {
      payload.done(false)
      return
    }

    // 追加办理流水（模拟不传附件 —— payload.files 静默忽略，见页面顶部说明）
    const decisions: NodeDecision[] = [
      ...(snapshot.decisions ?? []),
      {
        stepId,
        result: payload.result,
        result_label: payload.result_label,
        extra: payload.extra,
        opinion: payload.opinion,
        handled_at: new Date().toISOString(),
      },
    ]

    const rebuilt = rebuildChain(flow, decisions, terminalMap, context)
    // 结论必须真的让流程往前挪（或结束）—— 与提交侧同一道拦截
    if (!rebuilt.done && rebuilt.currentStep === payload.index) {
      showMock('该结论在流程里没有对应的后置环节，请改选其它选项', 'error')
      payload.done(false)
      return
    }
    // 接收类结论必须选了人（与提交侧一致）
    if ((payload.result === PICK_MEMBERS_RESULT || payload.result === PICK_TEAM_RESULT)
      && !hasPickedMember(payload.extra?.members)) {
      showMock(payload.result === PICK_TEAM_RESULT ? '请选择接收部门' : '请选择接收团队', 'warning')
      payload.done(false)
      return
    }

    // 内存回填（真实实现这里是 updateApprovalOrder 写库 —— 模拟只改本地对象）
    order.chain = { ...snapshot, chain: rebuilt.chain, decisions }
    order.status = statusByOutcome(rebuilt.outcome)

    // 通知**预演**（真实实现这里是 sendArrivedNotifies 发飞书 —— 模拟只算不发）
    try {
      const plan = planArrivedNotifies({
        flow,
        before: before.stepIds,
        after: rebuilt.stepIds,
        afterChain: rebuilt.chain,
        orderNo: order.order_no,
        context,
      })
      notifyLogs.value.unshift({ at: new Date().toISOString(), label: payload.result_label ?? payload.result, items: plan.items })
    } catch (error) {
      console.warn('[mockRun] 通知预演失败（不影响模拟推进）:', error)
    }

    payload.done(true, { sameApproverNext: nextStepSameApprover(rebuilt.chain, payload.index) })
  }

  /** 模拟单不存在的抄送/转办：只提示，不做任何事 */
  function onMockSelect () {
    // 与真实办理唯一的差异之一：抄送/转办会写库，模拟里没有意义
    window.alert('模拟运行不执行抄送/转办（会写真实数据）')
  }

  /**
   * 通知预演收件人的显示名：targets 是 NotifyTarget 对象（member + 飞书 id），
   * 取 member.name，缺名字退邮箱 —— 直接 join 会变成 [object Object]。
   */
  function targetNames (item: NotifyPlanItem): string {
    return item.targets
      .map(t => String(t.member?.name ?? t.member?.email ?? '').trim())
      .filter(Boolean)
      .join('、')
  }

  onMounted(() => {
    loadTemplates()
    // 深链：/mockRun?template=<id> 直接锁定模板（审批模板页「去模拟」跳转用）
    const fromQuery = useRoute().query.template
    if (fromQuery) templateId.value = String(fromQuery)
  })
</script>

<style lang="scss" scoped>
/*
 * 风格参照「竞品雷达情报面板」：
 * 光晕底 + 网格纹理、渐变卡 + 四角装饰线、mono 序号标签、kicker 胶囊、
 * 标题渐变延伸线、行卡 hover 微动效。全部页面级 scoped，不动全局主题。
 * 颜色统一走 --mp-* 变量：浅色默认值定义在 .mock-page 上，
 * 暗黑档（顶栏按钮翻 theme.global.name，祖先挂 .v-theme--dark）在下方整体覆盖。
 */
.mock-page {
  --mp-page-bg: linear-gradient(180deg, #f7f9ff, #edf0fa);
  --mp-grid-line: rgba(16, 23, 54, 0.055);
  --mp-sheet-bg: linear-gradient(158deg, #ffffff, #ffffff);
  --mp-sheet-border: rgba(16, 23, 54, 0.08);
  --mp-sheet-shadow: 0 2px 6px rgba(16, 23, 54, 0.04), 0 18px 44px -18px rgba(49, 46, 129, 0.22);
  --mp-corner: rgba(79, 70, 229, 0.4);
  --mp-ink: #101736;
  --mp-body: #46507c;
  --mp-muted: #7e87a9;
  --mp-accent: #4f46e5;
  --mp-cyan: #0891b2;
  --mp-cyan-border: rgba(8, 145, 178, 0.32);
  --mp-cyan-bg: rgba(8, 145, 178, 0.05);
  --mp-pulse: rgba(8, 145, 178, 0.35);
  --mp-green: #059669;
  --mp-amber: #b45309;
  --mp-title-line: linear-gradient(90deg, rgba(79, 70, 229, 0.55), rgba(8, 145, 178, 0.22), transparent);
  --mp-tag-line: linear-gradient(90deg, #4f46e5, #0891b2);
  --mp-no-bg: rgba(79, 70, 229, 0.07);
  --mp-no-border: rgba(79, 70, 229, 0.22);
  --mp-no-ink: #4f46e5;
  --mp-card-bg: #ffffff;
  --mp-card-border: rgba(16, 23, 54, 0.08);
  --mp-card-shadow: 0 1px 3px rgba(16, 23, 54, 0.03), 0 10px 26px -16px rgba(49, 46, 129, 0.16);
  --mp-row-bg: #ffffff;
  --mp-row-border-hover: rgba(79, 70, 229, 0.32);
  --mp-row-hover-bg: #ffffff;
  --mp-row-hover-shadow: 0 6px 16px -10px rgba(49, 46, 129, 0.3);
  --mp-json-bg: rgba(16, 23, 54, 0.035);
  --mp-json-border: rgba(16, 23, 54, 0.06);
  --mp-verdict-bg: linear-gradient(90deg, rgba(79, 70, 229, 0.06), transparent 72%);
  --mp-verdict-border: rgba(79, 70, 229, 0.45);
  --mp-verdict-ink: #46507c;
  --mp-start-grad: linear-gradient(135deg, #4f46e5, #4338ca);
  --mp-start-shadow: 0 6px 16px -6px rgba(79, 70, 229, 0.5);

  position: relative;
  background: var(--mp-page-bg);
}

/* 光晕 + 网格纹理（径向 mask 从页头向下渐隐） */
.mock-page::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(620px 320px at 12% 0%, rgba(99, 102, 241, 0.18), transparent 62%),
    radial-gradient(520px 340px at 88% 6%, rgba(8, 145, 178, 0.13), transparent 62%),
    linear-gradient(var(--mp-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--mp-grid-line) 1px, transparent 1px);
  background-size: auto, auto, 52px 52px, 52px 52px;
  mask-image: radial-gradient(ellipse 95% 82% at 50% 0%, #000 22%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 95% 82% at 50% 0%, #000 22%, transparent 78%);
}

/* ======== 暗黑档：参照 dark 版雷达面板的 token 整体覆盖 ======== */
.v-theme--dark .mock-page {
  --mp-page-bg: linear-gradient(180deg, #060a1e, #070b22 46%, #05081a);
  --mp-grid-line: rgba(99, 102, 241, 0.075);
  --mp-sheet-bg: linear-gradient(158deg, rgba(21, 27, 62, 0.86), rgba(8, 12, 32, 0.9));
  --mp-sheet-border: rgba(99, 102, 241, 0.18);
  --mp-sheet-shadow: 0 10px 40px rgba(2, 5, 20, 0.6);
  --mp-corner: rgba(129, 140, 248, 0.6);
  --mp-ink: #e9ecff;
  --mp-body: #b7bde8;
  --mp-muted: #7d86bd;
  --mp-accent: #818cf8;
  --mp-cyan: #22d3ee;
  --mp-cyan-border: rgba(34, 211, 238, 0.3);
  --mp-cyan-bg: rgba(34, 211, 238, 0.06);
  --mp-pulse: rgba(34, 211, 238, 0.4);
  --mp-green: #34d399;
  --mp-amber: #fbbf24;
  --mp-title-line: linear-gradient(90deg, rgba(99, 102, 241, 0.45), rgba(34, 211, 238, 0.25), transparent);
  --mp-tag-line: linear-gradient(90deg, #6366f1, #22d3ee);
  --mp-no-bg: rgba(129, 140, 248, 0.12);
  --mp-no-border: rgba(129, 140, 248, 0.45);
  --mp-no-ink: #c7cdff;
  --mp-card-bg: linear-gradient(158deg, rgba(21, 27, 62, 0.86), rgba(8, 12, 32, 0.9));
  --mp-card-border: rgba(99, 102, 241, 0.18);
  --mp-card-shadow: 0 2px 12px rgba(2, 5, 20, 0.45);
  --mp-row-bg: rgba(255, 255, 255, 0.018);
  --mp-row-border-hover: rgba(129, 140, 248, 0.42);
  --mp-row-hover-bg: rgba(99, 102, 241, 0.13);
  --mp-row-hover-shadow: 0 6px 18px -8px rgba(2, 5, 20, 0.7);
  --mp-json-bg: rgba(99, 102, 241, 0.08);
  --mp-json-border: rgba(99, 102, 241, 0.14);
  --mp-verdict-bg: rgba(99, 102, 241, 0.1);
  --mp-verdict-border: #818cf8;
  --mp-verdict-ink: #d6daff;
  --mp-start-grad: linear-gradient(135deg, #6366f1, #4f46e5);
  --mp-start-shadow: 0 6px 18px -6px rgba(99, 102, 241, 0.55);
}

/* 暗黑光晕：右上 indigo / 左侧 cyan / 底部 violet 三组光斑 + indigo 网格，mask 中心下移 */
.v-theme--dark .mock-page::before {
  background-image:
    radial-gradient(950px 520px at 78% -8%, rgba(99, 102, 241, 0.2), transparent 62%),
    radial-gradient(760px 460px at 6% 22%, rgba(34, 211, 238, 0.1), transparent 60%),
    radial-gradient(900px 620px at 50% 108%, rgba(167, 139, 250, 0.14), transparent 62%),
    linear-gradient(rgba(99, 102, 241, 0.075) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99, 102, 241, 0.075) 1px, transparent 1px);
  background-size: auto, auto, auto, 52px 52px, 52px 52px;
  mask-image: radial-gradient(ellipse 92% 82% at 50% 18%, #000 22%, transparent 82%);
  -webkit-mask-image: radial-gradient(ellipse 92% 82% at 50% 18%, #000 22%, transparent 82%);
}

.mock-sheet {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  margin: 0 auto;
  padding: 22px 24px;
  overflow: hidden;
  border: 1px solid var(--mp-sheet-border);
  background: var(--mp-sheet-bg);
  box-shadow: var(--mp-sheet-shadow);
}

/* 主卡四角装饰线（右上/左下） */
.mock-sheet::before,
.mock-sheet::after {
  content: '';
  position: absolute;
  width: 13px;
  height: 13px;
  pointer-events: none;
  border-color: var(--mp-corner);
}

.mock-sheet::before {
  top: -1px;
  right: -1px;
  border-top: 1.5px solid;
  border-right: 1.5px solid;
  border-top-right-radius: 16px;
}

.mock-sheet::after {
  bottom: -1px;
  left: -1px;
  border-bottom: 1.5px solid;
  border-left: 1.5px solid;
  border-bottom-left-radius: 16px;
}

.mock-mono {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace;
}

.mock-ink {
  color: var(--mp-ink);
}

/* 图标配色走变量（模板里不用 color prop 硬编码，两种主题各自取色） */
.mock-icon-accent {
  color: var(--mp-accent);
}

.mock-icon-cyan {
  color: var(--mp-cyan);
}

.mock-icon-green {
  color: var(--mp-green);
}

.mock-icon-amber {
  color: var(--mp-amber);
}

/* kicker：脉冲点 + mono 大写间距胶囊 */
.mock-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 12px;
  border: 1px solid var(--mp-cyan-border);
  border-radius: 99px;
  background: var(--mp-cyan-bg);
  color: var(--mp-cyan);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  flex: 0 0 auto;
  align-self: flex-start;
}

.mock-kicker::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mp-cyan);
  animation: mock-pulse 2.4s ease-out infinite;
}

@keyframes mock-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--mp-pulse);
  }

  70% {
    box-shadow: 0 0 0 6px transparent;
  }

  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

/* 页面标题 + 渐变延伸线（暗黑档标题换参照的四段渐变文字） */
.mock-title {
  position: relative;
  margin: 0;
  color: var(--mp-ink);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1.2;
}

.v-theme--dark .mock-title {
  background: linear-gradient(100deg, #c7cdff, #818cf8 42%, #22d3ee 78%, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.mock-title-line {
  display: inline-block;
  width: min(190px, 24vw);
  height: 2px;
  margin-left: 10px;
  vertical-align: middle;
  background: var(--mp-title-line);
}

.mock-sub {
  max-width: 860px;
  margin: 6px 0 0;
  color: var(--mp-body);
  font-size: 12px;
  line-height: 1.75;
}

.mock-tpl {
  color: var(--mp-muted);
  font-size: 12px;
}

/* 单号徽标：mono + 主色淡底描边 */
.mock-no {
  padding: 1px 7px;
  border: 1px solid var(--mp-no-border);
  border-radius: 6px;
  background: var(--mp-no-bg);
  color: var(--mp-no-ink);
  font-size: 11px;
  letter-spacing: 0.02em;
}

/* 配置态双卡 grid */
.mock-grid {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 12px;
  margin-top: 14px;
}

@media (max-width: 959px) {
  .mock-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 内容卡：渐变底 + 近远双层阴影 + 四角装饰 */
.mock-card {
  position: relative;
  padding: 16px 18px;
  border: 1px solid var(--mp-card-border);
  border-radius: 12px;
  background: var(--mp-card-bg);
  box-shadow: var(--mp-card-shadow);
}

.mock-card::before,
.mock-card::after {
  content: '';
  position: absolute;
  width: 11px;
  height: 11px;
  pointer-events: none;
  border-color: var(--mp-corner);
}

.mock-card::before {
  top: -1px;
  left: -1px;
  border-top: 1.5px solid;
  border-left: 1.5px solid;
  border-top-left-radius: 12px;
}

.mock-card::after {
  right: -1px;
  bottom: -1px;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  border-bottom-right-radius: 12px;
}

/* 卡内 mono 标签（前置渐变短横线） */
.mock-card-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--mp-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.mock-card-tag::before {
  content: '';
  width: 14px;
  height: 1.5px;
  background: var(--mp-tag-line);
}

.mock-card-tag--sm {
  font-size: 9.5px;
}

.mock-card-hint {
  color: var(--mp-muted);
  font-size: 11px;
  line-height: 1.6;
}

/* 开启模拟：主色渐变按钮 */
.mock-start-btn {
  background: var(--mp-start-grad);
  box-shadow: var(--mp-start-shadow);
}

/* verdict：左竖线引用块 */
.mock-verdict {
  flex: 0 0 auto;
  margin-top: 12px;
  padding: 9px 14px;
  border-left: 2px solid var(--mp-verdict-border);
  border-radius: 0 10px 10px 0;
  background: var(--mp-verdict-bg);
  color: var(--mp-verdict-ink);
  font-size: 12px;
  line-height: 1.7;
}

.mock-verdict--side {
  margin-top: 0;
}

/* 运行态：详情 + 侧栏 grid（沿用原 flex 滚动职责） */
.mock-run-grid {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 12px;
  margin-top: 10px;
  min-height: 0;
}

/* 主办面吃掉剩余宽度；DetailView 内部自带 flex 布局与滚动 */
.mock-detail {
  padding: 0;
  overflow: hidden;
}

/* 模拟侧栏：固定宽度，内部自己滚动 */
.mock-side {
  min-height: 0;
  overflow: hidden;
}

.mock-side-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.mock-count {
  color: var(--mp-muted);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}

.mock-context :deep(textarea) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
}

.mock-json {
  padding: 7px 9px;
  border: 1px solid var(--mp-json-border);
  border-radius: 8px;
  background: var(--mp-json-bg);
  color: var(--mp-body);
  font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 通知条目：行卡（hover 右移 + 边框变色 + 阴影） */
.mock-notify {
  padding: 8px 10px;
  border: 1px solid var(--mp-card-border);
  border-radius: 10px;
  background: var(--mp-row-bg);
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.mock-notify + .mock-notify {
  margin-top: 6px;
}

.mock-notify:hover {
  border-color: var(--mp-row-border-hover);
  background: var(--mp-row-hover-bg);
  transform: translateX(2px);
  box-shadow: var(--mp-row-hover-shadow);
}

/*
 * flex-column 面板里的 v-alert 必须固定「按内容占高」：
 * Vuetify 给 .v-alert 内置了 flex: 1 1 0%（为横排布局设计），放进 column 面板后
 * grow=1 会吃光富余高度（alert 巨大化）、grow=0 则 basis 0% 生效塌成一条
 * （它自带 overflow:hidden，flex 的 min-content 保底随之失效）。
 */
.mock-static {
  flex: 0 0 auto;
}

@media (max-width: 1279px) {
  .mock-run-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}

@media (max-width: 959px) {
  .mock-run-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mock-side {
    max-height: 340px;
  }

  .mock-sheet {
    overflow-y: auto;
  }
}
</style>
