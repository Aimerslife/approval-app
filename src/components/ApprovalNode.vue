<template>
  <!--
    弃置段：`discard-zone` 这个类决定"这条要不要包进背景整块"，:style 只挂这一条的数值
    （圆角留哪几个角、上下要不要往缝里撑 —— 见 discardZoneStyle）。
    不在弃置段时两者都不生效，主链样式一个像素不动。
  -->
  <v-timeline-item :class="{ 'discard-zone': inDiscardSegment !== undefined }" class="mb-12"
    :dot-color="dotColor" :size="size" :style="discardZoneStyle">
    <template #icon>
      <span :style="{ fontSize: iconFontSize, color: iconColor }">{{ initials }}</span>
    </template>

    <!-- 弃置段的**段首**：在整块背景的左上角标一句「进入弃置流程」（整段只有这一条有） -->
    <div v-if="inDiscardSegment === 0" class="discard-flag">
      <v-icon icon="mdi-archive-arrow-down-outline" size="13" />
      <span>进入弃置流程</span>
    </div>

    <div class=" d-flex align-center justify-space-between">
      <div class="d-flex align-center gap-2">
        <span v-if="deptName" class="text-[12px]">[{{ deptName }}]</span>

        <v-avatar size="30px">
          <v-img alt="Avatar" :src="manageDatas[0]?.avatar" />
          <!-- <v-icon :color="message.color" :icon="message.icon"></v-icon> -->
        </v-avatar>

        <span class="text-body-small" :class="{ 'text-medium-emphasis text-decoration-line-through': transferredTo }">
          {{ manageDatas[0]?.name }}</span>

        <v-chip v-if="transferredTo" color="secondary" label size="x-small" variant="tonal">
          已转办 → {{ transferredTo }}
        </v-chip>

        <v-chip v-if="transferIn" color="primary" label size="x-small" variant="flat">
          转办：{{ transferIn.delegated_from }} → {{ transferIn.name }}
        </v-chip>
        <template v-if="resultChips.length > 0">
          <v-chip v-for="(c, ci) in resultChips" :key="ci" class="ms-0" color="primary" label size="x-small">
            {{ c }}
          </v-chip>
        </template>

        <template v-else-if="status">
          <v-chip class="ms-0" color="success" label size="x-small">通过</v-chip>
        </template>

        <span v-for="(t, ti) in receiveLedgerChips" :key="`ledger-${ti}`"
          class="text-[11px] text-medium-emphasis">{{ t }}</span>

        <span v-if="activeStep && !canHandle" class="text-[11px] text-medium-emphasis">未到该环节</span>
        <template v-if="activeStep && canHandle && !status">
          <v-dialog v-model="dialog" max-width="500">
            <template #activator="{ props: activatorProps }">
              <v-btn color="success" size="x-small" variant="tonal" v-bind="activatorProps"
                @click="dialogs = true">办理</v-btn>
            </template>

            <v-card>
              <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
                <v-icon color="primary" size="18">mdi-check-all</v-icon>
                <span>审批</span>

                <!-- 同一审批人连续多环：标出"这是第几个动作"，避免以为只办一次就完了 -->
                <v-chip v-if="actionTotal > 1" color="primary" label size="x-small" variant="tonal">
                  第 {{ actionNo }} / {{ actionTotal }} 个动作
                </v-chip>
              </v-card-title>

              <v-divider />

              <v-card-text class="d-flex flex-column ga-4 pb-2">

                <v-alert v-if="waitingNext" density="compact" type="info" variant="tonal">
                  已提交，正在进入下一环节（还是你办理）…
                </v-alert>

                <div v-for="(d, di) in doneActions" :key="di" class="pa-3 rounded bg-[#F6F7F9]">
                  <div class="d-flex align-center flex-wrap gap-2">
                    <v-chip color="success" label size="x-small" variant="flat">已办</v-chip>
                    <v-chip color="primary" label size="x-small" variant="tonal">{{ d.label }}</v-chip>

                    <span v-if="d.path" class="text-[11px] text-medium-emphasis">{{ d.path }}</span>
                  </div>

                  <div v-if="d.opinion" class="mt-1 text-[11px] text-medium-emphasis">意见：{{ d.opinion }}</div>

                  <div v-if="d.extras.length > 0" class="mt-1 d-flex flex-wrap align-center ga-2">
                    <span v-for="it in d.extras" :key="it.key" class="text-[11px] text-medium-emphasis">
                      {{ it.label }}：{{ it.value }}
                    </span>
                  </div>

                  <div v-if="d.files.length > 0" class="mt-1 d-flex align-center flex-wrap text-[11px]">
                    <span v-for="f in d.files" :key="f.id" class="d-inline-flex align-center cursor-pointer text-[#89898A] underline"
                      @click="showPic(f.url)">
                      <v-icon size="11">mdi-paperclip</v-icon>
                      <span class="mt-1">{{ f.name }}</span>
                    </span>
                  </div>
                </div>

                <!-- 当前要办的那个动作（连续多环时标一下，免得以为下面这块是"又一个"） -->
                <div v-if="actionTotal > 1 && activeStep" class="text-[11px] text-medium-emphasis -mb-2">
                  当前要办的动作（第 {{ actionNo }} 个）
                </div>

                <v-form v-if="radios == 'deal'" ref="handleForm" @submit.prevent="handleConfirm">
         
                  <template v-if="!hasNodeLevelTree">
                    <div class="field-label mb-2">选择处理方式</div>
                    <v-radio-group v-if="useOptionRadios" v-model="selectedOptionKey" hide-details inline>
                      <v-radio v-for="opt in selectItems" :key="opt.key" :color="radioColorOf(opt.result)"
                        :value="opt.key">
                        <template #label>
                          <span class="text-[13px]">{{ opt.text }}</span>
                        </template>
                      </v-radio>
                    </v-radio-group>

                    <v-select v-else v-model="selectedOptionKey" class="filter-select" density="compact"
                      hide-details item-title="text" item-value="key" :items="selectItems"
                      :menu-props="{ contentClass: 'filter-menu' }" single-line style="max-width: 480px"
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">选择处理方式</span>
                      </template>
                    </v-select>
                  </template>
                  <div v-if="pickedGroups.length > 0" class="mt-2">
                    <div class="field-label mb-2">办理选项</div>
                    <v-select v-model="pickedLeaf" class="filter-select" density="compact" hide-details
                      item-title="text" :items="optionMenuItems"
                      :menu-props="{ contentClass: 'filter-menu' }" placeholder="请选择" return-object single-line
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">选项</span>
                      </template>
                    </v-select>

                    <v-select v-if="leafChildren.length > 0" v-model="pickedChild" class="filter-select mt-2"
                      density="compact" hide-details :items="leafChildren"
                      :menu-props="{ contentClass: 'filter-menu' }" placeholder="请选择" single-line
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">二级选项</span>
                      </template>
                    </v-select>
                  </div>

           
                  <div v-if="needReceiveQty" class="d-flex align-center ga-2 mt-2">
           
                    <v-text-field v-model="qty" class="qty-input" density="compact" label="接收数量"
                      :readonly="receiveAll && hasReceiveCap" :rules="receiveQtyRules" single-line suffix="件"
                      variant="underlined" width="160px" />
                    <span v-if="receiveAll && hasReceiveCap" class="text-[11px] text-medium-emphasis">
                      =<template v-if="receivedQtyText">
                        （总 {{ stockQtyText }}，已接收 {{ receivedQtyText }}）</template>
                    </span>

                    <!-- 部分接收：把"还剩多少"摆在旁边，省得去翻上一环记录 -->
                    <span v-else-if="usingRemaining" class="text-[11px] text-medium-emphasis">
                      剩余 {{ receiveCapText }} 件（总 {{ stockQtyText }}，已接收 {{ receivedQtyText }}）
                    </span>

                    <span
                      v-if="receiveValueText"
                      class="text-[11px] text-medium-emphasis"
                      :title="`价值 = 总库存金额 ÷ 总库存数量 × 剩余数量 = ${stockAmountText} ÷ ${stockQtyText} × ${receiveCapText}`"
                    >
                      价值 ￥{{ receiveValueText }}
                    </span>
                  </div>

                  <div v-else-if="needRecycle" class="d-flex align-center ga-4 mt-2">
                    <v-text-field v-model="recycleQty" class="qty-input" density="compact" label="回收数量"
                      :rules="recycleQtyRules" single-line suffix="件" variant="underlined" width="160px" />

                    <v-text-field v-model="recycleAmount" class="qty-input" density="compact" label="回收金额"
                      :rules="recycleAmountRules" single-line suffix="￥" variant="underlined" width="160px" />
                  </div>

                  <div v-else-if="needScrapConfirm" class="d-flex align-center ga-2 mt-2">
                    <v-btn append-icon="mdi-transfer-right" color="error" size="small" variant="tonal"
                      @click="setClean = true">确认报废清仓</v-btn>
                  </div>

                  <div v-else-if="needReason && pickedGroups.length === 0" class="mt-2">
              
                    <v-select v-model="reason" class="filter-select" density="compact" hide-details item-title="text"
                      :items="groupedReasons" max-width="200" :menu-props="{ contentClass: 'filter-menu' }"
                      return-object single-line variant="outlined" @update:model-value="handleResonChange">
                      <template #label>
                        <span class="text-[11px]">原因</span>
                      </template>
                    </v-select>

                
                    <v-select v-if="reason.belong === '开发类'" v-model="secondReason" class="filter-select"
                      density="compact" hide-details item-title="text" :items="secondApprovalModal" max-width="180"
                      :menu-props="{ contentClass: 'filter-menu' }" return-object single-line variant="outlined"
                      @update:model-value="handleSecondResonChange">
                      <template #label>
                        <span class="text-[11px]">二级原因</span>
                      </template>
                    </v-select>

                    <template v-if="reason.belong === '外部环境'">
                      <div class="mt-2">
                        <v-textarea v-model="reasonRemark" class="remark-input" density="compact" hide-details label=""
                          max-width="300" placeholder="补充说明" rows="2" variant="outlined" />
                      </div>
                    </template>
                  </div>
                  <!--
                    「选择接收组别 / 选择接收团队」：当场指定接收方 → 该结论**终结流程**，
                    后面接的环节不再有人办（见 CLOSE_FLOW_RESULTS）
                  -->
                  <div v-if="needPick" class="mt-2">
                    <div class="d-flex align-center ga-2 flex-wrap">
                      <v-btn color="primary" :prepend-icon="picking ? 'mdi-chevron-up' : 'mdi-account-plus-outline'"
                        size="small" variant="tonal" @click="picking = !picking">
                        {{ needPickTeam ? '选择接收团队' : '选择接收组别' }}
                      </v-btn>
                    </div>

                    <div v-if="JSON.stringify(pickedMembers) !== '{}'" class="d-flex align-center ga-1 mt-2">
                      <v-chip closable size="small" @click:close="unpickMember" >
                        {{ pickedMembers.name }}
                        <!-- 选中信息 = 名字 + 负责人（团队级叫负责人、组级叫组长，都是落地联系的人） -->
                        <span v-if="pickedMembers.manager" class="ml-1 text-[11px] opacity-70 mt-1">
                          {{ pickedMembers.manager }}
                        </span>
                      </v-chip>
                    </div>

                    <v-expand-transition>
                      <div v-show="picking">
                        <v-divider class="my-2" />
                        <!--
                          候选来自团队表（utils/organazation），不是整棵飞书通讯录，见 TeamPicker 的说明；
                          group 模式：`team` = 本单所属团队 → 只在团队内选组别（不涉及其他团队）；
                          team 模式：在所有团队里挑，负责人取表里维护的 parentManager。
                        -->
                        <TeamPicker :mode="needPickTeam ? 'team' : 'group'" :team="needPickTeam ? '' : receiverTeam"
                          @select="pickMember" />
                      </div>
                    </v-expand-transition>
                  </div>
                </v-form>
                <!-- 备注 / 审批意见 -->
                <div>
                  <div class="field-label mb-2">备注 / 审批意见</div>

                  <v-textarea v-model="opinion" class="remark-input" :counter="300" density="compact" persistent-counter
                    rows="3" variant="outlined" />
                </div>
              </v-card-text>
              <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框 -->
              <div class="d-flex align-center ga-1 px-4 pb-3">
                <v-file-input ref="fileInputRef" v-model="attachment" class="attachment-input" density="compact"
                  hide-input>
                  <template #prepend>
                    <v-icon color="#1055C9" size="15">mdi-paperclip</v-icon>
                  </template>
                </v-file-input>

                <span v-if="attachment" class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
                  :title="attachment.name">
                  {{ attachment.name }}
                </span>

                <span v-else class="text-[12px] text-medium-emphasis cursor-pointer"
                  @click="fileInputRef?.click()">上传附件</span>

                <v-btn v-if="attachment" density="compact" icon="mdi-close" variant="plain" @click="attachment = null">
                  <v-icon icon="mdi-close" size="15" />
                </v-btn>
              </div>

              <v-divider />

              <v-card-actions class="px-4 py-3">
                <v-spacer />
                <v-btn size="small" text="取消" variant="plain" @click="dialog = false" />

                <v-btn color="primary" :disabled="waitingNext" :loading="submitting || waitingNext" size="small"
                  :text="waitingNext ? '正在进入下一环节…' : (hasNextAction ? '提交并继续下一个' : '提交')"
                  variant="tonal" @click="handleConfirm" />
              </v-card-actions>
            </v-card>
          </v-dialog>
        </template>
      </div>

      <div class="ml-auto">
        <div v-if="manager?.handled_at" class="mt-1 text-[12px] text-medium-emphasis">
          {{ formatDate(manager?.handled_at) }}
        </div>

        <span v-if="durationText" class="text-[12px] ml-auto ml-1">
          {{ durationLabel }}：{{ durationText }}
        </span>
      </div>
    </div>
    <!-- 已办理：渲染该审批人的选项 / 信息 / 文件 -->
    <template v-if="manager?.result">
      <v-sheet v-if="manager.opinion" class="py-2 px-3 text-body-small mt-1 w-fit" color="#F6F7F9" rounded="10">
        <span class="text-medium-emphasis">意见：</span>{{ manager.opinion }}
      </v-sheet>

      <div v-if="optionPath" class="mt-2 d-flex align-center gap-2">
        <v-chip color="primary" label size="x-small" variant="tonal">
          <span class="text-[9px]">分项</span>
        </v-chip>

        <span class="text-[12px]">{{ optionPath }}</span>
      </div>


      <div v-if="pickedReceiver" class="mt-2 d-flex align-center gap-2">
        <v-chip class="mr-1" color="primary" label size="x-small" variant="flat">
          <span class="text-[9px]">{{ pickedReceiver.pick === 'team' ? '接收团队' : '接收组别' }}</span>
        </v-chip>

        <v-avatar class="mr-1" size="22">
          <v-img v-if="pickedReceiver.avatar" cover :src="proxyAvatar(pickedReceiver.avatar)" />
          <v-icon v-else size="13">mdi-account</v-icon>
        </v-avatar>

        <span class="text-[10px] text-medium-emphasis">{{ pickedReceiver.name }}</span>
        <!-- 接收方 = 名字 + 负责人（团队表选的；团队级叫负责人、组级叫组长）；历史单（那时选的是人）退回显示邮箱 -->
        <span v-if="pickedReceiver.manager" class="text-[10px] text-high-emphasis">
          {{ pickedReceiver.pick === 'team' ? '负责人' : '组长' }} {{ pickedReceiver.manager }}
        </span>
        <span v-else-if="pickedReceiver.email" class="text-[10px] text-high-emphasis">{{ pickedReceiver.email }}</span>
      </div>

      <div v-if="extraItems.length > 0" class="mt-1 d-flex flex-wrap align-center ga-2">
        <span v-for="it in extraItems" :key="it.key" class="text-[11px] text-medium-emphasis">
          {{ it.label }}：{{ it.value }}
        </span>
      </div>

      <div v-if="manager.files?.length" class="mt-1 d-flex align-center flex-wrap text-[11px]">
        <div v-for="f in manager.files" :key="f.id"
          class="d-inline-flex align-center  cursor-pointer text-[#89898A] underline" :href="f.url" rel="noopener"
          @click="showPic(f.url)">
          <v-icon size="11">mdi-paperclip</v-icon>
          <span class="mt-1">{{ f.name }}</span>
        </div>
      </div>
    </template>


    <div v-for="(r, ri) in nextStepResults" :key="ri" class="mt-1">
      <div class="d-flex align-center flex-wrap gap-2">
        <v-chip color="primary" label size="x-small">{{ r.label }}</v-chip>

        <span v-if="r.path" class="text-[11px] text-medium-emphasis">{{ r.path }}</span>
        <span v-if="r.opinion" class="text-[11px] text-medium-emphasis">意见：{{ r.opinion }}</span>
      </div>

      <div v-if="r.extras.length > 0" class="mt-0.5 d-flex flex-wrap align-center ga-2">
        <span v-for="it in r.extras" :key="it.key" class="text-[11px] text-medium-emphasis">
          {{ it.label }}：{{ it.value }}
        </span>
      </div>

      <div v-if="r.files.length > 0" class="mt-0.5 d-flex align-center flex-wrap text-[11px]">
        <div v-for="f in r.files" :key="f.id"
          class="d-inline-flex align-center cursor-pointer text-[#89898A] underline" @click="showPic(f.url)">
          <v-icon size="11">mdi-paperclip</v-icon>
          <span class="mt-1">{{ f.name }}</span>
        </div>
      </div>
    </div>

    <template v-if="nodeTargets?.length">
      <div class="mt-2 d-flex align-center gap-2">
        <v-chip class="mr-1" color="secondary" label size="x-small" variant="flat">
          <span class="text-[9px]">抄送</span>
        </v-chip>

        <div v-for="(t, i) in nodeTargets" :key="i" class="d-flex align-center">
          <v-avatar class="mr-1" size="22">
            <v-img v-if="t.avatar" cover :src="t.avatar" />
            <v-icon v-else size="13">mdi-account</v-icon>
          </v-avatar>

          <span class="text-[10px] text-medium-emphasis">{{ t.name }}</span>
        </div>
      </div>
    </template>
  </v-timeline-item>

  <v-overlay v-model="overlay" @click:outside="overlay = false">
    <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
      <v-img contain max-height="90vh" rounded="10" :src="imgUrl" :style="{ maxWidth: '90vw' }" :width="800" />
    </div>
  </v-overlay>
</template>

<script lang="ts" setup>
import type { ApprovalChainItem, ApprovalNodeOption, ApprovalOptionGroup, ApprovalOptionLeaf, NodeSubmitPayload, ReceiverTeam } from '@/types/approval'
import dayjs from 'dayjs'
// proxyAvatar：飞书头像要经服务端代理才能在浏览器里正常显示（历史单里选过的"接收人"带着头像）
import { proxyAvatar } from '@/api/api'
import { APPROVAL_RESULTS, filterOfferedOptions, PICK_MEMBERS_RESULT, PICK_TEAM_RESULT, receiptLedgerAfter } from '@/types/approval'
import { buildColorScale, discardColorStep, pickColorStep } from '@/utils/color'

import { ensurePinyin, pinyinInitials } from '@/utils/pinyin'
// shareValueText：按「总金额 ÷ 总数量 × 数量」折算货值（见 utils/number）
import { formatDate, formatTimeDiff, shareValueText } from '@/utils/utils'
// 环节负责人口径（mainOf）与「连续同人环节」的类型都来自这里，别在组件里另写一套
import { mainOf, type ApprovalNextStep } from '@/utils/approvalRuntime'
// 「选择接收组别」的候选：团队表（utils/organazation）——不是整棵飞书通讯录，见组件说明
import TeamPicker from './TeamPicker.vue'

const overlay = ref(false)

interface ApprovalNodeProps {
  startTime?: string
  department?: string
  status?: number
  data?: ApprovalChainItem[]
  /** 审批链总步骤数，用于计算节点尺寸与动态色阶 */
  length?: number
  /** 当前环节在 chain 中的下标 */
  index?: number

  prevTime?: string

  allowedResults?: string[]

  allowedOptions?: ApprovalNodeOption[]

  canHandle?: boolean

  nextSteps?: ApprovalNextStep[]

  stockQty?: number | string
  /**
   * 本环节**还能接多少件** = 总库存数量 − 前面各环节已接收数量。
   *
   * 用途：一批货先被某个组「部分接收」，剩下的转给其他组/团队 —— 本环节的接收数量
   * 就以它为准（「全部接收」= 剩余、部分接收必须小于剩余），否则后面的组会按**原始总量**
   * 再收一遍重复计算。由页面按本单办理流水算出（见 types/approval 的 receivedQuantities）；
   * 取不到时退回 stockQty 的老口径。
   */
  remainingQty?: number | string
  /**
   * 本单关联产品的「总库存金额」：**回收金额**的上限（回收的价值不可能超过这批货本身的价值）。
   * 与 stockQty 同一套下发方式与"取不到就放行"的口径，见 lessThan。
   */
  stockAmount?: number | string
  /**
   * 办理**选项条件**（`offerWhen`）的求值上下文：业务快照 + `result` = 上一环节结论。
   * 由页面用 `optionContextOf(order, chain, index)` 算好下发（三处入口必须同一口径）。
   * 不给 = 不过滤（老调用方 / 单测里仍能按原样渲染）。
   */
  optionContext?: Record<string, unknown>
  /**
   * 本单所属的**团队**：「选择接收组别」的候选限定在它之内（见 TeamPicker）。
   * 空串 = 没识别出来，选择器退回"全部团队按团队分组"。
   */
  receiverTeam?: string

  /**
   * 这一环在**弃置段**里的位置（0 起；不在弃置段 / 认不出来 = 不传）。
   *
   * 弃置段 = 「引用模板」在建单期从源模板（弃置模板）搬进来的那一段（见 utils/templateRef）。
   * 视觉上要和主链一眼分开：
   *   · **圆点从进入这一段起逐渐缩小、颜色逐渐变浅**（主链是越往后越大越深，这里反过来）；
   *   · **整段**用一层独立背景包起来（不是每条各包一块，见 discardZoneStyle）。
   *
   * 由页面用 utils/approvalRuntime 的 discardSegmentStart 算出段起点，再按**段内序号**传进来
   * （用段内序号而不是 chain 下标：缩小幅度只与"进入这一段第几环"有关）。
   * 样式不能由页面加容器实现 —— 时间线的直接子元素必须是 v-timeline-item，
   * 外面套一层 div 会把连线布局弄坏，所以只传序号、样式在本组件内部换。
   */
  inDiscardSegment?: number

  /**
   * 弃置段一共几条节点（**合并后的节点数**，与 inDiscardSegment 同一口径）。
   *
   * 用途：整段只有**首/尾**两条该留圆角、该往缝里撑（中间那些是直角，拼起来才看不出接缝），
   * 所以组件必须知道"哪条是最后一条"。不传（默认 1）= 每条都当首尾，退回"一条一块背景"的老样子。
   */
  discardSegmentSize?: number
}
const props = withDefaults(defineProps<ApprovalNodeProps>(), {
  startTime: '',
  department: '',
  status: 0,
  data: () => [],
  length: 0,
  index: 0,
  prevTime: '',
  allowedResults: () => [],
  allowedOptions: () => [],
  canHandle: true,
  nextSteps: () => [],
  stockQty: '',
  remainingQty: '',
  stockAmount: '',
  optionContext: () => ({}),
  receiverTeam: '',
  // 不传 = 认不出段长：每条都当"首尾"处理（退回一条一块背景的老样子，不会画错）
  discardSegmentSize: 1,
})
// 选择项

const qty = ref('')
/** 回收数量 / 回收金额（tab=2 选「回收」时填写） */
const recycleQty = ref('')
const recycleAmount = ref('')
const radios = ref('deal')

const opinion = ref('')
/** tab=4「外部环境」分类下的补充说明 */
const reasonRemark = ref('')
/** 提交中，避免重复点击 */
const submitting = ref(false)

const waitingNext = ref(false)

/*
 * 圆点尺寸：
 *  · 主链：随下标**变大**（35 → 55），越靠后越醒目；
 *  · 弃置段：反过来 —— 从进入这一段起**逐环缩小**（34 → 24，见下面 size）。
 * 缩小幅度刻意放缓（每环 2px）：一段下来只"淡出"一点点，不至于最后几环小到看不清。
 */
const DISCARD_DOT_FROM = 40
const DISCARD_DOT_MIN = 34
const DISCARD_DOT_SHRINK = 2

const size = computed(() => {
  // 弃置段：进入这一段第 0 环起每一环缩一点，缩到下限为止（别缩成看不见的点）
  if (props.inDiscardSegment !== undefined) {
    return Math.max(DISCARD_DOT_MIN, DISCARD_DOT_FROM - props.inDiscardSegment * DISCARD_DOT_SHRINK)
  }
  // length 为 0 时 20 / 0 = Infinity，会导致后续计算全部变成 NaN
  if (props.length === 0) return 40
  return 35 + Math.round(20 / props.length * props.index)
})

/** 整段背景面板的圆角（需求指定 10px）：只留在段的**首/尾**，中间是直角 */
const DISCARD_RADIUS = 10
/**
 * 时间线竖排的节点间距 = 行距 `row-gap: 24px`（见 Vuetify 的 VTimeline.css），所以要连成一整块，
 * 就得把这段缝补上：**上下各撑 12px（padding）+ 等量负 margin**。
 * 为什么这么补：`.v-timeline-item` 是 `display: contents`（没有盒子），挂在它上面的 mb-12 之类的
 * 外边距工具类**根本不起作用**，要挪只能挪内部的 `__body`；而直接加 padding 会把行高撑大、
 * 节点间的距离跟着变 —— 配上等量负 margin 就不会：外边距盒（决定行高与内容位置）一点没变，
 * 只是背景盒多铺进缝里 12px，相邻两条正好拼满 24px。
 * 正好 12px、不重叠：底色是半透明的，多铺 1px 会在接缝处叠出比周围略深的一条线。
 */
const DISCARD_SEAM = 12
/** 面板内的上下留白（内容与面板边缘之间；不含补缝的那 12px） */
const DISCARD_INNER_PAD = 8

/**
 * 弃置段的背景面板数值：颜色/圆角/内边距挂成 **CSS 变量**，交给 style 里的
 * `.discard-zone :deep(.v-timeline-item__body)` 读。
 *
 * 为什么要走变量而不是直接写在根元素上：`__body` 是 **Vuetify 组件内部**的元素，
 * 本组件的作用域标记落在它的祖先（v-timeline-item 根元素）上，样式只能透过变量传下去；
 * 而"要不要包背景"由根元素上的 `discard-zone` 类决定（非弃置段不匹配 → 主链完全不受影响）。
 *
 * 整段只有**首/尾**两条留圆角、只有非首条向上撑、非尾条向下撑（见 DISCARD_SEAM）——
 * 中间那些直角的面板首尾相接，看上去才是**一整个**背景，而不是每节点一块。
 */
const discardZoneStyle = computed(() => {
  if (props.inDiscardSegment === undefined) return undefined
  const isFirst = props.inDiscardSegment === 0
  const isLast = props.inDiscardSegment >= props.discardSegmentSize - 1
  const corner = (on: boolean) => (on ? `${DISCARD_RADIUS}px` : '0')
  return {
    // 与主链区分开的底色（淡琥珀）。想换色只改这一处
    '--discard-body-bg': 'rgba(var(--v-theme-warning), 0.10)',
    // 圆角：左上 右上 右下 左下 —— 只有整段的首/尾那两条各留两个角
    '--discard-body-radius': `${corner(isFirst)} ${corner(isFirst)} ${corner(isLast)} ${corner(isLast)}`,
    '--discard-body-pad-start': `${DISCARD_INNER_PAD + (isFirst ? 0 : DISCARD_SEAM)}px`,
    '--discard-body-pad-end': `${DISCARD_INNER_PAD + (isLast ? 0 : DISCARD_SEAM)}px`,
    // 负 margin 抵掉"补缝"的那部分 padding：布局不动，只有背景进缝（见 DISCARD_SEAM）
    '--discard-body-margin-start': `${isFirst ? 0 : -DISCARD_SEAM}px`,
    '--discard-body-margin-end': `${isLast ? 0 : -DISCARD_SEAM}px`,
    // 右边留一点内边距，文字/时间不会贴到面板边缘（左边沿用 Vuetify 给圆点让位的 24px）
    '--discard-body-pad-inline-end': '12px',
  }
})

const iconFontSize = computed(() => `${Math.max(12, Math.round(size.value / 3))}px`)

const colorScale = computed(() => buildColorScale(props.length))
const currentStep = computed(() => pickColorStep(colorScale.value, props.index))

/*
 * 圆点颜色：
 *  · 主链：随下标在色阶上**由浅到深**（越靠后越醒目）；
 *  · 弃置段：反过来 —— 从段首（与主链同色）起**逐环变浅**（见 discardColorStep）。
 * 文字色一并跟着换（浅底配深字），否则白字会糊在浅蓝上。
 */
const colorStep = computed(() => (props.inDiscardSegment === undefined
  ? currentStep.value
  : discardColorStep(currentStep.value.bg, props.inDiscardSegment)))
const dotColor = computed(() => colorStep.value.bg)
const iconColor = computed(() => colorStep.value.fg)

const manageDatas = computed(() => props.data.filter(item => item.type == 'manager'))


const initials = ref('')
watch(
  () => manageDatas.value[0]?.name,
  name => {
    initials.value = pinyinInitials(name)
    void ensurePinyin().then(() => {
      initials.value = pinyinInitials(name)
    })
  },
  { immediate: true },
)
/** 该步骤的审批人（办理信息记录在其上） */
const manager = computed<ApprovalChainItem | undefined>(() => manageDatas.value[0])


const actionSteps = computed(() => [
  { index: props.index, data: props.data, allowedOptions: props.allowedOptions, allowedResults: props.allowedResults },
  ...props.nextSteps,
])


const activeStep = computed(() => actionSteps.value.find(s => !mainOf(s.data)?.handled_at))

/** 当前动作在组内的序号（从 1 起）与动作总数：>1 时弹窗里提示"办完自动接下一环" */
const actionNo = computed(() => actionSteps.value.findIndex(s => s.index === activeStep.value?.index) + 1)
const actionTotal = computed(() => actionSteps.value.length)

/** 当前动作之后还有没有同人的动作 —— 有就先不关弹窗，落库后接着办（见 handleConfirm） */
const hasNextAction = computed(() => {
  const i = actionSteps.value.findIndex(s => s.index === activeStep.value?.index)
  return i >= 0 && i < actionSteps.value.length - 1
})

/** 本环节的办理时间；未办理时为 undefined */
const handledAt = computed(() => manager.value?.handled_at)

/** 耗时文案：已办理算到办理时刻（耗时），未办理算到当下（已等待） */
const durationLabel = computed(() => (handledAt.value ? '耗时' : '已等待'))

const durationText = computed(() => {
  const from = props.index === 0 ? props.startTime : props.prevTime
  if (!from || !dayjs(from).isValid()) return ''
  return formatTimeDiff(from, handledAt.value)
})

const deptName = computed(
  () =>
    manageDatas.value[0]?.department
    ?? props.data.find(item => item?.department)?.department
    ?? props.department
    ?? '',
)

/** extra 字段 → 展示文案 */
const EXTRA_LABELS: Record<string, string> = {
  qty: '数量',
  amount: '金额',
  confirmed: '确认状态',
  reason: '原因',
  reason_belong: '分类',
  second_reason: '二级原因',
  remark: '补充说明',
  // 接收方（可能来自「选择接收组别」或「选择接收团队」，粒度看 ReceiverTeam.pick）
  members: '接收方',
  // 接收类结论顺带写下的账（本环接收后累计收了多少、还剩多少给后面的组），见 receiptLedgerAfter
  received_qty: '已接收',
  remaining_qty: '剩余',
}

const EXTRA_HIDDEN_KEYS = /_target$|^option_/


function optionPathOf (extra?: Record<string, unknown>) {
  const group = String(extra?.option_group ?? '').trim()
  if (!group) return ''
  return [group, extra?.option_text, extra?.option_child]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .join(' / ')
}


const pickedReceiver = computed<ReceiverTeam | undefined>(() => {
  const raw = manager.value?.extra?.members
  const one = Array.isArray(raw) ? raw[0] : raw
  if (!one || typeof one !== 'object') {
    return undefined
  }
  const item = one as ReceiverTeam
  // 粒度：本环节的结论码说了算（历史单没有 pick 字段，按结论补上；再退一步按组别）
  const kind = manager.value?.result
  return { ...item, pick: item.pick ?? (kind === PICK_TEAM_RESULT ? 'team' : 'group') }
})

/**
 * 成员对象（接收方 / 办理人）的展示文案：名字 +（有负责人就带上）负责人。
 *
 * 措辞按**粒度**走（见 ReceiverTeam.pick）：团队级叫「负责人」，组级叫「组长」——
 * 同一件东西在办理弹窗、时间线、明细三处不该长得不一样。
 */
function memberLabel (x: unknown): string {
  if (!x || typeof x !== 'object') {
    return String(x ?? '')
  }
  const name = String((x as { name?: unknown }).name ?? '')
  const leader = (x as { manager?: unknown }).manager
  if (!leader) {
    return name
  }
  const role = (x as { pick?: unknown }).pick === 'team' ? '负责人' : '组长'
  return `${name}（${role} ${String(leader)}）`
}

/**
 * 一条办理流水里的选项明细（extra）→ { label, value } 列表。
 * 抽成函数是因为**合并节点**里的第 2、3 个动作也要按同一口径渲染（见 nextStepResults）。
 */
function extraItemsOf (extra?: Record<string, unknown>) {
  if (!extra) return []
  return Object.entries(extra)
    // members（接收组别）已在上方单独成块渲染，这里不重复
    .filter(([key]) => key !== 'members')
    .filter(([key]) => !EXTRA_HIDDEN_KEYS.test(key))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, v]) => ({
      key,
      label: EXTRA_LABELS[key] ?? key,
      // 「接收组别」这类值是成员对象（单选）或成员数组（多选）：拼名字展示，别渲染成 [object Object]
      value: v !== null && typeof v === 'object'
        ? (Array.isArray(v) ? v : [v])
          .map(x => memberLabel(x))
          .filter(Boolean)
          .join('、')
        : typeof v === 'boolean'
          ? (v ? '已确认' : '未确认')
          : String(v),
    }))
    .filter(item => item.value !== '')
}

/** 本节点第 1 个动作的办理明细（表格/时间线按原样渲染） */
const extraItems = computed(() => extraItemsOf(manager.value?.extra))

/** 本节点第 1 个动作的分项路径 */
const optionPath = computed(() => optionPathOf(manager.value?.extra))

const resultChips = computed(() =>
  actionSteps.value
    .map(s => mainOf(s.data))
    .filter(m => !!m?.result)
    .map(m => String(m?.result_label || m?.result || '')),
)

/**
 * 已办的接收类环节留下的账（「已接收 X · 剩余 Y 件」），渲染在时间线的节点头部。
 *
 * 数据来自办理时写进结论 extra 的那两个字段（见 withReceiveLedger / receiptLedgerAfter）——
 * 所以历史单（那时还没有这笔账）不会显示，也不会影响任何求值。
 */
const receiveLedgerChips = computed(() =>
  actionSteps.value.flatMap((s) => {
    const extra = mainOf(s.data)?.extra
    const remaining = extra?.remaining_qty
    if (remaining === undefined || remaining === null || remaining === '') {
      return []
    }
    return [`已接收 ${String(extra?.received_qty ?? '—')} · 剩余 ${String(remaining)} 件`]
  }),
)


function actionResultOf (step: { data: ApprovalChainItem[] }) {
  const m = mainOf(step.data)
  if (!m?.result) return null
  return {
    label: String(m.result_label || m.result || ''),
    path: optionPathOf(m.extra),
    opinion: String(m.opinion ?? '').trim(),
    extras: extraItemsOf(m.extra),
    files: m.files ?? [],
  }
}


const nextStepResults = computed(() =>
  props.nextSteps.map(actionResultOf).filter((x): x is NonNullable<typeof x> => !!x),
)


const doneActions = computed(() =>
  actionSteps.value.map(actionResultOf).filter((x): x is NonNullable<typeof x> => !!x),
)

const dialog = ref(false)
const setClean = ref(false)
const attachment = ref<File | null>(null)
const fileInputRef = ref<{ click: () => void } | null>(null)
const dialogs = ref(false)

const reason = ref<ReasonItem>({ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' })
const secondReason = ref<{ text: string, target: string }>({ text: '运营/销售', target: 'sale' })
/** 一级 / 二级「原因」的初始值：换动作时也要回到这里（见 resetFormState） */
const INIT_REASON: ReasonItem = { text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' }
const INIT_SECOND_REASON = { text: '运营/销售', target: 'sale' }
/**
 * 「选择接收组别」选中的接收**组别**（组别名 + 组长）：只记进本环节的办理记录；
 * 该结论会**终结流程**（见 CLOSE_FLOW_RESULTS）。
 * `department` 只为兼容此前存过"所属团队"的记录，新选的一律带 `manager`。
 */
const pickedMembers = ref<ReceiverTeam & { department?: string }>({})
/** 选人面板是否展开 */
const picking = ref(false)


function resetFormState () {
  selectedOptionKey.value = ''
  pickedLeaf.value = null
  pickedChild.value = ''
  qty.value = ''
  recycleQty.value = ''
  recycleAmount.value = ''
  reason.value = { ...INIT_REASON }
  secondReason.value = { ...INIT_SECOND_REASON }
  reasonRemark.value = ''
  pickedMembers.value = {}
  picking.value = false
  setClean.value = false
  opinion.value = ''
  attachment.value = null
  // 下一环的数据到了（或已经没得办）：解除"等待中"，按钮恢复可用
  waitingNext.value = false
  // 表单校验状态一并清掉：连续多环时上一环的红字不能留在下一环的输入框上
  handleForm.value?.resetValidation()
}

/**
 * 选中一个接收方（来自 TeamPicker，两种模式共用这一段）。
 *
 * 存的是**名字**（`name`）+ **负责人**（`manager`）：
 *   · 组别模式（「选择接收组别」）—— 组别名 + 该组组长；
 *   · 团队模式（「选择接收团队」）—— 团队名 + 团队负责人（`parentManager`）。
 * 另外记一个 `pick` 标明是哪一层 —— 时间线/明细据此把「组长」显示成「负责人」。
 * 不再存人（那是"谁办下一环"的语义，与这个结论不是一回事）。
 */
function pickMember (t: { name: string, manager?: string }) {
  pickedMembers.value = {
    name: t.name,
    ...(t.manager ? { manager: t.manager } : {}),
    // 放在办理记录里的 type 沿用旧口径（接收方占"办理人"那一格），时间线据此单独渲染一个节点
    type: 'manager',
    pick: needPickTeam.value ? 'team' : 'group',
  }
}

function unpickMember() {
  pickedMembers.value = {}
}

const optionItems = computed<ApprovalNodeOption[]>(() => {
  // 取**当前要办的那个动作**的选项（同一审批人连续多环时，动作会随着办理推进而前移）
  const step = activeStep.value
  const raw: ApprovalNodeOption[] = step?.allowedOptions?.length
    ? step.allowedOptions
    : (step?.allowedResults?.length ? step.allowedResults : ['pass', 'reject'])
      .map(v => ({ result: v, text: APPROVAL_RESULTS.find(r => r.value === v)?.label ?? v }))

  /*
   * 「选项条件」（offerWhen，模板里配在分支上）：按上下文过滤 —— 典型场景是同一个环节
   * 不同来路给不同选项（如"上一环节结论不是 not_receive 才给「同意接收」"）。
   * 只影响渲染、不参与选路；**全被过滤光时会退回原列表**（见 filterOfferedOptions），
   * 否则办理人会卡在"没有可选项"上。
   */
  return filterOfferedOptions(raw, props.optionContext)
})

/**
 * 一个选项的**唯一键**：文案 + 结论码。
 * 同一条线配了多个选项文本时它们**共用同一个结论码**，只有这个键能区分选的是哪一个。
 */
function optionKeyOf(o: { result: string, text: string }): string {
  return `${o.text}|${o.result}`
}

/** 下拉候选项：在选项上补一个 key（供 v-select 的 item-value 用，见模板里的说明） */
const selectItems = computed(() => optionItems.value.map(o => ({ ...o, key: optionKeyOf(o) })))


const RADIO_MAX = 3

/** 这次用 radio 还是下拉（两种形态绑定同一个 selectedOptionKey，提交逻辑完全一致） */
const useOptionRadios = computed(() => selectItems.value.length <= RADIO_MAX)


function radioColorOf (result: string): string {
  if (result === 'reject' || result === 'discard' || result === 'scrap') {
    return 'error'
  }
  return result === 'pass' || result === 'receive' ? 'success' : 'primary'
}

/** 当前选中的**键** —— v-model 绑它，才分得清同码的多个选项 */
const selectedOptionKey = ref('')

/** 当前选中的选项；文案与结论码都从它取，不再"按码猜文案" */
const selectedOption = computed(() => selectItems.value.find(o => o.key === selectedOptionKey.value))

/** 选中的一级选项（二级候选项由它带出来）—— 声明在这里是因为下面的 selectedResult 要读它的链路 */
const pickedLeaf = ref<ApprovalOptionLeaf | null>(null)


const selectedResult = computed(() => {
  const opt = selectedOption.value
  if (opt?.nodeLevel) {
    return pickedLeaf.value?.link || ''
  }
  return opt?.result ?? ''
})


const hasNodeLevelTree = computed(() => optionItems.value.length === 1 && !!optionItems.value[0]?.nodeLevel)

/** 某个结论码在**本环节**的显示文案（优先模板给它的名字；同码多选项时只能取第一个，仅作兜底） */
function labelOf(result: string): string {
  return optionItems.value.find(o => o.result === result)?.text
    ?? APPROVAL_RESULTS.find(r => r.value === result)?.label
    ?? result
}


function customLabelOf(result: string): string {
  const t = String(selectedOption.value?.text ?? '').trim()
  const def = APPROVAL_RESULTS.find(r => r.value === result)?.label ?? ''
  return t && t !== def ? t : ''
}

/** 选项异步到达、或换到下一个动作后，同步一个合法默认值，避免空选提交 */
watch(
  [() => activeStep.value?.index, () => activeStep.value?.allowedOptions],
  () => {
    const opts = selectItems.value
    if (!opts.some(o => o.key === selectedOptionKey.value)) {
      selectedOptionKey.value = opts[0]?.key ?? ''
    }
  },
  { immediate: true },
)


watch(
  () => activeStep.value?.index,
  (now, before) => {
    if (now === before) return
    resetFormState()
    if (now === undefined && dialog.value) {
      dialog.value = false
    }
  },
)

/** 关掉弹窗时清掉"等待下一环"：下次打开不该是禁用状态（见 waitingNext） */
watch(dialog, open => {
  if (!open) {
    waitingNext.value = false
  }
})

/** 选中结论后需要补充的信息表单（数量 / 金额 / 原因等） */
const needReceiveQty = computed(
  () => selectedResult.value === 'receive' || selectedResult.value === 'part_receive',
)

const rules = {
  /** 必填：空串 / 只有空格都算没填（`'0'` 算填了，数量 0 是合法输入） */
  required: (value: unknown) => (String(value ?? '').trim() === '' ? '请填写' : true),
  /** 正整数：只允许数字，不接受小数与千分位逗号 */
  isInteger: (value: unknown) => {
    const raw = String(value ?? '').trim()
    if (raw === '') {
      return true
    }
    return /^\d+$/.test(raw) ? true : '只能填正整数（不支持小数或千分位逗号）'
  },
  /** 金额：整数或最多两位小数（金额带角分是常态，所以与数量分开一条规则） */
  amount: (value: unknown) => {
    const raw = String(value ?? '').trim()
    if (raw === '') {
      return true
    }
    return /^\d+(?:\.\d{1,2})?$/.test(raw) ? true : '只能填金额，最多两位小数'
  },
}

/** 办理表单（数量 / 金额那几个输入框的宿主）—— 提交前用它 validate() */
type HandleForm = {
  validate: () => Promise<{ valid: boolean, errors: string[] }>
  resetValidation: () => void
}
const handleForm = ref<HandleForm | null>(null)
/* ===== 「全部接收」的数量 ===== */

/** 「全部接收」= 结论码 `receive`（见 collectResult 里那个分支），此时数量不由人填 */
const receiveAll = computed(() => selectedResult.value === 'receive')

/** 产品总库存数量（页面下发）；没配到就是空串 —— 那种情况下退回手填，不把人卡住 */
const stockQtyText = computed(() => {
  const v = props.stockQty
  return v === null || v === undefined || v === '' ? '' : String(v)
})

/**
 * 本环节的**接收上限**：优先「剩余接收数量」（= 总库存数量 − 前面各环节已接收，
 * 由页面按本单办理流水算出，见 types/approval 的 receivedQuantities）；
 * 页面没下发（老单 / 没关联产品）时退回「总库存数量」，再没有就留空退回手填。
 *
 * 为什么必须按剩余算：一批货被上游**部分接收**后，剩下的才轮到本环节 ——
 * 上限与「全部接收」的取值都以它为准，否则后面的组会按**原始总量**再收一遍，账就重复了。
 */
const receiveCapText = computed(() => {
  const v = props.remainingQty
  return v === null || v === undefined || v === '' ? stockQtyText.value : String(v)
})
/** 上限取的是「剩余」还是「总库存」：提示语与校验文案要写对 */
const usingRemaining = computed(() => receiveCapText.value !== '' && receiveCapText.value !== stockQtyText.value)
const receiveCapName = computed(() => (usingRemaining.value ? '剩余接收数量' : '总库存数量'))
/** 是否真的取到了上限：没有它「全部接收」的数量框就不能锁死（否则只读 + 必填 = 卡死） */
const hasReceiveCap = computed(() => receiveCapText.value !== '')
/** 前面各环节已接收多少（= 总 − 剩余）：两个数都取到时才显示，供办理人核对 */
const receivedQtyText = computed(() => {
  const total = Number(stockQtyText.value)
  const left = Number(receiveCapText.value)
  return usingRemaining.value && Number.isFinite(total) && Number.isFinite(left) ? String(total - left) : ''
})

/** 产品总库存**金额**（页面下发）：回收金额的上限，口径与总库存数量同一套 */
const stockAmountText = computed(() => {
  const v = props.stockAmount
  return v === null || v === undefined || v === '' ? '' : String(v)
})

/**
 * 「剩余数量」对应的**价值** ≈ 单价 × 剩余 = 总库存金额 ÷ 总库存数量 × 剩余数量（见 shareValueText）。
 *
 * 为什么要给办理人看：件数说明不了轻重 —— 「剩余 500 件」到底值多少、值不值得接，
 * 业务上是按**金额**判断的。与上面那条提示同一处展示，一眼能对上。
 *
 * 剩余取的是**接收上限**（receiveCapText）：它与「全部接收」时系统填的数、以及
 * 部分接收的校验上限是**同一个值**（见 receiveCapText 的说明）—— 三处口径必须一致，
 * 否则会出现"显示的价值和实际能收的数量对不上"。没有上游部分接收时它会退回总库存数量，
 * 于是价值就是这批货的总金额，同样是对的。
 *
 * 取不到就是空串、不显示（不猜）：老单 / 没关联产品 / 总库存数量为 0（单价算不出来）。
 */
const receiveValueText = computed(() =>
  shareValueText(stockAmountText.value, stockQtyText.value, receiveCapText.value),
)


/**
 * 必须**小于** limit 的规则工厂（接收 / 回收的数量与金额共用）。
 * 用"小于"而不是"不超过"：这些数都是**部分**量 —— 接收要接全部就该选「全部接收」
 * （那条口径下数量由系统填 = 总库存数量），所以等于总库存数量本身不成立；回收同理。
 * @param hint 追加在文案后面的引导语（如"要接全部请选「全部接收」"）
 */
function lessThan (limit: string, name: string, unit: string, hint = '') {
  return (value: unknown) => {
    const raw = String(value ?? '').trim()
    const cap = Number(limit)
    // 没填交给 required；上限取不到 / 认不出、填的不是数字，都放行（不凭空拒绝，也不叠第二条错误）
    if (raw === '' || limit === '' || !Number.isFinite(cap)) {
      return true
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      return true
    }
    return n < cap ? true : `必须小于${name}（${limit} ${unit}）${hint}`
  }
}

const receiveQtyRules = computed(() => (receiveAll.value && hasReceiveCap.value
  ? [rules.required]
  : [rules.required, rules.isInteger, lessThan(receiveCapText.value, receiveCapName.value, '件', '；要接全部请选「全部接收」')]))

/** 回收数量：正整数，且小于总库存数量（与部分接收同一口径） */
const recycleQtyRules = computed(() => [
  rules.required,
  rules.isInteger,
  lessThan(stockQtyText.value, '总库存数量', '件'),
])

/** 回收金额：金额格式，且小于总库存金额 */
const recycleAmountRules = computed(() => [
  rules.required,
  rules.amount,
  lessThan(stockAmountText.value, '总库存金额', '元'),
])

/** 提交时真正用的数量：接收上限优先（界面只读展示的也是它），拿不到才用用户填的 */
const receiveAllQty = computed(() => receiveCapText.value || qty.value)

/**
 * 接收类结论的账：把「已接收 / 剩余」一并写进结论的 extra。
 *
 * 条件求值**不依赖它**（引擎自己按流水算，见 types/approval 的 receivedQuantities），
 * 写进来是为了记录**可追溯、可统计**：时间线上直接看得出"本环收了多少、还剩多少给后面的组"。
 * 算不出来（老单 / 没关联产品）就什么都不写 —— 宁可空着，也别在记录里留半截假数字。
 */
function withReceiveLedger (extra: Record<string, unknown>, thisQty: unknown): Record<string, unknown> {
  const ledger = receiptLedgerAfter(stockQtyText.value, receiveCapText.value, thisQty)
  if (ledger) {
    extra.received_qty = String(ledger.received)
    extra.remaining_qty = String(ledger.remaining)
  }
  return extra
}


/**
 * 「接收数量」的初值 = 本环节**还能接多少**（剩余接收数量；页面没下发时退回总库存数量）。
 *
 * 以前只有选「全部接收」才把上限写进框里，「部分接收」时框是空的 —— 那个数只写在一行小字上，
 * 想少接还得自己抄一遍。现在两种情形**一开始就填在框里**：数看得见，要少接往下改即可。
 *
 * 只填空框：除「全部接收」（那个数由系统定死、框也是只读的）之外，不覆盖办理人改过的数。
 * 换环节 / 换单会先走 resetFormState 清空，于是新表单又会预填好。
 *
 * ⚠️ 依赖里带上 needReceiveQty：结论与选项是异步/按顺序到位的，
 * 只盯 index 与上限有可能在「还没选中接收类结论」时算一次就再也不触发了。
 */
watch(
  [needReceiveQty, receiveAll, receiveCapText, () => activeStep.value?.index],
  () => {
    if (!needReceiveQty.value) {
      return
    }
    if (receiveAll.value || qty.value === '') {
      qty.value = receiveCapText.value
    }
  },
  { immediate: true },
)
/**
 * 「回收」类结论：需要填**回收数量 + 回收金额**。
 * 「供应商回收」与它同一套填写（只是结论码不同，便于分开统计），所以共用这一块。
 */
const needRecycle = computed(
  () => selectedResult.value === 'recycle' || selectedResult.value === 'supplier_recycle',
)
const needScrapConfirm = computed(() => selectedResult.value === 'scrap')
const needReason = computed(() => selectedResult.value === 'other_reason')
/** 「选择接收组别」：需要当场选组别（见 PICK_MEMBERS_RESULT） */
const needPickMembers = computed(() => selectedResult.value === PICK_MEMBERS_RESULT)
/** 「选择接收团队」：需要当场选团队，负责人取团队表的 parentManager（见 PICK_TEAM_RESULT） */
const needPickTeam = computed(() => selectedResult.value === PICK_TEAM_RESULT)
/** 两条"当场指定接收方"的结论，界面共用一块（选择器按 needPickTeam 切模式） */
const needPick = computed(() => needPickMembers.value || needPickTeam.value)

const nodeTargets = computed(() => props.data.filter(item => item.type != 'manager'))

const transferIn = computed(() => props.data.find(m => m.delegated_from))
const transferredTo = computed(() => manageDatas.value[0]?.transferred_to)

const imgUrl = ref('')
function showPic(url: string) {
  overlay.value = true
  imgUrl.value = url
}
interface ReasonItem {
  text: string
  target: string
  belong?: string
  sendDepartment?: string[]
}
const approvalModal: ReasonItem[] = [{ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' },
{ text: '运营-其他因素', target: 'operation-other', belong: '运营' },
{ text: '销量预测偏差', target: 'inventory-sales', belong: '库存管理', sendDepartment: ['运营', 'PMC'] },
{ text: '库存尾数弃置', target: 'inventory-tail', belong: '库存管理' },
{ text: '库存保管不善', target: 'inventory-storage', belong: '库存管理', sendDepartment: ['工厂'] },
{ text: '产品侵权-外观专利侵权（产品员自查）', target: 'infringement-self', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-外观专利侵权（产品合规中心承接）', target: 'infringement-center', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
// { text: '产品侵权-外观专利侵权（产品合规中心承接）', target: 'inventory' ,belong:'产品侵权'},
{ text: '产品侵权-发明专利侵权', target: 'infringement-invention', belong: '产品侵权', sendDepartment: ['开发', '研发', '合规管理'] },
{ text: '产品侵权-常规技术/常规外观竞对恶意专利抢注', target: 'infringement-technology', belong: '产品侵权', sendDepartment: ['合规管理'] },
{ text: '产品侵权-专利公示时间晚于检索时间', target: 'infringement-late', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-其他', target: 'infringement-other', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-版权', target: 'infringement-copyright', belong: '产品侵权', sendDepartment: ['设计部'] },
{ text: '产品质量问题', target: 'development-quality', belong: '开发类', sendDepartment: ['开发', '研发', '合规管理', '采购部', '工厂'] },
{ text: '包装及设计问题', target: 'development-design', belong: '开发类', sendDepartment: ['开发', '合规管理', '采购部', '工厂'] },
{ text: '开发/研发-其他因素', target: 'development-other', belong: '开发类', sendDepartment: ['开发', '研发'] },
{ text: '供应链-起订量限制', target: 'supply-order', belong: '供应链', sendDepartment: ['运营', '开发', '采购部', '工厂'] },
{ text: '供应链-采购因素', target: 'supply-purchase', belong: '供应链', sendDepartment: ['采购部'] },
{ text: '供应链-物流因素', target: 'supply-logistics', belong: '供应链', sendDepartment: ['物流部'] },
{ text: '政策与法规变化', target: 'outside-policy', belong: '外部环境' },
{ text: '自然灾害与突发事件导致产品不可售', target: 'outside-natural', belong: '外部环境' },
{ text: '平台限制/政策调整等', target: 'outside-platform', belong: '外部环境' },
{ text: '历史遗留库存', target: 'outside-history', belong: '外部环境' },
{ text: '其他客观因素', target: 'outside-other', belong: '外部环境' },
]
const secondApprovalModal = [
  { text: '运营/销售', target: 'sale' },
  { text: '开发', target: 'develop' },
  { text: '研发', target: 'search' },
  { text: '合规管理', target: 'compliance' },
  { text: '设计部', target: 'design' },
  { text: 'PMC', target: 'pmc' },
  { text: '采购部  ', target: 'purchase' },
  { text: '物流部', target: 'logistics' },
  { text: '工厂', target: 'factory' },
]
// 按 belong 分类生成带分组标题的下拉数据（type: 'subheader' 由 Vuetify 渲染为分组标题，标题取自 item-title 字段 text）
const groupedReasons = computed(() => {
  const groups = new Map<string, ReasonItem[]>()
  for (const item of approvalModal) {
    const key = item.belong || '其他'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  const list: (ReasonItem | { type: 'subheader', text: string })[] = []
  for (const [belong, items] of groups) {
    list.push({ type: 'subheader', text: belong }, ...items)
  }
  return list
})
function handleResonChange(val: ReasonItem | null) {
  reason.value = val ?? { text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' }
}
function handleSecondResonChange(val: { text: string, target: string } | null) {
  secondReason.value = val ?? { text: '运营/销售', target: 'sale' }
}

/* ===== 模板配的「选项树」（类别 → 一级 → 二级，见 types/approval 的 ApprovalOptionGroup）===== */


const pickedGroups = computed<ApprovalOptionGroup[]>(() => selectedOption.value?.groups ?? [])

/** 「驳回」的结论码：必须与保存期注入的驳回分支条件（`{ field:'result', op:'eq', value:'reject' }`）一致 */
const REJECT_RESULT = 'reject'


const optionMenuItems = computed(() => {
  const list: Array<ApprovalOptionLeaf | { type: 'subheader', text: string }> = []
  for (const g of pickedGroups.value) {
    list.push({ type: 'subheader', text: g.title || '未分类' }, ...g.items)
  }
  const hasRejectLeaf = pickedGroups.value.some(g => (g.items ?? []).some(i => i.link === REJECT_RESULT))
  if (selectedOption.value?.nodeLevel && selectedOption.value?.canReject && !hasRejectLeaf) {
    list.push({ type: 'subheader', text: '其它' }, { text: '驳回', link: REJECT_RESULT })
  }
  return list
})

/** 二级候选项：**只有选中了带二级的一级选项才有值** —— 这就是"选中一级才展示二级"
 *  （`pickedLeaf` 的声明在上面，因为 selectedResult 要读它的「实际链路」） */
const leafChildren = computed(() => pickedLeaf.value?.children ?? [])

/** 选中的二级文案（一级没有二级时为空，不提交它） */
const pickedChild = ref('')

/** 处理方式一变（或它带的树变了）就重置一级 / 二级，避免留下上一棵树里的选择 */
watch(
  [selectedOption, pickedGroups],
  () => {
    const first = pickedGroups.value[0]?.items[0] ?? null
    pickedLeaf.value = first
    pickedChild.value = first?.children?.[0] ?? ''
  },
  { immediate: true, deep: true },
)


watch(pickedLeaf, leaf => {
  pickedChild.value = leaf?.children?.[0] ?? ''
})

const emit = defineEmits<{
  (e: 'submit', payload: NodeSubmitPayload): void
}>()

function collectResult(): { result: string, result_label: string, extra: Record<string, unknown> } {
  const extra: Record<string, unknown> = {}


  if (pickedLeaf.value) {
    const leaf = pickedLeaf.value
    const child = pickedChild.value
    // 类别按「文案 + 链路」回查（不按对象身份比 —— 经过响应式包装 / 下拉穿透后身份不保证相同）
    extra.option_group = pickedGroups.value
      .find(g => g.items.some(i => i.text === leaf.text && i.link === leaf.link))?.title ?? ''
    extra.option_text = leaf.text
    extra.option_link = leaf.link
    if (child) {
      extra.option_child = child
    }
    return {
      result: leaf.link,
      result_label: child ? `${leaf.text}·${child}` : leaf.text,
      extra,
    }
  }

  const result = selectedResult.value

  switch (result) {
    case 'receive': { // 全部接收：数量 = 本环节还能接多少（剩余，拿不到才退回总库存）；界面只读，这里再兜一道
      extra.qty = receiveAllQty.value
      return { result, result_label: '全部接收', extra: withReceiveLedger(extra, receiveAllQty.value) }
    }
    case 'part_receive': { // 部分接收
      extra.qty = qty.value
      return { result, result_label: `部分接收 ${qty.value || 0} 件`, extra: withReceiveLedger(extra, qty.value) }
    }
    case 'recycle': { // 回收：数量 + 金额
      extra.qty = recycleQty.value
      extra.amount = recycleAmount.value
      return { result, result_label: '回收', extra }
    }
    case 'supplier_recycle': { // 供应商回收：与「回收」同一套填写，只是结论码不同（分开统计）
      extra.qty = recycleQty.value
      extra.amount = recycleAmount.value
      return { result, result_label: '供应商回收', extra }
    }
    case 'scrap': { // 报废清仓：确认标记
      extra.confirmed = setClean.value
      return { result, result_label: '报废清仓', extra }
    }
    case 'rework': {
      // 模板在「审批结论」右侧配了选项文本时以它为准（同一条线的多个选项文案不同、码相同）
      return { result, result_label: customLabelOf(result) || '建议返工', extra }
    }
    case 'discard': {
      return { result, result_label: customLabelOf(result) || '建议弃置', extra }
    }
    case 'other_reason': {
      extra.reason = reason.value.text
      extra.reason_target = reason.value.target
      extra.reason_belong = reason.value.belong
      if (reason.value.belong === '开发类') {
        extra.second_reason = secondReason.value.text
        extra.second_reason_target = secondReason.value.target
      }
      if (reason.value.belong === '外部环境') extra.remark = reasonRemark.value
      return { result, result_label: reason.value.text, extra }
    }
    case PICK_MEMBERS_RESULT: // 选择接收组别：在这里收集接收方（组别 + 组长）
    case PICK_TEAM_RESULT: { // 选择接收团队：同上，粒度是「团队 + 团队负责人」；提交后流程即终结（见 CLOSE_FLOW_RESULTS）
      extra.members = pickedMembers.value
      const names = pickedMembers.value.name
      const leader = pickedMembers.value.manager
      const isTeam = pickedMembers.value.pick === 'team'
      const title = isTeam ? '选择接收团队' : '选择接收组别'
      // 结论文案带上「名字 + 负责人」：时间线上一眼能看出这一环把货交给了谁、找谁
      return {
        result,
        result_label: names
          ? `${title}：${names}${leader ? `（${isTeam ? '负责人' : '组长'} ${leader}）` : ''}`
          : title,
        extra,
      }
    }
    case 'pending': {
      return { result, result_label: '待定', extra }
    }
    case 'lack_demand': {
      return { result, result_label: '市场需求不足', extra }
    }
    case 'reject': {
      return { result, result_label: '驳回', extra }
    }
    default: {

      const finalResult = result || 'pass'
      return { result: finalResult, result_label: customLabelOf(finalResult) || labelOf(finalResult), extra }
    }
  }
}


async function handleConfirm() {
  // 正在提交 / 上一环刚提交、同人的下一环还没传回来：都不该再发一次
  if (submitting.value || waitingNext.value) return
  const step = activeStep.value
  if (!step) return
  if (handleForm.value) {
    const { valid } = await handleForm.value.validate()
    if (!valid) return
  }
  submitting.value = true
  const { result, result_label, extra } = collectResult()
  emit('submit', {
    // 提交的是**当前动作**那一环（同一审批人连续多环时，可能是本人这组的第 2、3 环）
    index: step.index,
    result,
    result_label,
    extra,
    opinion: opinion.value.trim(),
    files: attachment.value ? [attachment.value] : [],
    done: (ok: boolean, info?: { sameApproverNext?: boolean }) => {
      submitting.value = false
      if (!ok) return

      if (hasNextAction.value || info?.sameApproverNext) {
        waitingNext.value = true
        return
      }
      dialog.value = false
    },
  })
}
</script>
<style scoped lang="scss">
:deep(.v-timeline--vertical.v-timeline--side-end) {
  grid-template-columns: 0 min-content 1fr;
}

:deep(.v-timeline-item__body) {
  justify-self: stretch;
  width: 100%;
}

/*
 * 弃置段：**整段**共用一层背景（不是每条各包一块）。
 *
 * 选择器为什么长这样：样式要落到 Vuetify 内部的 `__body` 上（`:deep` 穿透），
 * 而"这一条算不算弃置段"由根元素上的 `discard-zone` 类决定（见模板）——
 * 类名带着本组件的作用域标记，非弃置段根本匹配不到这条规则，主链一个像素都不动
 * （也就不需要 revert 之类的兜底）。
 *
 * 具体数值（圆角留哪几个角、上下撑多少、往缝里补多少）全部由 discardZoneStyle 算好，
 * 以 CSS 变量挂在根元素上 —— 根元素是 `display: contents`，没有盒子，样式只能靠变量传给 `__body`。
 */
.discard-zone :deep(.v-timeline-item__body) {
  background: var(--discard-body-bg);
  // 只有整段首/尾那两条有圆角（见 discardZoneStyle）；中间的直角首尾相接才拼成一整块
  border-radius: var(--discard-body-radius);
  /*
   * 纵向：padding 里含"补缝"的那一段（DISCARD_SEAM），负 margin 再把它抵掉 —— 行高与内容位置
   * 分毫不动，只有背景盒铺进节点之间的缝里（见 DISCARD_SEAM 的说明）。
   */
  padding-block-start: var(--discard-body-pad-start);
  padding-block-end: var(--discard-body-pad-end);
  margin-block-start: var(--discard-body-margin-start);
  margin-block-end: var(--discard-body-margin-end);
  // 只补右边：左边那 24px 是 Vuetify 给圆点让位的，不能动（否则文字会和主链错开）
  padding-inline-end: var(--discard-body-pad-inline-end);
}

/*
 * 弃置段段首的标识「进入弃置流程」：整块背景的左上角，一眼看出"从这里起是弃置流程"（见模板）。
 * 标签底色用比面板再深一档的**同色**（warning）、字用正文色 —— 面板底色本身就跟主题走，
 * 这里也跟着走，深浅两种模式都不会糊成一片。
 */
.discard-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgba(var(--v-theme-warning), 0.35);
}

// 拖拽悬停时的目标高亮
::deep(.v-timeline-item__body.drop-target) {
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 8px;
  outline: 1px dashed rgb(var(--v-theme-primary));
  outline-offset: 4px;
}


.field-label {
  font-size: 12px;
  line-height: 1.5;

  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

// 补充说明输入框：改「内部」字体必须用 :deep() 穿透 scoped 边界，
// 否则选择器编译成 .remark-input[data-v-xxx] textarea，匹配不到 Vuetify 内部的 textarea。
.remark-input {

  // 输入文字
  :deep(textarea) {
    font-size: 13px;
    line-height: 1.6;
  }

  // placeholder 是原生伪元素，要挂在 textarea 上而不是外层容器
  :deep(textarea::placeholder) {
    font-size: 12px;
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  }
}

// 附件选择：只露出 prepend 的回形针图标，隐藏输入框本体
.attachment-input {
  flex: 0 0 auto;
  max-width: 20px;

  :deep(.v-input__control) {
    display: none;
  }
}

// 回收数量输入框：缩小字号、高度
.qty-input {
  :deep(.v-field) {
    --v-field-padding-top: 1px;
    --v-field-padding-bottom: 1px;
    --v-input-control-height: 30px;
    font-size: 12px;
  }

  :deep(.v-field__input) {
    min-height: 30px;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  :deep(.v-label) {
    font-size: 12px;
  }

  // 后缀（$ / PST）默认 opacity: 0，仅激活时显示；这里强制始终可见
  // :deep(.v-text-field__suffix) {
  //     opacity: 1;
  // }
}

// radio 内嵌输入框：与左侧单选按钮垂直居中对齐
.radio-with-input {
  :deep(.v-label) {
    display: flex;
    // align-items: center;
    // align-self: stretch;
    // height: auto;
  }

  // 输入控件与按钮行高中线对齐，去除多余的上下边距
  :deep(.v-input) {
    margin-top: 0;
    margin-bottom: 0;
  }

  :deep(.v-field) {
    --v-input-control-height: 26px;
    --v-field-padding-top: 0;
    --v-field-padding-bottom: 0;
  }

  :deep(.v-field__input) {
    min-height: 26px;
    padding-top: 0;
    padding-bottom: 0;
    line-height: 26px;
  }
}
</style>
