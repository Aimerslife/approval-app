<template>
  <div
    class="sticky top-[30px] z-1000 p-5 h-[50px] d-flex justify-between w-full align-center gap-2"
    :class="{ 'tabs-scrolled': scrolled }"
    style="background-color: rgb(var(--v-theme-surface))"
  >
    <span class="text-[12px] text-[#727272]">最后更新：{{ formatDate(data.updated) }}</span>

    <div>
      <v-icon-btn variant="text" @click="goEdit">
        <v-icon color="#727272">mdi-file-edit-outline</v-icon>
      </v-icon-btn>

      <v-btn size="small" variant="tonal" @click="open = true">
        <span class="text-[12px] text-[#727272]">审批流程</span>
      </v-btn>
    </div>
  </div>

  <v-container class="pt--35px">
    <v-row>
      <v-md-preview :text="data.content" />
    </v-row>

    <v-navigation-drawer v-model="open" location="right" permanent :width="ifExpand?width:750">
      <div
        class="d-flex justify-between align-center sticky top-[0px] z-800 w-full"
        style="background-color: rgb(var(--v-theme-surface))"
      >
        <v-icon-btn color="#727272" size="40" variant="text" @click="expand">
          <v-icon size="20">{{ ifExpand ? 'mdi-unfold-less-vertical' : 'mdi-unfold-more-vertical' }}</v-icon>
        </v-icon-btn>

        <span class="text-[13px]">审批流程</span>

        <v-icon-btn color="#727272" size="40" variant="text" @click="open = false">
          <v-icon size="15">mdi-close</v-icon>
        </v-icon-btn>
      </div>

      <v-divider />

      <v-container>
        <StreamPanel />
      </v-container>
    </v-navigation-drawer>
  </v-container>
</template>
<script setup lang="ts">
  import { useWindowSize } from '@vueuse/core'
  import StreamPanel from '@/components/StreamPanel.vue'
  import { drawerSet } from '@/composables/useEditorFullscreen'
  import { type DocumentModel, getDocument } from '@/utils/collection'
  import { formatDate } from '@/utils/utils'
  const scrolled = ref(false)
  function onScroll () {
    // 向上滚动（scrollTop > 0）时显示阴影
    scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
  }
  const { width } = useWindowSize()
  const open = ref(false)
  const data = ref<DocumentModel>({} as DocumentModel)
  const router = useRouter()
  const aWidth = ref(750)
  const ifExpand = ref(false)
  function goEdit () {
    router.push({
      path: '/editRule',
      query: {
        id: data.value.id,
      },
    })
  }
  function expand () {
    ifExpand.value = !ifExpand.value
    drawerSet.value = !drawerSet.value
    aWidth.value = aWidth.value === 750 ? 1000 : 750
    console.log(width.value)
  }
  async function getDates () {
    const dates = await getDocument()
    if (dates) {
      data.value = dates
    }
    console.log(dates)
  }
  onMounted(() => {
    getDates()
    window.addEventListener('scroll', onScroll, { passive: true })
  })
  onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style lang="scss" scoped>
.v-navigation-drawer {
  :deep(.v-navigation-drawer__content) {
    scrollbar-width: none;          /* Firefox */
    -ms-overflow-style: none;       /* IE/Edge */
    &::-webkit-scrollbar {
      display: none;                /* Chrome/Safari */
    }
  }
}

.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
