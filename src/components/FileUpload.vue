<template>
    <div class="d-flex align-center ga-2">
        <input ref="fileInput" type="file" class="d-none" @change="onFileSelected">
        <v-btn size="small" variant="text" color="primary" class="text-none pa-0" prepend-icon="mdi-link-variant"
            @click="fileInput?.click()">
            上传附件
        </v-btn>
        <span v-if="fileName" class="text-caption text-grey text-truncate text-[13px] text-decoration-underline">
            {{ fileName }}
            <v-btn variant="text" @click="fileName = ''" icon size="20px" class="ml-2">
                <v-icon class="text-grey" size="15px">mdi-close</v-icon>
            </v-btn>
        </span>
    </div>
</template>

<script lang="ts" setup>
const fileInput = ref<HTMLInputElement>()
const fileName = ref('')

// function calculateTime(time){
//     const now=new Date()
//     const diff=now.getTime()-time.getTime()
//     return diff
// }

function onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement
    fileName.value = input.files?.[0]?.name ?? ''
    // TODO: 上传附件
}


onMounted(() => {
})
</script>

<style scoped>
</style>