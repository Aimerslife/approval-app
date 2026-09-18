<template>
  <v-container class="p-8" fluid>
    <v-sheet class="d-flex align-center gap-1 mb-3">
      <v-icon-btn size="20" @click="$router.back()">
        <v-icon size="20">mdi-chevron-left</v-icon>
      </v-icon-btn>

      <span class="text-[13px]">审批流程修订</span>
    </v-sheet>

    <v-sheet class="z-1000">
      <v-md-editor
        v-model="content"
        height="87vh"
        :include-level="[3, 4]"
        @fullscreen-change="hanldeFullScreenChange"
        @save="onSave"
      />
    </v-sheet>

    <v-layout min-height="100">
      <v-snackbar
        v-model="loading"
        contained
        loading
        text="保存中"
        :timeout="-1"
      />

      <v-snackbar
        v-model="success"
        color="success"
        contained
        prepend-icon="$complete"
        text="已保存!"
        :timeout="2000"
      />
    </v-layout>
  </v-container>
</template>
<script setup lang="ts">
  import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
  import { type DocumentModel, getDocumentByOne, saveDocument } from '@/utils/collection'
  const route = useRoute()
  const data = ref<DocumentModel>({} as DocumentModel)
  const loading = ref(false)
  const success = ref(false)
  const content = ref('')
  async function onSave (text: string, html: string) {
    loading.value = true
    success.value = false
    await saveDocument(text, data.value.id, data.value.published)
    loading.value = false
    success.value = true
  }
  async function getDates (id: string) {
    const dates = await getDocumentByOne(id)
    if (dates) {
      data.value = dates
      content.value = data.value.content
    }
    console.log(dates)
  }
  function hanldeFullScreenChange (isFullscreen: boolean) {
    isEditorFullscreen.value = isFullscreen
  }
  onMounted(async () => {
    const id = route.query.id as string
    if (id) {
      await getDates(id)
    }
  })
</script>
