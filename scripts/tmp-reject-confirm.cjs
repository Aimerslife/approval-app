// 临时补丁：HandleDock 驳回按钮加二次确认弹窗。用完即删
const fs = require('node:fs')
const path = 'd:/project/vuetify_approval/vite-project/approval-app/src/components/approval/HandleDock.vue'
let src = fs.readFileSync(path, 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const norm = s => s.split('\n').join(nl)
const anchorOf = s => norm(s)

// 1) 模板：在 dialog 模式 v-dialog 之后插入驳回确认弹窗
{
  const anchor = anchorOf([
    '    </v-dialog>',
    '  </div>',
    '</template>',
  ].join('\n'))
  if (!src.includes(anchor)) throw new Error('template anchor not found')
  const insertion = anchorOf([
    '',
    '',
    '    <!-- 驳回二次确认：标题条一键直达没有输入位，动的是流转方向，先拦一道防误触 -->',
    '    <v-dialog v-model="rejectConfirm" max-width="430">',
    '      <v-card prepend-icon="mdi-arrow-u-left-top" title="确认驳回？">',
    '        <v-card-text class="text-[13px]">',
    '          将以「回退上级」结论驳回<span v-if="rejectStepName">「{{ rejectStepName }}」</span>这一环，',
    '          流程会退回上一个环节或直接终结（按模板配置）。',
    '          <div class="mt-2 text-medium-emphasis">',
    '            驳回不携带审批意见，如需留痕请用「办理」进表单操作。该操作<strong>立即生效</strong>。',
    '          </div>',
    '        </v-card-text>',
    '',
    '        <v-card-actions class="px-4 pb-4">',
    '          <v-spacer />',
    '          <v-btn :disabled="rejecting" variant="text" @click="rejectConfirm = false">取消</v-btn>',
    '          <v-btn color="error" :disabled="!pendingGroup" :loading="rejecting" variant="flat"',
    '            @click="confirmRejectBack">',
    '            确认驳回',
    '          </v-btn>',
    '        </v-card-actions>',
    '      </v-card>',
    '    </v-dialog>',
    '  </div>',
    '</template>',
  ].join('\n'))
  src = src.replace(anchor, insertion)
}

// 2) 脚本：handleRejectBack 拆为「开确认弹窗」+「确认后提交」
{
  const anchor = anchorOf([
    '/**',
    ' * 一键回退上级：以「驳回」结论提交**当前待办环** —— 模板里那条分支要么回退到',
    ' * 上一个别人办的环节（loopBackTo），要么直接终结流程。',
    ' * 意见 / 附件留空：标题条上没有输入位，需要留痕的意见写进时间线评论或后续环节补充。',
    ' */',
    'function handleRejectBack() {',
    '  const g = pendingGroup.value',
    '  if (!g || rejecting.value) return',
    '  rejecting.value = true',
    '  emit(\'submit\', {',
    '    index: props.currentStep,',
    '    result: REJECT_RESULT,',
    '    result_label: \'回退上级\',',
    '    extra: {},',
    '    opinion: \'\',',
    '    files: [],',
    '    done: () => {',
    '      rejecting.value = false',
    '    },',
    '  })',
    '}',
  ].join('\n'))
  if (!src.includes(anchor)) throw new Error('script anchor not found')
  const replacement = anchorOf([
    '/** 驳回确认弹窗：点「驳回」先拦一道，确认后才真正提交 */',
    'const rejectConfirm = ref(false)',
    '',
    '/** 确认弹窗里点名的那一环（时间线节点名），取不到就只说"这一环" */',
    'const rejectStepName = computed(() => {',
    '  const g = pendingGroup.value',
    '  if (!g) return \'\'',
    '  const pos = g.indexes.indexOf(props.currentStep)',
    '  return g.steps[pos]?.[0]?.node_name ?? g.steps[0]?.[0]?.node_name ?? \'\'',
    '})',
    '',
    '/**',
    ' * 一键回退上级（第一步）：只打开确认弹窗，不做任何提交。',
    ' * 驳回动的是流转方向（退回上一环或终结流程），防误触必须先确认。',
    ' */',
    'function handleRejectBack() {',
    '  if (rejecting.value) return',
    '  rejectConfirm.value = true',
    '}',
    '',
    '/**',
    ' * 确认驳回（第二步）：关弹窗，以「驳回」结论提交**当前待办环** —— 模板里那条分支',
    ' * 要么回退到上一个别人办的环节（loopBackTo），要么直接终结流程。',
    ' * 意见 / 附件留空：确认弹窗没有输入位，需要留痕的意见写进时间线评论或后续环节补充。',
    ' */',
    'function confirmRejectBack() {',
    '  const g = pendingGroup.value',
    '  if (!g || rejecting.value) return',
    '  rejectConfirm.value = false',
    '  rejecting.value = true',
    '  emit(\'submit\', {',
    '    index: props.currentStep,',
    '    result: REJECT_RESULT,',
    '    result_label: \'回退上级\',',
    '    extra: {},',
    '    opinion: \'\',',
    '    files: [],',
    '    done: () => {',
    '      rejecting.value = false',
    '    },',
    '  })',
    '}',
  ].join('\n'))
  src = src.replace(anchor, replacement)
}

fs.writeFileSync(path, src)
console.log('PATCH-OK')
