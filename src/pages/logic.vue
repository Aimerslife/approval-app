<template>
  <div
    class="sticky top-[30px] z-1000 p-5 h-[50px] d-flex justify-between w-full align-center gap-2"
    :class="{ 'tabs-scrolled': scrolled }"
    style="background-color: rgb(var(--v-theme-surface))"
  >
    <div>
      <v-icon-btn size="20" @click="$router.back()">
        <v-icon size="20">mdi-chevron-left</v-icon>
      </v-icon-btn>

      <span class="text-[12px] text-[#727272] ml-1">最后更新：{{ formatDate(data.updated) }}</span>
    </div>

    <div>
      <v-icon-btn variant="text" @click="goEdit">
        <v-icon color="#727272">mdi-file-edit-outline</v-icon>
      </v-icon-btn>
    </div>
  </div>

  <v-container class="pt--35px">
    <v-row v-if="data.id">
      <v-md-preview :text="data.content" />
    </v-row>

    <div v-else class="m-2 text-[12px] text-[#8D8D8D]">
      {{ unpublished
        ? '这篇文档还没有发布：发布后才会在前端显示（编辑页仍可打开继续改）'
        : '没有找到这篇文档（可能已被删除，或者链接里的 id 不对）' }}
    </div>
  </v-container>
</template>
<script setup lang="ts">
  import { type DocumentModel, getDocument, getDocumentByOne } from '@/utils/collection'
  import { formatDate } from '@/utils/utils'
  const scrolled = ref(false)
  function onScroll () {
    // 向上滚动（scrollTop > 0）时显示阴影
    scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
  }
  const data = ref<DocumentModel>({} as DocumentModel)
  const router = useRouter()
  const route = useRoute()

  function goEdit () {
    router.push({
      path: '/editRule',
      query: {
        id: data.value.id,
      },
    })
  }

  /** 打开的是一篇**还没发布**的文档（直接拿 id 访问）：按"0 状态不在前端显示"的口径只给提示 */
  const unpublished = ref(false)

  async function getDates () {
    const id = String(route.query.id ?? '').trim()
    const one = id ? await getDocumentByOne(id) : undefined
    const first = id ? undefined : (await getDocument())[0]
    /*
     * 未发布 = `status !== 1`（口径与列表页的 `status = 1` 完全一致 ——
     * 不然会出现"列表里没有、直接开链接却看得到"这种半公开的怪状态）。
     */
    unpublished.value = !!one && Number(one.status ?? 0) !== 1
    data.value = (unpublished.value ? undefined : one) ?? first ?? ({} as DocumentModel)
    if (id && !one) {
      console.warn('[logic] 没有找到 id 对应的文档:', id)
    }
  }

  // 换 id 就重新读（同一个页面组件内跳转不会重新挂载）
  watch(() => route.query.id, () => {
    void getDates()
  })

  onMounted(() => {
    getDates()
    window.addEventListener('scroll', onScroll, { passive: true })
  })
  onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style lang="scss" scoped>
.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
