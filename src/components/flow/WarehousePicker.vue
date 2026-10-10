<template>
  <v-menu :close-on-content-click="false" location="bottom start" offset="6">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        class="wp-btn"
        title="从维护好的仓库清单里选：点分类 = 整组一起填；点单个 = 追加进这条条件"
        type="button"
      >
        <v-icon size="11">mdi-warehouse</v-icon>
        <span>仓库</span>
      </button>
    </template>

    <v-sheet class="wp-menu" rounded="lg" style="min-width: 248px">
      <div class="wp-head">
        点<b>分类</b> = 整组一起填（命中任一）；点<b>单个</b> = 追加进这条条件
      </div>

      <div v-if="groups.length === 0" class="wp-empty">
        仓库清单还是空的 —— 去「角色设置 → 仓库设置」里维护一份
      </div>

      <div v-for="g in groups" :key="g.parent" class="wp-group">
        <button class="wp-group-btn" type="button" @click="emit('pick-group', [...g.names])">
          <v-icon size="12">mdi-folder-outline</v-icon>
          <span class="wp-group-name">{{ g.parent }}</span>
          <span class="wp-count">{{ g.names.length }}</span>
        </button>

        <div class="wp-children">
          <button
            v-for="n in g.names"
            :key="n"
            class="wp-item"
            :class="{ 'is-on': isOn(n) }"
            :title="isOn(n) ? '这条条件里已经有了' : '追加进这条条件'"
            type="button"
            @click="emit('pick-one', n)"
          >
            {{ n }}
          </button>
        </div>
      </div>
    </v-sheet>
  </v-menu>
</template>

<script lang="ts" setup>
  // 「去空白后再比」的口径与仓库清单共用一份（人工维护的名字常带多余空格）
  import { sameWarehouseName } from '@/utils/warehouse'

  /**
   * 「仓库」候选选择器（条件值侧）。
   *
   * 候选来自**维护好的仓库清单**（「角色设置 → 仓库设置」，见 utils/warehouse 的文件头），
   * 按「上级分类 → 仓库名」两级展示 —— 于是"本地仓"这一类可以**一次把它的全部子仓库**
   * 写进同一条条件（用户的实际诉求：选「本地仓」= 本地仓 / 广州仓 / 中山仓 / 代发仓）。
   *
   * 为什么用「分类 → 子项」而不是一长串平铺：这些仓库名在数据列「仓位」里是**同一列的不同取值**，
   * 逐个勾很容易漏（漏一个就少命中一批数据），而"整组一起填"是业务上最常见的写法。
   *
   * 组件**不碰数据**：只把选择结果 emit 出去，怎么写到条件上由调用方（createStream 的右侧面板）决定。
   */
  const props = defineProps<{
    /** 候选：[{ parent: '本地仓', names: ['本地仓','广州仓','中山仓','代发仓'] }, …] */
    groups: Array<{ parent: string, names: string[] }>
    /**
     * 这条条件里**已经有的值**（高亮用）。
     * ⚠️ 传的是只读派生的字符串数组，不要直接传 `conditionValues(c)` ——
     * 那个函数会把单值**就地**改成数组（渲染期产生副作用）。
     */
    selected?: string[]
  }>()

  const emit = defineEmits<{
    /** 点了分类：整组一起写（参数是这一类的全部仓库名，已拷贝，调用方可以放心存） */
    'pick-group': [names: string[]]
    /** 点了单个仓库：追加进这条条件 */
    'pick-one': [name: string]
  }>()

  function isOn (name: string): boolean {
    return (props.selected ?? []).some(v => sameWarehouseName(v, name))
  }
</script>

<style scoped>
/* 触发器：与右侧面板那排小按钮（.add-cond-btn）同款观感（虚线框 + 11px 字） */
.wp-btn {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 3px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--flow-text-sub);
  background: transparent;
  border: 1px dashed var(--flow-border-strong);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wp-btn:hover {
  color: var(--flow-handle-active);
  background: var(--flow-surface-hover);
  border-color: var(--flow-blue-border);
}

.wp-menu {
  max-height: 380px;
  padding: 8px 6px;
  overflow-y: auto;
}

.wp-head {
  padding: 2px 8px 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--flow-text-muted);
  border-bottom: 1px solid var(--flow-border);
}

.wp-empty {
  padding: 10px 8px;
  font-size: 11px;
  color: var(--flow-text-muted);
}

.wp-group {
  padding: 4px 4px 2px;
}

/* 分类整组：一行，点它就把这一类全部子仓库写进条件 */
.wp-group-btn {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 5px;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--flow-text);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.wp-group-btn:hover {
  background: var(--flow-surface-hover);
}

.wp-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 子仓库个数：让"整组会填进去几条"一眼可见 */
.wp-count {
  flex: none;
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  color: var(--flow-text-sub);
  background: var(--flow-input-bg);
  border-radius: 8px;
}

/* 子仓库：小胶囊，已选的标出来（避免重复点、也一眼看清这条条件里有什么） */
.wp-children {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 6px 4px 24px;
}

.wp-item {
  padding: 2px 7px;
  font-size: 11px;
  color: var(--flow-input-text);
  background: var(--flow-input-bg);
  border: 1px solid var(--flow-input-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.wp-item:hover {
  color: var(--flow-handle-active);
  border-color: var(--flow-blue-border);
}

.wp-item.is-on {
  color: var(--flow-handle-active);
  background: rgb(37 99 235 / 8%);
  border-color: var(--flow-blue-border);
}
</style>
