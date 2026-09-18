<template>
    <v-container fluid class="p-8">
        <v-sheet class="d-flex align-center gap-1 mb-3">
            <v-icon-btn @click="$router.back()" size="20">
                <v-icon size="20">mdi-chevron-left</v-icon>
            </v-icon-btn>
            <span class="text-[13px]">审批流程修订</span>
        </v-sheet>
        <v-sheet class="z-1000">
            <v-md-editor v-model="content" height="87vh" :include-level="[3, 4]" @save="onSave"
                @fullscreen-change="hanldeFullScreenChange"></v-md-editor>
        </v-sheet>
        <v-layout min-height="100">
            <v-snackbar v-model="loading" :timeout="-1" text="保存中" contained loading></v-snackbar>
            <v-snackbar v-model="success" :timeout="2000" color="success" prepend-icon="$complete"
                text="已保存!" contained></v-snackbar>
        </v-layout>
    </v-container>
</template>
<script setup lang="ts">
import { getDocumentByOne, saveDocument, type DocumentModel } from '@/utils/collection'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
const route = useRoute()
const data = ref<DocumentModel>({} as DocumentModel)
const loading = ref(false)
const success = ref(false)
const content = ref('')
async function onSave(text: string, html: string) {
    loading.value = true
    success.value = false
    await saveDocument(text, data.value.id, data.value.published)
    loading.value = false
    success.value = true

}
async function getDates(id: string) {
    const dates = await getDocumentByOne(id)
    if (dates) {
        data.value = dates
        content.value = data.value.content
    }
    console.log(dates)
}
function hanldeFullScreenChange(isFullscreen: boolean) {
    isEditorFullscreen.value = isFullscreen
}
onMounted(async () => {
    const id = route.query.id as string
    if (id) {
        await getDates(id)
    }
})
</script>