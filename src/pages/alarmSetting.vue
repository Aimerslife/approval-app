<template>
  <v-container class="page-bg px-30 pb-6 pt-10" fluid>
    <!-- 页头 -->
    <div class="d-flex align-start justify-space-between flex-wrap ga-3 mb-4 px-1">
      <div>
        <div class="text-[20px] font-bold block-title">提醒设置</div>
        <div class="text-[12.5px] text-medium-emphasis mt-1">
          配置飞书推送规则：超时阈值、推送时间与间隔、推送人员与白名单。保存后由超时跑批执行
        </div>
      </div>

      <v-chip :color="custom ? 'primary' : undefined" label size="small" variant="tonal">
        {{ custom ? '已自定义' : '默认规则' }}
      </v-chip>
    </div>

    <!-- ① 定时推送：开关 + 频率 + 时间 + 超时阈值 -->
    <v-sheet class="overflow-hidden p-4" rounded="15">
      <div class="d-flex align-center ga-3 px-5 py-3">
        <v-avatar color="primary" size="30" variant="tonal">
          <v-icon size="16">mdi-alarm-check</v-icon>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="text-[14px] font-semibold">审批流定时推送</div>
          <div class="text-[12px] text-medium-emphasis">待办超过阈值后，按下面的频率与**推送间隔**重复提醒相关人</div>
        </div>

        <v-switch v-model="draft.enabled" color="primary" density="compact" hide-details size="small"
          :label="draft.enabled ? '已开启' : '已关闭'" />
      </div>

      <v-divider />

      <!-- 四个条件框（频率 / 时间 / 阈值 / 间隔）：尺寸与字号比 Vuetify 的 compact 再小 2，见下面 .push-controls 的样式 -->
      <div class="push-controls d-flex flex-wrap ga-4 px-5 py-4">
        <div class="flex-grow-1" style="min-width: 240px">
          <div class="field-title mb-2">推送频率</div>

          <v-btn-toggle v-model="draft.frequency" color="primary" density="comfortable" variant="outlined">
            <v-btn v-for="opt in PUSH_FREQUENCY_OPTIONS" :key="opt.value" :value="opt.value" size="small">
              {{ opt.title }}
            </v-btn>
          </v-btn-toggle>

          <div class="text-[11px] text-medium-emphasis mt-1">
            {{ frequencyHint }}
          </div>
        </div>

        <div>
          <div class="field-title mb-2">推送时间</div>

          <v-text-field v-model="draft.sendTime" density="compact" hide-details="auto" placeholder="09:00" single-line
            style="max-width: 110px" type="time" variant="outlined">
            <template #message>
              <!--
                跑批是"到点之后最近的第一次执行"，不是"准时在 09:00 发" —— 说清楚，
                否则用户会以为定时器和这个字段联动，等不到消息就去查代码。
              -->
              <span class="text-[11px]">每天**不早于**该时刻推送；建议外部 cron 从该时刻起每 10 分钟打一次
                /api/reminders/run?send=1（同一单在「推送间隔」内只发一条）</span>
            </template>
          </v-text-field>
        </div>

        <div>
          <div class="field-title mb-2">超时阈值</div>

          <v-text-field v-model.number="draft.overdueHours" density="compact" hide-details :min="1" single-line
            style="max-width: 90px" suffix="小时" type="number" variant="outlined" />
        </div>
        <div>
          <div class="field-title mb-2">推送间隔</div>

          <v-select v-model="draft.intervalHours" density="compact" hide-details :items="intervalOptions"
            :menu-props="{ contentClass: 'filter-menu' }" single-line style="max-width: 170px" variant="outlined" />
        </div>
      </div>

      <!-- 一句话把"超时后会怎么推"讲清楚：三个字段（频率 / 阈值 / 间隔）单看都不直观 -->
      <div class="d-flex align-center ga-2 px-5 pb-3 text-[11px] text-medium-emphasis">
        <v-icon size="14">mdi-timeline-clock-outline</v-icon>
        <span>当前口径：{{ cadenceText }}</span>
      </div>
    </v-sheet>

    <!-- ② 推送人员：默认当前审批人，也可固定发某几个人 -->
    <v-sheet class="overflow-hidden mt-6 p-4" rounded="15">
      <div class="d-flex align-center ga-3 px-5 py-3">
        <v-avatar color="primary" size="30" variant="tonal">
          <v-icon size="16">mdi-account-multiple-outline</v-icon>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="text-[14px] font-semibold">推送人员</div>
          <div class="text-[12px] text-medium-emphasis">默认发给当前审批人；也可以固定发给指定的人一起盯单</div>
        </div>
      </div>

      <v-divider />

      <div class="px-5 py-4 ">
        <v-radio-group v-model="draft.receiverMode" class="receiver-radio" hide-details>
          <div class="d-flex flex-wrap ga-3">
            <div v-for="opt in RECEIVER_MODE_OPTIONS" :key="opt.value" class="mode-card"
              :class="{ 'mode-card-active': draft.receiverMode === opt.value }" @click="draft.receiverMode = opt.value">
              <v-radio :value="opt.value" color="primary" density="compact" hide-details :ripple="false">
                <template #label>
                  <div class="d-flex flex-column ml-1">
                    <span class="text-[13px] font-semibold">{{ opt.title }}</span>
                    <span class="text-[11px] text-medium-emphasis">{{ opt.hint }}</span>
                  </div>
                </template>
              </v-radio>
            </div>
          </div>
        </v-radio-group>

        <div class="d-flex align-center ga-2 mt-4 mb-2">
          <span class="field-title">指定人员</span>
          <v-chip v-if="draft.receivers.length > 0" label size="x-small" variant="tonal">
            {{ draft.receivers.length }} 人
          </v-chip>

          <v-spacer />

          <v-btn color="primary" prepend-icon="mdi-plus" size="small" variant="tonal"
            @click="openPicker('receivers')">添加人员</v-btn>
        </div>

        <PushPeopleList :people="draft.receivers" empty="还没有指定人员（选「当前审批人」时这里可以留空）"
          @remove="p => removePerson('receivers', p)" />
      </div>
    </v-sheet>

    <!-- ③ 白名单：名单内的人不推送 -->
    <v-sheet class="overflow-hidden mt-6 p-4" rounded="15">
      <div class="d-flex align-center ga-3 px-5 py-3">
        <v-avatar color="warning" size="30" variant="tonal">
          <v-icon size="16">mdi-shield-off-outline</v-icon>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="text-[14px] font-semibold">推送白名单</div>
          <div class="text-[12px] text-medium-emphasis">
            名单内的人**不推送**：定时催办与到达提醒都不会发给他们（白名单优先于推送人员）
          </div>
        </div>
      </div>

      <v-divider />

      <div class="px-5 py-4">
        <div class="d-flex align-center ga-2 mb-2">
          <span class="field-title">免打扰人员</span>
          <v-chip v-if="draft.whitelist.length > 0" label size="x-small" variant="tonal">
            {{ draft.whitelist.length }} 人
          </v-chip>
          <v-spacer />
          <v-btn color="primary" prepend-icon="mdi-plus" size="small" variant="tonal"
            @click="openPicker('whitelist')">添加人员</v-btn>
        </div>

        <PushPeopleList :people="draft.whitelist" empty="白名单是空的：所有人都可能收到提醒"
          @remove="p => removePerson('whitelist', p)" />
      </div>
    </v-sheet>

    <!--
      ④ 执行日志：定时跑批到底跑没跑、发了什么。
      只读，与上面三个板块（改规则）分开 —— 它不需要保存，也不参与「保存 / 恢复默认」的草稿。
    -->
    <v-sheet class="overflow-hidden mt-6 p-4" rounded="15">
      <div class="d-flex align-center ga-3 px-5 py-3">
        <v-avatar color="primary" size="30" variant="tonal">
          <v-icon size="16">mdi-history</v-icon>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="text-[14px] font-semibold">执行日志</div>

          <div class="text-[12px] text-medium-emphasis">
            每轮跑了多久、扫描多少、该提醒多少、真发多少、被哪条规则挡掉
            <template v-if="log">（最多留最近 {{ log.limits.entries }} 轮，每轮最多 {{ log.limits.tasks }} 条明细）</template>
          </div>
        </div>

        <v-btn :loading="logLoading" prepend-icon="mdi-refresh" size="small" variant="text" @click="reloadLog">
          刷新
        </v-btn>

        <v-btn color="primary" :loading="probing" prepend-icon="mdi-play-circle-outline" size="small" variant="tonal"
          @click="runDryRun">立即试算</v-btn>
      </div>

      <v-divider />

      <div class="px-5 py-4">
        <!--
          进程内定时的开关状态放在最前面：它比"日志是空的"更能说明问题 ——
          没开定时时界面该说"靠外部 cron"，而不是让人以为跑批坏了。
        -->
        <div class="d-flex flex-wrap align-center ga-2 mb-3">
          <v-chip :color="log?.timer.enabled ? 'success' : 'warning'" label size="small" variant="tonal">
            {{ timerText }}
          </v-chip>

          <v-chip v-if="log?.timer.enabled" :color="log.timer.send ? 'warning' : undefined" label size="small"
            variant="tonal">
            {{ log.timer.send ? '会真发消息' : '只试算不发' }}
          </v-chip>

          <span v-if="log" class="text-[11.5px] text-medium-emphasis">
            服务启动于 {{ formatDate(log.since) }}{{ lastRunText }}
          </span>
        </div>

        <v-alert v-if="logError" density="compact" type="warning" variant="tonal">{{ logError }}</v-alert>

        <div v-else-if="runs.length === 0" class="text-[12.5px] text-medium-emphasis">
          本次服务启动后还没跑过。可点右上「立即试算」看一遍会提醒哪些单（不发消息），或等定时任务 / 外部 cron 触发。
        </div>

        <v-table v-else class="run-table" density="compact" hover>
          <thead>
            <tr>
              <th>时间</th>
              <th>触发</th>
              <th>模式</th>
              <th>扫描 / 应提醒 / 已发</th>
              <th>跳过 / 升级</th>
              <th>结果</th>
              <th class="text-right">耗时</th>
              <th />
            </tr>
          </thead>

          <tbody>
            <template v-for="run in runs" :key="run.at">
              <tr>
                <td class="text-no-wrap">{{ formatDate(run.at) }}</td>
                <td>
                  <v-chip :color="TRIGGER_META[run.trigger].color" label size="x-small" variant="tonal">
                    {{ TRIGGER_META[run.trigger].text }}
                  </v-chip>
                </td>
                <td>{{ run.dryRun ? '试算' : '真发' }}</td>
                <td class="text-no-wrap">{{ run.scanned }} / {{ run.due }} / {{ run.sent }}</td>
                <td class="text-no-wrap">{{ run.skippedInterval }} / {{ run.escalated }}</td>
                <td>
                  <v-chip :color="statusOf(run).color" label size="x-small" :title="statusOf(run).hint"
                    variant="tonal">{{ statusOf(run).text }}</v-chip>
                </td>
                <td class="text-no-wrap text-right">{{ run.ms }} ms</td>
                <td class="text-right">
                  <v-btn size="x-small" variant="text" @click="toggleRun(run.at)">
                    {{ expandedRun === run.at ? '收起' : '明细' }}
                  </v-btn>
                </td>
              </tr>

              <!-- 明细：挡掉的原因 / 失败 / 这一轮该提醒哪些单 -->
              <tr v-if="expandedRun === run.at">
                <td class="run-detail" colspan="8">
                  <div v-if="run.gate">被推送规则挡掉：{{ run.gate }}</div>
                  <div v-if="run.fatal" class="text-error">跑批失败：{{ run.fatal }}</div>
                  <template v-if="run.errors.length > 0">
                    <div>失败 / 告警（{{ run.errors.length }} 条）：</div>
                    <div v-for="(e, i) in run.errors" :key="i" class="pl-3">· {{ e }}</div>
                  </template>
                  <template v-if="run.tasks.length > 0">
                    <div class="mt-1">这一轮该提醒的单（{{ run.tasks.length }} 条）：</div>
                    <div v-for="t in run.tasks" :key="`${t.orderNo}-${t.level}`" class="pl-3">
                      · {{ t.orderNo }} 第 {{ t.stepIndex }} 环 · 已等 {{ t.hours }} 工作日小时 ·
                      {{ t.level === '5d' ? '升级' : '催办' }} · 待 {{t.waiting.map(m => m.name || m.email).join('、') || '—'
                      }}
                    </div>
                  </template>
                  <div v-if="!run.gate && !run.fatal && run.errors.length === 0 && run.tasks.length === 0">
                    这一轮没有需要提醒的单，也没有错误。
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </v-table>
      </div>
    </v-sheet>

    <!-- 底部动作条：改的是一整份规则，所以只在保存时落库（与"点一下改一条"的角色设置不同） -->
    <v-sheet class="d-flex align-center flex-wrap ga-3 mt-6 p-4" rounded="15">
      <v-icon color="primary" size="16">mdi-information-outline</v-icon>
      <span class="text-[12px] text-medium-emphasis flex-grow-1">
        规则保存后立即生效；「恢复默认」= 回到 工作日 48 小时后开始、每 24 小时提醒当前审批人
      </span>
      <v-btn :disabled="loading || saving" size="small" variant="text" @click="confirmReset = true">
        恢复默认
      </v-btn>
      <v-btn color="primary" :disabled="loading" :loading="saving" size="small" variant="flat" @click="save">
        保存
      </v-btn>
    </v-sheet>

    <!-- 选人：直接复用「通讯录」（组织架构树），与角色设置里换审批人同一套 -->
    <v-dialog v-model="pickerOpen" max-width="900">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
          <div class="d-flex align-center ga-2">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-icon icon="mdi-account-plus-outline" size="16" />
            </v-avatar>
            <span class="text-[15px] font-bold">
              添加{{ pickerTarget === 'receivers' ? '推送人员' : '白名单人员' }}
            </span>
          </div>

          <v-icon-btn icon="mdi-close" size="small" variant="text" @click="pickerOpen = false" />
        </v-card-title>

        <v-divider />

        <v-card-text class="px-6 py-4">
          <div class="approver-tree">
            <OrgTree @select="onOrgSelect" />
          </div>

          <div v-if="picked" class="picked-box d-flex align-center ga-3 mt-3 px-3 py-2">
            <v-avatar color="primary" size="36" variant="tonal">
              <v-img v-if="picked.avatar" :alt="picked.name" :src="picked.avatar" />
              <span v-else class="text-[13px] font-semibold">{{ picked.name.slice(0, 1) }}</span>
            </v-avatar>

            <div class="d-flex flex-column">
              <span class="text-[13px] font-semibold">{{ picked.name }}</span>
              <span class="text-[11px] text-medium-emphasis">
                {{ picked.department_path || picked.department || '—' }}
                <template v-if="picked.email"> · {{ picked.email }}</template>
              </span>
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn variant="text" @click="pickerOpen = false">取消</v-btn>
          <v-btn color="primary" :disabled="!picked" variant="flat" @click="confirmPick">添加</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 恢复默认要确认：它会删掉整份自定义规则（虽然可以再配回来） -->
    <v-dialog v-model="confirmReset" max-width="440">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center ga-2 px-6 py-4">
          <v-avatar color="warning" size="28" variant="tonal">
            <v-icon size="16">mdi-backup-restore</v-icon>
          </v-avatar>
          <span class="text-[15px] font-semibold">恢复默认推送规则</span>
        </v-card-title>

        <v-divider />

        <v-card-text class="px-6 py-5 text-[13px]">
          将清空当前保存的规则，回到默认：
          <b>工作日 48 小时后开始、每 24 小时提醒当前审批人</b>，白名单为空。
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn variant="text" @click="confirmReset = false">取消</v-btn>
          <v-btn color="warning" :loading="resetting" variant="flat" @click="runReset">确定</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="hint.show" :color="hint.color" location="top" timeout="3000" variant="tonal">
      {{ hint.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
// 执行日志（GET /api/reminders/log）与「立即试算」：打的是 app server（3002），不是 PocketBase
import { fetchReminderLog, type ReminderLogPayload, type ReminderRunEntry, runReminderOnce } from '@/api/api'
import OrgTree from '@/components/OrgTree.vue'
import type { OrgSelectPayload, OrgSelectedUser } from '@/components/OrgTree.vue'
import PushPeopleList from '@/components/PushPeopleList.vue'
// 规则读写独立成模块（不放在 utils/collection：那边已经 import 了 notifySteps，会成环，见 pushRulesStore）
import {
  loadPushRules,
  PUSH_RULES_SETUP_ERROR,
  resetPushRules,
  savePushRules,
} from '@/utils/pushRulesStore'
import {
  DEFAULT_PUSH_RULES,
  normalizePerson,
  personKeyOf,
  PUSH_FREQUENCY_OPTIONS,
  PUSH_INTERVAL_MAX,
  PUSH_INTERVAL_MIN,
  PUSH_INTERVAL_OPTIONS,
  PUSH_TIME_RE,
  pushCadenceText,
  RECEIVER_MODE_OPTIONS,
  type PushPerson,
  type PushRules,
} from '@/utils/pushRules'
// 时间展示（YYYY-MM-DD HH:mm:ss）：与首页表格同一套，别在本页另写一份
import { formatDate } from '@/utils/utils'

/*
 * 页面只持有**一份草稿**：从库里读出来放进 draft，改的都是它，点「保存」才整份写回去。
 * 为什么不改一处存一处（像角色设置那样）：这几项互相牵连（比如把口径从"当前审批人"
 * 改成"仅指定人员"时要保证名单非空），半保存的状态没有任何业务意义。
 */
const draft = ref<PushRules>({ ...DEFAULT_PUSH_RULES })
const custom = ref(false)
const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const confirmReset = ref(false)

const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
  show: false,
  text: '',
  color: 'success',
})
function showHint(text: string, color: 'success' | 'error' | 'warning' = 'warning') {
  hint.value = { show: true, text, color }
}

const frequencyHint = computed(
  () => PUSH_FREQUENCY_OPTIONS.find(o => o.value === draft.value.frequency)?.hint ?? '',
)

/**
 * 推送间隔的下拉项：常用档位 + **当前值**（库里存着的那个数）。
 *
 * 为什么要并上当前值：库里可能存着一个不在档位里的数（比如以前手工填过 3），
 * 不并进来的话 v-select 会显示空白 —— 用户看到的和库里存的不是一回事。
 *
 * 档位表本身就是升序的，所以**按位置插入**就够，不用再排序（也不动原数组）。
 */
const intervalOptions = computed(() => {
  const current = Number(draft.value.intervalHours)
  const values = PUSH_INTERVAL_OPTIONS.map(o => o.value)
  if (Number.isFinite(current) && current >= PUSH_INTERVAL_MIN && !values.includes(current)) {
    const at = values.findIndex(v => v > current)
    values.splice(at < 0 ? values.length : at, 0, current)
  }
  return values.map(v => ({ value: v, title: `每 ${v} 小时` }))
})

/**
 * 间隔的说明：档位里有就用它写的那句，否则给一句通用的（手工填的值没有文案）。
 * 末尾统一带上"第二天重新起算" —— 那是用户最容易误解的一处（以为间隔会跨天累计、越推越晚）。
 */
const intervalHint = computed(() => {
  const base = PUSH_INTERVAL_OPTIONS.find(o => o.value === Number(draft.value.intervalHours))?.hint
    ?? '超时后按这个间隔重复提醒'
  return `${base}；第二天从推送时间重新起算`
})

/** 「超时后会怎么推」的一句话（口径在 utils/pushRules，页面不自己拼字符串） */
const cadenceText = computed(() => pushCadenceText(draft.value))

/** 读规则：读失败回落默认规则（集合还没建时页面也要能打开），所以这里不需要 try/catch */
async function reload() {
  loading.value = true
  try {
    const res = await loadPushRules()
    draft.value = res.rules
    custom.value = res.custom
  } finally {
    loading.value = false
  }
}

/* ==================== 选人（通讯录） ==================== */

const pickerOpen = ref(false)
const pickerTarget = ref<'receivers' | 'whitelist'>('receivers')
const picked = ref<OrgSelectedUser | null>(null)

function openPicker(target: 'receivers' | 'whitelist') {
  pickerTarget.value = target
  picked.value = null
  pickerOpen.value = true
}

/** 通讯录里只能选**人**：点到部门时忽略并提示，否则会把部门名当成一个人存进白名单 */
function onOrgSelect(payload: OrgSelectPayload | null) {
  if (!payload) {
    return
  }
  if (payload.type !== 'user') {
    showHint('请在通讯录里点选成员，而不是部门')
    return
  }
  picked.value = payload.user
}

function confirmPick() {
  const user = picked.value
  const person = normalizePerson(user)
  if (!person) {
    return
  }
  const target = pickerTarget.value
  const list = draft.value[target]
  if (list.some(p => personKeyOf(p) === personKeyOf(person))) {
    showHint(`「${person.name}」已经在列表里了`)
    return
  }
  list.push(person)
  pickerOpen.value = false

  /*
   * 加进白名单的人如果同时又在推送人员里，一定要说一声：白名单优先，
   * 那两个地方都填了的话，用户会以为"填了就该收到"，结果一条都收不到。
   */
  if (target === 'whitelist' && draft.value.receivers.some(p => personKeyOf(p) === personKeyOf(person))) {
    showHint(`「${person.name}」还在「推送人员」里，白名单优先 —— TA 不会收到推送`, 'warning')
    return
  }
  showHint(`已添加「${person.name}」`, 'success')
}

function removePerson(target: 'receivers' | 'whitelist', person: PushPerson) {
  draft.value[target] = draft.value[target].filter(p => personKeyOf(p) !== personKeyOf(person))
}

/* ==================== 保存 / 恢复默认 ==================== */

/** 提交前的检查：能当场判定的都在这里拦住，别让跑批拿着不完整的规则空转 */
function validate(): string | null {
  if (!PUSH_TIME_RE.test(String(draft.value.sendTime ?? '').trim())) {
    return '推送时间要填 09:00 这种格式'
  }
  const hours = Number(draft.value.overdueHours)
  if (!Number.isFinite(hours) || hours <= 0) {
    return '超时阈值要填大于 0 的工作日小时数'
  }
  /*
   * 间隔必须在 1~168 小时之间：
   *   0 / 负数会让"每次都发"（跑批每 tick 一条，比不推更糟）；
   *   超过一周基本等于"不再重复"，那种需求应该直接关掉总开关，而不是填一个假数字。
   * ⚠️ 跑批侧还会再收敛一次（normalizePushRules）—— 这里的拦截只是为了让用户当场看到问题。
   */
  const interval = Number(draft.value.intervalHours)
  if (!Number.isFinite(interval) || interval < PUSH_INTERVAL_MIN || interval > PUSH_INTERVAL_MAX) {
    return `推送间隔要填 ${PUSH_INTERVAL_MIN}~${PUSH_INTERVAL_MAX} 之间的整数小时`
  }
  if (draft.value.receiverMode !== 'approver' && draft.value.receivers.length === 0) {
    return '推送人员选了「指定人员」，但一个人都还没加'
  }
  return null
}

/** 写失败时的提示：环境没准备好（没跑迁移）就把原因原样说出来，其余换成通用文案 */
function writeErrorHint(error: unknown): string {
  return error instanceof Error && error.name === PUSH_RULES_SETUP_ERROR
    ? error.message
    : '保存失败，请稍后重试'
}

async function save() {
  const bad = validate()
  if (bad) {
    showHint(bad, 'warning')
    return
  }
  saving.value = true
  try {
    await savePushRules(draft.value)
    await reload()
    showHint('推送规则已保存', 'success')
  } catch (error) {
    console.error('[alarmSetting] 保存推送规则失败:', error)
    // 失败必须显式提示：静默失败的话，下次进页面又变回旧值，用户会以为界面在骗他
    showHint(writeErrorHint(error), 'error')
  } finally {
    saving.value = false
  }
}

async function runReset() {
  resetting.value = true
  try {
    await resetPushRules()
    await reload()
    confirmReset.value = false
    showHint('已恢复默认推送规则', 'success')
  } catch (error) {
    console.error('[alarmSetting] 恢复默认失败:', error)
    showHint(writeErrorHint(error), 'error')
  } finally {
    resetting.value = false
  }
}

/* ==================== 执行日志（只读） ==================== */

const log = ref<ReminderLogPayload | null>(null)
const logLoading = ref(false)
const logError = ref('')
const probing = ref(false)
/** 哪一行的明细是展开的（同一时刻只展开一条，省得一屏全是明细） */
const expandedRun = ref('')

const runs = computed(() => log.value?.items ?? [])

/** 进程内定时的情况：没开时说清"靠外部 cron"，别让人以为跑批坏了 */
const timerText = computed(() => {
  const t = log.value?.timer
  if (!t) {
    return '定时状态未知'
  }
  return t.enabled ? `进程内定时：每 ${t.intervalMin} 分钟` : '进程内定时未开启（靠外部 cron 打接口）'
})

/** 最近一轮是多久之前 —— "定时任务还活着没有"看这一眼最直观 */
const lastRunText = computed(() => {
  const at = runs.value[0]?.at
  return at ? `；最近一轮 ${fromNow(at)}` : ''
})

const TRIGGER_META: Record<ReminderRunEntry['trigger'], { text: string, color?: string }> = {
  timer: { text: '定时', color: 'success' },
  http: { text: '外部 cron' },
  manual: { text: '手动试算', color: 'info' },
}

/**
 * 一轮的结果标签。判定顺序 = 严重程度：
 * 跑批挂了 > 被规则整轮挡掉 > 有单条失败 > 试算 > 真发 > 间隔未到 > 没有超时单。
 * 顺序不能乱 —— 比如"有错误"同时又"发了 3 条"时，得先让人看到"有错误"。
 */
function statusOf(run: ReminderRunEntry): { text: string, color?: string, hint?: string } {
  if (run.fatal) {
    return { text: '失败', color: 'error', hint: run.fatal }
  }
  if (run.gate) {
    return { text: '被规则挡掉', color: 'warning', hint: run.gate }
  }
  if (run.errors.length > 0) {
    return { text: `有 ${run.errors.length} 条错误`, color: 'warning', hint: run.errors.join('\n') }
  }
  if (run.dryRun) {
    return {
      text: run.due > 0 ? `试算：应提醒 ${run.due} 单` : '试算：无超时单',
      hint: '试算只算不发，不会打扰任何人',
    }
  }
  if (run.sent > 0) {
    return { text: `已发 ${run.sent} 条`, color: 'success' }
  }
  if (run.skippedInterval > 0) {
    return { text: `间隔未到，跳过 ${run.skippedInterval} 单`, color: 'info' }
  }
  return { text: '无超时单' }
}

function toggleRun(at: string) {
  expandedRun.value = expandedRun.value === at ? '' : at
}

/**
 * "3 分钟前"。自己算而**不引 dayjs**：本文件没引它，而 relativeTime 插件是在
 * utils/utils 里 extend 的 —— 依赖"顺手引了别的东西才生效"太脆。
 */
function fromNow(iso?: string): string {
  const ms = iso ? Date.now() - Date.parse(iso) : Number.NaN
  if (!Number.isFinite(ms) || ms < 0) {
    return ''
  }
  const min = Math.floor(ms / 60_000)
  if (min < 1) {
    return '刚刚'
  }
  if (min < 60) {
    return `${min} 分钟前`
  }
  const hr = Math.floor(min / 60)
  if (hr < 24) {
    return `${hr} 小时前`
  }
  return `${Math.floor(hr / 24)} 天前`
}

async function reloadLog() {
  logLoading.value = true
  try {
    log.value = await fetchReminderLog()
    logError.value = ''
  } catch (error) {
    // 读不到必须说出来：这时列表是空的，不说的话看起来就像"跑批一次都没跑"
    console.error('[alarmSetting] 读取执行日志失败:', error)
    logError.value = error instanceof Error ? error.message : '读取执行日志失败'
  } finally {
    logLoading.value = false
  }
}

/**
 * 「立即试算」：跑一遍 dry-run（**不发消息**），再把日志刷出来 —— 结果就落在下面的表里。
 * 用 dry-run 而不是真发：这个按钮是给运维"确认口径对不对"用的，不该真打扰同事。
 */
async function runDryRun() {
  probing.value = true
  try {
    const report = await runReminderOnce()
    await reloadLog()
    showHint(
      report.due ? `试算完成：应提醒 ${report.due} 单（未发送）` : '试算完成：当前没有超时的单',
      'success',
    )
  } catch (error) {
    console.error('[alarmSetting] 试算失败:', error)
    showHint(error instanceof Error ? error.message : '试算失败', 'error')
  } finally {
    probing.value = false
  }
}

onMounted(() => {
  void reload()
  // 日志与规则各读各的：日志读失败不该挡住规则编辑（反过来也一样）
  void reloadLog()
})
</script>

<style scoped>
/* ===== 执行日志表格：字号压到 12px，与页面其它说明文字同一档 ===== */
.run-table {
  font-size: 12px;
}

.run-table :deep(th) {
  font-size: 11.5px;
  white-space: nowrap;
}

/* 展开的明细行：淡底色 + 小字号，与表体区分开（暗色主题单独给一档） */
.run-detail {
  background-color: rgba(28, 40, 72, 0.03);
  font-size: 11.5px;
  line-height: 1.8;
}

.v-theme--dark .run-detail {
  background-color: rgba(255, 255, 255, 0.04);
}

.field-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* 三种推送口径：卡片式单选，点整块都能选中 */
.mode-card {
  display: flex;
  align-items: center;
  min-width: 200px;
  padding: 6px 12px;
  border: 1px solid rgba(28, 40, 72, 0.14);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.mode-card:hover {
  background-color: rgba(28, 40, 72, 0.04);
}

.mode-card-active {
  border-color: rgb(var(--v-theme-primary));
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 7%, transparent);
}

.v-theme--dark .mode-card {
  border-color: rgba(255, 255, 255, 0.16);
}

.v-theme--dark .mode-card:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.v-theme--dark .mode-card-active {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent);
}

.mode-card :deep(.v-selection-control) {
  --v-selection-control-size: 20px;
}

/* 通讯录在弹窗里要有界高度（它自带的 max-height 是按整屏算的，弹窗里会高得离谱） */
.approver-tree :deep(.org-sheet) {
  max-height: 420px;
}

.picked-box {
  background-color: rgb(var(--v-theme-primary) / 7%);
  border: 1px solid rgb(var(--v-theme-primary) / 22%);
  border-radius: 10px;
}

/* ===== 定时推送的四个条件框：尺寸与字号都比 Vuetify 的 compact 再小一档 =====
 *
 * 这几个数是**成组**用的（与全局 .filter-select、components/ApprovalNode 的 .qty-input
 * 同一套写法）—— 少一项文字就会在框里偏：
 *   1. 上下内边距**必须对称**（这里都是 1px）：Vuetify 用它们给浮动标签与文字定位，
 *      写成上 4 下 2 时文字会被往下顶一截，看起来就是"字没在框中间"；
 *   2. 控件高与输入区高度要**配平**：36 = 34（输入区）+ 1 + 1（上下内边距）——
 *      只改其中一个，多出来的空间会被勉强分摊，同样表现为偏移；
 *   3. 输入区自己也要给 padding：光改 .v-field 的变量，里面 .v-field__input 仍带着默认
 *      的上下留白，字就顶到上边去了；
 *   4. 字号要同时落在 .v-field__input 与 .v-label（Vuetify 内部节点，只能 :deep 穿透）。
 *
 * 为什么单开一个类而不是直接用全局的 .filter-select：那套是**表格筛选**的口径（28px / 12px），
 * 贴在这张设置卡片里显得过小、和旁边的单选卡片不成比例；这里取"表单默认再小一档"。
 * 要再调大小，按上面第 2 条的配平关系同时改「控件高 / 输入区高度」两个数。
 */
.push-controls :deep(.v-field) {
  --v-input-control-height: 36px;
  --v-field-padding-top: 1px;
  --v-field-padding-bottom: 1px;
  font-size: 14px;
}

.push-controls :deep(.v-field__input) {
  min-height: 34px;
  padding-top: 1px;
  padding-bottom: 1px;
  font-size: 14px;
}

.push-controls :deep(.v-label) {
  font-size: 14px;
}

/* 后缀（工作日小时）与下拉箭头：显式垂直居中 —— 默认会靠上，字变小以后更明显 */
.push-controls :deep(.v-field__append-inner),
.push-controls :deep(.v-field__prepend-inner) {
  align-self: center;
  padding-top: 0;
}

/* ===== 「工作日小时」这类**后缀文字**：把 Vuetify 给它单独加的高度清掉 =====
 *
 * Vuetify 对后缀另有一套尺寸（见 node_modules/vuetify/.../VTextField.css）：
 *     .v-text-field__suffix {
 *       min-height: max(var(--v-input-control-height,56px), 1.5rem + 上下 padding);
 *       padding-top: var(--v-field-padding-top);
 *       padding-bottom: var(--v-field-padding-bottom);
 *     }
 * 在本页的紧凑档里，输入区是 34px + 1 + 1 = 36，而后缀是「36 + 1 + 1」= 38 ——
 * 同一行里两个高度不一样、又各自按自己的中线居中，于是数字与「工作日小时」不在一条基线上，
 * 整行还被后缀撑高 2px（四个框只有带后缀的那个高一点）。
 * 归零后两者同高，统一交给 .v-field__input 的 align-items: center 居中。
 */
.push-controls :deep(.v-text-field__suffix),
.push-controls :deep(.v-text-field__prefix) {
  min-height: 0;
  padding-top: 7px;
  padding-bottom: 0;
}

/* 「推送频率」的按钮组也在这一行：一起收一档，否则它比旁边三个框明显高一截 */
.push-controls :deep(.v-btn-toggle .v-btn) {
  --v-btn-height: 32px;
  font-size: 13px;
}
</style>
