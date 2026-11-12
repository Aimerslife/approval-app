<template>
  <tr class="text-no-wrap" :class="{ 'row-draggable': draggable }" :draggable="draggable"
    @dragstart="onDragStart">
    <td>{{ item.name }}</td>

    <td>
      <strong :class="item.status == 0 ? 'text-error' : 'text-success'">{{ item.status == 0 ? '未启用' : '启用' }}</strong>
    </td>

    <td style="min-width: 360px">
      <!-- 表格里展示紧凑版流程概览（主线成员 + 分支组/条件/嵌套/loopBackTo）；点「查看」再看完整流程图 -->
      <div class="d-flex align-center" style="gap: 6px">
        <v-icon-btn icon="mdi-chart-sankey-variant" size="24" title="查看流程图" variant="plain"
          @click="emit('preview', item)">
          <v-icon color="#1055C9" size="16" />
        </v-icon-btn>

        <FlowMiniMap :chain="item.chain.chain" :flow="item.chain.flow" style="flex: 1; min-width: 0" />
      </div>
    </td>

    <td>
      <span class="text-grey">{{ formatDate(item.created) }}</span>
    </td>

    <td class="text-start">
      <v-icon-btn icon="mdi-pencil" size="24" variant="plain" @click="emit('edit', item.id)">
        <v-icon size="16" />
      </v-icon-btn>

      <v-icon-btn icon="mdi-delete-outline" size="24" variant="plain" @click="emit('remove', item.id)">
        <v-icon size="16" />
      </v-icon-btn>

      <v-icon-btn icon="mdi-content-copy" size="24" title="复制成副本" variant="plain"
        @click="emit('copy', item.id)">
        <v-icon size="15" />
      </v-icon-btn>

      <!-- 副本专属：改名去掉「- 副本」后缀，就移进正本（见 promoteParten） -->
      <v-icon-btn v-if="isTemplateCopy(item.name)" icon="mdi-arrow-up-bold-box-outline" size="24"
        title="改名并移入正本" variant="plain" @click="emit('promote', item)">
        <v-icon color="#1867C0" size="16" />
      </v-icon-btn>

      <!-- 导出成 JSON：文件里只有名字 + 启停 + 三要素，拿去别的环境用「导入 JSON」还原 -->
      <v-icon-btn icon="mdi-file-export-outline" size="24" title="导出为 JSON" variant="plain"
        @click="emit('export', item)">
        <v-icon color="#1055C9" size="16" />
      </v-icon-btn>
    </td>
  </tr>
</template>

<script lang="ts" setup>
import type { ApprovalModal } from '@/types/approval'
import FlowMiniMap from '@/components/FlowMiniMap.vue'
// 正本 / 副本的名规约（判定用，见 utils/templateCopy）
import { isTemplateCopy } from '@/utils/templateCopy'
import { formatDate } from '@/utils/utils'

/**
 * 模板管理页的**一行模板**（名称 / 状态 / 流程概览 / 创建时间 / 操作）。
 *
 * 为什么抽成组件：正本页签用 v-data-table 的原生分组（group-by=sectionName，2026-11-12），
 * 组内行和副本表共用同一份行渲染。区块的移动不再走按钮弹窗 —— 正本行**可拖拽**：
 * 拖到某个区块的组头 = 移入该区块，拖到表格下方虚线区 = 建新区块并移入。
 */
const props = defineProps<{
  item: ApprovalModal
  /** 正本 = true：行可拖拽进区块（副本是草稿，不参与区块分组） */
  draggable?: boolean
}>()

const emit = defineEmits<{
  preview: [item: ApprovalModal]
  edit: [id: string]
  remove: [id: string]
  copy: [id: string]
  promote: [item: ApprovalModal]
  export: [item: ApprovalModal]
}>()

/**
 * HTML5 拖拽的数据握手：把模板 id 放进专用格式（只认这个 MIME，避免拖别的内容误触发）。
 * drop 侧见页面的 onDropToGroup / onDropNewSection。
 */
function onDragStart(e: DragEvent) {
  if (!props.draggable) return
  e.dataTransfer?.setData('application/x-approval-template', props.item.id)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}
</script>

<style scoped>
tr.row-draggable {
  cursor: grab;
}
</style>
