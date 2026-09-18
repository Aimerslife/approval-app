<template>
  <div class="d-flex align-center ga-2">
    <input ref="fileInput" class="d-none" type="file" @change="onFileSelected">

    <v-btn
      class="text-none pa-0"
      color="primary"
      prepend-icon="mdi-link-variant"
      size="small"
      variant="text"
      @click="fileInput?.click()"
    >
      上传附件
    </v-btn>

    <span v-if="fileName" class="text-caption text-grey text-truncate text-[13px] text-decoration-underline">
      {{ fileName }}
      <v-btn
        class="ml-2"
        icon
        size="20px"
        variant="text"
        @click="fileName = ''"
      >
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

  function onFileSelected (event: Event) {
    const input = event.target as HTMLInputElement
    fileName.value = input.files?.[0]?.name ?? ''
    // TODO: 上传附件
  }

  onMounted(() => {})
</script>

<style scoped>
</style>
