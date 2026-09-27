<template>
  <v-avatar :class="['user-avatar', { 'user-avatar--interactive': interactive }]" 
    :color="showImage ? undefined : 'primary'" :size="size" :title="name" :variant="showImage ? undefined : 'tonal'">

    <v-img v-if="showImage" :alt="name" :src="avatarUrl" @error="failed = true" />
    <span v-else-if="hasUser" class="user-avatar__initial" :style="{ fontSize: `${initialSize}px` }">{{ initial
      }}</span>

    <v-icon v-else icon="mdi-account" :size="iconSize" />
  </v-avatar>
      
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useUserStore } from '@/stores/user'

/**
 * 个人头像（顶栏菜单锚点、菜单内、设置页共用）。
 *
 * 为什么抽成组件：这三处此前各写一份、而且已经漂了 ——
 *   · 设置页直接读 `user.avatar_url`，绕过了 utils/avatar 的 resolveAvatar 兜底，
 *     库里只存了路径时那边会拿到一个拼不出来的地址；
 *   · 顶栏下拉里那份没有任何兜底，没图就是一个空圈；
 *   · 顶栏锚点用的是写死的 #2196F3（不是主题主色，深浅色也不跟随）。
 *
 * 三个兜底口径：
 *   1. **URL 统一走 userStore.avatar**（已在 store 里过了一遍 resolveAvatar）；
 *   2. **加载失败退回首字** —— 这不是假想情况：飞书头像 URL 带签名，
 *      库里只存路径时拼出来的地址通常 403，那时 v-img 什么都不画；
 *   3. **换账号/换 URL 后重新给图片一次机会**，否则"上一张挂了"会让新头像永远显示首字。
 */
const props = withDefaults(defineProps<{
  /** 直径（px），字号会跟着它按比例走 */
  size?: number
  /** 可点击时给指针与悬停反馈（顶栏那个是 v-menu 的锚点） */
  interactive?: boolean
}>(), {
  size: 40,
  interactive: false,
})

const userStore = useUserStore()

const avatarUrl = computed(() => userStore.avatar)
const name = computed(() => userStore.displayName || '未登录')
/** 有没有"人"可显示：未登录时 store 的 displayName 是「未登录」，取首字会变成个"未"字头像 */
const hasUser = computed(() => userStore.isLoggedIn)

const failed = ref(false)
watch(avatarUrl, () => {
  failed.value = false
})
const showImage = computed(() => hasUser.value && !!avatarUrl.value && !failed.value)

/** 姓名首字：中文取第一个字（「张三」→「张」），英文取首字母并大写 */
const initial = computed(() => {
  const n = name.value.trim()
  return n ? n.slice(0, 1).toUpperCase() : '?'
})
/** 比例跟着直径走，避免"大头像配小字" */
const initialSize = computed(() => Math.round(props.size * 0.42))
const iconSize = computed(() => Math.round(props.size * 0.62))
</script>

<style scoped>
/*
 * 描边用 box-shadow 而不是 border：v-avatar 是固定宽高 + 居中，
 * 加 border 会占掉直径，不同尺寸下图形被挤小的比例还不一样。
 * 内圈用 surface 色（把头像从背景里隔出来），外圈再极淡地描一下边。
 */
.user-avatar {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-surface)), 0 0 0 3px rgb(var(--v-theme-on-surface) / 10%);
}

/* 首字压在 tonal 底色上（主色 12%），用主色字深浅色都可读 */
.user-avatar__initial {
  font-weight: 600;
  line-height: 1;
  color: rgb(var(--v-theme-primary));
}

.user-avatar--interactive {
  cursor: pointer;
  transition: box-shadow 0.14s ease;
}

.user-avatar--interactive:hover {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-surface)), 0 0 0 4px rgb(var(--v-theme-primary) / 45%);
}

.button-27 {
  position: relative;
  /* padding: 1px; */
  background: linear-gradient(0deg, #fcfcfc 0%, #f5f5f5 100%);
  border: 6px solid transparent;
  border-radius: 30px;
  background-clip: padding-box;
  box-shadow: 0 1px 1px 0 rgba(0, 0, 0, 0.2), 0 1px 4px 0 rgba(0, 0, 0, 0.5), 1px 3px 3px 2px #fff, 0 0 0 6px #ECECEC;
  font-family: "Inter", sans-serif;
  font-size: 18px;
  line-height: 1;
  transition: border 0.1s ease-in-out, padding 0.1s ease-in-out, margin 0.1s ease-in-out;
}

/* .button-27:after {
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: -6px;
  right: -6px;
  background: linear-gradient(#fff, #ededed);
  content: "";
  z-index: -1;
  border-radius: 16px;
} */

.button-27:hover {
  border: 0px solid transparent;
  background-image: linear-gradient(180deg, #E6E6E6 0%, #F7F7F7 100%);
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.35), 0 0 0 6px #ECECEC;
  padding: 2px;
}

.button-27:active {
  border-top: 1px solid transparent;
}
</style>
