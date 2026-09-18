<template>
    <v-container fluid :class="{ 'screen-full': fullSceen }">
        <BackNode title="审批模板" />
        <v-row align="stretch" class="flow-grid">
            <v-col cols="2" class="min-w-0 flow-col-left" :class="{ 'flow-col-left--collapsed': leftCollapsed }">
                <!-- 收起 / 展开。按钮固定在栏内同一个位置，收起后仍在原处 → 不会"收起来就找不回来" -->
                <v-icon-btn class="flow-col-left__toggle mr-5 mt-5" :title="leftCollapsed ? '展开组织架构' : '收起组织架构'"
                    :icon="leftCollapsed ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'" size="small" variant="text"
                    @click="leftCollapsed = !leftCollapsed" />
                <!-- v-show 而不是 v-if：收起再展开要保住树的展开状态、滚动位置和已选部门 -->
                <OrgTree v-show="!leftCollapsed" @select="onOrgSelect" />
            </v-col>
            <v-col cols="10" class="min-w-0 flow-col-right">
                <v-sheet rounded
                    class="p-3 border border-dashed border-accent sticky top-2 flow-sheet d-flex flex-column">
                    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-2 shrink-0">
                        <div class="d-flex align-center ga-2 flex-wrap">
                            <span class="text-[14px] font-weight-bold">{{ editId ? '编辑审批流' : '新建审批流' }}</span>
                            <v-btn variant="tonal" size="small" color="primary" prepend-icon="mdi-account-check"
                                @click="addApprovalNode">审批节点</v-btn>
                            <v-btn variant="tonal" size="small" color="warning" prepend-icon="mdi-source-branch"
                                @click="addConditionNode">条件分支</v-btn>
                        </div>
                        <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-0">
                            <div class="d-flex align-center">
                                <template v-if="selectedUser">
                                    <v-avatar size="25" class="mr-3">
                                        <v-img v-if="selectedUser.avatar" :src="selectedUser.avatar" cover />
                                        <v-icon v-else size="15">mdi-account</v-icon>
                                    </v-avatar>
                                    <div class="d-flex flex-column">
                                        <div class="text-[12px]">
                                            {{ selectedUser.name }}
                                            <v-chip v-if="selectedUser.is_tenant_manager" size="x-small" color="error"
                                                variant="tonal">管理员</v-chip>
                                            <v-chip v-if="selectedUser.is_leader" size="x-small" color="warning"
                                                variant="tonal">负责人</v-chip>
                                        </div>
                                    </div>
                                    <v-radio-group v-model="radios" inline density="compact" hide-details class="ml-4">
                                        <v-radio value="manager" color="#5BB65E">
                                            <template v-slot:label>
                                                <strong class="text-success text-[11px]">审批人</strong>
                                            </template>
                                        </v-radio>
                                        <v-radio value="cc" color="#2670C4">
                                            <template v-slot:label>
                                                <strong class="text-primary text-[11px]">抄送</strong>
                                            </template>
                                        </v-radio>
                                    </v-radio-group>
                                </template>
                                <v-alert v-else type="info" variant="tonal" density="compact" class="py-0 "
                                    icon-size="15">
                                    <span class="text-[11px]">在左侧选择员工后，点击节点上的「添加成员」加入</span>
                                </v-alert>
                            </div>
                        </div>
                        <div class="d-flex align-center ga-2">
                            <!-- <v-btn-group density="compact" size="small" rounded="lg"> -->
                            <v-icon-btn :disabled="!undoStack.length" icon="mdi-arrow-u-left-top" title="撤销 (Ctrl+Z)"
                                @click="undo" size="small" variant="text" />
                            <v-icon-btn :disabled="!redoStack.length" icon="mdi-arrow-u-right-top"
                                title="重做 (Ctrl+Shift+Z)" size="small" variant="text" @click="redo" />
                            <v-icon-btn :title="fullSceen ? '退出全屏 (Esc)' : '全屏'"
                                :icon="fullSceen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" size="small"
                                variant="text" @click="setFullScreen" />
                            <!-- </v-btn-group> -->
                            <v-btn variant="tonal" size="small" color="error" @click="resetAll">重置</v-btn>
                            <v-btn variant="flat" color="primary" size="small" @click="isActive = true">保存</v-btn>
                        </div>
                    </div>
                    <div v-if="selectedEdge" class="branch-panel mb-2" :class="{ 'result-panel': isResultEdge }">
                        <div class="panel-head">
                            <span class="head-icon">
                                <v-icon size="12" :color="isResultEdge ? '#2563eb' : '#d97706'">
                                    {{ isResultEdge ? 'mdi-account-check-outline' : 'mdi-source-branch' }}
                                </v-icon>
                            </span>
                            <span class="panel-title">{{ isResultEdge ? '审批结果分支配置' : '分支配置' }}</span>
                            <div v-if="selectedEdgeToEnd" class="panel-hint end-branch-hint ml-3">
                                此分支直达「结束」节点：命中该分支时流程直接结束，不再进入后续环节
                            </div>
                            <v-spacer />
                            <button class="icon-btn" title="关闭" @click="selectedEdge = null">
                                <v-icon size="12">mdi-close</v-icon>
                            </button>
                        </div>
                        <div class="panel-body">
                            <div class="panel-row">
                                <input v-model="selectedEdgeLabel" class="panel-input" style="width: 148px"
                                    :placeholder="isResultEdge ? '如：驳回走复核' : '如：财务审批'" />
                                <label class="switch-label">
                                    <input type="checkbox" :checked="!selectedEdgeConditions.length"
                                        @change="onMainToggle" />
                                    <span class="mt-1" v-if="!selectedEdgeConditions.length">{{ isResultEdge ?
                                        '主线（审批通过/其他结论未命中时走这条）' : '默认分支（条件都不命中时走这条）' }}</span>
                                </label>
                                <div class="panel-row ml-3">
                                    <select v-model="selectedEdgeType" class="panel-input" style="width: 128px">
                                        <option v-for="t in EDGE_STYLES" :key="t.value" :value="t.value">
                                            {{ t.label }}
                                        </option>
                                    </select>
                                    <template v-if="selectedEdgeType === 'default'">
                                        <span class="panel-label" title="0 = 接近直线，1 = 弯曲最明显">弯曲程度</span>
                                        <input v-model.number="selectedEdgeCurvature" type="range" min="0" max="1"
                                            step="0.05" class="edge-slider" />
                                        <span class="panel-label slider-value">{{ selectedEdgeCurvature.toFixed(2)
                                        }}</span>
                                    </template>
                                    <template v-else-if="selectedEdgeType === 'smoothstep'">
                                        <span class="panel-label">圆角大小</span>
                                        <input v-model.number="selectedEdgeBorderRadius" type="range" min="0" max="30"
                                            step="1" class="edge-slider" />
                                        <span class="panel-label slider-value">{{
                                            Math.round(selectedEdgeBorderRadius)
                                        }}</span>
                                    </template>
                                </div>
                            </div>
                            <!--
                                审批结论（仅结果分支）：单独一行 —— 它是**硬前提**，
                                与下面那些"附加条件/条件组"不是一个层级（不参与「满足方式」的组合）。
                            -->
                            <template v-if="isResultEdge && selectedEdgeConditions.length">
                                <div class="panel-row">
                                    <span class="panel-label">审批结论</span>
                                    <select v-model="selectedEdgeResult" class="panel-input" style="width: 168px">
                                        <option value="" disabled>请选择审批结论</option>
                                        <option v-for="r in APPROVAL_RESULTS" :key="r.value" :value="r.value">
                                            {{ r.label }}
                                        </option>
                                    </select>
                                </div>
                                <div v-if="selectedEdgeResult === 'other_reason'" class="panel-hint ml-3">
                                    「其他原因」通常需要再细化：可追加条件，如 result_label 包含关键词、amount 大于 5000；
                                    多个原因属于同一走向时把满足方式改成「任一满足」
                                </div>
                            </template>

                            <!-- 条件条目：两种分支共用（普通条件 / 条件组混排） -->
                            <template v-if="selectedEdgeConditions.length">
                                <div v-for="item in panelConditionItems" :key="item.index" class="cond-item"
                                    :class="{ 'ml-3': isResultEdge }">
                                    <!-- 条件组：组内自己的满足方式 + 组内条件行 -->
                                    <div v-if="item.kind === 'group'" class="cond-group">
                                        <div class="panel-row">
                                            <v-chip size="x-small" color="warning">条件组</v-chip>
                                            <select v-model="groupOf(item).logic" class="panel-input" style="width: 116px">
                                                <option value="and">组内全部满足</option>
                                                <option value="or">组内任一满足</option>
                                            </select>
                                            <button class="add-cond-btn" @click="addGroupItem(groupOf(item))">
                                                <v-icon size="11">mdi-plus</v-icon>
                                                <span>组内条件</span>
                                            </button>
                                            <v-icon-btn @click="removeCondition(item.index)" variant="text" size="x-small"
                                                class="ml--2" title="删除整个条件组">
                                                <v-icon size="11">mdi-close</v-icon>
                                            </v-icon-btn>
                                        </div>
                                        <div v-for="(sub, k) in groupOf(item).items" :key="k">
                                            <!-- 更深的嵌套组：面板先不展开编辑（模型支持，数据照常保存） -->
                                            <div v-if="isConditionGroup(sub)" class="panel-hint ml-4">
                                                （这里是三层以上的嵌套组，面板暂不展开编辑；结构会原样保存）
                                            </div>
                                            <div v-else class="panel-row ml-4">
                                                <input v-model="subCondOf(sub).field" class="panel-input"
                                                    style="width: 108px" list="flow-field-options"
                                                    placeholder="字段 是否属于灯具" />
                                                <select v-model="subCondOf(sub).op" class="panel-input"
                                                    style="width: 88px">
                                                    <option v-for="op in OPS" :key="op.value" :value="op.value">
                                                        {{ op.label }}
                                                    </option>
                                                </select>
                                                <input v-model="subCondOf(sub).value" class="panel-input"
                                                    style="width: 108px" placeholder="比较值 是 / 5000" />
                                                <v-icon-btn @click="removeGroupItem(groupOf(item), k)" variant="text"
                                                    size="x-small" class="ml--2">
                                                    <v-icon size="11">mdi-close</v-icon>
                                                </v-icon-btn>
                                            </div>
                                        </div>
                                        <div v-if="!groupOf(item).items.length" class="panel-hint ml-4">
                                            组内还没有条件：当前按「恒真」处理，不会拦住这条分支（补上条件才会生效）
                                        </div>
                                    </div>

                                    <!-- 普通条件：单行 -->
                                    <div v-else class="panel-row">
                                        <input v-model="condOf(item).field" class="panel-input" style="width: 108px"
                                            list="flow-field-options" placeholder="字段 amount" />
                                        <select v-model="condOf(item).op" class="panel-input" style="width: 88px">
                                            <option v-for="op in OPS" :key="op.value" :value="op.value">{{ op.label }}
                                            </option>
                                        </select>
                                        <input v-model="condOf(item).value" class="panel-input" style="width: 108px"
                                            placeholder="比较值 5000" />
                                        <v-icon-btn @click="removeCondition(item.index)" variant="text" size="x-small"
                                            class="ml--2">
                                            <v-icon size="11">mdi-close</v-icon>
                                        </v-icon-btn>
                                    </div>
                                </div>

                                <div class="panel-row" :class="{ 'ml-3': isResultEdge }">
                                    <button class="add-cond-btn" @click="addCondition">
                                        <v-icon size="11">mdi-plus</v-icon>
                                        <span>添加条件</span>
                                    </button>
                                    <button class="add-cond-btn ml-2" @click="addConditionGroup"
                                        title="一个条件组内部可以先用「组内满足方式」组合，再用下面的「满足方式」与其它条目组合。分档阈值（灯具>5000 或 非灯具>2000）就是这么写的">
                                        <v-icon size="11">mdi-plus</v-icon>
                                        <span>添加条件组</span>
                                    </button>
                                </div>
                                <!-- 条目之间的组合方式；每个条件组**内部**另有自己的满足方式 -->
                                <div v-if="panelConditionItems.length > 1" class="panel-row"
                                    :class="{ 'ml-3': isResultEdge }">
                                    <span class="panel-label">满足方式</span>
                                    <select v-model="selectedEdgeLogic" class="panel-input" style="width: 108px">
                                        <option value="and">全部满足</option>
                                        <option value="or">任一满足</option>
                                    </select>
                                    <span class="panel-hint ml-2">作用于上面这些条目之间</span>
                                </div>
                            </template>
                        </div>
                    </div>
                    <!--
                        条件字段候选。用 datalist 而不是 v-select：
                        ① 仍允许手输（旧模板里可能有不在清单里的字段名，v-select 会把它们清掉）；
                        ② 不改变分支面板现有的原生输入框样式。
                        value 取 f.key（= BI 的中文列名，条件求值就是按它取数），label 显示表格里的标题，
                        两者不一致时（如 key=图片链接 / title=产品图片）能看出对应关系。
                    -->
                    <datalist id="flow-field-options">
                        <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
                    </datalist>
                    <!--
                        校验失败的提示条：点名是哪个环节出了问题，并提供「定位」。
                        环节卡片上也会显示同一句话（见 nodeErrorOf），这里主要是让用户
                        在别处（比如刚点完保存、视线在别处）也能看到，并一点跳过去。
                    -->
                    <div v-if="saveError" class="save-error-bar">
                        <v-icon size="14">mdi-alert-circle-outline</v-icon>
                        <span class="save-error-bar__text">{{ saveError.message }}</span>
                        <button v-if="saveError.nodeId" class="save-error-bar__btn" @click="locateError">定位</button>
                        <button class="save-error-bar__btn" @click="saveError = null">关闭</button>
                    </div>
                    <div class="flow-canvas">
                        <VueFlow v-model:nodes="nodes" v-model:edges="edges" :delete-key-code="['Backspace', 'Delete']"
                            :default-viewport="{ zoom: 1 }" :min-zoom="0.3" :max-zoom="1.8" fit-view-on-init
                            :connection-radius="30" @connect="onConnect" @edge-click="onEdgeClick"
                            @pane-click="selectedEdge = null" @move="onMove">
                            <Background :gap="16" />
                            <Controls position="bottom-left" />
                            <MiniMap position="bottom-right" pannable zoomable />
                            <!--
                                每个节点外面包一层，用来在**卡片正下方**挂校验错误：
                                错误条是节点的一部分（跟着一起平移缩放），用户一眼就能看到
                                「是这一环」而不只是弹一句提示。节点组件本身不用改。
                            -->
                            <template #node-start="{ id }">
                                <div class="node-shell">
                                    <StartEndNode kind="start" :key="id" />
                                    <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                                        <v-icon size="12">mdi-alert-circle-outline</v-icon>
                                        <span>{{ nodeErrorOf(id) }}</span>
                                    </div>
                                </div>
                            </template>
                            <template #node-end="{ id }">
                                <div class="node-shell">
                                    <StartEndNode kind="end" :key="id" />
                                    <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                                        <v-icon size="12">mdi-alert-circle-outline</v-icon>
                                        <span>{{ nodeErrorOf(id) }}</span>
                                    </div>
                                </div>
                            </template>
                            <template #node-approval="{ id, data, selected }">
                                <div class="node-shell">
                                    <ApprovalNode :data="data" :selected="selected" :branches="outBranches(id)"
                                        :active-edge-id="selectedEdge?.id" @branch-click="selectBranch"
                                        @add-member="addMemberTo(id)" @add-role="addRoleMemberTo(id)"
                                        @remove="removeNodeById(id)" />
                                    <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                                        <v-icon size="12">mdi-alert-circle-outline</v-icon>
                                        <span>{{ nodeErrorOf(id) }}</span>
                                    </div>
                                </div>
                            </template>
                            <template #node-condition="{ id, selected }">
                                <div class="node-shell">
                                    <ConditionNode :branches="getBranches(id)" :active-edge-id="selectedEdge?.id"
                                        :selected="selected" @branch-click="selectBranch"
                                        @remove="removeNodeById(id)" />
                                    <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                                        <v-icon size="12">mdi-alert-circle-outline</v-icon>
                                        <span>{{ nodeErrorOf(id) }}</span>
                                    </div>
                                </div>
                            </template>
                            <template #edge-adjustable="edgeProps">
                                <AdjustableEdge v-bind="(edgeProps as any)" :interactive="true"
                                    @update-cp="onEdgeCpUpdate((edgeProps as any).id, $event)" />
                            </template>
                        </VueFlow>
                    </div>
                    <div class="text-grey text-[11px] mt-2 shrink-0">
                        选中连线按 Backspace / Delete 可删除；节点可自由拖动；Ctrl+Z 撤销 / Ctrl+Shift+Z 重做
                    </div>
                </v-sheet>
            </v-col>
        </v-row>

        <v-dialog max-width="500" v-model="isActive">
            <v-card rounded="lg">
                <v-card-text>
                    <div class="d-flex justify-space-between">
                        <v-btn class="text-none font-weight-bold ms-n4 mt-2" color="primary" text="审批流命名"
                            variant="text"></v-btn>
                        <v-switch v-model="status" color="#1867C0" true-icon="mdi-check" false-icon="mdi-close">
                            <template v-slot:label>
                                <span class="text-[12px]">{{ status ? '开启' : '关闭' }}</span>
                            </template>
                        </v-switch>
                    </div>
                    <v-text-field label="例如：报销审批" variant="outlined" clearable v-model="streamName"
                        :rules="[streamNameRule]" persistent-hint hint="审批流名称不能为空"></v-text-field>
                    <span class="text-[12px] text-grey">创建后将于审批模板处查看</span>
                </v-card-text>
                <v-divider></v-divider>
                <v-card-actions class="my-1 d-flex justify-end">
                    <v-btn class="text-none" rounded="xl" text="取消" @click="isActive = false"></v-btn>
                    <v-btn class="text-none" color="primary" rounded="xl" :text="editId ? '保存' : '创建'" variant="flat"
                        :loading="saving" @click="saveStream"></v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000">
            {{ snackbar.text }}
            <template v-slot:actions>
                <v-btn variant="text" @click="snackbar.show = false">关闭</v-btn>
            </template>
        </v-snackbar>
    </v-container>
</template>

<script lang="ts" setup>
import { VueFlow, MarkerType, useVueFlow, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'

import { addApproval, getApprovalOne, updateApprovalModel } from '@/utils/collection'
import { ensureRejectLoopBack, graphToFlowFrom } from '@/utils/approvalFlow'
import type {
    ApprovalChainItem,
    ApprovalFlow,
    ApprovalNodeData,
    BranchCondition,
    ConditionExpr,
    ConditionGroup,
    FlowGraph,
    FlowGraphEdge,
} from '@/types/approval'
import { APPROVAL_RESULTS, flowToChain, isConditionGroup, isResultCondition, uid } from '@/types/approval'
import BackNode from '@/components/BackNode.vue'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
// 条件字段候选：BI 产品字段 + 派生指标（毛利率 / 海外仓库存金额）
import { PRODUCT_FIELDS } from '@/utils/productFields'
import { DERIVED_KEYS } from '@/utils/biRowFields'
import OrgTree from '@/components/OrgTree.vue'
import type { OrgSelectPayload } from '@/components/OrgTree.vue'
import StartEndNode from '@/components/flow/StartEndNode.vue'
import ApprovalNode from '@/components/flow/ApprovalNode.vue'
import ConditionNode from '@/components/flow/ConditionNode.vue'
import AdjustableEdge from '@/components/flow/AdjustableEdge.vue'

const route = useRoute()
const { setViewport, addSelectedEdges, setCenter, findNode } = useVueFlow()

const isActive = ref(false)
const status = ref(false)
const saving = ref(false)
const streamName = ref<string>('')
const radios = ref('manager')
/** 编辑模式：加载已有模板时记录其 id，保存走 update */
const editId = ref('')
const snackbar = ref<{ show: boolean; text: string; color: string }>({ show: false, text: '', color: 'success' })
const showMsg = (text: string, color: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    snackbar.value = { show: true, text, color }
}

/* ==================== 保存失败：指出是哪个环节 ==================== */

/**
 * 校验失败时锁定的出错位置（由 graphToFlowFrom 的 errorNodeId / errorEdgeId 给出）。
 *
 * 为什么要有这个：原先失败只弹一句「请检查连线」，而画布上几十个框、上百条线，
 * 用户根本不知道看哪儿。现在出错的那个**环节卡片上直接写原因**，
 * 视图自动移过去，画布上方还有一条提示条可以再点「定位」。
 *
 * 生命周期：只在保存时刷新 —— 改完再存一次就换到新位置 / 清空，
 * 不监听每次拖动（那样错误提示会在用户还没改完时就闪掉，反而看不到）。
 */
const saveError = ref<{ message: string; nodeId?: string; edgeId?: string } | null>(null)

/** 该环节要显示的错误文案（绑到节点组件的 error prop 上） */
function nodeErrorOf(id: string): string {
    return saveError.value?.nodeId === id ? saveError.value.message : ''
}

/** 把视图移到出错的环节上；提示条里的「定位」按钮也用它 */
function locateError() {
    const nodeId = saveError.value?.nodeId
    if (!nodeId) return
    const node = findNode(nodeId)
    if (!node) return
    // 卡片宽 236：居中要到它横向中点；纵向往上留一点，别让卡片顶到视口边缘
    setCenter(node.position.x + 118, node.position.y + 40, { zoom: 1, duration: 300 })
}

/**
 * 出错的那条线标红。
 * 节点是自绘组件、错误文案走 prop；线是 vue-flow 内部渲染的，走它自己的 class 机制最省。
 */
watch(saveError, (cur, prev) => {
    for (const e of edges.value) {
        if (prev?.edgeId === e.id) delete e.class
        if (cur?.edgeId && cur.edgeId === e.id) e.class = 'has-error'
    }
})

const fullSceen = computed({
    get: () => isEditorFullscreen.value,
    set: (v: boolean) => { isEditorFullscreen.value = v },
})

function setFullScreen() {
    fullSceen.value = !fullSceen.value
}

/** 左侧组织架构是否收起（收起后画布拿到整行宽度）。只在本页会话内保留，不落库 */
const leftCollapsed = ref(false)

// ===== 画布数据 =====
// 节点/边用宽松类型，避免 vue-flow Node/Edge 联合泛型导致的 TS 2589 深实例化

const nodes = ref<any[]>([
    { id: 'start', type: 'start', position: { x: 300, y: 0 } },
    { id: 'end', type: 'end', position: { x: 300, y: 240 } },
])

/**
 * 分支条件的**字段候选**（喂给 <datalist>，见模板里的说明）。三部分：
 *   1) 65 个 BI 产品字段 —— 条件求值时就是按这些中文 key 从产品数据里取值；
 *   2) 派生指标（毛利率 / 海外仓库存金额）—— BI 里没有这两列，由 biRowFields 算出（见 deriveFlowFields）；
 *   3) 审批结论与办理表单字段 —— 上一环节的结论（result）以及办理人填的值（amount / qty / …）。
 * 前两部分的 value 用 `key`（= BI 中文列名，与产品数据里的键一致），label 显示为对应说明。
 */
const FIELD_OPTIONS = computed(() => [
    ...PRODUCT_FIELDS.map(f => ({ value: f.key, label: f.title })),
    { value: DERIVED_KEYS.grossMargin, label: '派生指标（SKU3月前毛利润 ÷ SKU3月前回款 × 100）' },
    { value: DERIVED_KEYS.overseasAmount, label: '派生指标（= 总库存金额，白板里的"海外仓库存金额/呆滞金额"就是它）' },
    { value: 'result', label: '上一环节的审批结论（pass / reject / …）' },
    { value: 'amount', label: '办理时填写的金额' },
    { value: 'qty', label: '办理时填写的数量' },
    { value: 'reason_belong', label: '办理时选择的原因分类' },
    { value: 'second_reason', label: '办理时选择的二级原因' },
    { value: 'remark', label: '办理时填写的补充说明' },
    { value: 'confirmed', label: '办理时的确认标记（如报废清仓）' },
])
/** 统一连线箭头：与连线同色，尺寸收敛 */
const arrowMarker = { type: MarkerType.ArrowClosed, color: '#cbd5e1', width: 16, height: 16 }

const edges = ref<any[]>([
    { id: uid(), source: 'start', target: 'end', markerEnd: arrowMarker },
])
/** 当前选中的连线（用于配置分支名与命中条件） */
const selectedEdge = ref<any | null>(null)
const selectedEdgeLabel = computed({
    get: () => String(selectedEdge.value?.label ?? ''),
    set: (v: string) => {
        if (selectedEdge.value) selectedEdge.value.label = v
    },
})

/** 选中连线是否为「审批结果分支」：审批节点出线且该节点已有 ≥2 条出线 */
const isResultEdge = computed(() => {
    const edge = selectedEdge.value
    if (!edge) return false
    const src = nodes.value.find(n => n.id === edge.source)
    if (src?.type !== 'approval') return false
    return edges.value.filter(e => e.source === edge.source).length > 1
})

/**
 * 确保选中连线的 data 存在，并把旧的单条件 condition 升级为多条件数组 conditions。
 * 之后面板统一只改 conditions，condition 仅作兼容字段由保存时派生。
 */
function ensureEdgeData(): any | null {
    const edge = selectedEdge.value
    if (!edge) return null
    if (!edge.data) edge.data = {}
    if (!Array.isArray(edge.data.conditions)) {
        edge.data.conditions = edge.data.condition ? [edge.data.condition] : []
    }
    return edge
}

/** 选中连线上的全部命中条件（单条件与条件组混排，可任意嵌套） */
const selectedEdgeConditions = computed<ConditionExpr[]>(
    () => (selectedEdge.value?.data?.conditions ?? []) as ConditionExpr[],
)

/** 面板里要渲染的一个"条件条目"（带**绝对下标**，删除时按它定位） */
type PanelCondItem =
    | { kind: 'cond'; index: number; cond: BranchCondition }
    | { kind: 'group'; index: number; group: ConditionGroup }

/**
 * 面板要渲染的条目清单。
 *
 * 为什么需要这层：条目可能是**单个条件**，也可能是**条件组**（组里还能再放组）。
 * 结果分支的第一项是「审批结论」条件，由上面的下拉框单独渲染，这里要剔除 ——
 * 剔除按"是不是结果条件"判断，**不能**死记"下标 0"：条件组排首位时那样会把整组弄丢。
 */
const panelConditionItems = computed<PanelCondItem[]>(() => {
    const out: PanelCondItem[] = []
    selectedEdgeConditions.value.forEach((c, index) => {
        if (isResultEdge.value && isResultCondition(c)) return
        out.push(isConditionGroup(c)
            ? { kind: 'group', index, group: c }
            : { kind: 'cond', index, cond: c })
    })
    return out
})

/*
 * 模板里按 kind 取组 / 取单条条件。
 *
 * 为什么不直接在模板里 `item.group.logic`：模板的 `v-if/v-else` **不会**可靠地窄化判别联合
 * （vue-tsc 报「ConditionExpr 上不存在属性 field」）。这两个函数带返回类型，
 * 模板里拿到的就是确定的类型；kind 不匹配时返回一个空壳，而那个分支本来也不会渲染。
 */
const EMPTY_GROUP: ConditionGroup = { logic: 'and', items: [] }
const EMPTY_COND: BranchCondition = { field: '', op: 'eq', value: '' }
function groupOf(item: PanelCondItem): ConditionGroup {
    return item.kind === 'group' ? item.group : EMPTY_GROUP
}
function condOf(item: PanelCondItem): BranchCondition {
    return item.kind === 'cond' ? item.cond : EMPTY_COND
}

/**
 * 组内条目里的"条件"视图。
 * 组内的条目本身也可能又是个组（模型不限层），但面板目前只展开**两层**：
 * 更深的组不在这里编辑（模板里有提示），数据仍会原样保存。
 */
function subCondOf(expr: ConditionExpr): BranchCondition {
    return isConditionGroup(expr) ? EMPTY_COND : expr
}

/** 多条件组合方式：and = 全部满足，or = 任一满足 */
const selectedEdgeLogic = computed<'and' | 'or'>({
    get: () => (selectedEdge.value?.data?.logic === 'or' ? 'or' : 'and'),
    set: (v: 'and' | 'or') => {
        const edge = ensureEdgeData()
        if (edge) edge.data.logic = v
    },
})


/** 连线形状：default=贝塞尔（弯曲）adjustable=手动拖拽曲线 smoothstep=圆角折线 step=直角折线 straight=直线 */
const EDGE_STYLES = [
    { value: 'default', label: '贝塞尔（弯曲）' },
    { value: 'adjustable', label: '手动拖拽曲线' },
    { value: 'smoothstep', label: '圆角折线' },
    { value: 'step', label: '直角折线' },
    { value: 'straight', label: '直线' },
]

/** 选中连线的形状；pathOptions 会透传给 vue-flow 内置连线组件（curvature / borderRadius） */
const selectedEdgeType = computed<string>({
    get: () => selectedEdge.value?.type ?? 'default',
    set: (v: string) => {
        const edge = selectedEdge.value
        if (!edge) return
        edge.type = v === 'default' ? undefined : v
    },
})

/** 修改选中连线的形状参数；整体替换 pathOptions 以保证连线重渲染 */
function setEdgePathOptions(mutate: (o: Record<string, any>) => void) {
    const edge = selectedEdge.value
    if (!edge) return
    const next = { ...(edge.pathOptions ?? {}) }
    mutate(next)
    edge.pathOptions = next
}

/** 贝塞尔弯曲程度：0 = 接近直线，1 = 弯曲最明显（vue-flow 默认 0.25） */
const selectedEdgeCurvature = computed<number>({
    get: () => Number(selectedEdge.value?.pathOptions?.curvature ?? 0.25),
    set: (v: number) => setEdgePathOptions(o => (o.curvature = v)),
})

/** 圆角折线的转角圆角半径（像素，vue-flow 默认 5） */
const selectedEdgeBorderRadius = computed<number>({
    get: () => Number(selectedEdge.value?.pathOptions?.borderRadius ?? 5),
    set: (v: number) => setEdgePathOptions(o => (o.borderRadius = v)),
})

/** 手动拖拽曲线的弯点写回：存在 edge.data.cp，随画布快照持久化；null 表示复位 */
function onEdgeCpUpdate(id: string, cp: { x: number; y: number } | null) {
    const edge = edges.value.find(e => e.id === id)
    if (!edge) return
    if (!edge.data) edge.data = {}
    if (cp) edge.data.cp = cp
    else delete edge.data.cp
}

/** 选中连线是否直达「结束」节点：是则该分支命中即结束流程 */
const selectedEdgeToEnd = computed(() => isEndTarget(selectedEdge.value?.target))

/** 审批结果分支绑定的结论：与 conditions[0]（{ field: 'result', op: 'eq' }）互转 */
const selectedEdgeResult = computed<string>({
    get: () => {
        // 用 find 而不是取下标 0：条件组可以排在结论条件前面，结论条件未必在首位
        const c = selectedEdgeConditions.value.find(isResultCondition) as BranchCondition | undefined
        return c && c.op === 'eq' ? String(c.value ?? '') : ''
    },
    set: (v: string) => {
        const edge = ensureEdgeData()
        if (!edge) return
        const list = edge.data.conditions as ConditionExpr[]
        // 保留**非结论条件**（含条件组），只替换结论条件 ——
        // 死记 slice(1) 会在条件组排首位时把整组删掉。
        const rest = list.filter(x => !isResultCondition(x))
        edge.data.conditions = v ? [{ field: 'result', op: 'eq', value: v }, ...rest] : rest
        // 分支名还是空时，直接用结论文案当名字，省一次输入
        if (v && !edge.label) {
            edge.label = APPROVAL_RESULTS.find(r => r.value === v)?.label ?? ''
        }
    },
})
/** 画布当前视口，随 @move 事件更新，保存时写入 graph */
const currentViewport = ref({ x: 0, y: 0, zoom: 1 })

// ===== 撤销 / 重做（快照栈）=====
/** 历史快照使用 serializeGraph 的剥离结果，避免 selected/dimensions 等运行时字段造成噪音 */
const undoStack = ref<any[]>([])
const redoStack = ref<any[]>([])
let lastSnapshot: { nodes: any[]; edges: any[] } | null = null
let historyTimer: ReturnType<typeof setTimeout> | undefined

function snapGraph() {
    const g = serializeGraph()
    return { nodes: g.nodes, edges: g.edges }
}

function sameGraph(a: { nodes: any[]; edges: any[] }, b: { nodes: any[]; edges: any[] }) {
    return JSON.stringify(a) === JSON.stringify(b)
}

/** 把「上一次记录的状态」入栈，并将当前状态作为新基准（在结构变化稳定后调用） */
function commitHistory() {
    const s = snapGraph()
    if (!lastSnapshot) {
        lastSnapshot = s
        return
    }
    if (sameGraph(lastSnapshot, s)) return
    undoStack.value.push(lastSnapshot)
    if (undoStack.value.length > 50) undoStack.value.shift()
    lastSnapshot = s
    redoStack.value = []
}

/** 加载 / 重置画布后重新建立历史基准（此时不可撤销到旧状态） */
function resetHistory() {
    clearTimeout(historyTimer)
    undoStack.value = []
    redoStack.value = []
    lastSnapshot = snapGraph()
}

/** 恢复某个快照到画布 */
function applySnapshot(s: { nodes: any[]; edges: any[] }) {
    nodes.value = s.nodes.map(n => ({ ...n, position: { ...n.position } }))
    edges.value = s.edges.map(e => ({ ...e, markerEnd: arrowMarker }))
    selectedEdge.value = null
}

function undo() {
    if (!undoStack.value.length) return
    const prev = undoStack.value.pop()!
    if (lastSnapshot) redoStack.value.push(lastSnapshot)
    applySnapshot(prev)
    lastSnapshot = prev
}

function redo() {
    if (!redoStack.value.length) return
    const next = redoStack.value.pop()!
    if (lastSnapshot) undoStack.value.push(lastSnapshot)
    applySnapshot(next)
    lastSnapshot = next
}

// 画布拓扑 / 数据变化统一进历史：防抖 200ms 合并连续拖动，保留一次「完整操作」
watch(
    [nodes, edges],
    () => {
        clearTimeout(historyTimer)
        historyTimer = setTimeout(() => commitHistory(), 200)
    },
    { deep: true },
)

// Backspace 删除的连线可能就是当前选中的分支：连线消失后同步关闭配置面板，避免残留选中态
watch(edges, list => {
    if (selectedEdge.value && !list.some(e => e.id === selectedEdge.value.id)) {
        selectedEdge.value = null
    }
})

function onKeydown(e: KeyboardEvent) {
    // 输入框 / 文本域内不拦截，交给浏览器原生文本撤销
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    // Esc 退出全屏。保存弹窗开着时不接管 —— 那时 Esc 是「关弹窗」，
    // 一键两用会让人既退全屏又关弹窗
    if (e.key === 'Escape') {
        if (!isActive.value && fullSceen.value) fullSceen.value = false
        return
    }
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
    } else if (key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
    } else if (key === 'y') {
        e.preventDefault()
        redo()
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    clearTimeout(historyTimer)
    // 全屏状态是跨组件共享的：离开页面必须还原，否则顶栏/侧边栏一直藏着
    isEditorFullscreen.value = false
})

// 以初始空画布为历史基准，保证画布上的第一次操作也可被撤销
resetHistory()

/** 分支命中条件操作符 */
const OPS = [
    { value: 'eq', label: '等于' },
    { value: 'ne', label: '不等于' },
    { value: 'gt', label: '大于' },
    { value: 'gte', label: '大于等于' },
    { value: 'lt', label: '小于' },
    { value: 'lte', label: '小于等于' },
    { value: 'contains', label: '包含' },
] as const

/** 当前选中的员工（含部门信息，加入节点时展开写入） */
const selectedUser = ref<(Omit<ApprovalChainItem, 'type'> & { name: string }) | null>(null)

function onOrgSelect(payload: OrgSelectPayload | null) {
    if (!payload || payload.type === 'dept') {
        selectedUser.value = null
        return
    }
    selectedUser.value = payload.user
}

// ===== 画布操作 =====

/** 连线目标是否为「结束」节点：是则这条分支命中即结束流程 */
function isEndTarget(targetId: string | null | undefined): boolean {
    return !!targetId && nodes.value.some(n => n.id === targetId && n.type === 'end')
}

/** 条件分支节点的出边列表：带边 id，供点击分支名联动选中配置面板 */
function getBranches(nodeId: string): { id: string; label: string; toEnd: boolean }[] {
    return edges.value
        .filter(e => e.source === nodeId)
        .map(e => ({ id: e.id, label: String(e.label ?? '').trim(), toEnd: isEndTarget(e.target) }))
}

/** 审批节点卡片展示用的出线列表：只有结果分支（≥2 条出线）才展示，单主线不展示 */
function outBranches(nodeId: string): { id: string; label: string; toEnd: boolean }[] {
    const branches = getBranches(nodeId)
    return branches.length > 1 ? branches : []
}

/** 点击条件分支卡片内的分支名：选中该连线，上方面板联动展示并高亮该连线 */
function selectBranch(edgeId: string) {
    const edge = edges.value.find(e => e.id === edgeId)
    if (!edge) return
    onEdgeClick({ edge })
    addSelectedEdges([edge])
}

function onEdgeClick({ edge }: { edge: any }) {
    // 可配置的连线：条件分支节点出线；或审批节点且已形成结果分支（≥2 条出线）的出线
    const source = nodes.value.find(n => n.id === edge.source)
    const resultBranchable =
        source?.type === 'approval' && (edges.value.filter(e => e.source === edge.source).length > 1)
    if (source?.type !== 'condition' && !resultBranchable) {
        selectedEdge.value = null
        return
    }
    if (!edge.data) edge.data = {}
    // 兼容旧数据：把单条件 condition 升级为多条件数组 conditions
    if (!Array.isArray(edge.data.conditions)) {
        edge.data.conditions = edge.data.condition ? [edge.data.condition] : []
    }
    selectedEdge.value = edge
}

/**
 * 面板首行「默认分支 / 主线」开关：与分支名输入同排，
 * 按当前连线类型分发——条件分支清空条件，审批结果分支切回主线（无审批结论）。
 */
function onMainToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    if (isResultEdge.value) toggleResultMain(checked)
    else toggleDefaultBranch(checked)
}

function toggleDefaultBranch(isDefault: boolean | null) {
    const edge = ensureEdgeData()
    if (!edge) return
    edge.data.conditions = isDefault ? [] : [{ field: '', op: 'eq', value: '' } satisfies BranchCondition]
    edge.data.condition = null // 兼容字段：以 conditions 为准
}

/** 追加一条命中条件（结果分支里追加在「审批结论」之后） */
function addCondition() {
    const edge = ensureEdgeData()
    if (!edge) return
    const list = edge.data.conditions as ConditionExpr[]
    // 结果分支必须先有结论才能附条件（按"有没有结论条件"判断，不是按下标）
    if (isResultEdge.value && !list.some(isResultCondition)) {
        list.push({ field: 'result', op: 'eq', value: 'reject' })
    }
    list.push({ field: '', op: 'eq', value: '' })
}

/**
 * 追加一个**条件组**。
 *
 * 用途：表达一组 `logic` 写不出来的逻辑，典型是**分档阈值** ——
 *   (是否属于灯具 = 是 and 总库存金额 > 5000) or (是否属于灯具 = 否 and 总库存金额 > 2000)
 * 先建一个"只有一个空条件"的组，由用户往里加/改。组内 logic 与组间的「满足方式」是两层。
 */
function addConditionGroup() {
    const edge = ensureEdgeData()
    if (!edge) return
    const list = edge.data.conditions as ConditionExpr[]
    if (isResultEdge.value && !list.some(isResultCondition)) {
        list.push({ field: 'result', op: 'eq', value: 'reject' })
    }
    list.push({ logic: 'and', items: [{ field: '', op: 'eq', value: '' }] })
}

/** 删除第 i 个条目（条件或条件组）；结果条件不可删，用「主线」开关切换 */
function removeCondition(i: number) {
    const edge = ensureEdgeData()
    if (!edge) return
    const list = edge.data.conditions as ConditionExpr[]
    if (isResultCondition(list[i])) return
    list.splice(i, 1)
}

/** 组内追加一条条件 */
function addGroupItem(group: ConditionGroup) {
    group.items.push({ field: '', op: 'eq', value: '' })
}

/** 组内删除第 k 条条件（组可以嵌套：删掉的也可能是子组） */
function removeGroupItem(group: ConditionGroup, k: number) {
    group.items.splice(k, 1)
}

function toggleResultMain(isMain: boolean) {
    const edge = ensureEdgeData()
    if (!edge) return
    edge.data.conditions = isMain ? [] : [{ field: 'result', op: 'eq', value: 'reject' }]
    edge.data.condition = null // 兼容字段：以 conditions 为准
}

function onMove({ flowTransform }: { flowTransform: { x: number; y: number; zoom: number } }) {
    currentViewport.value = flowTransform
}

function onConnect(params: Connection) {
    if (params.source === params.target) return // 不允许自连

    const sourceNode = nodes.value.find(n => n.id === params.source)
    const selected = selectedEdge.value
    const branchable = sourceNode?.type === 'condition' || sourceNode?.type === 'approval'

    // 已选中本节点某条出线：把这条分支改连到新目标，而不是再建一条
    // （条件分支与审批结果分支共用这套语义）
    if (branchable && selected && selected.source === params.source) {
        if (selected.target === params.target) return // 落点没变，无需处理
        selected.sourceHandle = params.sourceHandle ?? undefined
        selected.target = params.target
        selected.targetHandle = params.targetHandle ?? undefined
        const targetName =
            nodes.value.find(n => n.id === params.target)?.data?.title || '结束'
        showMsg(`「${selected.label || '未命名分支'}」已改连到「${targetName}」`, 'success')
        return
    }

    const outCount = edges.value.filter(e => e.source === params.source).length
    let label: string | undefined
    let data: FlowGraphEdge['data'] | undefined
    let newResultBranch = false
    if (sourceNode?.type === 'condition') {
        label = `分支${outCount + 1}`
        data = { condition: null, conditions: [] }
    } else if (sourceNode?.type === 'approval' && outCount >= 1) {
        // 审批节点出现第二条出线：按审批结论走的结果分支（默认绑定「驳回」，可再配置、可加附加条件）
        label = ''
        data = {
            condition: { field: 'result', op: 'eq', value: 'reject' },
            conditions: [{ field: 'result', op: 'eq', value: 'reject' }],
        }
        newResultBranch = true
    }
    edges.value.push({
        id: uid(),
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle ?? undefined,
        targetHandle: params.targetHandle ?? undefined,
        label,
        data,
        markerEnd: arrowMarker,
    })
    if (newResultBranch) {
        // 原有主线若未命名，自动命名为「通过」（它是审批通过/兜底走的路）
        const main = edges.value.find(
            e =>
                e.source === params.source &&
                !e.label &&
                !(e.data?.conditions?.length || e.data?.condition),
        )
        if (main) main.label = '通过'
        // 自动选中新分支，画布高亮 + 上方面板展开，供命名与选择审批结论
        selectedEdge.value = edges.value[edges.value.length - 1]
        addSelectedEdges([selectedEdge.value])
        showMsg('已创建审批结果分支：在上方命名并选择对应审批结论（原主线保留「通过」兜底）', 'success')
    }
}

function addNodeToCanvas(node: any) {
    const el = document.querySelector('.flow-canvas')
    const w = el?.clientWidth ?? 800
    const h = el?.clientHeight ?? 600
    const { x, y, zoom } = currentViewport.value
    const cx = (w / 2 - x) / zoom
    const cy = (h / 2 - y) / zoom

    // 节点近似占位尺寸：卡片宽固定 236，高度按类型粗估（只用于避让，不追求精确）
    const W = 236
    const H = node.type === 'approval' || node.type === 'condition' ? 130 : 60
    const margin = 30
    const occupied = (px: number, py: number) =>
        nodes.value.some(n => {
            const nh = n.type === 'approval' || n.type === 'condition' ? 130 : 60
            return (
                px < n.position.x + W + margin &&
                px + W + margin > n.position.x &&
                py < n.position.y + nh + margin &&
                py + H + margin > n.position.y
            )
        })

    const step = 70
    let pos = { x: cx - W / 2, y: cy - H / 2 }
    let placed = false
    for (let r = 0; r <= 12 && !placed; r++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
            for (let dy = -r; dy <= r && !placed; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
                const px = cx + dx * step - W / 2
                const py = cy + dy * step - H / 2
                if (!occupied(px, py)) {
                    pos = { x: px, y: py }
                    placed = true
                }
            }
        }
    }

    node.position = pos
    nodes.value.push(node)
}

function addApprovalNode() {
    const seq = nodes.value.filter(n => n.type === 'approval').length + 1
    addNodeToCanvas({ id: uid(), type: 'approval', position: { x: 0, y: 0 }, data: { title: `流程${seq}`, members: [] } })
}

function addConditionNode() {
    addNodeToCanvas({ id: uid(), type: 'condition', position: { x: 0, y: 0 } })
}

function removeNodeById(id: string) {
    const node = nodes.value.find(n => n.id === id)
    if (!node || node.type === 'start' || node.type === 'end') return
    nodes.value = nodes.value.filter(n => n.id !== id)
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id)
    if (selectedEdge.value && selectedEdge.value.source === id) selectedEdge.value = null
}

/**
 * 给节点加一个**动态审批人**（部门负责人）。
 *
 * 模板里不写人名：建单时按数据行字段（默认「组别」）找到对应部门的负责人 ——
 * 白板上的「推送至相关部门负责人」「团队负责人审批」就是这类环节。
 * 解析口径与失败处理见 utils/approvalRoles.ts（解析不出来会判那条建单失败）。
 * 默认字段名可在节点卡片上直接改。
 */
function addRoleMemberTo(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId)
    if (!node || node.type !== 'approval') return
    const members = (node.data?.members ?? []) as ApprovalChainItem[]
    members.push({ type: 'manager', name: '', role: { kind: 'dept_leader', deptFrom: '组别' } })
    node.data = { ...node.data, members }
}

/** 把当前选中员工加入指定审批节点 */
function addMemberTo(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId)
    if (!node || node.type !== 'approval') return
    if (!selectedUser.value) {
        showMsg('请先在左侧选择员工', 'warning')
        return
    }
    const data = node.data as ApprovalNodeData
    if (data.members.some((item: ApprovalChainItem) => item.email && item.email === selectedUser.value!.email)) {
        showMsg('该员工已在此环节中，请勿重复添加', 'warning')
        return
    }
    data.members.push({ ...selectedUser.value, type: radios.value })
    showMsg(`已将 ${selectedUser.value.name} 加入「${data.title || '未命名环节'}」`, 'success')
    selectedUser.value = null
}

function resetAll() {
    nodes.value = [
        { id: 'start', type: 'start', position: { x: 300, y: 0 } },
        { id: 'end', type: 'end', position: { x: 300, y: 240 } },
    ]
    edges.value = [{ id: uid(), source: 'start', target: 'end', markerEnd: arrowMarker }]
    selectedEdge.value = null
    selectedUser.value = null
    streamName.value = ''
    editId.value = ''
    // 重置即新基准，撤销不会越过重置后的状态
    resetHistory()
}

// ===== 图 → ApprovalFlow 转换（保存时） =====
// 返回类型直接取转换器的（含 errorNodeId / errorEdgeId），避免在这里抄一份类型后漏字段
function graphToFlow(): ReturnType<typeof graphToFlowFrom> {
    return graphToFlowFrom(nodes.value, edges.value)
}


// ===== 整图持久化 =====

/** 剥离 vue-flow 运行时字段，序列化为可入库的最小快照 */
function serializeGraph(): FlowGraph {
    return {
        nodes: nodes.value.map(n => ({
            id: n.id,
            type: n.type,
            position: { x: n.position.x, y: n.position.y },
            data: n.data ? JSON.parse(JSON.stringify(n.data)) : undefined,
        })),
        edges: edges.value.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
            label: typeof e.label === 'string' ? e.label : undefined,
            type: e.type,
            pathOptions: e.pathOptions ? JSON.parse(JSON.stringify(e.pathOptions)) : undefined,
            data: e.data ? JSON.parse(JSON.stringify(e.data)) : undefined,
        })),
        viewport: { ...currentViewport.value },
    }
}

/** 从入库快照还原画布（含视口） */
async function loadGraph(id: string) {
    const record = await getApprovalOne(id)
    const graph = record?.chain?.graph
    if (!record || !graph) {
        showMsg('该模板没有画布数据，无法还原', 'warning')
        return
    }
    editId.value = id
    streamName.value = record.name ?? ''
    status.value = Boolean(record.status)
    nodes.value = graph.nodes.map(n => ({
        ...n,
        position: { ...n.position },
        data: n.data ? JSON.parse(JSON.stringify(n.data)) : undefined,
    }))
    edges.value = graph.edges.map(e => ({
        ...e,
        label: e.label ?? '',
        data: e.data ? JSON.parse(JSON.stringify(e.data)) : undefined,
        markerEnd: arrowMarker,
    }))
    await nextTick()
    if (graph.viewport) setViewport(graph.viewport)
    // 加载完成即新基准，撤销不会越过「刚加载」状态
    resetHistory()
}

// ===== 保存 =====

const streamNameRule = (v: string) => !!v || '审批流名称不能为空'

async function saveStream() {
    if (!streamName.value.trim()) {
        showMsg('请输入审批流名称', 'warning')
        return
    }
    const { flow: rawFlow, error, errorNodeId, errorEdgeId } = graphToFlow()
    if (error) {
        saveError.value = { message: error, ...(errorNodeId ? { nodeId: errorNodeId } : {}), ...(errorEdgeId ? { edgeId: errorEdgeId } : {}) }
        // 文案里带上环节名：画布上有几十个框，只说「请检查连线」等于没说
        const title = errorNodeId ? String(findNode(errorNodeId)?.data?.title ?? '') : ''
        showMsg(title ? `环节「${title}」：${error}` : error, 'warning')
        // 等标记渲染出来再定位，否则新节点尺寸还没算、居中会偏
        await nextTick()
        locateError()
        return
    }
    saveError.value = null
    saving.value = true
    try {
        // 每个审批环节自动补「驳回 → 回退到上一级」分支：
        // 这是「每个环节都该有」的通用能力，不要求配置者在画布上逐个手画回退连线
        const flow = ensureRejectLoopBack(rawFlow)
        // chain 是拍平后的线性链路，保证旧的列表/编辑页仍能渲染；
        // flow 是带分支与条件的完整结构；graph 是画布快照，供下次编辑还原。
        const chain = flowToChain(flow)
        const payload = { chain, flow, graph: serializeGraph() }
        console.log(payload)
        if (editId.value) {
            await updateApprovalModel(editId.value, {
                name: streamName.value,
                status: Number(status.value),
                chain: payload,
            })
        } else {
            await addApproval(streamName.value, Number(status.value), payload)
        }
        showMsg(editId.value ? '审批流保存成功' : '审批流创建成功', 'success')
        isActive.value = false
        if (!editId.value) resetAll()
    } catch {
        showMsg('保存失败，请稍后重试', 'error')
    } finally {
        saving.value = false
    }
}

onMounted(() => {
    const id = String(route.query.id ?? '')
    if (id) loadGraph(id)
})
</script>

<style lang="scss">
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';

/* ===== 分支配置面板：与画布节点同一套设计语言（白底 / 细边框 / 琥珀类型条） ===== */
.branch-panel {
    /* 配置面板高度固定（内容超高时内部滚动），剩余空间全给画布 */
    flex: none;
    background: var(--flow-surface);
    border: 1px solid var(--flow-border);
    border-radius: 10px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
    overflow: hidden;
}

/* 顶部类型条：条件分支琥珀色；审批结果分支蓝色，与「审批节点」一致 */
.branch-panel::before {
    content: '';
    display: block;
    height: 3px;
    background: #f59e0b;
}

.branch-panel.result-panel::before {
    background: #2563eb;
}

.panel-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 2px;
}

.panel-head .head-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--flow-amber-soft);
    flex: none;
}

.branch-panel.result-panel .panel-head .head-icon {
    background: var(--flow-blue-soft);
}

.panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--flow-text);
}

.panel-head .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--flow-icon);
    cursor: pointer;
    transition: all 0.15s ease;
}

.panel-head .icon-btn:hover {
    background: var(--flow-icon-hover-bg);
    color: var(--flow-icon-hover-text);
}

.panel-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 10px 10px;
    /* 条件可能有多条：限制最大高度并内部滚动，避免面板把画布挤掉 */
    max-height: 132px;
    overflow-y: auto;
}

.panel-row {
    display: flex;
    align-items: center;
    // justify-content: ;
    gap: 8px;
    flex-wrap: wrap;
}

.panel-label {
    font-size: 11px;
    color: var(--flow-text-sub);
    flex: none;
}

/* 连线弯曲程度 / 圆角滑块：收紧高度并跟随面板主题色 */
.edge-slider {
    width: 110px;
    height: 18px;
    padding: 0;
    margin: 0;
    accent-color: #f59e0b;
    cursor: pointer;
}

.branch-panel.result-panel .edge-slider {
    accent-color: #2563eb;
}

.slider-value {
    min-width: 26px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--flow-text-muted);
}

.panel-input {
    height: 26px;
    font-size: 12px;
    color: var(--flow-input-text);
    padding: 0 8px;
    border: 1px solid var(--flow-input-border);
    border-radius: 6px;
    background: var(--flow-input-bg);
    outline: none;
    transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
}

.panel-input:hover {
    border-color: var(--flow-border-strong);
}

.panel-input:focus {
    border-color: var(--flow-input-focus);
    box-shadow: 0 0 0 2px rgb(245 158 11 / 12%);
}

.panel-input::placeholder {
    color: var(--flow-text-muted);
}

// select.panel-input {
//     cursor: pointer;
//     appearance: none;
//     padding-right: 20px;
//     background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 3.5L5 6.5L8 3.5' fill='none' stroke='%237b8698' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/></svg>");
//     background-repeat: no-repeat;
//     background-position: right 6px center;
// }

/* 「默认分支」开关 */
.switch-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--flow-text-sub);
    cursor: pointer;
    user-select: none;
}

.switch-label input {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: #f59e0b;
    cursor: pointer;
}

.branch-panel.result-panel .switch-label input {
    accent-color: #2563eb;
}

/* 多条件提示：如「其他原因」需再细化 */
.panel-hint {
    font-size: 11px;
    line-height: 15px;
    color: var(--flow-text-muted);
}

/* 直达结束分支的提示：命中该分支即流程结束，不再进入后续环节 */
.panel-hint.end-branch-hint {
    color: var(--flow-amber-text);
    background: var(--flow-amber-soft);
    padding: 3px 8px;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 6px;
}

/* 添加条件按钮：与画布节点「添加成员」同一套虚线风格 */
.add-cond-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    align-self: flex-start;
    margin-top: 2px;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1;
    color: var(--flow-text-sub);
    background: transparent;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
}

/* 图标与文字严格同基线：去掉外边距类带来的偏移，统一由 gap 控制间距 */
.add-cond-btn :deep(.v-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    line-height: 1;
    flex: none;
}

.add-cond-btn>span {
    line-height: 1;
}

.add-cond-btn:hover {
    color: var(--flow-handle-active);
    border-color: var(--flow-blue-border);
    background: var(--flow-surface-hover);
}

/* ===== 条件条目 / 条件组 ===== */
.cond-item {
    /* 一条条件，或一个条件组；竖向排，条目之间留一点缝 */
    display: flex;
    flex-direction: column;
    gap: 2px;
}

/* 条件组：虚线框把它和普通条件区分开（组内另有自己的满足方式） */
.cond-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px 6px;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 8px;
    background: var(--flow-surface-sunken);
}


/* ===== 画布容器 ===== */
/*
 * 黑色鼠标指针：CSS 无法直接给系统光标上色，这里用内联 SVG（黑填充 + 白描边）
 * 自定义 cursor。拖动节点 / 画布时切换为对应的手型光标。
 */
:root {
    --cursor-black-arrow: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l6.5 17 2.6-6.6 6.4-2.7z" fill="%231e293b" stroke="%23ffffff" stroke-width="1.2" stroke-linejoin="round"/></svg>');
    --cursor-black-grab: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-1V6.5a1.5 1.5 0 013 0V13c0 4-2.5 7-6 7s-6-2.8-6-6.5V11a1.5 1.5 0 013 0" fill="none" stroke="%231e293b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    --cursor-black-grabbing: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 13V8m1-1V6m2 1V5.5m2 1V6.5m2 1.5V9" fill="none" stroke="%231e293b" stroke-width="1.6" stroke-linecap="round"/><path d="M6 12v-1a1.5 1.5 0 013 0v1m0 0V9.5a1.5 1.5 0 013 0V12m0-1V10a1.5 1.5 0 013 0v4c0 3.6-2.2 6.5-5.5 6.5S7 17.6 7 14v-2" fill="none" stroke="%231e293b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
}

/* 右侧画布面板：与左侧组织架构面板等高（同一行内 stretch 拉伸后取同一限高） */
/* 组织架构树 open-all 展开后可能比 3 栏更宽，让它在组件内部横向滚动，
   不要把宽度顶到 v-col 上（否则 cols 比例被撑破）。 */
:deep(.org-scroll) {
    overflow-x: auto;
}

/*
 * 全屏：让「组织树 + 画布」这一整页铺满视口。
 *
 * 为什么不能只靠 isEditorFullscreen 隐藏顶栏/侧边栏：
 * 侧边栏是 v-show 隐藏的，v-main 的 padding-left（--v-layout-left）不一定跟着收回，
 * 那 240px 未必真能拿到；fixed 铺满则与布局实现无关。
 *
 * z-index 取 1000：高于普通内容，又低于 v-navigation-drawer(1004) 与菜单浮层(2400+)，
 * 所以组织树里的下拉、保存弹窗仍能正常浮在它上面，不会被压住。
 */
.screen-full {
    position: fixed;
    inset: 0;
    z-index: 1000;
    /* 与原来的容器内边距一致，全屏时也不贴边 */
    padding: 12px;
    background: rgb(var(--v-theme-background));
    /* 用 auto 而不是 hidden：万一内容比视口高，要能滚到画布底部 */
    overflow: auto;

    /* 全屏时顶部系统栏（36px）不再占位，画布可以多长 36px
       （非全屏是 calc(100vh - 100px)，见下面的 .flow-sheet） */
    .flow-sheet {
        height: calc(100vh - 64px);
    }

    /* OrgTree 的限高写死在它自己的 scoped 样式里（也是 calc(100vh - 100px)），
       这里穿透改一下，否则它会比右侧画布矮 36px、白白空一截 */
    :deep(.org-sheet) {
        max-height: calc(100vh - 64px);
    }
}

/* ===== 左右 4:8 栅格：显式锁定，绕过 Vuetify 断点类的不确定性 =====
   用 !important 是因为 Vuetify 的 grid 规则是未分层(unlayered)的，
   而本文件 scoped 样式即使带 data-v 属性选择器也可能因特异性不足被压过。 */
.flow-grid {
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: stretch;
}

.flow-col-left {
    flex: 0 0 33.333333% !important;
    max-width: 33.333333% !important;
    min-width: 0;
    /* 给栏内的收起按钮当定位参照 */
    position: relative;
}

/*
 * 收起：整列缩成一条 36px 窄栏，只剩那个按钮。
 * ⚠️ 这里**不写 overflow: hidden**：一是 OrgTree 内部自带横向滚动（.org-scroll），
 *    父级裁切会让它的滚动区域失效；二是窄栏只有 36px，按钮靠绝对定位溢出内边距才放得下，
 *    裁切会把它直接切掉。内容用模板里的 v-show 隐藏就够了。
 */
.flow-col-left--collapsed {
    flex: 0 0 36px !important;
    max-width: 36px !important;
}

/* 收起按钮：展开 / 收起两个状态下都在栏目左上角同一处，收起后不必去别处找 */
.flow-col-left__toggle {
    position: absolute;
    top: 12px;
    right: 4px;
    z-index: 2;
}

.flow-col-right {
    flex: 1 1 auto !important;
    min-width: 0;
    max-width: 100%;
}

/* 窄屏下退回上下堆叠，避免两栏被压得不可用 */
@media (max-width: 960px) {
    .flow-grid {
        flex-wrap: wrap !important;
    }

    .flow-col-left,
    .flow-col-right {
        flex: 0 0 100% !important;
        max-width: 100% !important;
    }
}

.flow-sheet {
    flex: 1 1 auto;
    min-height: 0;
    height: calc(100vh - 100px);
}

.flow-canvas {
    /* 工具栏/分支面板/提示占固定高度，画布吃掉剩余空间 */
    flex: 1 1 auto;
    min-height: 160px;
    border: 1px solid var(--flow-canvas-border);
    border-radius: 10px;
    background: var(--flow-canvas-bg);
    overflow: hidden;
    cursor: var(--cursor-black-arrow) 2 2, default;
}

/* ===== 保存校验失败：提示条 + 环节上的错误条 + 出错的连线 ===== */
.save-error-bar {
    /* 画布上方常驻一行：不参与画布布局，所以给 flex: none */
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    padding: 6px 10px;
    border: 1px solid rgb(220 38 38 / 35%);
    border-radius: 8px;
    background: rgb(220 38 38 / 8%);
    color: #b91c1c;
    font-size: 12px;
}

.save-error-bar__text {
    flex: 1 1 auto;
    min-width: 0;
}

.save-error-bar__btn {
    flex: none;
    padding: 2px 8px;
    border: 1px solid rgb(220 38 38 / 35%);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.save-error-bar__btn:hover {
    background: rgb(220 38 38 / 12%);
}

/* 节点外壳：卡片 + 下方的错误条（宽度跟着卡片，别撑破节点框） */
.node-shell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
}

/* 环节卡片正下方的错误条：和节点一起平移缩放，指向明确 */
.node-error {
    max-width: 236px;
    margin-top: 4px;
    padding: 4px 6px;
    border: 1px solid rgb(220 38 38 / 35%);
    border-radius: 6px;
    background: rgb(220 38 38 / 8%);
    color: #b91c1c;
    font-size: 11px;
    line-height: 1.35;
    /* 长文案最多两行，超出省略（完整内容看 title 悬浮提示） */
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
}

/* 出错的那条连线（class 由脚本里的 saveError 打上）：加粗变红，压过选中态 */
.flow-canvas .vue-flow__edge.has-error .vue-flow__edge-path {
    stroke: #dc2626;
    stroke-width: 2.4;
}

/* 画布空白：拖拽平移时握手型 */
.flow-canvas .vue-flow__pane {
    cursor: var(--cursor-black-arrow) 2 2, default;
}

.flow-canvas .vue-flow__pane.dragging {
    cursor: var(--cursor-black-grabbing) 12 12, grabbing;
}

/* 节点：可抓取 */
.flow-canvas .vue-flow__node {
    cursor: var(--cursor-black-grab) 12 12, grab;
}

.flow-canvas .vue-flow__node.dragging {
    cursor: var(--cursor-black-grabbing) 12 12, grabbing;
}

/* 连线：点击选中 */
.flow-canvas .vue-flow__edge {
    cursor: var(--cursor-black-arrow) 2 2, pointer;
}

/* 连接点：拉线用十字 */
.flow-canvas .vue-flow__handle {
    cursor: crosshair;
}

/* 拖拽生成的新连线（虚线）改为深色 */
.flow-canvas .vue-flow__connection-path {
    stroke: var(--flow-connection);
    stroke-width: 1.8;
    stroke-dasharray: 5 4;
}

/* 框选区域：深色半透明 */
.flow-canvas .vue-flow__selection {
    background: var(--flow-selection-bg);
    border: 1px solid var(--flow-selection-border);
}

/* ===== 连接点：小圆点，hover 变主色 ===== */
/*
 * Vue Flow 用 transform: translate(-50%, ±50%) 给连接点做居中定位，
 * 所以这里**不能**用 transform: scale() 做 hover 放大——它会整体覆盖掉 translate，
 * 圆点瞬间偏移半个身位 → 鼠标脱离圆点 → 缩回 → 再进入，形成高频抖动，
 * 表现就是"悬浮时多个圆点影像重叠"，且按下时经常抓不中、拉不出连线。
 * 因此 hover 只改颜色和 box-shadow 光环，几何位置保持不动。
 */
.flow-canvas .vue-flow__handle {
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    background: var(--flow-handle-bg);
    border: 2px solid var(--flow-handle-border);
    border-radius: 50%;
    transition:
        border-color 0.15s ease,
        background 0.15s ease,
        box-shadow 0.15s ease;
}

/* 透明热区：视觉 10px，实际可抓取约 22px，解决"圆点太小按不住"。
   主要向外扩，向内只留 2px，避免抢走节点头部输入框 / 按钮的点击。 */
.flow-canvas .vue-flow__handle::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: transparent;
}

.flow-canvas .vue-flow__handle-bottom::after {
    inset: -2px -6px -6px -6px;
}

.flow-canvas .vue-flow__handle-top::after {
    inset: -6px -6px -2px -6px;
}

.flow-canvas .vue-flow__handle:hover,
.flow-canvas .vue-flow__handle.connectionindicator:hover {
    border-color: var(--flow-handle-active);
    background: var(--flow-handle-active);
    box-shadow: 0 0 0 4px rgb(37 99 235 / 18%);
}

/* 沿用 Vue Flow 自带的居中偏移即可，不再叠加 -5px：
   否则圆点会远离节点边缘，和相邻节点的连接点在视觉上叠在一起 */
.flow-canvas .vue-flow__handle-top {
    top: 0;
}

.flow-canvas .vue-flow__handle-bottom {
    bottom: 0;
}

/* ===== 连线 ===== */
.flow-canvas .vue-flow__edge-path {
    stroke: var(--flow-edge);
    stroke-width: 1.6;
    transition: stroke 0.15s ease;
}

.flow-canvas .vue-flow__edge:hover .vue-flow__edge-path {
    stroke: var(--flow-edge-hover);
}

.flow-canvas .vue-flow__edge.selected .vue-flow__edge-path {
    stroke: var(--flow-edge-selected);
    stroke-width: 2.2;
}

/* 分支名标签 */
.flow-canvas .vue-flow__edge-text {
    font-size: 11px;
    fill: var(--flow-edge-label);
}

.flow-canvas .vue-flow__edge-textbg {
    fill: var(--flow-edge-label-bg);
}

/* ===== 控件：圆角 + 柔和阴影 ===== */
.flow-canvas .vue-flow__controls,
.flow-canvas .vue-flow__minimap {
    border-radius: 8px;
    border: 1px solid var(--flow-border);
    box-shadow: 0 2px 8px rgb(15 23 42 / 6%);
    overflow: hidden;
}

.flow-canvas .vue-flow__controls-button {
    border: none;
    border-bottom: 1px solid var(--flow-control-border);
    background: var(--flow-control-bg);
    fill: var(--flow-control-fill);
    transition: background 0.15s ease;
}

.flow-canvas .vue-flow__controls-button:hover {
    background: var(--flow-control-hover-bg);
    fill: var(--flow-control-hover-fill);
}

/* ===== 节点：去掉默认选中描边，交给组件自己处理 ===== */
.flow-canvas .vue-flow__node {
    font-size: 12px;
}

.flow-canvas .vue-flow__node.selected .node-card,
.flow-canvas .vue-flow__node.selected .start-end-node {
    outline: none;
}
</style>
