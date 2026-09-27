<script setup lang="ts">
  import type { ApprovalOrder } from '@/types/approval'
  import type { Flow2Node, Flow2Run, Flow2Template } from '@/types/flow2'
  /*
   * 流程编排 v2（实验）：**每个节点就是一个函数**，流程在运行期一步步构建出来。
   *
   * 这个页面与 createStream.vue 完全独立：不同的模板集合（app_chain2）、不同的引擎
   * （utils/flow2Engine.ts）、不同的运行模型。现有流程一行都不受影响 —— 它是为了
   * 和 v1 做对比而存在的一次实验。
   *
   * 页面做两件事：
   *   1. 编排：一串函数节点（谁产出环节、下一步去哪，全由函数决定）；
   *   2. 试算：**真的去查 PocketBase**，把流程构建出来，连决策日志一起给你看。
   *
   * ⚠️ 函数的执行方式是 `new Function`，在浏览器里跑，没有真正的沙箱 ——
   * 只适合内部可信环境做对比。生产化的两条路见 utils/flow2Engine.ts 文件头。
   */
  import { computed, onMounted, ref } from 'vue'
  import { APPROVAL_RESULTS } from '@/types/approval'
  import { NODE_API_DOC } from '@/types/flow2'
  import { flowContextOfOrder } from '@/utils/approvalFlow'
  import {
    addFlow2,
    FLOW2_MIGRATION_HINT,
    type Flow2Model,
    getFlow2List,
    getFlow2One,
    updateFlow2,
  } from '@/utils/collection'
  import { getRecentOrders } from '@/utils/collection'
  import {
    defaultFlow2Template,
    type Flow2Simulation,
    makePbQuery,
    simulateFlow2,
    validateFlow2Template,
  } from '@/utils/flow2Engine'

  /* ==================== 模板编排 ==================== */

  const tplName = ref('示例：同团队轮询 + 提前终止')
  const editId = ref('')
  const nodes = ref<Flow2Node[]>(defaultFlow2Template().nodes)
  const entry = ref(defaultFlow2Template().entry)

  const template = computed<Flow2Template>(() => ({ entry: entry.value, nodes: nodes.value }))
  /** 保存前的即时体检：语法错、id 重复、入口不存在都在这里露出 */
  const issues = computed(() => validateFlow2Template(template.value))

  const entryItems = computed(() => nodes.value.map(n => ({ title: `${n.name || '(未命名)'} · ${n.id}`, value: n.id })))

  function addNode () {
    const id = `node${nodes.value.length + 1}`
    nodes.value.push({ id, name: '新节点', code: 'log(\'这里写你的逻辑\')\nreturn { next: \'end\' }' })
  }

  function removeNode (i: number) {
    const [gone] = nodes.value.splice(i, 1)
    if (gone && entry.value === gone.id) {
      entry.value = nodes.value[0]?.id ?? ''
    }
  }

  function moveNode (i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= nodes.value.length) {
      return
    }
    const [one] = nodes.value.splice(i, 1)
    if (one) {
      nodes.value.splice(j, 0, one)
    }
  }

  function loadExample () {
    const tpl = defaultFlow2Template()
    nodes.value = tpl.nodes.map(n => ({ ...n }))
    entry.value = tpl.entry
    tplName.value = '示例：同团队轮询 + 提前终止'
    editId.value = ''
    resultText.value = 'pass, pass, recycle'
    msg('已载入示例（演示：第 3 环选「回收」即提前结束轮询）')
  }

  /* ==================== 模板存取 ==================== */

  const templates = ref<Flow2Model[]>([])
  const showList = ref(false)
  const snapshot = ref<Record<string, string>>({})

  async function refreshList () {
    templates.value = await getFlow2List()
    snapshot.value = Object.fromEntries(templates.value.map(t => [t.id, JSON.stringify(t.spec)]))
  }

  async function save () {
    if (!tplName.value.trim()) {
      msg('请先填模板名', 'warning')
      return
    }
    if (issues.value.length > 0) {
      msg(`先修好这些问题再保存：${issues.value.join('；')}`, 'warning')
      return
    }
    try {
      if (editId.value) {
        const saved = await updateFlow2(editId.value, { name: tplName.value, spec: template.value })
        msg(`已更新「${saved.name}」`)
      } else {
        const saved = await addFlow2(tplName.value, 1, template.value)
        editId.value = saved.id
        msg(`已保存「${saved.name}」`)
      }
      await refreshList()
    } catch (error) {
      // 集合没建好是最常见的失败（迁移没应用），给一句能照着做的提示
      msg(`${FLOW2_MIGRATION_HINT}｜原始错误：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function openTemplate (id: string) {
    const rec = await getFlow2One(id)
    if (!rec) {
      msg('读取失败', 'error')
      return
    }
    editId.value = rec.id
    tplName.value = rec.name
    nodes.value = (rec.spec?.nodes ?? []).map(n => ({ ...n }))
    entry.value = rec.spec?.entry ?? nodes.value[0]?.id ?? ''
    showList.value = false
    msg(`已载入「${rec.name}」`)
  }

  async function copyTemplate (t: Flow2Model) {
    try {
      const saved = await addFlow2(`${t.name} 副本`, Number(t.status ?? 1), t.spec)
      await refreshList()
      msg(`已复制为「${saved.name}」`)
    } catch (error) {
      msg(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  /* ==================== 试算 ==================== */

  const orders = ref<ApprovalOrder[]>([])
  const orderId = ref('')
  const manualCtx = ref('')
  const resultText = ref('pass, pass, recycle')
  const running = ref(false)
  const sim = ref<Flow2Simulation | null>(null)
  /** 每个节点最后一次执行（日志里查"最后一次跑了什么"很方便） */
  const lastLog = computed(() => sim.value?.logs.at(-1) ?? null)

  const orderItems = computed(() => [
    { title: '（手填数据）', value: '' },
    ...orders.value.map(o => {
      // sync_key = SKU|店铺|仓位|组别|是否呆滞，拿头两段当标签足够认单
      const tag = String(o.sync_key ?? '').split('|').slice(0, 2).filter(Boolean).join(' · ')
      return { title: `${o.order_no ?? o.id}${tag ? ` · ${tag}` : ''}`, value: o.id }
    }),
  ])

  /** 试算用的数据上下文：与真实链路同源（审批单快照优先），所以试算结论可信 */
  const ctxPreview = computed(() => {
    if (!orderId.value) {
      return manualCtx.value
    }
    const order = orders.value.find(o => o.id === orderId.value)
    return JSON.stringify(flowContextOfOrder(order ?? null), null, 2)
  })

  /** 结论串：允许写结论码（recycle）或中文标签（回收），逗号/空格/换行分隔 */
  function parseResults (): string[] {
    const labelToValue = new Map(APPROVAL_RESULTS.map(r => [r.label, r.value]))
    return resultText.value
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => labelToValue.get(s) ?? s)
  }

  function resultLabel (value: string): string {
    return APPROVAL_RESULTS.find(r => r.value === value)?.label ?? value
  }

  async function runSim () {
    if (issues.value.length > 0) {
      msg(`模板有问题，先修：${issues.value.join('；')}`, 'warning')
      return
    }
    const raw = ctxPreview.value.trim()
    let ctx: Record<string, unknown> = {}
    if (raw) {
      try {
        ctx = JSON.parse(raw) as Record<string, unknown>
      } catch (error) {
        msg(`数据上下文不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, 'error')
        return
      }
    }
    running.value = true
    try {
      // 真的去查 PocketBase（与生产同一套查询口径）
      sim.value = await simulateFlow2({ template: template.value, ctx, query: makePbQuery(), results: parseResults() })
      if (sim.value.errors.length > 0) {
        msg(`试算中断：${sim.value.errors[0]}`, 'error')
      } else {
        msg(`试算完成：构建出 ${sim.value.steps.length} 个环节，${sim.value.rounds} 轮`)
      }
    } catch (error) {
      msg(`试算失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      running.value = false
    }
  }

  /** 环节的办理人长什么样：动态角色写成「组负责人·美1组」，固定人写名字 */
  function memberText (m: { name?: string, email?: string, role?: { kind: string, dept?: string } }): string {
    if (m.role?.dept) {
      return `组负责人 · ${m.role.dept}`
    }
    if (m.role) {
      return m.role.kind
    }
    return m.name || m.email || '(未指定)'
  }

  function queryText (q: { collection: string, filter: string, total?: number, ms: number, error?: string }): string {
    const hit = q.error ? `失败：${q.error}` : `${q.total ?? 0} 行`
    return `${q.collection} ｜ ${q.filter} ｜ ${hit} ｜ ${q.ms}ms`
  }

  const logRun = (r: Flow2Run): string => JSON.stringify(r, null, 2)

  /* ==================== 提示 ==================== */

  const snack = ref({ show: false, text: '', color: 'success' })
  let snackTimer: ReturnType<typeof setTimeout> | undefined
  function msg (text: string, color = 'success') {
    snack.value = { show: true, text, color }
    clearTimeout(snackTimer)
    snackTimer = setTimeout(() => {
      snack.value.show = false
    }, 4000)
  }

  onMounted(async () => {
    await refreshList()
    orders.value = await getRecentOrders(30)
  })

  defineExpose({ logRun })
</script>

<template>
  <v-container class="cs2" fluid>
    <v-sheet class="border-dashed border-accent p-5 mb-4" rounded>
      <div class="d-flex align-center flex-wrap ga-3">
        <div>
          <div class="block-title">流程编排 v2 · 函数节点（实验）</div>

          <div class="cs2-sub">
            每个节点是一段函数，流程在<strong>运行期</strong>被构建出来 —— 可以查库、可以循环、
            可以依据上一环的结论改走向。与 <code>createStream</code> 完全独立（另一张表
            <code>app_chain2</code>），不影响任何现有流程。
          </div>
        </div>

        <v-spacer />
        <v-btn prepend-icon="mdi-flask-outline" variant="tonal" @click="loadExample">载入示例</v-btn>
        <v-btn prepend-icon="mdi-folder-open-outline" variant="tonal" @click="showList = true">打开模板</v-btn>
        <v-btn color="primary" prepend-icon="mdi-content-save-outline" @click="save">保存模板</v-btn>
      </div>
    </v-sheet>

    <v-alert
      v-if="issues.length > 0"
      class="mb-3"
      density="compact"
      type="warning"
      variant="tonal"
    >
      <div v-for="(it, i) in issues" :key="i">{{ it }}</div>
    </v-alert>

    <v-row dense>
      <!-- 左：编排 -->
      <v-col cols="12" lg="7">
        <v-sheet border class="p-4" rounded>
          <div class="d-flex align-center flex-wrap ga-3 mb-3">
            <v-text-field
              v-model="tplName"
              density="compact"
              hide-details
              label="模板名"
              style="max-width: 280px"
            />

            <v-select
              v-model="entry"
              density="compact"
              hide-details
              :items="entryItems"
              label="起始节点"
              style="max-width: 240px"
            />

            <v-spacer />
            <v-btn prepend-icon="mdi-plus" size="small" variant="text" @click="addNode">加节点</v-btn>
          </div>

          <v-expansion-panels class="mb-3" variant="accordion">
            <v-expansion-panel density="compact" title="函数里能用什么（API 说明）">
              <v-expansion-panel-text>
                <pre class="cs2-doc">{{ NODE_API_DOC }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <v-card v-for="(n, i) in nodes" :key="i" class="mb-3" variant="outlined">
            <v-card-title class="d-flex align-center ga-2 py-2">
              <v-chip :color="entry === n.id ? 'primary' : undefined" size="small" variant="tonal">
                {{ entry === n.id ? '入口' : `#${i + 1}` }}
              </v-chip>

              <v-text-field
                v-model="n.name"
                density="compact"
                hide-details
                label="节点名"
                style="max-width: 220px"
              />

              <v-text-field
                v-model="n.id"
                density="compact"
                hide-details
                label="节点 id"
                style="max-width: 150px"
              />

              <v-spacer />
              <v-btn icon="mdi-arrow-up" size="x-small" variant="text" @click="moveNode(i, -1)" />
              <v-btn icon="mdi-arrow-down" size="x-small" variant="text" @click="moveNode(i, 1)" />
              <v-btn icon="mdi-delete-outline" size="x-small" variant="text" @click="removeNode(i)" />
            </v-card-title>

            <v-card-text class="pt-1">
              <div v-if="n.note" class="cs2-note">{{ n.note }}</div>

              <v-textarea
                v-model="n.code"
                class="cs2-code"
                density="compact"
                hide-details
                label="节点代码（async 函数体）"
                rows="10"
                spellcheck="false"
              />
            </v-card-text>
          </v-card>
        </v-sheet>
      </v-col>

      <!-- 右：试算 -->
      <v-col cols="12" lg="5">
        <v-sheet border class="p-4" rounded>
          <div class="block-title mb-2">试算（真的去查 PocketBase）</div>

          <v-select
            v-model="orderId"
            class="mb-2"
            density="compact"
            hide-details
            :items="orderItems"
            label="数据来源"
          />

          <v-textarea
            class="cs2-code mb-1"
            density="compact"
            hide-details
            label="数据上下文（ctx）"
            :model-value="ctxPreview"
            readonly
            rows="6"
          />

          <v-text-field
            v-model="resultText"
            class="mb-1"
            density="compact"
            hide-details
            label="每一环的结论（按顺序，第 n 个给第 n 环）"
          />

          <div class="cs2-note mb-2">
            演示提前终止：<code>pass, pass, recycle</code> = 前两环通过、第三环选「回收」即结束轮询。
            可用结论码或中文标签（{{ APPROVAL_RESULTS.slice(0, 4).map(r => r.label).join('、') }}…）。
          </div>

          <v-btn
            block
            color="primary"
            :loading="running"
            prepend-icon="mdi-play-circle-outline"
            @click="runSim"
          >运行</v-btn>

          <template v-if="sim">
            <v-divider class="my-3" />

            <div class="d-flex align-center flex-wrap ga-2 mb-2">
              <v-chip color="primary" size="small" variant="tonal">构建出 {{ sim.steps.length }} 个环节</v-chip>
              <v-chip size="small" variant="tonal">{{ sim.rounds }} 轮推进</v-chip>

              <v-chip :color="sim.done ? 'success' : 'warning'" size="small" variant="tonal">
                {{ sim.done ? '已结束' : '未结束' }}
              </v-chip>
            </div>

            <div class="cs2-sub mb-1">构建出来的流程（这一步才是 v1 里"建单期展开"的东西）</div>

            <v-table class="cs2-table" density="compact">
              <thead>
                <tr><th>#</th><th>环节</th><th>办理人</th><th>模拟结论</th><th>产出节点</th></tr>
              </thead>

              <tbody>
                <tr v-for="(s, i) in sim.steps" :key="s.id">
                  <td>{{ i + 1 }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.members.map(memberText).join('、') }}</td>
                  <td>{{ resultLabel(sim.results[i] ?? '') }}</td>
                  <td><code>{{ s.nodeId }}</code></td>
                </tr>

                <tr v-if="sim.steps.length === 0">
                  <td class="cs2-note" colspan="5">没有构建出任何环节（函数直接走到了 end）</td>
                </tr>
              </tbody>
            </v-table>

            <div class="cs2-sub mt-3 mb-1">决策日志（审计：当时查了什么、返回了什么、走了哪）</div>

            <div v-for="l in sim.logs" :key="l.seq" class="cs2-log">
              <div class="cs2-log-head">
                <strong>{{ l.seq + 1 }}. {{ l.nodeName }}</strong>
                <span class="cs2-note">{{ l.ms }}ms</span>
                <span v-if="l.error" class="cs2-err">✗ {{ l.error }}</span>
              </div>

              <div v-for="(t, ti) in l.logs" :key="ti" class="cs2-log-line">log: {{ t }}</div>
              <div v-for="(qq, qi) in l.queries" :key="qi" class="cs2-log-line">query: {{ queryText(qq) }}</div>

              <div v-if="l.out" class="cs2-log-line">
                out: 产出 {{ l.out.steps }} 环 · next = <code>{{ l.out.next }}</code>
              </div>
            </div>

            <div class="cs2-sub mt-3 mb-1">结束时的 state（函数记住的东西，随单据落库）</div>
            <pre class="cs2-doc">{{ JSON.stringify(sim.state, null, 2) }}</pre>

            <v-alert
              v-for="(e, i) in sim.errors"
              :key="i"
              class="mt-2"
              density="compact"
              type="error"
              variant="tonal"
            >
              {{ e }}
            </v-alert>

            <div v-if="lastLog?.out" class="cs2-note mt-2">
              最后一次执行：<code>{{ lastLog.nodeId }}</code> → next = <code>{{ lastLog.out.next }}</code>
            </div>
          </template>
        </v-sheet>

        <!-- 对比与代价：把话说清，避免被当成"更好的方案"直接上生产 -->
        <v-sheet border class="p-4 mt-3" rounded>
          <div class="block-title mb-2">与 v1 的差别（同一次需求的两种实现）</div>

          <table class="cs2-cmp">
            <tbody>
              <tr><td>建单期</td><td>v1 要把链路全算出来；v2 只跑第一个函数</td></tr>
              <tr><td>运行期</td><td>v1 纯重放（不查库）；v2 每推进一环都执行函数、可能要查库</td></tr>
              <tr><td>表达力</td><td>v1 受"画得出来"限制；v2 任意 JS（循环、提前结束、跨表判断）</td></tr>
              <tr><td>数据一致性</td><td>v1 建单期冻死；v2 每步都是当时最新数据 —— 这正是它最大的风险</td></tr>
              <tr><td>可校验</td><td>v1 保存期能校验；v2 只能校验语法，行为要跑才知道</td></tr>
              <tr><td>可审计</td><td>v1 模板+流水+快照天然可重放；v2 靠<strong>落库的构建结果 + 决策日志</strong></td></tr>
            </tbody>
          </table>

          <v-alert class="mt-3" density="compact" type="warning" variant="tonal">
            这是实验原型：函数在浏览器里用 <code>new Function</code> 执行，没有真正的沙箱。
            要上生产，只有两条路 —— 把执行搬到服务端受控环境，或改成可序列化、可静态校验的受控算子集。
          </v-alert>

          <div class="cs2-note mt-2">
            与真实单据打通还需要（当前页面只做编排与试算）：建单时跑第一个函数并落库构建结果、
            每办一环后从 <code>cursor</code> 继续、展示层只读落库结果、催办按落库的当前环来找人。
          </div>
        </v-sheet>
      </v-col>
    </v-row>

    <v-dialog v-model="showList" max-width="720">
      <v-sheet class="p-4">
        <div class="block-title mb-3">v2 模板（app_chain2）</div>

        <v-table density="compact">
          <thead><tr><th>名称</th><th>节点数</th><th>更新时间</th><th /></tr></thead>

          <tbody>
            <tr v-for="t in templates" :key="t.id">
              <td>{{ t.name }}</td>
              <td>{{ (t.spec?.nodes ?? []).length }}</td>
              <td>{{ t.updated }}</td>

              <td class="text-right">
                <v-btn size="small" variant="text" @click="openTemplate(t.id)">打开</v-btn>
                <v-btn size="small" variant="text" @click="copyTemplate(t)">复制</v-btn>
              </td>
            </tr>

            <tr v-if="templates.length === 0">
              <td class="cs2-note" colspan="4">
                还没有模板。若刚建好集合，重启一次 PocketBase（yarn dev:pb）应用迁移后再刷新。
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-sheet>
    </v-dialog>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="4000">{{ snack.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.cs2-sub {
  font-size: 12px;
  line-height: 1.7;
  color: rgb(var(--v-theme-on-surface-variant));
}

.cs2-note {
  font-size: 11.5px;
  line-height: 1.6;
  color: rgb(var(--v-theme-on-surface-variant));
}

.cs2-code :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.cs2-doc {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.cs2-table {
  font-size: 12px;
}

.cs2-log {
  border-left: 2px solid rgb(var(--v-theme-primary));
  padding: 4px 0 4px 8px;
  margin-bottom: 6px;
}

.cs2-log-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
}

.cs2-log-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
}

.cs2-err {
  color: rgb(var(--v-theme-error));
  font-size: 11.5px;
}

.cs2-cmp {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
}

.cs2-cmp td {
  padding: 3px 6px 3px 0;
  vertical-align: top;
}

.cs2-cmp td:first-child {
  width: 84px;
  color: rgb(var(--v-theme-on-surface-variant));
  white-space: nowrap;
}
</style>
