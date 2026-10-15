<template>
  <v-container :class="{ 'screen-full': fullSceen }" fluid>
    <BackNode title="审批模板" />
    <v-row align="stretch" class="flow-grid" density="compact">
      <v-col class="min-w-0 flow-col-left" :class="{ 'flow-col-left--collapsed': leftCollapsed }" cols="2">
        <v-icon-btn class="flow-col-left__toggle mr-5 mt-5"
          :icon="leftCollapsed ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'" size="small"
          :title="leftCollapsed ? '展开组织架构' : '收起组织架构'" variant="text" @click="leftCollapsed = !leftCollapsed" />
        <Transition name="org-panel">
          <OrgTree v-show="!leftCollapsed" @select="onOrgSelect" />
        </Transition>
      </v-col>
      <v-col class="min-w-0 flow-col-right" cols="10">
        <v-sheet class="p-3 border border-dashed border-accent sticky top-2 flow-sheet d-flex flex-column" rounded>
          <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-2 shrink-0">
            <div class="d-flex align-center ga-2 flex-wrap">
              <span class="text-[14px] font-weight-bold">{{ editId ? '编辑审批流' : '新建审批流' }}</span>
              <v-btn color="primary" prepend-icon="mdi-account-check" size="small" variant="tonal"
                @click="addApprovalNode">
                <span class="mb-1">审批节点</span></v-btn>
              <v-btn color="warning" prepend-icon="mdi-source-branch" size="small" variant="tonal"
                @click="addConditionNode"><span class="mb-1">条件分支</span></v-btn>
              <v-btn color="info" prepend-icon="mdi-database-search-outline" size="small" variant="tonal"
                @click="addProbeNode"><span class="mb-1">数据查询</span></v-btn>
              <v-btn color="info" prepend-icon="mdi-bell-ring-outline" size="small" variant="tonal"
                @click="addNotifyNode"><span class="mb-1">飞书提醒</span></v-btn>
              <v-btn color="#7C3AED" prepend-icon="mdi-autorenew" size="small" variant="tonal"
                @click="addLoopNode"><span class="mb-1">轮询</span></v-btn>
              <v-btn color="#0D9488" prepend-icon="mdi-puzzle-outline" size="small" variant="tonal"
                @click="addRefNode"><span class="mb-1">引用模板</span></v-btn>
            </div>

            <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-0">
              <div class="d-flex align-center">
                <template v-if="selectedUser">
                  <v-avatar class="mr-2" size="25">
                    <v-img v-if="selectedUser.avatar" cover :src="selectedUser.avatar" />
                    <v-icon v-else size="15">mdi-account</v-icon>
                  </v-avatar>
                  <div class="d-flex flex-column">
                    <div class="text-[12px]">
                      {{ selectedUser.name }}
                      <v-chip v-if="selectedUser.is_tenant_manager" color="error" size="x-small"
                        variant="tonal">管理员</v-chip>
                      <v-chip v-if="selectedUser.is_leader" color="warning" size="x-small" variant="tonal">负责人</v-chip>
                    </div>
                  </div>
                  <v-radio-group v-model="radios" class="ml-2" density="compact" hide-details inline>
                    <v-radio color="#5BB65E" value="manager">
                      <template #label>
                        <strong class="text-success text-[11px]">审批人</strong>
                      </template>
                    </v-radio>
                    <v-radio color="#2670C4" value="cc">
                      <template #label>
                        <strong class="text-primary text-[11px]">抄送</strong>
                      </template>
                    </v-radio>
                  </v-radio-group>
                </template>
                <v-alert v-else class="py-0 " density="compact" icon-size="15" type="info" variant="tonal">
                  <span class="text-[11px]">在左侧选择加入员工</span>
                </v-alert>
              </div>
            </div>
            <div class="d-flex align-center ga-2">
              <!-- <v-btn-group density="compact" size="small" rounded="lg"> -->
              <v-icon-btn :disabled="undoStack.length === 0" icon="mdi-arrow-u-left-top" size="small"
                title="撤销 (Ctrl+Z)" variant="text" @click="undo" />
              <v-icon-btn :disabled="redoStack.length === 0" icon="mdi-arrow-u-right-top" size="small"
                title="重做 (Ctrl+Shift+Z)" variant="text" @click="redo" />
              <v-icon-btn :icon="fullSceen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" size="small"
                :title="fullSceen ? '退出全屏 (Esc)' : '全屏'" variant="text" @click="setFullScreen" />
              <!-- </v-btn-group> -->
              <v-btn color="error" size="small" variant="tonal" @click="resetAll">重置</v-btn>
              <v-btn color="primary" size="small" variant="flat" @click="isActive = true">保存</v-btn>
            </div>
          </div>
          <div v-if="selectedEdge" class="branch-panel mb-2" :class="{ 'result-panel': isResultEdge || isRefEdge }">
            <div class="panel-head">
              <span class="head-icon">
                <v-icon
                  :color="isResultEdge ? '#2563eb' : (isRefEdge ? '#0d9488' : (isBranchEdge ? '#d97706' : '#6b7280'))"
                  size="12"
                >
                  {{ isResultEdge
                    ? 'mdi-account-check-outline'
                    : (isRefEdge ? 'mdi-puzzle-outline' : (isBranchEdge ? 'mdi-source-branch' : 'mdi-vector-line')) }}
                </v-icon>
              </span>
              <span class="panel-title">{{
                isResultEdge ? '审批结果分支配置' : (isRefEdge ? '引用分流配置' : (isBranchEdge ? '分支配置' : '连线配置'))
                }}</span>

              <button v-if="isResultEdge" class="panel-btn"
                title="配置本审批环节的办理选项（类别 → 一级 → 二级；一级的「实际链路」决定实际走哪条线）；同一环节的各条结果分支共用这一份"
                @click="optionDialog = true">
                <v-icon size="12">mdi-format-list-bulleted-type</v-icon>
                <span>配置选项</span>
                <span class="panel-btn__note">{{ optionSummary }}</span>
              </button>

              <div v-if="isBranchEdge && selectedEdgeToEnd" class="panel-hint end-branch-hint ml-3">
                {{ selectedEdgeExitMode === 'jump'
                  ? '此分支跳到指定环节继续办（循环里剩下的环节会被跳过）'
                  : '此分支直达「结束」节点：命中该分支时流程直接结束，不再进入后续环节' }}
              </div>
              <v-spacer />
              <button class="icon-btn" title="关闭" @click="selectedEdge = null">
                <v-icon size="12">mdi-close</v-icon>
              </button>
            </div>
            <div class="panel-body">
              <div v-if="isBranchEdge && selectedEdgeToEnd" class="panel-row">
                <span class="panel-label">本分支走向</span>

                <select v-model="selectedEdgeExitMode" class="panel-input" style="width: 186px">
                  <option value="end">结束整个流程</option>
                  <option value="jump">跳出循环 → 跳到指定环节</option>
                </select>

                <template v-if="selectedEdgeExitMode === 'jump'">
                  <span class="panel-label ml-3">目标环节</span>

                  <select v-model="selectedEdgeExitTo" class="panel-input" style="width: 168px">
                    <option value="">请选择环节</option>
                    <option v-for="t in exitTargets" :key="t.id" :value="t.id">{{ t.label }}</option>
                  </select>
                </template>
              </div>
              <!--
                「组间轮询」卡片自己的出线走向（见 selectedEdgeLoopExit）：
                卡片最多两条出线，一条「轮完」（所有组都轮完、没人跳出时走）、
                一条「提前跳出」（某组接了、提前结束轮询时走）。单条时不写字段 = 「轮完」。
              -->
              <div v-if="isLoopEdge" class="panel-row">
                <span class="panel-label">本线走向</span>

                <select v-model="selectedEdgeLoopExit" class="panel-input" style="width: 186px">
                  <option value="done">轮完（所有组都轮完）</option>
                  <option value="early">提前跳出（某组接了直接跳出）</option>
                </select>

                <span class="panel-hint ml-3">两条出线靠这一项区分：一条「轮完」、一条「提前跳出」</span>
              </div>

              <div class="panel-row">
                <span class="panel-label">线条形状</span>

                <select v-model="selectedEdgeType" class="panel-input" style="width: 128px">
                  <option v-for="t in EDGE_STYLES" :key="t.value" :value="t.value">
                    {{ t.label }}
                  </option>
                </select>

                <template v-if="selectedEdgeType === 'default'">
                  <span class="panel-label ml-3" title="0 = 接近直线，1 = 弯曲最明显">弯曲程度</span>

                  <input v-model.number="selectedEdgeCurvature" class="edge-slider" max="1" min="0" step="0.05"
                    type="range">

                  <span class="panel-label slider-value">{{ selectedEdgeCurvature.toFixed(2) }}</span>
                </template>

                <template v-else-if="selectedEdgeType === 'smoothstep'">
                  <span class="panel-label ml-3">圆角大小</span>

                  <input v-model.number="selectedEdgeBorderRadius" class="edge-slider" max="30" min="0" step="1"
                    type="range">

                  <span class="panel-label slider-value">{{ Math.round(selectedEdgeBorderRadius) }}</span>
                </template>

                <span v-else-if="selectedEdgeType === 'adjustable'" class="panel-hint ml-2">
                  拖动线上的圆点可绕开交叉区域，双击圆点复位
                </span>
              </div>

              <!-- 以下是**分支**专属配置（分支名 / 审批结论 / 条件）；普通连线只有上面的形状行 -->
              <div v-if="isBranchEdge" class="panel-row">
                 <span class="panel-label">线路名称</span>
                <input v-model="selectedEdgeLabel" class="panel-input"
                  :placeholder="isResultEdge ? '如：驳回走复核' : (isRefEdge ? '如：接收走仓储' : '如：财务审批')"
                  style="width: 148px">

                <label class="switch-label">
                  <input :checked="selectedEdgeConditions.length === 0" type="checkbox" @change="onMainToggle">

                  <span v-if="selectedEdgeConditions.length === 0" class="mt-1">{{
                    isResultEdge ? '主线（审批通过/其他结论未命中时走这条）'
                      : (isRefEdge ? '兜底主线（这一段最后办出来的结论没绑到别的线时走这条）'
                        : '默认分支（条件都不命中时走这条）')
                    }}</span>
                </label>
                              <template
                                v-if="isBranchEdge && (isResultEdge || isRefEdge) && selectedEdgeConditions.length > 0"
                              >
                <div class="panel-row">
                  <span class="panel-label">审批结论</span>

                  <select v-model="selectedEdgeResult" class="panel-input" style="width: 168px">
                    <option disabled value="">请选择审批结论</option>

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

              <!--
                「办理选项条件」：只在满足时把这条线的选项**摆给办理人**，**不影响走哪条线**。
                主线（无条件出线）也能配 —— 典型就是"「同意接收」只在前一环节结论是 receive 时才给"。
              -->
              <div v-if="isResultEdge" class="panel-row">
                <span class="panel-label">选项条件</span>

                <select :value="offerRule.op" class="panel-input" style="width: 112px" @change="onOfferOp">
                  <option value="">不限</option>
                  <option value="eq">上一环结论是</option>
                  <option value="ne">上一环结论不是</option>
                </select>

                <select v-if="offerRule.op" :value="offerRule.value" class="panel-input" style="width: 126px"
                  @change="onOfferCode">
                  <option value="">请选择结论</option>
                  <option v-for="r in APPROVAL_RESULTS" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>
              </div>
              </div>
              <!-- 条件条目：两种分支共用（普通条件 / 条件组混排） -->
              <template v-if="isBranchEdge && selectedEdgeConditions.length > 0">
                <div v-for="item in panelConditionItems" :key="item.index" class="cond-item"
                  :class="{ 'ml-3': isResultEdge }">
                  <!-- 条件组：组内自己的满足方式 + 组内条件行 -->
                  <div v-if="item.kind === 'group'" class="cond-group">
                    <div class="panel-row">
                      <v-chip color="warning" size="x-small">条件组</v-chip>

                      <select v-model="groupOf(item).logic" class="panel-input" style="width: 116px">
                        <option value="and">组内全部满足</option>
                        <option value="or">组内任一满足</option>
                      </select>

                      <button class="add-cond-btn" @click="addGroupItem(groupOf(item))">
                        <v-icon size="11">mdi-plus</v-icon>
                        <span>组内条件</span>
                      </button>

                      <v-icon-btn class="ml--2" size="x-small" title="删除整个条件组" variant="text"
                        @click="removeCondition(item.index)">
                        <v-icon size="11">mdi-close</v-icon>
                      </v-icon-btn>
                    </div>

                    <div v-for="(sub, k) in groupOf(item).items" :key="k">
                      <!-- 更深的嵌套组：面板先不展开编辑（模型支持，数据照常保存） -->
                      <div v-if="isConditionGroup(sub)" class="panel-hint ml-4">
                        （这里是三层以上的嵌套组，面板暂不展开编辑；结构会原样保存）
                      </div>

                      <div v-else class="panel-row ml-4">
                        <input v-model="subCondOf(sub).field" class="panel-input" list="flow-field-options"
                          placeholder="字段 是否属于灯具" style="width: 120px">

                        <select v-model="subCondOf(sub).op" class="panel-input" style="width: 88px"
                          @change="onOpChange(subCondOf(sub), $event)">
                          <option v-for="op in opsFor(subCondOf(sub))" :key="op.value" :value="op.value">
                            {{ op.label }}
                          </option>
                        </select>

                        <!--
                          值：「包含」可以填多个（命中任一即满足）；
                          其它操作符是单值 —— 常量（是 / 5000）或「@字段名」引用另一字段的值。
                        -->
                        <template v-if="subCondOf(sub).op === 'contains'">
                          <span v-for="(_, vi) in condValues(subCondOf(sub))" :key="vi" class="cond-value">
                            <!--
                              结论码用下拉：手打码太容易错，而错的码**永远不会命中**（还看不出来）。
                              结论条件不参与 @字段引用（见 types/approval 的 conditionRefField），所以这里不给输入框。
                            -->
                            <select v-if="isResultField(subCondOf(sub).field)" v-model="condValues(subCondOf(sub))[vi]"
                              class="panel-input" style="width: 96px">
                              <option value="">选择结论…</option>
                              <option v-for="r in resultOptions(condValues(subCondOf(sub))[vi])" :key="r.value"
                                :value="r.value">{{ r.label }}</option>
                            </select>

                            <input v-else v-model="condValues(subCondOf(sub))[vi]" class="panel-input"
                              list="flow-field-ref-options" placeholder="值" style="width: 96px">

                            <v-icon-btn v-if="condValues(subCondOf(sub)).length > 1" size="x-small" title="删除这个值"
                              variant="text" @click="removeCondValue(subCondOf(sub), vi)">
                              <v-icon size="11">mdi-close</v-icon>
                            </v-icon-btn>
                          </span>

                          <button class="add-cond-btn add-cond-btn--inline" title="再加一个值：命中任一个即算满足"
                            @click="addCondValue(subCondOf(sub))">
                            <v-icon size="11">mdi-plus</v-icon>
                            <span>值</span>
                          </button>
                        </template>

                        <!-- 结论码用下拉（同上）；其它字段照旧是"常量或 @字段引用" -->
                        <select v-else-if="isResultField(subCondOf(sub).field)" v-model="subCondOf(sub).value"
                          class="panel-input" style="width: 200px">
                          <option value="">选择结论…</option>
                          <option v-for="r in resultOptions(subCondOf(sub).value)" :key="r.value" :value="r.value">
                            {{ r.label }}
                          </option>
                        </select>

                        <input v-else v-model="subCondOf(sub).value" class="panel-input" list="flow-field-ref-options"
                          placeholder="5000 或 @字段" style="width: 200px">

                        <!--
                          仓库候选：点分类 = 整组一起填（选「本地仓」→ 本地仓 / 广州仓 / 中山仓 / 代发仓），
                          点单个 = 追加进这条条件。清单来自「角色设置 → 仓库设置」。
                        -->
                        <WarehousePicker
                          :groups="warehouseGroups"
                          :selected="selectedWarehouseValues(subCondOf(sub))"
                          @pick-group="(names) => applyWarehouseGroup(subCondOf(sub), names)"
                          @pick-one="(name) => appendWarehouseValue(subCondOf(sub), name)"
                        />

                        <v-icon-btn class="ml--2" size="x-small" variant="text"
                          @click="removeGroupItem(groupOf(item), k)">
                          <v-icon size="11">mdi-close</v-icon>
                        </v-icon-btn>
                      </div>
                    </div>

                    <div v-if="groupOf(item).items.length === 0" class="panel-hint ml-4">
                      组内还没有条件：当前按「恒真」处理，不会拦住这条分支（补上条件才会生效）
                    </div>
                  </div>

                  <!-- 普通条件：单行 -->
                  <div v-else class="panel-row">
                    <input v-model="condOf(item).field" class="panel-input" list="flow-field-options"
                      placeholder="字段 amount" style="width: 108px">

                    <select v-model="condOf(item).op" class="panel-input" style="width: 88px"
                      @change="onOpChange(condOf(item), $event)">
                      <option v-for="op in opsFor(condOf(item))" :key="op.value" :value="op.value">{{ op.label }}
                      </option>
                    </select>
                    <template v-if="condOf(item).op === 'contains'">
                      <span v-for="(_, vi) in condValues(condOf(item))" :key="vi" class="cond-value">
                        <!-- 结论码用下拉（同组内那条）：错的码永远不会命中，而手打很容易错 -->
                        <select v-if="isResultField(condOf(item).field)" v-model="condValues(condOf(item))[vi]"
                          class="panel-input" style="width: 96px">
                          <option value="">选择结论…</option>
                          <option v-for="r in resultOptions(condValues(condOf(item))[vi])" :key="r.value"
                            :value="r.value">{{ r.label }}</option>
                        </select>

                        <input v-else v-model="condValues(condOf(item))[vi]" class="panel-input" list="flow-field-ref-options"
                          placeholder="值" style="width: 96px">

                        <v-icon-btn v-if="condValues(condOf(item)).length > 1" size="x-small" title="删除这个值"
                          variant="text" @click="removeCondValue(condOf(item), vi)">
                          <v-icon size="11">mdi-close</v-icon>
                        </v-icon-btn>
                      </span>

                      <button class="add-cond-btn add-cond-btn--inline" title="再加一个值：命中任一个即算满足"
                        @click="addCondValue(condOf(item))">
                        <v-icon size="11">mdi-plus</v-icon>
                        <span>值</span>
                      </button>
                    </template>

                    <!--
                      结论字段（上一环节的审批结论）→ 结论码下拉：手打码太容易错，错的码永远不命中。
                      其它操作符是单值：常量（5000 / 是）或「@字段名」引用另一字段的值，输入 @ 会给候选。
                    -->
                    <select v-else-if="isResultField(condOf(item).field)" v-model="condOf(item).value"
                      class="panel-input" style="width: 120px">
                      <option value="">选择结论…</option>
                      <option v-for="r in resultOptions(condOf(item).value)" :key="r.value" :value="r.value">
                        {{ r.label }}
                      </option>
                    </select>

                    <input v-else v-model="condOf(item).value" class="panel-input" list="flow-field-ref-options"
                      placeholder="5000 或 @字段" style="width: 120px">

                    <!--
                      仓库候选：点分类 = 整组一起填（选「本地仓」→ 本地仓 / 广州仓 / 中山仓 / 代发仓），
                      点单个 = 追加进这条条件。清单来自「角色设置 → 仓库设置」。
                    -->
                    <WarehousePicker
                      :groups="warehouseGroups"
                      :selected="selectedWarehouseValues(condOf(item))"
                      @pick-group="(names) => applyWarehouseGroup(condOf(item), names)"
                      @pick-one="(name) => appendWarehouseValue(condOf(item), name)"
                    />

                    <v-icon-btn class="ml--2" size="x-small" variant="text" @click="removeCondition(item.index)">
                      <v-icon size="11">mdi-close</v-icon>
                    </v-icon-btn>
                  </div>
                </div>

                <div class="panel-row" :class="{ 'ml-3': isResultEdge }">
                  <button class="add-cond-btn" @click="addCondition">
                    <v-icon size="11">mdi-plus</v-icon>
                    <span>添加条件</span>
                  </button>

                  <button class="add-cond-btn ml-2"
                    title="一个条件组内部可以先用「组内满足方式」组合，再用下面的「满足方式」与其它条目组合。分档阈值（灯具>5000 或 非灯具>2000）就是这么写的"
                    @click="addConditionGroup">
                    <v-icon size="11">mdi-plus</v-icon>
                    <span>添加条件组</span>
                  </button>
                </div>
                <!-- 条目之间的组合方式；每个条件组**内部**另有自己的满足方式 -->
                <div v-if="panelConditionItems.length > 1" class="panel-row" :class="{ 'ml-3': isResultEdge }">
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

          <datalist id="flow-field-options">
            <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </datalist>
          <!--
            条件**值**侧的候选：带 @ 前缀的「引用另一字段」写法（见 types/approval 的 FIELD_REF_PREFIX）。
            不复用上面那个 datalist：它给的是字段名本身，直接选进 value 只会变成
            "总库存金额 == 总库存金额" 这种常量比较，不是引用。
          -->
          <datalist id="flow-field-ref-options">
            <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="FIELD_REF_PREFIX + f.value">{{ f.label }}</option>
          </datalist>

          <div v-if="saveError" class="save-error-bar">
            <v-icon size="14">mdi-alert-circle-outline</v-icon>
            <span class="save-error-bar__text">{{ saveError.message }}</span>
            <button v-if="saveError.nodeId" class="save-error-bar__btn" @click="locateError">定位</button>
            <button class="save-error-bar__btn" @click="saveError = null">关闭</button>
          </div>

          <div class="flow-canvas">
            <VueFlow v-model:edges="edges" v-model:nodes="nodes" :connection-radius="30" :default-viewport="{ zoom: 1 }"
              :delete-key-code="['Backspace', 'Delete']" fit-view-on-init :max-zoom="1.8" :min-zoom="0.3"
              @connect="onConnect" @edge-click="onEdgeClick" @move="onMove" @node-click="onNodeClick"
              @pane-click="selectedEdge = null">
              <Background :gap="16" />
              <Controls position="bottom-left" />
              <MiniMap pannable position="bottom-right" zoomable />

              <template #node-start="{ id }">
                <div class="node-shell">
                  <StartEndNode :key="id" kind="start" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <template #node-end="{ id }">
                <div class="node-shell">
                  <StartEndNode :key="id" kind="end" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <template #node-approval="{ id, data, selected }">
                <div class="node-shell">
                  <ApprovalNode :active-edge-id="selectedEdge?.id" :branches="outBranches(id)" :data="data"
                    :selected="selected" @add-member="addMemberTo(id)" @add-role="addRoleMemberTo(id)"
                    @branch-click="selectBranch" @remove="removeNodeById(id)" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <template #node-condition="{ id, selected }">
                <div class="node-shell">
                  <ConditionNode :active-edge-id="selectedEdge?.id" :branches="getBranches(id)" :selected="selected"
                    @branch-click="selectBranch" @remove="removeNodeById(id)" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <!-- 数据查询：卡片上只配「集合 + 条件」，两条出边的走向由建单期的查询结果决定，
                   所以不联动分支配置面板（点它的出线不会打开条件编辑器） -->
              <template #node-probe="{ id, data, selected }">
                <div class="node-shell">
                  <ProbeNode :branches="getBranches(id)" :probe="probeDataOf(data)" :selected="selected"
                    :title="data?.title" @remove="removeNodeById(id)" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <!-- 飞书提醒：复用审批节点的卡片（kind=notify 只换配色/文案/图标），
                   交互完全一致，所以成员增删那两个事件直接复用同一个处理函数 -->
              <template #node-notify="{ id, data, selected }">
                <div class="node-shell">
                  <ApprovalNode :active-edge-id="selectedEdge?.id" :branches="outBranches(id)" :data="data"
                    kind="notify" :selected="selected" @add-member="addMemberTo(id)" @add-role="addRoleMemberTo(id)"
                    @branch-click="selectBranch" @remove="removeNodeById(id)" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <!--
                组间轮询卡片：画布上只显示"名字 + 轮询字段 + 内部有几个环节"，
                点「编辑内部流程」在对话框里画那张小画布（见 LoopCardDialog）。
              -->
              <template #node-loop="{ id, data, selected }">
                <div class="node-shell">
                  <LoopCardNode :data="data" :outer-approvals="loopCardOuterApprovalsFor(id)" :selected="selected"
                    @edit="openCardDialog(id)" @remove="removeNodeById(id)" />

                  <div v-if="nodeErrorOf(id)" class="node-error" :title="nodeErrorOf(id)">
                    <v-icon size="12">mdi-alert-circle-outline</v-icon>
                    <span>{{ nodeErrorOf(id) }}</span>
                  </div>
                </div>
              </template>

              <!--
                引用模板卡片：只显示"引用的是哪张模板"，**不在这里画**被引用的流程 ——
                内容只有一份（在源模板里），这正是"复用"而不是"复制"的关键：
                源模板改了，之后新建的单立刻用新版（见 utils/templateRef）。
              -->
              <template #node-ref="{ id, data, selected }">
                <div class="node-shell">
                  <RefCardNode :branches="outBranches(id)" :data="data" :selected="selected"
                    :templates="refTemplateChoices" @branch-click="selectBranch" @open="openRefTemplate"
                    @preview="openRefPreview" @remove="removeNodeById(id)" />

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
            选中连线按 Backspace / Delete 可删除；节点可自由拖动；Ctrl+Z 撤销 / Ctrl+Shift+Z 重做；
            点一张卡片按 Ctrl+C 复制、Ctrl+V 粘贴（副本不带连线，位置在源卡片右下方）
          </div>
          <LoopCardDialog v-if="editingCardData" :data="editingCardData" :open="cardDialog"
            :outer-approvals="loopCardOuterApprovalsFor(editingCardId ?? '')" @close="closeCardDialog" />

          <RefPreviewDialog
            v-if="previewRefId"
            :open="!!previewRefId"
            :template-id="previewRefId"
            @close="closeRefPreview"
            @open-template="openRefTemplate"
          />

          <EdgeOptionTreeDialog :link-options="selectedEdgeLinkOptions" :model-value="selectedEdgeOptionGroups"
            :open="optionDialog" @close="optionDialog = false" @update:model-value="commitEdgeOptionGroups" />

        </v-sheet>
      </v-col>
    </v-row>

    <v-dialog v-model="isActive" max-width="500">
      <v-card rounded="lg">
        <v-card-text>
          <div class="d-flex justify-space-between">
            <v-btn class="text-none font-weight-bold ms-n4 mt-2" color="primary" text="审批流命名" variant="text" />

            <v-switch v-model="status" color="#1867C0" false-icon="mdi-close" true-icon="mdi-check">
              <template #label>
                <span class="text-[12px]">{{ status ? '开启' : '关闭' }}</span>
              </template>
            </v-switch>
          </div>

          <v-text-field v-model="streamName" clearable hint="审批流名称不能为空" label="例如：报销审批" persistent-hint
            :rules="[streamNameRule]" variant="outlined" />

          <span class="text-[12px] text-grey">创建后将于审批模板处查看</span>
        </v-card-text>

        <v-divider />

        <v-card-actions class="my-1 d-flex justify-end">
          <v-btn class="text-none" rounded="xl" text="取消" @click="isActive = false" />

          <v-btn class="text-none" color="primary" :loading="saving" rounded="xl" :text="editId ? '保存' : '创建'"
            variant="flat" @click="saveStream" />
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000">
      {{ snackbar.text }}
      <template #actions>
        <v-btn variant="text" @click="snackbar.show = false">关闭</v-btn>
      </template>
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
import type { OrgSelectPayload } from '@/components/OrgTree.vue'
import type {
  ApprovalChainItem,
  ApprovalNodeData,
  ApprovalOptionGroup,
  BranchCondition,
  ConditionExpr,
  ConditionGroup,
  FlowGraph,
  FlowGraphEdge,
  LoopNodeData,
  RefNodeData,
} from '@/types/approval'
// 连线形状清单：与卡片内部画布共用（两处各写一份迟早不一致）
import { applyEdgeShape, DEFAULT_EDGE_BORDER_RADIUS, DEFAULT_EDGE_CURVATURE, EDGE_STYLES } from '@/utils/edgeStyles'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { type Connection, MarkerType, useVueFlow, VueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import BackNode from '@/components/BackNode.vue'
import AdjustableEdge from '@/components/flow/AdjustableEdge.vue'
import ApprovalNode from '@/components/flow/ApprovalNode.vue'
import ConditionNode from '@/components/flow/ConditionNode.vue'
import EdgeOptionTreeDialog from '@/components/flow/EdgeOptionTreeDialog.vue'
// 组间轮询卡片：画布上的卡片 + 「内部子流程」编辑对话框（内含一张小画布）
import LoopCardDialog from '@/components/flow/LoopCardDialog.vue'
import LoopCardNode from '@/components/flow/LoopCardNode.vue'
import ProbeNode from '@/components/flow/ProbeNode.vue'
// 引用模板卡片：画布上的卡片本体（只存一个指向源模板的引用，内容在建单期搬进来）
import RefCardNode from '@/components/flow/RefCardNode.vue'
// 引用卡片「展开预览」弹窗：只读看一眼源模板里到底有什么（画布上刻意不画它的内容）
import RefPreviewDialog from '@/components/flow/RefPreviewDialog.vue'
import StartEndNode from '@/components/flow/StartEndNode.vue'
// 「仓库」候选值选择器（条件值侧）：候选来自「角色设置 → 仓库设置」维护的清单
import WarehousePicker from '@/components/flow/WarehousePicker.vue'
import OrgTree from '@/components/OrgTree.vue'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
import { APPROVAL_RESULTS, collapseConditionValue, conditionValues, FIELD_REF_PREFIX, flowToChain, isConditionGroup, isResultCondition, PROBE_EMPTY_BRANCH, PROBE_EXISTS_BRANCH, uid } from '@/types/approval'
import { ensureRejectLoopBack, graphToFlowFrom } from '@/utils/approvalFlow'
import { addApproval, getApprovalOne, getApprovalOptions, loadWarehouses, updateApprovalModel } from '@/utils/collection'
// 条件字段候选：与卡片内部画布共用同一份（见 utils/conditionFields 的文件头）
import { CONDITION_FIELD_OPTIONS } from '@/utils/conditionFields'
// 「跳出循环 / 轮完走向 / 提前结束轮询」的候选环节：与保存期白名单共用同一份口径
import { collectExitTargets } from '@/utils/exitTargets'
// 仓库清单（含"写进条件"的口径：分类 → 子仓库、追加单个）都是纯逻辑，放在 utils/warehouse 里
import { appendWarehouseValue, applyWarehouseGroup, groupWarehouses, selectedWarehouseValues } from '@/utils/warehouse'

const route = useRoute()
const router = useRouter()
const { setViewport, addSelectedEdges, setCenter, findNode, updateNodeInternals } = useVueFlow()

const isActive = ref(false)
const status = ref(false)
const saving = ref(false)
const streamName = ref<string>('')
const radios = ref('manager')
/** 编辑模式：加载已有模板时记录其 id，保存走 update */
const editId = ref('')
const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' | 'info' = 'success') {
  snackbar.value = { show: true, text, color }
}

const saveError = ref<{ message: string, nodeId?: string, edgeId?: string } | null>(null)

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
  /*
   * 用节点**自己的尺寸**算中点，别再写死数字：
   * 以前写死 `+118`（那是卡片只有 236px 宽的时代），卡片改成 300px 之后，
   * 「定位」落在卡片偏左 32px 的位置 —— 看起来就像"错误跑到别的节点上去了"。
   * vue-flow 的 node.dimensions 是量好的（调用这里之前已 await nextTick）。
   */
  const w = Number((node as { dimensions?: { width?: number } }).dimensions?.width) || 236
  const h = Number((node as { dimensions?: { height?: number } }).dimensions?.height) || 60
  // 横向到卡片中点；纵向往上留三分之一高，避免卡片顶到视口边缘
  setCenter(node.position.x + w / 2, node.position.y + h / 3, { zoom: 1, duration: 300 })
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
  set: (v: boolean) => {
    isEditorFullscreen.value = v
  },
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

/*
 * 分支条件的**字段候选**：与「组间轮询」卡片内部画布、条件值侧的 `@引用` 共用**同一份**
 * （见 utils/conditionFields 的文件头 —— 以前两处各抄一份，加字段漏一处就"卡片里选不到"）。
 */
const FIELD_OPTIONS = CONDITION_FIELD_OPTIONS
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

const offerRule = computed<{ op: string, value: string }>(() => {
  const list = (selectedEdge.value?.data?.offerWhen ?? []) as ConditionExpr[]
  const first = list[0]
  const one: BranchCondition | null = list.length === 1 && first && !isConditionGroup(first) ? first : null
  return one && one.field === 'result' && (one.op === 'eq' || one.op === 'ne')
    ? { op: one.op, value: String(one.value ?? '') }
    : { op: '', value: '' }
})

/** 写回选项条件；op / value 任一为空 → 删掉字段（"不限"与"没配"是同一种表示） */
function writeOfferRule (op: string, value: string) {
  const edge = selectedEdge.value
  if (!edge) return
  ensureEdgeData()
  if (!op || !value) {
    delete edge.data.offerWhen
    return
  }
  edge.data.offerWhen = [{ field: 'result', op, value }]
}

function onOfferOp (e: Event) {
  writeOfferRule((e.target as HTMLSelectElement).value, offerRule.value.value)
}

function onOfferCode (e: Event) {
  writeOfferRule(offerRule.value.op, (e.target as HTMLSelectElement).value)
}

/** 选中连线是否为「审批结果分支」：审批节点出线且该节点已有 ≥2 条出线 */
const isResultEdge = computed(() => {
  const edge = selectedEdge.value
  if (!edge) return false
  const src = nodes.value.find(n => n.id === edge.source)
  if (src?.type !== 'approval') return false
  return edges.value.filter(e => e.source === edge.source).length > 1
})

/**
 * 选中连线是否为「引用模板的分流线」：引用卡片出线，且卡片已有 ≥2 条出线。
 *
 * 与审批结果分支**共用同一套交互**（线路名称 / 绑结论 / 条件 / 兜底主线）——
 * 差别只在"结论从哪来"：那边是上一环节的审批结论，这边是**被引用那一段最后办出来的结论**；
 * 但引擎给下游的都是同一个 `result`，所以面板上共用同一个「审批结论」下拉。
 *
 * 审批环节专属的配置（办理选项树 / 选项条件）**不给它**：引用卡片自己没有"办理这一刻"。
 */
const isRefEdge = computed(() => {
  const edge = selectedEdge.value
  if (!edge) return false
  const src = nodes.value.find(n => n.id === edge.source)
  if (src?.type !== 'ref') return false
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

/*
 * 「跳出循环」：分支连线仍指向「结束」节点（画布是树，画不出"汇回主干"的合并线），
 * 所以用面板上的"走向"来区分「真结束」与「跳到指定环节继续办」。
 * 面板写两份数据：exitMode（走向）+ exitTo（目标环节 id），
 * 保存时由 utils/approvalFlow.ts 转成 ApprovalBranch.exitTo，并在那里校验目标是否合法。
 */
const selectedEdgeExitMode = computed<'end' | 'jump'>({
  get: () => (selectedEdge.value?.data?.exitMode === 'jump' ? 'jump' : 'end'),
  set: v => {
    const edge = ensureEdgeData()
    if (!edge) return
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

/** 「跳出循环」的目标环节 id（留空 = 还没选，保存时会明确报错，不会静默变成"结束流程"） */
const selectedEdgeExitTo = computed({
  get: () => String(selectedEdge.value?.data?.exitTo ?? ''),
  set: (v: string) => {
    const edge = ensureEdgeData()
    if (edge) {
      edge.data.exitTo = v
    }
  },
})

/** 选中的这条线是不是**「组间轮询」卡片自己的出线**（它的走向由下面这一项决定） */
const isLoopEdge = computed(() => {
  const source = nodes.value.find(n => n.id === selectedEdge.value?.source)
  return source?.type === 'loop'
})

/*
 * 「组间轮询」卡片自己的出线走向（`edge.data.loopExit`，见 types/approval 的 FlowGraphEdge.data）：
 *   · 轮完（'done'）     = 所有组都轮完、一直没人跳出轮询 → 卡片的**后继**；
 *   · 提前跳出（'early'） = 某一组接了、提前结束轮询 → 环内「提前结束轮询」的**缺省目标**
 *     （环内那条线自己选了目标就用它）。
 *
 * 卡片最多两条出线、靠这一项区分（保存期口径见 utils/approvalFlow 的 splitLoopOuts）：
 * 没有它就说不清"第几环走哪条"，两条都没标会当场报错。
 * **单出线时默认就是「轮完」**，所以老模板一个字段都不用写。
 */
const selectedEdgeLoopExit = computed<'done' | 'early'>({
  get: () => (selectedEdge.value?.data?.loopExit === 'early' ? 'early' : 'done'),
  set: v => {
    const edge = ensureEdgeData()
    if (!edge) return
    edge.data.loopExit = v
    /*
     * 连线名跟着写死成走向：画布上一眼看出哪条是「轮完」、哪条是「提前跳出」。
     * 与「数据查询」两条出线自动命名（存在 / 不存在）同一套做法 ——
     * 卡片出线本来就没有"分支名"可编辑（isBranchEdge 不含 loop），不会被覆盖。
     */
    edge.label = v === 'early' ? '提前跳出' : '轮完'
  },
})

/**
 * 「跳出循环」的可选目标：本流程里**能跳过去接着走**的环节
 * —— 审批 / 飞书提醒 / 引用模板 / 组间轮询，口径与保存期白名单共用一份
 * （见 utils/exitTargets；以前这里自己 filter 审批+提醒，于是"引用模板卡片"配不出来，
 * 而它其实是合法目标：建单期会从那一段的第一环接着走）。
 *
 * 不含本分支所在的那个环节自己：跳到自己的出线等于原地打转。
 */
const exitTargets = computed(() => collectExitTargets(nodes.value, selectedEdge.value?.source))

/** 面板里要渲染的一个"条件条目"（带**绝对下标**，删除时按它定位） */
type PanelCondItem
  = | { kind: 'cond', index: number, cond: BranchCondition }
  | { kind: 'group', index: number, group: ConditionGroup }

/**
 * 面板要渲染的条目清单。
 *
 * 为什么需要这层：条目可能是**单个条件**，也可能是**条件组**（组里还能再放组）。
 * 结果分支的第一项是「审批结论」条件，由上面的下拉框单独渲染，这里要剔除 ——
 * 剔除按"是不是结果条件"判断，**不能**死记"下标 0"：条件组排首位时那样会把整组弄丢。
 */
const panelConditionItems = computed<PanelCondItem[]>(() => {
  const out: PanelCondItem[] = []
  for (const [index, c] of selectedEdgeConditions.value.entries()) {
    if (isResultEdge.value && isResultCondition(c)) continue
    out.push(isConditionGroup(c)
      ? { kind: 'group', index, group: c }
      : { kind: 'cond', index, cond: c })
  }
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

/*
 * 「包含」的值列表：读写放在 types/approval.ts（conditionValues / collapseConditionValue）。
 * 放那边的理由：它们定义的是 `value` 的**数据形状**，必须和求值口径待在一起，
 * 也才能被 tsx 直接断言 —— 这类"数组被 String() 成 a,b"的错不会报错，只会静默不命中。
 */
const condValues = conditionValues

/** 给「包含」加一个值输入框 */
function addCondValue(c: BranchCondition) {
  conditionValues(c).push('')
}

/** 删掉第 i 个值；删空了留一个空框，否则用户没地方再输入 */
function removeCondValue(c: BranchCondition, i: number) {
  const list = conditionValues(c)
  list.splice(i, 1)
  if (list.length === 0) {
    list.push('')
  }
}

/* ==================== 「仓库」候选值（条件值侧） ==================== */

/**
 * 右侧面板「仓库」按钮的候选：**分类 → 其下全部仓库**。
 *
 * 来源是「角色设置 → 仓库设置」维护的那份清单（PB `warehouses` 表；没维护过时用
 * utils/warehouse 的文件默认值）—— 与审批人覆盖值同一套"外部维护、模板引用"的做法。
 *
 * ⚠️ 它只是**候选**：写进条件的是**具体仓库名**（见 utils/warehouse 的 applyWarehouseGroup /
 *    appendWarehouseValue），模板里不会存"引用了清单"这层关系 ——
 *    所以清单以后改名 / 增删，**已保存的模板不受影响**。这与「引用模板」刻意不同：
 *    条件是业务口径，必须落成确定的取值，不能跟着清单漂。
 */
const warehouseGroups = ref<Array<{ parent: string, names: string[] }>>([])

async function loadWarehouseGroups() {
  const res = await loadWarehouses()
  warehouseGroups.value = groupWarehouses(res.rows)
}

/**
 * 切换操作符时在「单值 ↔ 多值」之间转换。
 *
 * 不转换的后果：
 *  · 从「包含」切到「等于」时 value 还是数组 → 求值时被 String() 成 "a,b"，
 *    条件永远不命中，而且**看不出来**（界面显示的是两个框里的值）；
 *  · 反过来切到「包含」：统一成数组后，模板里就只需要处理一种形状。
 *
 * op 直接从事件取值，而不是依赖 v-model 已经写过：
 * 同一个 change 事件上，v-model 的处理函数与本函数谁先执行没有保证。
 */
function onOpChange(c: BranchCondition, e?: Event) {
  const next = (e?.target as HTMLSelectElement | null)?.value
  if (next) {
    c.op = next as BranchCondition['op']
  }
  if (c.op === 'contains') {
    conditionValues(c)
    return
  }
  // 切到别的比较方式：多值收回单值（保留第一个非空值，而不是直接丢掉）
  collapseConditionValue(c)
}

/** 多条件组合方式：and = 全部满足，or = 任一满足 */
const selectedEdgeLogic = computed<'and' | 'or'>({
  get: () => (selectedEdge.value?.data?.logic === 'or' ? 'or' : 'and'),
  set: (v: 'and' | 'or') => {
    const edge = ensureEdgeData()
    if (edge) edge.data.logic = v
  },
})

/**
 * 选中连线的形状；pathOptions 会透传给 vue-flow 内置连线组件（curvature / borderRadius）。
 * 形状清单（EDGE_STYLES）与卡片内部画布**共用** src/utils/edgeStyles.ts，别在这里再写一份。
 */
const selectedEdgeType = computed<string>({
  get: () => selectedEdge.value?.type ?? 'default',
  set: (v: string) => applyEdgeShape(selectedEdge.value, v),
})

/** 修改选中连线的形状参数；整体替换 pathOptions 以保证连线重渲染 */
function setEdgePathOptions(mutate: (o: Record<string, any>) => void) {
  const edge = selectedEdge.value
  if (!edge) return
  const next = { ...edge.pathOptions }
  mutate(next)
  edge.pathOptions = next
}

/** 贝塞尔弯曲程度：0 = 接近直线，1 = 弯曲最明显（默认值与 shared/edgeStyles 保持一致） */
const selectedEdgeCurvature = computed<number>({
  get: () => Number(selectedEdge.value?.pathOptions?.curvature ?? DEFAULT_EDGE_CURVATURE),
  set: (v: number) => setEdgePathOptions(o => (o.curvature = v)),
})

/** 圆角折线的转角圆角半径（像素） */
const selectedEdgeBorderRadius = computed<number>({
  get: () => Number(selectedEdge.value?.pathOptions?.borderRadius ?? DEFAULT_EDGE_BORDER_RADIUS),
  set: (v: number) => setEdgePathOptions(o => (o.borderRadius = v)),
})

/** 手动拖拽曲线的弯点写回：存在 edge.data.cp，随画布快照持久化；null 表示复位 */
function onEdgeCpUpdate(id: string, cp: { x: number, y: number } | null) {
  const edge = edges.value.find(e => e.id === id)
  if (!edge) return
  if (!edge.data) edge.data = {}
  if (cp) edge.data.cp = cp
  else delete edge.data.cp
}

/*
 * 「选项文本」（`edge.data.options`）以前在面板上是个纯文本框，**现已去掉** ——
 * 它想表达的是"多个说法走同一条线"，而选项树的「实际链路」能表达得更清楚
 * （还能分组、还能带二级），两处并存容易配串。
 * 数据层仍兼容它：旧模板里配了 `options` 的分支照常渲染（见 collectStepOptionItems）。
 *
 * 与选项树共用的落库口径（"空就删字段"）见下面的 commitEdgeOptionGroups。
 */

/* ===== 选项树（类别 → 一级 + 实际链路 → 二级，见 ApprovalOptionGroup）===== */

/** 弹出框开关（选项树整块在弹出框里编辑，见 EdgeOptionTreeDialog） */
const optionDialog = ref(false)

/** 选中连线源头的**审批环节节点**：选项树挂在它身上（一个环节一份，见 ApprovalNodeData.optionGroups） */
const selectedEdgeApprovalNode = computed(() => (
  nodes.value.find(n => n.id === selectedEdge.value?.source) ?? null
))

/**
 * 老数据兜底：选项树以前配在**连线**上（`edge.data.optionGroups`）。
 * 节点上还没配时读一次，让老模板照常能编辑；存回去时一律以节点为准（顺手清掉线上那份）。
 */
function legacyEdgeOptionGroups(): ApprovalOptionGroup[] {
  const edge = selectedEdge.value
  if (!edge) return []
  const of = (e: any): ApprovalOptionGroup[] => (Array.isArray(e?.data?.optionGroups) ? e.data.optionGroups : [])
  const own = of(edge)
  return own.length > 0 ? own : of(edges.value.find(e => e.source === edge.source && of(e).length > 0))
}

/**
 * 本**环节**共用的选项树 —— 点本环节任意一条结果分支的「配置选项」看到的都是这一份。
 *
 * 为什么是环节级：树里每个一级选项自带「实际链路」，能指到本环节**任意一条**出线，
 * 一棵树本来就覆盖整个环节；按"当前连线"取会出现"A 线配了、B 线显示未配置"的假象。
 */
const selectedEdgeOptionGroups = computed<ApprovalOptionGroup[]>(() => {
  const own = selectedEdgeApprovalNode.value?.data?.optionGroups
  return Array.isArray(own) ? own : legacyEdgeOptionGroups()
})

/** 「配置选项」按钮上的概览：不打开也知道**本环节**配没配（空树点进去只有一个「新增类别」） */
const optionSummary = computed(() => {
  const groups = selectedEdgeOptionGroups.value
  if (groups.length === 0) {
    return '（本环节未配置）'
  }
  const items = groups.reduce((n, g) => n + (g.items?.length ?? 0), 0)
  return `（本环节已配 ${items} 个一级）`
})

/** 「实际链路」候选 = **本节点各条出线**（结论码 → 分支名/结论文案）：选项树里每个一级选项指一条 */
const selectedEdgeLinkOptions = computed(() => {
  const src = selectedEdge.value?.source
  if (!src) {
    return []
  }
  const out: Array<{ value: string, label: string }> = []
  const seen = new Set<string>()
  for (const e of edges.value.filter(x => x.source === src)) {
    const list = Array.isArray(e.data?.conditions) ? e.data.conditions : []
    const c = list.find(isResultCondition) as BranchCondition | undefined
    // 没绑结论的出线就是"主线"（其余结论未命中时走它），结论码按 pass 算，与编译器口径一致
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
 * 写回选项树：写到**审批环节节点**上（见 ApprovalNodeData.optionGroups）——
 * 一个环节一份，从它的任意一条结果分支改，改的都是同一份；空树就删字段。
 * 老数据配在连线上的那份顺手清掉：内容已经写进节点，留着会让编译时两处都出选项。
 */
function commitEdgeOptionGroups (list: ApprovalOptionGroup[]) {
  const node = selectedEdgeApprovalNode.value
  if (!node) return
  if (!node.data) node.data = {}
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
let lastSnapshot: { nodes: any[], edges: any[] } | null = null
let historyTimer: ReturnType<typeof setTimeout> | undefined

function snapGraph() {
  const g = serializeGraph()
  return { nodes: g.nodes, edges: g.edges }
}

function sameGraph(a: { nodes: any[], edges: any[] }, b: { nodes: any[], edges: any[] }) {
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
function applySnapshot(s: { nodes: any[], edges: any[] }) {
  nodes.value = s.nodes.map(n => ({ ...n, position: { ...n.position } }))
  edges.value = s.edges.map(e => ({ ...e, markerEnd: arrowMarker }))
  selectedEdge.value = null
  // 整批换图：同 loadGraph，补一次重量（撤销/重做后卡片内容会变高变矮）
  remeasureNodes()
}

function undo() {
  if (undoStack.value.length === 0) return
  const prev = undoStack.value.pop()!
  if (lastSnapshot) redoStack.value.push(lastSnapshot)
  applySnapshot(prev)
  lastSnapshot = prev
}

function redo() {
  if (redoStack.value.length === 0) return
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

// ===== 复制 / 粘贴卡片（Ctrl / Cmd + C、V）=====

/**
 * 剪贴板里那**一张**卡片：只存类型 + 数据的深拷贝 + 源节点 id。
 *
 * · 存 id 是为了粘贴时以**源卡片的位置**为基准往右下错开 —— 副本就在旁边，
 *   不用去画布另一头找它；源卡片被删了就退回"视口中心的空位"（复用加节点那套避让）。
 * · **不存连线**：连线两端是"别处"的节点，复制过去要么指错、要么得连带造一批节点出来。
 *   复制卡片真正省的是重复录入（标题 / 审批人 / 条件配置），线请重新拖一条。
 */
const copiedNode = ref<{ id: string, type: string, data: unknown } | null>(null)

/** 连按粘贴的次数：让副本依次错开，而不是每次都叠在同一处 */
let pasteCount = 0

/** 最后点过的卡片（由画布的 @node-click 记录）—— Ctrl+C 复制的是它 */
const pickedNodeId = ref('')

function onNodeClick ({ node }: { node: any }) {
  pickedNodeId.value = String(node?.id ?? '')
}

/**
 * 卡片数据的深拷贝：JSON 往返。
 *
 * 必须**拷贝**而不是共用引用：否则改了副本的审批人，原卡片也跟着变（最迷惑人的那种 bug）。
 * 用 JSON 而不是 `structuredClone`，理由与项目里其它快照一致（见 LoopCardDialog 的 cloneGraph）：
 * 数据可能来自 Vue 的响应式代理，`structuredClone` 遇到 Proxy 会抛 DataCloneError。
 */
function copyNodeData (data: unknown): unknown {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- 见上：Proxy 会让 structuredClone 抛 DataCloneError
  return data === undefined || data === null ? {} : JSON.parse(JSON.stringify(data))
}

/** 卡片名（提示文案里点名用；没写名字时按类型给个叫法） */
const CARD_NAME_BY_TYPE: Record<string, string> = {
  approval: '审批环节',
  notify: '飞书提醒',
  condition: '条件分支',
  probe: '数据查询',
  loop: '组间轮询',
  ref: '引用模板',
}

function cardNameOf (node: any): string {
  const title = String(node?.data?.title ?? '').trim()
  return title || CARD_NAME_BY_TYPE[String(node?.type)] || '卡片'
}

/** Ctrl+C：把最后点过的那张卡片存进剪贴板 */
function copyPickedNode () {
  const node = nodes.value.find(n => n.id === pickedNodeId.value)
  if (!node || node.type === 'start' || node.type === 'end') {
    showMsg('先点一下要复制的卡片（开始 / 结束节点不用复制）', 'warning')
    return
  }
  copiedNode.value = { id: String(node.id), type: String(node.type), data: copyNodeData(node.data) }
  pasteCount = 0
  showMsg(`已复制「${cardNameOf(node)}」—— 按 Ctrl+V 粘贴`, 'success')
}

/** Ctrl+V：粘贴一张副本（不带连线） */
function pasteCopiedNode () {
  const copied = copiedNode.value
  if (!copied) {
    showMsg('剪贴板里还没有卡片：先点一张卡片，按 Ctrl+C 复制', 'warning')
    return
  }
  pasteCount += 1
  const node: any = {
    id: uid(),
    type: copied.type,
    position: { x: 0, y: 0 },
    data: copyNodeData(copied.data),
  }
  const source = nodes.value.find(n => n.id === copied.id)
  if (source) {
    // 以源卡片为基准往右下挪；连按几次就排成一条斜线，一眼看得出哪几个是新粘的
    node.position = {
      x: Number(source.position?.x ?? 0) + 32 * pasteCount,
      y: Number(source.position?.y ?? 0) + 32 * pasteCount,
    }
    nodes.value.push(node)
  } else {
    // 源卡片已经不在了（删掉 / 换过模板）：交给"加节点"那套找个不压其它卡片的空位
    addNodeToCanvas(node)
  }
  pickedNodeId.value = node.id
  showMsg(`已粘贴「${cardNameOf(node)}」—— 拖到合适位置，再拖线接上下游`, 'success')
}

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
  } else if (key === 'c' && !e.shiftKey) {
    // 复制卡片（输入框里的复制已在函数开头放过：那是复制文字，不该变成复制卡片）
    e.preventDefault()
    copyPickedNode()
  } else if (key === 'v' && !e.shiftKey) {
    e.preventDefault()
    pasteCopiedNode()
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

/** 操作符的中文名（下拉里显示；表里没有的（老数据）就原样显示码） */
function opLabel (op: string): string {
  return OPS.find(o => o.value === op)?.label ?? op
}

/** 这个字段是不是「上一环节的审批结论」（保留字段 result，见 types/approval 的 conditionRefField） */
function isResultField (field: unknown): boolean {
  return String(field ?? '').trim() === 'result'
}

/**
 * 「上一环节的审批结论」的候选 = 全局结论码表（"结果分支"下拉读的也是它，见 APPROVAL_RESULTS）。
 *
 * 表里没有的码（老模板 / 拼错的码）**补在最后**：不补的话下拉会把已有值显示成空白，
 * 用户一保存就被改成表里第一项 —— 等于悄悄改了模板的分流口径。
 */
function resultOptions (raw: unknown): Array<{ value: string, label: string }> {
  const v = String(raw ?? '').trim()
  if (!v || APPROVAL_RESULTS.some(r => r.value === v)) {
    return [...APPROVAL_RESULTS]
  }
  return [...APPROVAL_RESULTS, { value: v, label: `${v}（表里没有的码）` }]
}

/**
 * 某个条件可用的操作符。
 *
 * `result` **只给「等于」**，两条理由指向同一件事：结论是一个**码**，不是可比较的量。
 *  1. 「包含」在它身上是**子串匹配**（`containsHit` 用 `String#includes`）——
 *     「不接收（not_receive）」会被「包含 接收（receive）」命中：看着配好了，
 *     实际按你没预期的口径分流。
 *  2. 「不等于」更危险：引擎判断"这条线绑的是哪个结论"时**只看字段名、不看操作符**
 *     （见 types/approval 的 isResultCondition / firstResultValueOf），
 *     于是 `result ≠ 驳回` 这条线会被判成"**就是**驳回"—— 终态、时间线与分支文案全跟着错。
 * 要表达"其余结论"，写多条「等于」+ 留一条无条件兜底主线（这也是引擎一直推荐的做法）。
 *
 * 老数据里若存着别的操作符，把它补进候选 —— 不能让下拉"看不见"已有值（否则一保存就被改掉）。
 */
function opsFor (c: BranchCondition): Array<{ value: string, label: string }> {
  const base = isResultField(c.field) ? OPS.filter(o => o.value === 'eq') : [...OPS]
  return base.some(o => o.value === c.op)
    ? [...base]
    : [...base, { value: c.op, label: `${opLabel(c.op)}（模板里存着的旧写法）` }]
}

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
function getBranches(nodeId: string): { id: string, label: string, toEnd: boolean }[] {
  return edges.value
    .filter(e => e.source === nodeId)
    .map(e => ({ id: e.id, label: String(e.label ?? '').trim(), toEnd: isEndTarget(e.target) }))
}

/** 审批节点卡片展示用的出线列表：只有结果分支（≥2 条出线）才展示，单主线不展示 */
function outBranches(nodeId: string): { id: string, label: string, toEnd: boolean }[] {
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

/**
 * 这条线算不算"分支"：条件分支节点的出线；或审批节点且已形成结果分支（≥2 条出线）的出线。
 * 只决定**面板里显示哪些配置项**（分支名 / 审批结论 / 条件），不再决定能否选中。
 */
function isBranchEdgeOf(edge: any): boolean {
  if (!edge) return false
  const source = nodes.value.find(n => n.id === edge.source)
  /*
   * 「审批节点」与「引用卡片」在这里同款：都能有 ≥2 条出线按结论分流
   * （审批 = 上一环节的结论；引用 = 被引用那一段最后办出来的结论）。
   * 只有 ≥2 条时才当分支 —— 单出线的引用卡片就是"穿过去"，没有分支可配。
   */
  const resultBranchable
    = (source?.type === 'approval' || source?.type === 'ref')
      && (edges.value.filter(e => e.source === edge.source).length > 1)
  return source?.type === 'condition' || resultBranchable
}

/** 当前选中的这条线是不是分支（见 isBranchEdgeOf） */
const isBranchEdge = computed(() => (selectedEdge.value ? isBranchEdgeOf(selectedEdge.value) : false))

function onEdgeClick({ edge }: { edge: any }) {
  /*
   * 任何连线都能选中。
   *
   * 以前这里有一道门：只有「条件节点出线」或「审批节点且 ≥2 条出线」才允许选中，别的线一律
   * `selectedEdge = null` 直接返回 —— 于是开始→第一环、审批的**唯一**出线、数据查询 / 提醒 /
   * 卡片的出线**点不出面板**，连"线条形状"都改不了（形状选择器就长在那个面板里）。
   * 现在：连线恒可选中；分支专属的配置项由模板上的 isBranchEdge 控制是否显示。
   */
  selectedEdge.value = edge ?? null
  if (!edge || !isBranchEdgeOf(edge)) return
  if (!edge.data) edge.data = {}
  // 兼容旧数据：把单条件 condition 升级为多条件数组 conditions
  if (!Array.isArray(edge.data.conditions)) {
    edge.data.conditions = edge.data.condition ? [edge.data.condition] : []
  }
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

function onMove({ flowTransform }: { flowTransform: { x: number, y: number, zoom: number } }) {
  currentViewport.value = flowTransform
}

function onConnect(params: Connection) {
  if (params.source === params.target) return // 不允许自连

  const sourceNode = nodes.value.find(n => n.id === params.source)
  const selected = selectedEdge.value
  const branchable = sourceNode?.type === 'condition' || sourceNode?.type === 'approval' || sourceNode?.type === 'probe'

  // 已选中本节点某条出线：把这条分支改连到新目标，而不是再建一条
  // （条件分支与审批结果分支共用这套语义）
  if (branchable && selected && selected.source === params.source) {
    if (selected.target === params.target) return // 落点没变，无需处理
    selected.sourceHandle = params.sourceHandle ?? undefined
    selected.target = params.target
    selected.targetHandle = params.targetHandle ?? undefined
    const targetName
      = nodes.value.find(n => n.id === params.target)?.data?.title || '结束'
    showMsg(`「${selected.label || '未命名分支'}」已改连到「${targetName}」`, 'success')
    return
  }

  /*
   * 飞书提醒节点**只允许一条出线**（它没有审批结论、也没有条件，多条出线无从分流，
   * 保存时会被 graphToFlowFrom 拦下）。所以这里再拖一条时不是新增，而是改连已有的那条 ——
   * 否则用户会得到一条必然报错的线，还得自己去删。
   */
  if (sourceNode?.type === 'notify') {
    const exist = edges.value.find(e => e.source === params.source)
    if (exist) {
      if (exist.target === params.target) return
      exist.target = params.target
      exist.targetHandle = params.targetHandle ?? undefined
      showMsg('飞书提醒节点的出线已改连到新目标', 'success')
      return
    }
  }

  /*
   * 「组间轮询」卡片最多**两条**出线：一条「轮完」（所有组都轮完、没人跳出时走）、
   * 一条「提前跳出」（某组接了、提前结束轮询时走）。两条各走各的路线，靠走向区分
   * （保存期口径见 utils/approvalFlow 的 splitLoopOuts）。
   * 拖第三条时直接拦下并说清限制 —— 否则用户会得到一条必然报错的线，还得自己去删。
   */
  if (sourceNode?.type === 'loop' && edges.value.filter(e => e.source === params.source).length >= 2) {
    showMsg('组间轮询卡片最多两条出线：一条「轮完」、一条「提前跳出」', 'warning')
    return
  }

  const outCount = edges.value.filter(e => e.source === params.source).length
  let label: string | undefined
  let data: FlowGraphEdge['data'] | undefined
  let newResultBranch = false
  if (sourceNode?.type === 'probe') {
    /*
     * 数据查询的两条出边按拖出顺序自动命名：第一条「存在」、第二条「不存在」。
     * 名字是**语义的一部分**（建单期按名字挑分支），所以不给「分支N」这种可随便改的名字；
     * 拖多了的第三条给个明显不合法的名字，交给保存期校验报错。
     */
    label = outCount === 0
      ? PROBE_EXISTS_BRANCH
      : (outCount === 1 ? PROBE_EMPTY_BRANCH : `多余分支${outCount + 1}`)
    data = {}
  } else if (sourceNode?.type === 'condition') {
    label = `分支${outCount + 1}`
    data = { condition: null, conditions: [] }
  } else if (sourceNode?.type === 'loop' && outCount >= 1) {
    /*
     * 卡片的**第二条**出线：默认当「提前跳出」（与审批节点拖出第二条线默认绑「驳回」同一套做法）。
     * 走向可以在上方面板改 —— 改完另一条自动就是「轮完」。
     */
    label = '提前跳出'
    data = { loopExit: 'early' }
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
        e.source === params.source
        && !e.label
        && !(e.data?.conditions?.length || e.data?.condition),
    )
    if (main) main.label = '通过'
    // 自动选中新分支，画布高亮 + 上方面板展开，供命名与选择审批结论
    selectedEdge.value = edges.value.at(-1)
    addSelectedEdges([selectedEdge.value])
    showMsg('已创建审批结果分支：在上方命名并选择对应审批结论（原主线保留「通过」兜底）', 'success')
  }
  // 轮询卡片的第二条出线：给第一条（本来就是「轮完」那条）补个名字，两条各是什么一眼看出
  if (sourceNode?.type === 'loop' && outCount === 1) {
    const done = edges.value.find(e => e.source === params.source && e.data?.loopExit !== 'early')
    if (done && !done.label) done.label = '轮完'
    selectedEdge.value = edges.value.at(-1)
    addSelectedEdges([selectedEdge.value])
    showMsg('已创建「提前跳出」出线：走向可在上方面板改（两条出线分别是轮完 / 提前跳出）', 'success')
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
  const H = isCardNode(node.type) ? 130 : 60
  const margin = 30
  const occupied = (px: number, py: number) =>
    nodes.value.some(n => {
      const nh = isCardNode(n.type) ? 130 : 60
      return (
        px < n.position.x + W + margin
        && px + W + margin > n.position.x
        && py < n.position.y + nh + margin
        && py + H + margin > n.position.y
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

/**
 * 加一个「数据查询」节点：建单时查一次 PB 集合，按"有没有记录"决定走哪条出边。
 *
 * 两条出边的名字**是语义的一部分**（建单期按名字挑分支，见 utils/approvalProbe），
 * 所以拖线时自动命名、保存时再校验一次，不让用户手写。
 */
function addProbeNode() {
  const seq = nodes.value.filter(n => n.type === 'probe').length + 1
  addNodeToCanvas({
    id: uid(),
    type: 'probe',
    position: { x: 0, y: 0 },
    data: { title: `数据查询${seq}`, probe: { collection: '', filter: '' } },
  })
}

/**
 * 卡片里直接改这个对象（父级与卡片持有同一引用，与 roleOf / rotationOf 同一套写法），
 * 所以取不到时补一个空壳，而不是返回 undefined 让卡片炸掉。
 */
function probeDataOf(data: any): { collection: string, filter: string } {
  if (!data) {
    return { collection: '', filter: '' }
  }
  if (!data.probe) {
    data.probe = { collection: '', filter: '' }
  }
  return data.probe as { collection: string, filter: string }
}

/**
 * 加一个「飞书提醒」节点：**只通知、不办理**。
 *
 * 它在时间线上占一环（"在审批环节中体现"），但流程到达即自动穿过 ——
 * 不需要审批人、不产生待办、不消费 decisions（见 types/approval 的 rebuildChain）。
 * 到达时向配置的提醒对象发一条飞书消息（见 composables/useNodeSubmit）。
 */
function addNotifyNode() {
  const seq = nodes.value.filter(n => n.type === 'notify').length + 1
  addNodeToCanvas({
    id: uid(),
    type: 'notify',
    position: { x: 0, y: 0 },
    data: { title: `提醒${seq}`, members: [] },
  })
}

/** 画布上的"卡片型"节点：摆放避让时按卡片高度估算（start/end 是小胶囊） */
function isCardNode(type?: string): boolean {
  return type === 'approval' || type === 'condition' || type === 'notify' || type === 'probe' || type === 'loop' || type === 'ref'
}

/**
 * 新卡片的轮询缺省口径：**只写必填的「组别」**（其余留空 = 回落代码默认，
 * 见 utils/approvalRotation 的 ROTATION_DEFAULTS）。
 *
 * 不把默认值固化进模板 —— 否则以后改默认口径（比如汇总是求和还是取最大）时，
 * 已经建好的卡片会被写死的字面量锁住（旧轮询面板就是靠"空 = 删字段"躲开这个坑）。
 */
const DEFAULT_LOOP_ROTATION = { groupFrom: '组别' }

/**
 * 加一张「组间轮询」卡片。
 *
 * 内部只预置开始 / 结束两个锚点，**不预置环节**：卡片内部画什么由作者决定；
 * "空卡片"会在保存时被明确拦下（见 utils/loopCardGraph），不会静默存成一张走不动流程的卡片。
 */
function addLoopNode() {
  const seq = nodes.value.filter(n => n.type === 'loop').length + 1
  addNodeToCanvas({
    id: uid(),
    type: 'loop',
    position: { x: 0, y: 0 },
    data: {
      title: `组间轮询${seq}`,
      rotation: { ...DEFAULT_LOOP_ROTATION },
      graph: {
        nodes: [
          { id: uid(), type: 'start', position: { x: 220, y: 0 } },
          { id: uid(), type: 'end', position: { x: 220, y: 220 } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    } satisfies LoopNodeData,
  })
}

/**
 * 加一张「引用模板」卡片。
 *
 * 故意**不预选**源模板：预选上第一张，会让"手滑拖出来但没选"变成
 * "悄悄引用了另一张模板的流程" —— 那比当场报错糟得多。
 * 没选会保存失败并点名这张卡片（见 utils/approvalFlow 的 readTemplateRef）。
 */
function addRefNode() {
  const seq = nodes.value.filter(n => n.type === 'ref').length + 1
  addNodeToCanvas({
    id: uid(),
    type: 'ref',
    position: { x: 0, y: 0 },
    data: { title: `引用模板${seq}`, refTemplateId: '' } satisfies RefNodeData,
  })
}

/** 可引用的模板（库里全量，见 utils/collection 的 getApprovalOptions） */
const refTemplateOptions = ref<{ id: string, name: string, status: number }[]>([])

/**
 * 卡片下拉里的候选：**排除当前正在编辑的这张模板**。
 * 自引用在语义上没有意义（自己引用自己 = 无限展开），建单期也会被成环检测拦下 ——
 * 但那种"能选却跑不通"的组合，一开始就不该出现在下拉里。
 */
const refTemplateChoices = computed(() => refTemplateOptions.value.filter(t => t.id !== editId.value))

async function loadRefTemplates() {
  refTemplateOptions.value = await getApprovalOptions()
}

/** 「打开源模板」：**新标签页**打开，当前这张模板未保存的改动不会丢 */
function openRefTemplate(templateId: string) {
  const href = router.resolve({ path: '/createStream', query: { id: templateId } }).href
  window.open(href, '_blank')
}

/**
 * 「展开预览」：弹窗里只读看一眼源模板的流程。
 *
 * 用 id 而不是布尔开关：`RefPreviewDialog` 挂在 `v-if` 上，
 * 换一张卡片就是换一次组件实例，弹窗里的加载状态自然重置，不会串到上一张。
 */
const previewRefId = ref('')

function openRefPreview(templateId: string) {
  previewRefId.value = templateId
}

function closeRefPreview() {
  previewRefId.value = ''
}

/**
 * 「组间轮询」卡片**外面**能跳过去的环节（`{id,label}`）：
 * 卡片的「轮完走向」与卡片内部连线的「提前结束轮询」共用这一份（两处口径必须一致，
 * 一处漏一类节点就会出现"选得下却跑不通"）。
 *
 * 与主画布 exitTargets **同一份口径**（utils/exitTargets）：审批 / 飞书提醒 / **引用模板** /
 * 组间轮询，引用模板那一项用的是**模板名**（卡片名可能被改掉、也可能是空的）。
 * 开始 / 结束 / 条件分支 / 数据查询没有"到达"这一步，不列。
 *
 * 传卡片 id：把**卡片自己**排掉 —— 它不能被自己的「轮完走向 / 提前结束轮询」指向。
 * 所以这里是函数而不是 computed（每张卡片的候选不同）。
 */
function loopCardOuterApprovalsFor (cardId: string) {
  return collectExitTargets(nodes.value, cardId)
}

/** 正在编辑内部流程的卡片（对话框就地改它的 data，随画布快照一起保存） */
const cardDialog = ref(false)
const editingCardId = ref<string | null>(null)
const editingCardData = computed<LoopNodeData | null>(() => {
  const node = nodes.value.find(n => n.id === editingCardId.value)
  return node ? (node.data as LoopNodeData) : null
})

function openCardDialog(id: string) {
  editingCardId.value = id
  cardDialog.value = true
}

/** 关掉后清引用：下次打开的一定是"当前这张"，不会串到上一张卡片的数据 */
function closeCardDialog() {
  cardDialog.value = false
  editingCardId.value = null
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
  // 审批节点与飞书提醒节点共用这套交互（提醒节点里 role = "提醒给该部门负责人"）
  if (!node || (node.type !== 'approval' && node.type !== 'notify')) return
  const members = (node.data?.members ?? []) as ApprovalChainItem[]
  members.push({ type: 'manager', name: '', role: { kind: 'dept_leader', deptFrom: '组别' } })
  node.data = { ...node.data, members }
}

/** 把当前选中员工加入指定审批节点 */
function addMemberTo(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (!node || (node.type !== 'approval' && node.type !== 'notify')) return
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
  // selectedUser.value = null
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
  // 整批换图：同 loadGraph，补一次重量
  remeasureNodes()
}

function graphToFlow(): ReturnType<typeof graphToFlowFrom> {
  return graphToFlowFrom(nodes.value, edges.value, { allowEmptyMembers: true })
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

/**
 * 让 vue-flow **重新量一遍**每个节点的连接点（handle）位置。
 *
 * 为什么必须手动补一次：vue-flow 只在"节点尺寸变化"时自动重量，而我们的图是
 * **分两拍**渲染出来的 —— 先放节点（那会儿还没有连线，卡片上的选项行 / 「→ 结束」标记
 * 都还没画），再放连线（选项行这才出现、卡片变高）。尺寸确实变了，但那次变化与
 * vue-flow 的重量时机挤在同一轮渲染里，结果连线端点停在"卡片变高之前"的位置 ——
 * 表现就是**刚进画布时线是偏的，随手点一下卡片（触发重渲染）才对上**。
 *
 * 所以下面几处"整批换图"的地方都补一次：加载模板 / 重置 / 撤销重做。
 * `nextTick` + `requestAnimationFrame`：等这两帧 DOM 真画出来再量，否则量的还是旧尺寸
 * （与 FlowPreview 里"等一帧再 fitView"同一个理由）。
 */
function remeasureNodes() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      updateNodeInternals(nodes.value.map(n => n.id))
    })
  })
}

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

  const nextNodes = graph.nodes.map(n => ({
    ...n,
    position: { ...n.position },
    data: n.data ? JSON.parse(JSON.stringify(n.data)) : undefined,
  }))
  const nextEdges = (graph.edges ?? []).map(e => ({
    ...e,
    label: e.label ?? '',
    data: e.data ? JSON.parse(JSON.stringify(e.data)) : undefined,
    markerEnd: arrowMarker,
  }))

  // ① 先放节点（旧库可能没有 edges 字段，用 ?? 兜底避免整页崩掉）
  nodes.value = nextNodes
  await nextTick()

  // ② 再放连线：此时 store 里已有上面的节点，不会被 setEdges 判定为「端点不存在」而丢弃
  edges.value = nextEdges
  await nextTick()

  // ③ 兜底：万一仍有连线被丢（时序问题），按 id 补回。
  //    幂等 —— 正常情况下 dropped 为空，不会执行。
  const liveIds = new Set(edges.value.map(e => e.id))
  const dropped = nextEdges.filter(e => !liveIds.has(e.id))
  if (dropped.length > 0) {
    console.warn(`[createStream] 还原画布时有 ${dropped.length} 条连线被 Vue Flow 丢弃，正在补回`)
    edges.value = [...edges.value, ...dropped]
    await nextTick()
  }

  if (graph.viewport) setViewport(graph.viewport)
  // 节点 + 连线都到位了：补一次重量，否则连线停在「卡片变高之前」的位置（见 remeasureNodes）
  remeasureNodes()
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
    await (editId.value
      ? updateApprovalModel(editId.value, {
        name: streamName.value,
        status: Number(status.value),
        chain: payload,
      })
      : addApproval(streamName.value, Number(status.value), payload))
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
  // 引用卡片的源模板候选：与加载画布并行，失败只是下拉为空（不影响编辑）
  loadRefTemplates()
  // 条件面板里「仓库」按钮的候选（同上：拿不到就只剩手动输入）
  loadWarehouseGroups()
})
</script>

<!--
  ⚠️ 这个块**不能**加 `scoped`（下面的 @import 与 vue-flow 的类名强相关）。

  加了会静默坏掉：Sass 先把 @import 的内容内联进来，Vue 再统一加 `[data-v-xxx]`，
  编译成 `.vue-flow__node[data-v-xxx]` —— 而 `.vue-flow__node` / `.vue-flow__pane` /
  `.vue-flow__edge` 落在 **VueFlow 组件内部**的元素上，拿不到本组件的标记
  （只有子组件的**根**元素才继承父组件的标记，所以只剩 `.vue-flow` 那条还生效），
  结果是节点定位、连线图层、连接点尺寸全丢 —— 画布看着一片空白。
  FlowPreview.vue 踩过这个坑（预览整块不显示），修法就是把导入单独放回一个无 scoped 的块。
-->
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

/*
 * 标题旁的「配置选项」按钮：选项树整块在弹出框里（见 EdgeOptionTreeDialog），
 * 所以面板上只留这一个入口 —— 做成蓝色小胶囊，与「审批结果分支」的蓝色主题一致。
 */
.panel-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  padding: 1px 8px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  color: #1d4ed8;
  font-size: 11px;
  line-height: 18px;
  background: #eff6ff;
  cursor: pointer;
}

.panel-btn:hover {
  border-color: #93c5fd;
  background: #dbeafe;
}

.panel-btn__note {
  color: #6b7280;
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
  /*
     * ⚠️ 必须让行内写死的宽度说话。
     *
     * 面板里每个控件的宽度都是**行内**给的（style="width: 108px" / "200px" / "168px" …），
     * 而它们都躺在 .panel-row 这个 flex 容器里 —— flex 项默认 flex-shrink: 1，
     * 于是 width 只被当成 flex-basis（基准尺寸）：**这一行放不下时浏览器会把它压回去**，
     * 表现就是「我把 108px 改成 200px，控件却没变宽」。
     * （.panel-body 的 overflow-y: auto 会让 overflow-x 计算为 auto，
     *   所以这一行不会横向溢出，只会把子控件压缩 —— 症状更容易被误判成"样式没生效"。）
     *
     * flex: none = flex: 0 0 auto：不压缩、也不拉伸，宽度完全由行内 width 决定。
     * 放不下时交给父级的 flex-wrap 换行，而不是把控件缩成一团。
     */
  flex: none;
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

/* 「包含」的每个值：输入框 + 删除按钮成组，整组一起换行 */
.cond-value {
  display: inline-flex;
  align-items: center;
  flex: none;
}

/* 行内版的「加一个值」按钮：默认的 align-self: flex-start + 上边距是给整行按钮用的，
   放进条件行里会与同行的输入框错开，这里改回垂直居中 */
.add-cond-btn--inline {
  margin-top: 0;
  align-self: center;
  padding: 4px 6px;
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
  /* 收起/展开的主运动：栏宽、内边距一起过渡（不能只过渡 flex，见 collapsed 里的 padding: 0） */
  transition:
    flex-basis 0.26s cubic-bezier(0.2, 0.8, 0.2, 1),
    max-width 0.26s cubic-bezier(0.2, 0.8, 0.2, 1),
    padding 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/*
 * 收起：整列收到 **0 宽**，画布拿回全部宽度（此前是缩到 36px 窄栏，仍占着一条）。
 * 内容不在这里隐藏 —— 由模板的 v-show 负责，这样树的展开状态/滚动位置/已选部门都能保住。
 * ⚠️ 这里**不写 overflow: hidden**：OrgTree 内部自带横向滚动（.org-scroll），
 *    父级裁切会让它的滚动区域失效。0 宽盒子本来也不会有可见内容。
 */
.flow-col-left--collapsed {
  flex: 0 0 0 !important;
  max-width: 0 !important;
  /* 内边距必须一起归零：box-sizing 是 border-box，但内边距之和大于指定宽度时
       盒子不会被压到 0（内容盒取 max(0, ...)），仍会撑出 24px 的空白 */
  padding: 0 !important;
}

/* 展开状态：按钮固定在栏目右上角（见下面的收起态另有位置） */
.flow-col-left__toggle {
  position: absolute;
  top: 12px;
  right: 4px;
  z-index: 2;
  /* 展开态在栏内右上角、收起态贴在交界并垂直居中：两个位置之间也要过渡，
       否则按钮会"瞬移"。位置、圆角、底色、阴影一起走，用 all 最省事（本项目已有同样写法） */
  transition: all 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/*
 * 收起后整列 0 宽，按钮改为贴在"栏与画布的交界"上、垂直居中：
 *   · 不占空间就只能浮在画布之上，所以要给它底色 + 描边 + 阴影才看得出是个按钮；
 *   · 不放顶部，是因为那里正好是画布面板的标题行，会压住"编辑审批流"和那几个按钮。
 */
.flow-col-left--collapsed .flow-col-left__toggle {
  top: 50%;
  right: auto;
  left: 0;
  transform: translateY(-50%);
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 3px rgb(15 23 42 / 18%), 0 0 0 1px rgb(var(--v-theme-on-surface) / 8%);
}

/*
 * 收起/展开的内容动效（配合模板里的 <Transition name="org-panel">）。
 *
 * 关键是**时长错开**，而不是各自为政：
 *   · 收：内容 0.12s 快速淡出 + 左移，栏宽 0.26s —— 内容先走完；
 *   · 展：内容延迟 0.16s 再淡入，等栏宽基本就位。
 * 为什么非要错开：栏宽在变的过程中，树里的文字会**逐帧重排**，
 * 那正是"卡顿感"的来源。让内容只在"可见期之外"存在，重排就看不见了。
 */
.org-panel-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.org-panel-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.org-panel-enter-active {
  transition: opacity 0.18s ease 0.16s, transform 0.18s ease 0.16s;
}

.org-panel-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

/* 关掉动效偏好时不做动画（与 index.vue 里那条同一口径） */
@media (prefers-reduced-motion: reduce) {

  .flow-col-left,
  .flow-col-left__toggle,
  .org-panel-leave-active,
  .org-panel-enter-active {
    transition: none !important;
  }
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

  /* 窄屏下"收起"也要真的收起：否则上面那条 100% 会把 0 宽压回去，
       表现就是点了收起、树没了但整屏仍被占着 */
  .flow-col-left--collapsed {
    flex: 0 0 0 !important;
    max-width: 0 !important;
    padding: 0 !important;
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
  /* 与卡片同宽（卡片现在是 300px）。写死 236 是早期卡片的宽度，长文案会被提前截断 */
  max-width: 300px;
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
