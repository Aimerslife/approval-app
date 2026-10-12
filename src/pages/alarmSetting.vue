<template>
  <v-container class="page-bg px-30 pb-6 pt-10" fluid>
    <!-- 页头 -->
    <div class="d-flex align-start justify-space-between flex-wrap ga-3 mb-4 px-1">
      <div>
        <div class="text-[20px] font-bold">提醒设置</div>
        <div class="text-[12.5px] text-medium-emphasis mt-1">
          配置飞书推送规则：定时催办、推送人员与白名单。保存后由超时跑批执行
        </div>
      </div>

      <v-chip :color="custom ? 'primary' : undefined" label size="small" variant="tonal">
        {{ custom ? '已自定义' : '默认规则' }}
      </v-chip>
    </div>

    <!-- ① 定时推送：开关 + 频率 + 时间 + 超时阈值 -->
    <v-sheet class="overflow-hidden" rounded="xl">
      <div class="d-flex align-center ga-3 px-5 py-3">
        <v-avatar color="primary" size="30" variant="tonal">
          <v-icon size="16">mdi-alarm-check</v-icon>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="text-[14px] font-semibold">审批流定时推送</div>
          <div class="text-[12px] text-medium-emphasis">待办超过阈值后，按下面的频率提醒相关人</div>
        </div>

        <v-switch
          v-model="draft.enabled"
          color="primary"
          density="compact"
          hide-details
          inset
          :label="draft.enabled ? '已开启' : '已关闭'"
        />
      </div>

      <v-divider />

      <div class="d-flex flex-wrap ga-8 px-5 py-4">
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

        <div style="min-width: 200px">
          <div class="field-title mb-2">推送时间</div>

          <v-text-field
            v-model="draft.sendTime"
            density="compact"
            hide-details="auto"
            placeholder="09:00"
            single-line
            style="max-width: 160px"
            type="time"
            variant="outlined"
          >
            <template #message>
              <!--
                跑批是"到点之后最近的第一次执行"，不是"准时在 09:00 发" —— 说清楚，
                否则用户会以为定时器和这个字段联动，等不到消息就去查代码。
              -->
              <span class="text-[11px]">每天**不早于**该时刻推送；建议外部 cron 从该时刻起每 10 分钟打一次
                /api/reminders/run?send=1（同一单当天只会发一条）</span>
            </template>
          </v-text-field>
        </div>

        <div style="min-width: 200px">
          <div class="field-title mb-2">超时阈值</div>

          <v-text-field
            v-model.number="draft.overdueHours"
            density="compact"
            hide-details
            :min="1"
            single-line
            style="max-width: 180px"
            suffix="工作日小时"
            type="number"
            variant="outlined"
          />

          <div class="text-[11px] text-medium-emphasis mt-1">
            按**工作日**计时（周末不计），业务原口径 48 小时
          </div>
        </div>
      </div>
    </v-sheet>

    <!-- ② 推送人员：默认当前审批人，也可固定发某几个人 -->
    <v-sheet class="overflow-hidden mt-6" rounded="xl">
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

      <div class="px-5 py-4">
        <v-radio-group v-model="draft.receiverMode" class="receiver-radio" hide-details>
          <div class="d-flex flex-wrap ga-3">
            <div
              v-for="opt in RECEIVER_MODE_OPTIONS"
              :key="opt.value"
              class="mode-card"
              :class="{ 'mode-card-active': draft.receiverMode === opt.value }"
              @click="draft.receiverMode = opt.value"
            >
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

          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            size="small"
            variant="tonal"
            @click="openPicker('receivers')"
          >添加人员</v-btn>
        </div>

        <PushPeopleList :people="draft.receivers" empty="还没有指定人员（选「当前审批人」时这里可以留空）"
          @remove="p => removePerson('receivers', p)" />
      </div>
    </v-sheet>

    <!-- ③ 白名单：名单内的人不推送 -->
    <v-sheet class="overflow-hidden mt-6" rounded="xl">
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

          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            size="small"
            variant="tonal"
            @click="openPicker('whitelist')"
          >添加人员</v-btn>
        </div>

        <PushPeopleList :people="draft.whitelist" empty="白名单是空的：所有人都可能收到提醒"
          @remove="p => removePerson('whitelist', p)" />
      </div>
    </v-sheet>

    <!-- 底部动作条：改的是一整份规则，所以只在保存时落库（与"点一下改一条"的角色设置不同） -->
    <v-sheet class="d-flex align-center flex-wrap ga-3 mt-6 px-5 py-3" rounded="xl">
      <v-icon color="primary" size="16">mdi-information-outline</v-icon>
      <span class="text-[12px] text-medium-emphasis flex-grow-1">
        规则保存后立即生效；「恢复默认」= 回到 工作日 48h 起每天提醒当前审批人
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
          <b>工作日 48 小时起、每天提醒当前审批人</b>，白名单为空。
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
    PUSH_TIME_RE,
    RECEIVER_MODE_OPTIONS,
    type PushPerson,
    type PushRules,
  } from '@/utils/pushRules'

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
  function showHint (text: string, color: 'success' | 'error' | 'warning' = 'warning') {
    hint.value = { show: true, text, color }
  }

  const frequencyHint = computed(
    () => PUSH_FREQUENCY_OPTIONS.find(o => o.value === draft.value.frequency)?.hint ?? '',
  )

  /** 读规则：读失败回落默认规则（集合还没建时页面也要能打开），所以这里不需要 try/catch */
  async function reload () {
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

  function openPicker (target: 'receivers' | 'whitelist') {
    pickerTarget.value = target
    picked.value = null
    pickerOpen.value = true
  }

  /** 通讯录里只能选**人**：点到部门时忽略并提示，否则会把部门名当成一个人存进白名单 */
  function onOrgSelect (payload: OrgSelectPayload | null) {
    if (!payload) {
      return
    }
    if (payload.type !== 'user') {
      showHint('请在通讯录里点选成员，而不是部门')
      return
    }
    picked.value = payload.user
  }

  function confirmPick () {
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

  function removePerson (target: 'receivers' | 'whitelist', person: PushPerson) {
    draft.value[target] = draft.value[target].filter(p => personKeyOf(p) !== personKeyOf(person))
  }

  /* ==================== 保存 / 恢复默认 ==================== */

  /** 提交前的检查：能当场判定的都在这里拦住，别让跑批拿着不完整的规则空转 */
  function validate (): string | null {
    if (!PUSH_TIME_RE.test(String(draft.value.sendTime ?? '').trim())) {
      return '推送时间要填 09:00 这种格式'
    }
    const hours = Number(draft.value.overdueHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      return '超时阈值要填大于 0 的工作日小时数'
    }
    if (draft.value.receiverMode !== 'approver' && draft.value.receivers.length === 0) {
      return '推送人员选了「指定人员」，但一个人都还没加'
    }
    return null
  }

  /** 写失败时的提示：环境没准备好（没跑迁移）就把原因原样说出来，其余换成通用文案 */
  function writeErrorHint (error: unknown): string {
    return error instanceof Error && error.name === PUSH_RULES_SETUP_ERROR
      ? error.message
      : '保存失败，请稍后重试'
  }

  async function save () {
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

  async function runReset () {
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

  onMounted(() => {
    void reload()
  })
</script>

<style scoped>
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
</style>
