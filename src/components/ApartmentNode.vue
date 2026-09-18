<template>
    <v-sheet class="pa-2 rounded" color="grey-lighten-4" style="max-height: 320px; overflow-y: auto;">
        <v-skeleton-loader v-if="treeLoading" type="list-item-two-line@4" />
        <v-alert v-else-if="treeError" type="error" density="compact" class="ma-2">
            {{ treeError }}
        </v-alert>
        <!-- 不设 open-all：树默认收起，点击部门再展开，减少 DOM 数量 -->
        <v-treeview v-else-if="treeItems.length" :items="treeItems" :hide-actions="true" indent-lines density="compact"
            item-value="id" activatable open-on-click color="#E8F0FE" active-class="tree-active-item"
            v-model:activated="activated" @update:activated="onActivated">
            <template v-slot:title="{ item }">
                <template v-if="item.type === 'dept'">
                    <span class="text-[13px] font-weight-medium">{{ item.title }}</span>
                    <span class="text-[12px] text-grey ml-1">({{ item.member_count }}人)</span>
                </template>
                <template v-else>
                    <span class="text-[13px]">{{ item.title }}</span>
                    <v-chip v-if="item.is_tenant_manager" size="x-small" color="error" variant="tonal"
                        class="ml-1">管理员</v-chip>
                    <v-chip v-if="item.is_leader" size="x-small" color="warning" variant="tonal"
                        class="ml-1">负责人</v-chip>
                </template>
            </template>
            <template v-slot:prepend="{ item, isOpen }">
                <v-icon v-if="item.type === 'dept'" size="20" color="#1055C9">
                    {{ item.has_child ? (isOpen ? 'mdi-layers-outline' : 'mdi-layers') :
                        'mdi-account-group' }}
                </v-icon>
                <v-avatar v-else size="24">
                    <v-img v-if="item.avatar" :src="item.avatar" cover />
                    <v-icon v-else size="12">mdi-account</v-icon>
                </v-avatar>
            </template>
        </v-treeview>
        <v-alert v-else type="info" variant="tonal" class="ma-2">暂无组织架构数据</v-alert>
    </v-sheet>
</template>
<script setup lang="ts">
interface TreeItem {
    id: string
    type: 'dept' | 'user'
    title: string
    subtitle?: string
    avatar?: string
    member_count?: number
    has_child?: boolean
    is_tenant_manager?: boolean
    is_leader?: boolean
    children?: TreeItem[]
}
const props = defineProps({
    treeItems: {
        type: Array,
        default: () => [],
    },
    treeLoading: {
        type: Boolean,
        default: false,
    },
    treeError: {
        type: String,
        default: '',
    },
    activated: {
        type: Array,
        default: () => [],
    },
})

const emit = defineEmits(['update:activated']);

const onActivated = (activated: any[]) => {
    emit('update:activated', activated);
};
</script>