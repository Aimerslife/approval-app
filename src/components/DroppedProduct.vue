<template>
    <v-sheet class="mt-2 pa-2 px-3 bg-[#F5F8FF] rounded-[10px] drop-product-sheet">
        <!-- 单字段 -->
        <div v-if="item.type === 'field' && item.field" class="d-flex align-center ga-2 min-w-0">
            <v-icon size="16" color="primary">mdi-information-outline</v-icon>
            <span class="text-[12px] text-grey-darken-1 shrink-0">{{ item.field.title }}</span>
            <span class="text-[13px] font-weight-medium text-truncate" :title="item.field.value">
                {{ item.field.value }}
            </span>
            <v-spacer></v-spacer>
            <v-btn variant="plain" density="compact" size="x-small" icon="mdi-close"
                @click="emit('remove')"></v-btn>
        </div>

        <!-- 整组 -->
        <template v-else-if="item.type === 'group' && item.group">
            <div class="d-flex align-center ga-2 mb-1">
                <v-icon size="16" color="primary">{{ item.group.icon }}</v-icon>
                <span class="text-[13px] font-weight-bold">{{ item.group.label }}</span>
                <v-spacer></v-spacer>
                <v-btn variant="plain" density="compact" size="x-small" icon="mdi-close"
                    @click="emit('remove')"></v-btn>
            </div>
            <div class="d-flex flex-wrap ga-1">
                <v-chip v-for="f in item.group.fields" :key="f.key" size="x-small" variant="tonal"
                    color="primary">
                    {{ f.title }}：{{ f.value }}
                </v-chip>
            </div>
        </template>
    </v-sheet>
</template>

<script setup lang="ts">
import type { DroppedItem } from '@/types/drop'

const props = defineProps<{ item: DroppedItem }>()
const emit = defineEmits<{ remove: [] }>()
</script>

<style scoped lang="scss">
.drop-product-sheet {
    border: 1px dashed rgba(var(--v-theme-primary), 0.45);
}
</style>
