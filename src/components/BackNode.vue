<template>
    <v-sheet class="d-flex align-center gap-1 mb-3" style="background-color: rgb(var(--v-theme-surface))">
        <v-icon-btn @click="$router.back()" size="20">
            <v-icon size="20" :icon="props.icon"></v-icon>
        </v-icon-btn>
        <span class="text-[13px]">{{ props.title }}</span>
    </v-sheet>
</template>
<script lang="ts" setup>
const props = withDefaults(defineProps<{
    icon?: string
    title?: string
}>(), {
    icon: 'mdi-arrow-left',
    title: '回到首页',
})
</script>
<style scoped lang="scss"></style>