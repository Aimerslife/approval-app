<template>
  <v-container class="quick-nav fill-height d-flex flex-column justify-center" max-width="1040">
    <div class="w-100">
      <!-- 顶部品牌区：限宽居中，避免 logo 随容器被拉满整行 -->
      <v-img alt="logo" class="mx-auto mb-3" height="96" max-width="240" src="@/assets/logo.png" />

      <div class="mb-10 text-center">
        <div class="text-[26px] font-weight-bold">快速导航</div>
      </div>

      <!--
        快速导航卡片。样式要点都在下面 scoped 样式里，**不依赖 Vuetify 内部类名**
        （只用自己的 .nav-card / .nav-arrow 等 class）：
          · 响应式：手机上单列、≥sm 两列 —— 原来固定 cols="6"，窄屏会挤成两列很窄的卡；
          · hover 上浮 + 阴影 + 主色描边，箭头右移，给出"可以点进去"的暗示；
          · height:100% 让同一行的卡片等高，避免标题长短不一造成参差。
      -->
      <v-row>
        <v-col v-for="link in links" :key="link.href" cols="12" sm="6">
          <v-card
            class="nav-card"
            :href="link.href"
            rel="noopener noreferrer"
            rounded="lg"
            :subtitle="link.subtitle"
            :title="link.title"
            variant="flat"
          >
            <template #prepend>
              <v-avatar class="nav-avatar ml-2 mr-1" color="primary" :icon="link.icon" size="44" variant="tonal" />
            </template>

            <v-card-actions class="justify-end px-4 pb-3 pt-0">
              <v-icon class="nav-arrow" color="primary" icon="mdi-arrow-right" size="18" />
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>

<script setup lang="ts">
  const links = [
    {
      href: '/home',
      icon: 'mdi-text-box-outline',
      subtitle: 'Learn about all things Vuetify in our documentation.',
      title: '我的任务',
    },
    {
      href: '/roleSetting',
      icon: 'mdi-star-circle-outline',
      subtitle: 'Explore available framework Features.',
      title: '个人信息',
    },
    {
      href: '/history',
      icon: 'mdi-widgets-outline',
      subtitle: 'Discover components in the API Explorer.',
      title: '历史数据',
    },
    {
      href: '/help',
      icon: 'mdi-account-group-outline',
      subtitle: 'Connect with Vuetify developers.',
      title: '说明文档',
    },
  ]
</script>

<style lang="scss" scoped>
/*
 * 卡片边框/hover 用 Vuetify 主题变量（rgba(var(--v-theme-xxx), α)），
 * 这样浅色/深色主题都会自动跟着变，不写死颜色。
 */
.quick-nav {
  .nav-card {
    height: 100%;
    border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .nav-card:hover {
    transform: translateY(-3px);
    border-color: rgba(var(--v-theme-primary), 0.35);
    /* 阴影用固定值：主题变量里没有合适的阴影色 */
    box-shadow: 0 12px 26px rgb(0 0 0 / 12%);
  }

  .nav-arrow,
  .nav-avatar {
    transition: transform 0.18s ease;
  }

  /* 箭头右移 + 头像微放大：不用改布局，纯粹是"可进入"的提示 */
  .nav-card:hover .nav-arrow {
    transform: translateX(4px);
  }

  .nav-card:hover .nav-avatar {
    transform: scale(1.05);
  }
}

/* 用户关掉动效偏好时不做位移（无障碍；也让截图/打印时稳定） */
@media (prefers-reduced-motion: reduce) {
  .quick-nav .nav-card,
  .quick-nav .nav-arrow,
  .quick-nav .nav-avatar {
    transition: none;
  }

  .quick-nav .nav-card:hover,
  .quick-nav .nav-card:hover .nav-arrow,
  .quick-nav .nav-card:hover .nav-avatar {
    transform: none;
  }
}
</style>
