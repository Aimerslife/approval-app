<template>
  <v-timeline-item
    class="mb-12"
    :class="{ 'discard-zone': inDiscardSegment !== undefined, 'waiting-approval': waitingApproval }"
    :dot-color="dotColor"
    size="35"
    :style="[discardZoneStyle, waitingGlowStyle]"
  >
    <template #icon>
      <!-- 飞书提醒环节没有人可显示首字，圆点里放一个铃铛 -->
      <v-icon v-if="isNotifyStep" :color="iconColor" size="14">mdi-bell-ring-outline</v-icon>
      <span v-else :style="{ fontSize: '13px', color: iconColor }">{{ initials }}</span>
    </template>

    <!-- 弃置段的**段首**：在整块背景的左上角标一句「进入弃置流程」（整段只有这一条有） -->
    <div v-if="inDiscardSegment === 0" class="discard-flag">
      <v-icon icon="mdi-archive-arrow-down-outline" size="13" />
      <span>进入弃置流程</span>
      <!-- 这一段要弃掉多少、值多少：跟着标题一起给，省得再去产品卡里翻 -->
      <span v-if="discardRemainingText" class="discard-flag__remaining">{{ discardRemainingText }}</span>
    </div>

    <div class=" d-flex align-center justify-space-between">
      <div class="d-flex align-center gap-2">
        <span v-if="deptName" class="text-[12px]">[{{ deptName }}]</span>

        <!-- 飞书提醒环节：没人可办，头部显示**提醒名称**（不是某人姓名），也没有头像 -->
        <template v-if="isNotifyStep">
          <v-icon color="primary" size="16">mdi-bell-ring-outline</v-icon>
          <span class="text-body-small font-weight-medium">{{ notifyItem?.name || '飞书提醒' }}</span>
          <v-chip color="info" label size="x-small" variant="tonal">飞书提醒</v-chip>
        </template>

        <template v-else>
          <v-avatar size="30px">
            <!-- 老单成员自带 avatar 直显；新单快照不带头像，按 open_id / email 现查（见 stores/avatarDirectory），
                 查不到退回首字（与抄送、接收人那两处同一口径） -->
            <v-img
              v-if="memberAvatar(manageDatas[0])"
              alt="Avatar"
              :src="memberAvatar(manageDatas[0])"
              @error="onAvatarError(manageDatas[0])"
            />

            <span v-else class="text-[12px] font-weight-semibold">{{ manageDatas[0]?.name?.slice(0, 1) }}</span>
            <!-- <v-icon :color="message.color" :icon="message.icon"></v-icon> -->
          </v-avatar>

          <span class="text-body-small" :class="{ 'text-medium-emphasis text-decoration-line-through': transferredTo }">
            {{ manageDatas[0]?.name }}</span>
        </template>

        <v-chip
          v-if="transferredTo"
          color="secondary"
          label
          size="x-small"
          variant="tonal"
        >
          已转办 → {{ transferredTo }}
        </v-chip>

        <v-chip
          v-if="transferIn"
          color="primary"
          label
          size="x-small"
          variant="flat"
        >
          转办：{{ transferIn.delegated_from }} → {{ transferIn.name }}
        </v-chip>

        <template v-if="resultChips.length > 0">
          <v-chip
            v-for="(c, ci) in resultChips"
            :key="ci"
            class="ms-0"
            color="primary"
            label
            size="x-small"
          >
            {{ c }}
          </v-chip>
        </template>

        <template v-else-if="status">
          <v-chip class="ms-0" color="success" label size="x-small">通过</v-chip>
        </template>

        <span v-for="(t, ti) in ledgerChips" :key="`ledger-${ti}`" class="text-[11px] text-medium-emphasis">{{ t
        }}</span>

        <span v-if="activeStep && !canHandle" class="text-[11px] text-medium-emphasis">未到该环节</span>

        <template v-if="activeStep && canHandle && !status && !hideHandle">
          <v-dialog v-model="dialog" max-width="500">
            <template #activator="{ props: activatorProps }">
              <v-btn
                color="success"
                size="x-small"
                variant="tonal"
                v-bind="activatorProps"
              >办理</v-btn>
            </template>

            <v-card>
              <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
                <v-icon color="primary" size="18">mdi-check-all</v-icon>
                <span>审批</span>
                <!-- 同一审批人连续多环：标出"这是第几个动作"，避免以为只办一次就完了 -->
                <v-chip
                  v-if="actionTotal > 1"
                  color="primary"
                  label
                  size="x-small"
                  variant="tonal"
                >
                  第 {{ actionNo }} / {{ actionTotal }} 个动作
                </v-chip>

                <v-spacer />
                <!-- 抄送 / 转办：与审批页底部面板同一个组件、同一份落库逻辑（页面监听 select） -->
                <SelectNode @select="payload => emit('select', payload)" />
              </v-card-title>

              <v-divider />

              <div class="px-4 py-3">
                <ApprovalHandleForm
                  ref="handleFormRef"
                  :allowed-options="props.allowedOptions"
                  :allowed-results="props.allowedResults"
                  :data="props.data"
                  :index="props.index"
                  :length="props.length"
                  :next-steps="props.nextSteps"
                  :option-context="props.optionContext"
                  :receiver-team="props.receiverTeam"
                  :remaining-qty="props.remainingQty"
                  :show-cancel="true"
                  :stock-amount="props.stockAmount"
                  :stock-qty="props.stockQty"
                  :type-templates="props.typeTemplates"
                  @cancel="dialog = false"
                  @submit="payload => emit('submit', payload)"
                />
              </div>
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

    <!-- 飞书提醒环节的详情：**提醒对象**（这一环会通知谁）。建单期只把姓名快照进 chain，所以只列名字 -->
    <div v-if="isNotifyStep && notifyTo.length > 0" class="mt-2 d-flex align-center flex-wrap gap-2">
      <v-chip color="info" label size="x-small" variant="tonal">提醒对象</v-chip>
      <span class="text-[12px] text-medium-emphasis">{{ notifyTo.join('、') }}</span>
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
        <v-chip
          class="mr-1"
          color="primary"
          label
          size="x-small"
          variant="flat"
        >
          <span class="text-[9px]">{{ pickedReceiver.pick === 'team' ? '接收部门' : '接收团队' }}</span>
        </v-chip>

        <v-avatar class="mr-1" size="22">
          <v-img v-if="pickedReceiver.avatar" cover :src="proxyAvatar(pickedReceiver.avatar)" />
          <v-icon v-else size="13">mdi-account</v-icon>
        </v-avatar>

        <span class="text-[10px] text-medium-emphasis">{{ pickedReceiver.name }}</span>
        <!-- 接收方 = 团队名/部门名 + 负责人；历史单（那时选的是人）退回显示邮箱 -->
        <span v-if="pickedReceiver.manager" class="text-[10px] text-high-emphasis">
          {{ pickedReceiver.pick === 'team' ? '部门负责人' : '团队负责人' }} {{ pickedReceiver.manager }}
        </span>

        <span v-else-if="pickedReceiver.email" class="text-[10px] text-high-emphasis">{{ pickedReceiver.email }}</span>
      </div>

      <div v-if="extraItems.length > 0" class="mt-1 d-flex flex-wrap align-center ga-2">
        <span v-for="it in extraItems" :key="it.key" class="text-[11px] text-medium-emphasis">
          {{ it.label }}：{{ it.value }}
        </span>
      </div>

      <div v-if="manager.files?.length" class="mt-1 d-flex align-center flex-wrap text-[11px]">
        <div
          v-for="f in manager.files"
          :key="f.id"
          class="d-inline-flex align-center  cursor-pointer text-[#89898A]"
          :href="f.url"
          rel="noopener"
          @click="showPic(f.url)"
        >
          <v-icon size="11">mdi-paperclip</v-icon>
          <span class="underline">{{ f.name }}</span>
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
        <div
          v-for="f in r.files"
          :key="f.id"
          class="d-inline-flex align-center cursor-pointer text-[#89898A] underline"
          @click="showPic(f.url)"
        >
          <v-icon size="11">mdi-paperclip</v-icon>
          <span class="mt-1">{{ f.name }}</span>
        </div>
      </div>
    </div>

    <template v-if="nodeTargets?.length">
      <div class="mt-2 d-flex align-center gap-2">
        <v-chip
          class="mr-1"
          color="secondary"
          label
          size="x-small"
          variant="flat"
        >
          <span class="text-[9px]">抄送</span>
        </v-chip>

        <div v-for="(t, i) in nodeTargets" :key="i" class="d-flex align-center">
          <v-avatar class="mr-1" size="22">
            <v-img v-if="memberAvatar(t)" cover :src="memberAvatar(t)" @error="onAvatarError(t)" />
            <v-icon v-else size="13">mdi-account</v-icon>
          </v-avatar>

          <span class="text-[10px] text-medium-emphasis">{{ t.name }}</span>
        </div>
      </div>
    </template>
  </v-timeline-item>

  <v-overlay v-model="overlay" class="d-flex align-center justify-center" @click:outside="overlay = false">
    <img
      v-if="imgUrl"
      alt="附件预览"
      class="attachment-preview"
      :src="imgUrl"
      @click="overlay = false"
    >
  </v-overlay>
</template>

<script lang="ts" setup>
  import type { UserBrief } from '@/api/api'
  import type { ApprovalChainItem, ApprovalNodeOption, NodeSubmitPayload, ReceiverTeam } from '@/types/approval'
  // 审批类型（结论码 → 选中后要填什么）：页面从单据快照里取，本组件只负责透传给办理表单
  import type { ApprovalTypeTemplate } from '@/utils/approvalTypes'
  import dayjs from 'dayjs'
  // proxyAvatar：飞书头像要经服务端代理才能在浏览器里正常显示（历史单里选过的"接收人"带着头像）
  import { proxyAvatar } from '@/api/api'
  // 头像目录：单据快照里不带成员头像，展示时按 open_id / email 现查（见该 store 的文件头）
  import { useAvatarDirectory } from '@/stores/avatarDirectory'
  // 头像地址的逐级降级（代理 → 原地址 → 首字）：见 composables/useAvatarSrc 的文件头
  import { useAvatarSrc } from '@/composables/useAvatarSrc'
  // 「选择接收团队」的结论码：历史单的 members 没记 pick，按结论码补粒度（见 pickedReceiver）
  import { PICK_TEAM_RESULT } from '@/types/approval'
  // 环节负责人口径（mainOf）与「连续同人环节」的类型都来自这里，别在组件里另写一套
  import { type ApprovalNextStep, mainOf } from '@/utils/approvalRuntime'
  import { buildColorScale, discardColorStep, hexToRgb, pickColorStep } from '@/utils/color'
  import { ensurePinyin, pinyinInitials } from '@/utils/pinyin'
  // shareValueText：按「总金额 ÷ 总数量 × 数量」折算货值（口径与办理表单里的「价值」同一份）
  import { formatDate, formatTimeDiff, shareValueText } from '@/utils/utils'
  // 表单主体：本项目没有「组件自动导入」，模板里用到的组件必须显式 import，
  // 否则编译成 resolveComponent 后运行时解析不到（控制台警告 + 表单整块不渲染）
  import ApprovalHandleForm from './approval/ApprovalHandleForm.vue'
  // 办理弹窗里的抄送 / 转办（首页、我的抽屉从节点进入办理时用它）
  import SelectNode from './streamNodes/SelectNode.vue'

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

    /**
     * 不在节点内渲染「办理」按钮：审批页把它换成了底部固定条上的统一入口
     * （见 pages/approvalPage.vue 的 `hide-handle` + 底部办理弹窗）。
     * 首页 / 我的抽屉里没有那条固定条，保持默认 false、仍从节点进入。
     */
    hideHandle?: boolean

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
     * 单据快照里的**审批类型**（结论码 → 选中后要填什么），直接透传给办理表单。
     * 页面用 `order.chain?.types` 传；老单没有这一项 → 表单回落内置默认。
     */
    typeTemplates?: Record<string, ApprovalTypeTemplate>

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
    hideHandle: false,
    nextSteps: () => [],
    stockQty: '',
    remainingQty: '',
    stockAmount: '',
    optionContext: () => ({}),
    receiverTeam: '',
    // 不传 = 认不出段长：每条都当"首尾"处理（退回一条一块背景的老样子，不会画错）
    discardSegmentSize: 1,
  })
  /*
   * 圆点尺寸：模板里写死 35（v-timeline-item 的 size="35"）。
   * 以前这里算过一份动态尺寸（主链渐大 / 弃置段渐小），但最终图标字号被写成了 13px、
   * 尺寸也只用了固定值，这份计算就成了死代码 —— 删掉，别留两套"看起来还在生效"的数。
   */

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

  /**
   * 弃置段段首那句「进入弃置流程」旁边带的产品余量：
   *   剩余数量 = 本环节还能接多少（`remainingQty`；页面没下发时退回总库存数量）；
   *   剩余金额 = 按「总库存金额 ÷ 总库存数量 × 剩余数量」折算（**与办理表单里的「价值」同一份实现**，
   *              见 utils/number 的 shareValueText）—— 两处口径必须一致，否则同一条时间线里
   *              弃置标题写一个数、办理框里写另一个数。
   *
   * 取不到数量 → 整句不显示；算不出金额（没关联产品 / 总数量为 0）→ 只显示数量那半截。
   * 宁可少显示，也不显示「剩余 0 件 / ￥0」这种会误导判断的值。
   */
  const discardRemainingText = computed(() => {
    const qty = String(props.remainingQty ?? '').trim() || String(props.stockQty ?? '').trim()
    if (!qty) {
      return ''
    }
    const amount = shareValueText(props.stockAmount, props.stockQty, qty)
    return amount ? `剩余 ${qty} 件 · ￥${amount}` : `剩余 ${qty} 件`
  })

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

  /*
   * 头像取法：**老单成员自带 avatar 直显，新单按 open_id / email 现查**
   * （快照里不再存头像，见 types/approval 的 slimFlowMembers）；都拿不到时模板里退回首字。
   * 现查的结果按人缓存在 store 里，一个会话只发一次请求。
   */
  const avatarDir = useAvatarDirectory()
  /*
   * 地址本身交给 useAvatarSrc 做**逐级降级**（服务端代理 → 原始签名地址 → 首字）：
   * 飞书头像 URL 带签名、会过期，直连只在签名有效期内可用（过期就是整片 403，见 utils/avatar）。
   */
  const avatarSrc = useAvatarSrc()
  function memberAvatar (m?: ApprovalChainItem) {
    return avatarSrc.srcOf(m?.avatar || avatarDir.avatarOf(m))
  }
  function onAvatarError (m?: ApprovalChainItem) {
    avatarSrc.onError(m?.avatar || avatarDir.avatarOf(m))
  }
  /*
   * 加载放在 watch 而不是 computed：这是"发请求 + 写缓存"的副作用，computed 里不该发请求。
   * ensure 幂等（内部记忆化），所以这里跟着 data 变多调几次也没关系。
   */
  watch(
    () => props.data,
    () => {
      void avatarDir.ensure()
    },
    { immediate: true },
  )

  /*
   * ===== 「飞书提醒」环节（type: 'notify'，见 types/approval 的 notify）=====
   * 它只通知、不办理：流程到达即穿过，**不会有结论、也不会成为 currentStep**（见 rebuildChain 的 pushNotify）。
   * 所以时间线上不该给它「办理」按钮 —— 更不该退而显示"未到该环节"（那看着像卡住了）——
   * 该显示的是**提醒名称**（chain 里 type='notify' 那条的 name）与**提醒对象**（notify.to）。
   */
  function isNotifyStepData (data?: ApprovalChainItem[]) {
    return !!data?.some(i => i.type === 'notify')
  }
  /** 本节点就是「飞书提醒」环节 */
  const isNotifyStep = computed(() => isNotifyStepData(props.data))
  /** 提醒环节那一条成员：name = 提醒名称，notify = { content, to } */
  const notifyItem = computed(() => props.data.find(i => i.type === 'notify'))
  /**
   * 提醒对象（这一环会通知谁）。
   * 建单期只把**姓名**快照进 chain（见 pushNotify），所以这里只有名字、没有头像/部门。
   *
   * 按姓名**去重**：模板的「提醒对象」可以多选，动态负责人也可能解析出多位负责人，
   * 同一个人很容易在成员列表里出现好几次（几个组共用一个负责人时尤其明显）。
   * 时间线上把同一个人列三遍，会让人误以为这一环真的会发三条提醒 ——
   * 发送侧也是"一个人只收一条"（见 utils/notifySteps 的 notifyTargets），两处口径保持一致。
   */
  const notifyTo = computed(() => {
    const names = (notifyItem.value?.notify?.to ?? [])
      .map(n => String(n ?? '').trim())
      .filter(Boolean)
    return [...new Set(names)]
  })

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

  /**
   * 当前要办的那一环。
   *
   * ⚠️ 跳过「飞书提醒」环节：它没有办理人、也不会有 handled_at，
   *    不跳过的话 `mainOf(提醒环)` 兜底取到那条 notify 成员、永远"未办理"，
   *    于是弹窗会对着一个不需要办的环节显示「办理」（或"未到该环节"）。
   */
  const activeStep = computed(() => actionSteps.value.find(s => !isNotifyStepData(s.data) && !mainOf(s.data)?.handled_at))

  /** 当前动作在组内的序号（从 1 起）与动作总数：>1 时弹窗里提示"办完自动接下一环" */
  const actionNo = computed(() => actionSteps.value.findIndex(s => s.index === activeStep.value?.index) + 1)
  const actionTotal = computed(() => actionSteps.value.length)

  /**
   * 这一环**正在等审批**（本节点就是当前待办那一环）：时间线上给圆点加边缘荧光闪烁
   * （样式见 `.waiting-approval`，效果就是"在等人办"）。
   *
   * 口径：
   *   · 认的是 activeStep（= 第一环还没 handled_at 的环节），所以已办完 / 已办结（activeStep 为空）自动为 false；
   *   · **不要求 canHandle** —— 单子流转到别人的环节时，那一环同样"在等人办"，同样该闪；
   *   · 飞书提醒环不会命中（activeStep 本来就跳过它们，见上面的说明）。
   */
  const waitingApproval = computed(() => activeStep.value?.index === props.index)

  /**
   * 荧光色 = **本环节圆点自己的颜色**（HEX → "r, g, b" 三元组，交给 CSS 用 rgba() 配透明度）。
   *
   * 不写死主题 primary：色阶是随环节位置变化的，光环跟着圆点走，整条时间线才是一体的。
   * 也正因为要拼 rgba()，这里传的是三元组而不是色值本身。
   */
  const waitingGlowStyle = computed(() => (
    waitingApproval.value ? { '--waiting-glow-rgb': hexToRgb(dotColor.value).join(', ') } : undefined
  ))

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
    // 回收类结论顺带写下的账（这批货总共多少件 / 多少钱），见 withRecycleLedger
    stock_qty: '总件数',
    stock_amount: '总金额',
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
    return `${name}（负责人 ${String(leader)}）`
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
   * 已办环节留下的账（渲染在时间线的节点头部，紧跟结论胶囊）：
   *
   *   · 接收：「已接收 X · 剩余 Y 件」—— 写进 extra 的 received_qty / remaining_qty
   *     （见 withReceiveLedger / receiptLedgerAfter）；
   *   · 回收：「总 Z 件 / ￥W」—— 写进 extra 的 stock_qty / stock_amount（见 withRecycleLedger）。
   *     本次回收的件数 / 金额已经在结论标签里（「回收 300 件 / ￥8,000」），这里补的是**这批货本身**。
   *
   * 数据都来自办理时写下的字段，所以历史单（那时还没有这笔账）不会显示，也不影响任何求值。
   * 两笔账各记各的：同一环节只会命中其中一条（结论不同）。
   */
  const ledgerChips = computed(() =>
    actionSteps.value.flatMap(s => {
      const extra = mainOf(s.data)?.extra
      if (!extra) {
        return []
      }
      const out: string[] = []
      const remaining = extra.remaining_qty
      if (remaining !== undefined && remaining !== null && remaining !== '') {
        out.push(`已接收 ${String(extra.received_qty ?? '—')} · 剩余 ${String(remaining)} 件`)
      }
      const stockQty = extra.stock_qty
      if (stockQty !== undefined && stockQty !== null && stockQty !== '') {
        const amount = extra.stock_amount
        const amountText = amount === undefined || amount === null || amount === '' ? '' : ` / ￥${String(amount)}`
        out.push(`总 ${String(stockQty)} 件${amountText}`)
      }
      return out
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
    props.nextSteps.map(step => actionResultOf(step)).filter((x): x is NonNullable<typeof x> => !!x),
  )

  const dialog = ref(false)
  /** 表单实例：关窗时调它的 reset()，把子组件自己的"等待下一环 / 校验红字"清掉 */
  const handleFormRef = ref<{ reset: () => void } | null>(null)

  /*
   * ⬇️ 这里曾经是节点内嵌的办理表单（选项下拉、数量/金额/原因、选接收方、collectResult…）。
   *    它已经整体搬进 components/approval/ApprovalHandleForm.vue（三个办理入口共用），
   *    上面的模板现在只是把 props 透传给它 + 关窗时 reset()。
   *    留下的这几行是**弹窗本身**还需要的：开关、子组件实例。
   */

  /*
   * ⬇️ 办理表单（选项下拉、数量/金额、原因二级原因、选接收方、collectResult）已整体搬到
   *    components/approval/ApprovalHandleForm.vue：三个办理入口共用同一份实现。
   *    这里曾经残留了同一套逻辑的副本，删掉 —— 两份并存时改一处漏一处，
   *    现象是"节点弹窗与底部面板填的东西不一样"。
   */

  /**
   * 这一环没得办了（别人办完 / 单据办结）：弹窗自己收起来。
   * 表单自身的状态由子组件管（关窗时它自己 reset()，见下一个 watch）。
   */
  watch(
    () => activeStep.value?.index,
    (now, before) => {
      if (now === before) return
      if (now === undefined && dialog.value) {
        dialog.value = false
      }
    },
  )

  /**
   * 关掉弹窗时把子组件自己的状态清干净（提交成功等下一环时按钮禁用 + 上一轮的红字校验），
   * 否则下次打开会带着旧状态。`reset()` 是 ApprovalHandleForm 对外暴露的唯一入口。
   */
  watch(dialog, open => {
    if (!open) {
      handleFormRef.value?.reset()
    }
  })

  /**
   * 本环节的**抄送人**（type 不是 manager 的成员）。
   *
   * ⚠️ 排除「飞书提醒」那条：它是**环节本身**，不是抄送给谁的人，`name` 是环节名（如「提醒1」）。
   *    以前它会落到这里被渲染成一个「抄送」标签 + 环节名，看着像"抄送了提醒1"这种没意义的东西；
   *    提醒名称与提醒对象改由模板里的 notifyItem / notifyTo 显示。
   */
  const nodeTargets = computed(() => props.data.filter(item => item.type != 'manager' && item.type !== 'notify'))

  const transferIn = computed(() => props.data.find(m => m.delegated_from))
  const transferredTo = computed(() => manageDatas.value[0]?.transferred_to)

  const imgUrl = ref('')
  function showPic (url: string) {
    overlay.value = true
    imgUrl.value = url
  }

  const emit = defineEmits<{
    (e: 'submit', payload: NodeSubmitPayload): void
    /** 抄送 / 转办选人：落库由页面接管（三处入口共用 composables/useApprovalSelect） */
    (e: 'select', payload: { action: 'cc' | 'transfer', user: UserBrief }): void
  }>()

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
  margin-left: 15px;
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
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgba(var(--v-theme-warning), 0.35);
}

/*
 * 标签里那半句「剩余 118 件 · ￥1,807.76」：
 *   · 比标题轻一档（它是补充信息，标题才是"从这里起是弃置流程"）；
 *   · 用一条细竖线跟标题隔开 —— 不然「进入弃置流程剩余 118 件」会读成一句话。
 */
.discard-flag__remaining {
  margin-left: 2px;
  padding-left: 8px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  font-weight: 500;
  opacity: 0.85;
}

/*
 * ===== 「正在审批」的圆点：边缘荧光闪烁（= 这一环在等人办）=====
 *
 * 两件事叠加，都只动 box-shadow / transform / opacity，**不碰布局**（时间线的行高、连线一个像素都不动）：
 *   ① 圆点本体（inner-dot）的荧光呼吸：光晕由小到大再收回去，像在"喘气"；
 *   ② 外层圆（dot）的 ::after 画一圈荧光边，向外扩散并淡出：雷达波，扫一眼就知道有东西在等。
 *      波放在**外层**而不是内层：内层被 Vuetify 让出一圈 8px 的"留白环"，从内层往外扩会往里缩一截。
 *
 * 判定在脚本里（waitingApproval）：本节点就是当前待办那一环时，根元素才带 `waiting-approval` 类，
 * 所以下面这些规则对已办完 / 未到达的环节**完全匹配不到**，不需要额外兜底。
 *
 * 颜色取圆点自己的颜色（`--waiting-glow-rgb`，见 waitingGlowStyle）：色阶越往后越深，光环跟着走。
 *
 * ⚠️ 类名跟着 Vuetify 4 的 timeline 内部结构（divider__dot / divider__inner-dot）；
 *    老版本是 item__dot / item__inner-dot，两个都写上 —— 样式不生效是静默的，宁可多一条选择器。
 */
.waiting-approval :deep(.v-timeline-divider__dot),
.waiting-approval :deep(.v-timeline-item__dot) {
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%; // 跟着圆点走，不写死尺寸：弃置段的圆点是逐环缩小的
    // 用 box-shadow 而不是 border 画边：不占盒模型，边线正好压在圆点外沿上
    box-shadow: 0 0 0 2px rgba(var(--waiting-glow-rgb), 0.8), 0 0 10px 3px rgba(var(--waiting-glow-rgb), 0.5);
    animation: approval-waiting-ping 1.9s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
    // 只是视觉：别让它挡住圆点上的点击（圆点里是首字 / 铃铛图标，本身不可点，但别留隐患）
    pointer-events: none;
  }
}

/* 荧光本体（内层圆盘） */
.waiting-approval :deep(.v-timeline-divider__inner-dot),
.waiting-approval :deep(.v-timeline-item__inner-dot) {
  animation: approval-waiting-glow 1.9s ease-in-out infinite;
}

/* 荧光本体：暗 → 亮 → 暗（周期与扩散波一致，两个动作看着是同一口气） */
@keyframes approval-waiting-glow {
  0%,
  100% {
    box-shadow: 0 0 4px 0 rgba(var(--waiting-glow-rgb), 0.35);
  }

  50% {
    box-shadow: 0 0 12px 3px rgba(var(--waiting-glow-rgb), 0.8);
  }
}

/* 扩散波：从圆点边缘放大到 1.7 倍并淡出（放大到 70% 就看不见了，剩下 30% 留白给节奏） */
@keyframes approval-waiting-ping {
  0% {
    transform: scale(1);
    opacity: 0.85;
  }

  70% {
    transform: scale(1.1);
    opacity: 0;
  }

  100% {
    transform: scale(1.1);
    opacity: 0;
  }
}

/*
 * 系统开了「减少动态效果」（无障碍设置 / 低电量模式）：保留静态荧光、不再闪。
 * 持续闪烁对前庭敏感的人不友好，这条不能省。
 */
@media (prefers-reduced-motion: reduce) {
  .waiting-approval :deep(.v-timeline-divider__dot)::after,
  .waiting-approval :deep(.v-timeline-item__dot)::after {
    display: none;
  }

  .waiting-approval :deep(.v-timeline-divider__inner-dot),
  .waiting-approval :deep(.v-timeline-item__inner-dot) {
    animation: none;
    box-shadow: 0 0 10px 2px rgba(var(--waiting-glow-rgb), 0.55);
  }
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

/*
 * 附件图片预览：只设"上限"，宽高都 auto —— 这是能自适应的关键：
 *   · 大图：等比缩到 max-width / max-height 之内（不会溢出屏幕）；
 *   · 小图：原尺寸显示（url 图不会被拉伸糊掉）；
 *   · 窄屏：90vw 让它横向也放得下，竖高的长图则由 90vh 收住。
 * 视口单位而不是固定 px：弹窗尺寸随页面走，缩放浏览器窗口/手机上同样成立。
 */
.attachment-preview {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 10px;
  cursor: zoom-out;
  /* 深色遮罩下给白底图一点边界感，否则边缘会"糊"进背景 */
  // box-shadow: 0 8px 40px rgb(0 0 0 / 45%);
}
</style>
