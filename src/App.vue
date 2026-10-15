<template>
  <v-app>
    <template v-if="!isPublic">
      <v-system-bar v-show="!isEditorFullscreen" class="!fixed top-0 left-0 app-titlebar px-2" color="#1055C9" window>
        <!-- 左侧：菜单 + 品牌 -->
        <div class="d-flex align-center ga-1">
          <v-icon-btn size="24" title="切换侧边栏" variant="text" @click="setDrawer">
            <v-icon size="16">mdi-menu</v-icon>
          </v-icon-btn>

          <span
            class="brand-name text-[14px] font-bold cursor-pointer"
            @click="routerGo('/')">🆈🅰🅽🆇🆄🅽</span>
          <!--
            「Collection」= 打开 PocketBase 自带后台（数据浏览 / 集合管理），**新标签页**打开：
            后台是一整套独立界面，在本页里跳过去会把当前页面的状态丢掉。
            地址与代理见 src/pocketbase.ts 的 PB_ADMIN_URL（后台与数据 API 是同一个 PB 实例）。

            **只给超级管理员看**（canOpenPbAdmin 走 utils/permissions 的动作表，不在这里写角色比较）：
            后台能直接浏览 / 修改所有集合（users、审批单、BI 镜像都在里面），
            所以这个入口比"清空 BI 数据"还宽 —— 管理员及以上都能用的功能不该包含它。
          -->
          <div
            v-if="canOpenPbAdmin"
            class="brand-name font-bold cursor-pointer"
            title="打开 PocketBase 后台（Collection）"
            @click="openPbAdmin"
          >
            Collection
            <v-icon color="#ffffff" size="18">mdi-database-outline</v-icon>
          </div>
        </div>

        <v-spacer />
        <!-- 右侧：设置 / 主题 + 窗口控制 -->
        <div class="d-flex align-center ga-1">
           <v-icon-btn size="24" title="提醒设置" variant="text" @click="routerGo('/alarmSetting')">
            <v-icon size="15">mdi-alarm-check</v-icon>
          </v-icon-btn>
          <v-icon-btn size="24" title="审批说明" variant="text" @click="routerGo('/knowledge')">
            <v-icon size="15">mdi-book-open-variant</v-icon>
          </v-icon-btn>

          <v-icon-btn size="24" title="设置" variant="text" @click="routerGo('/userSetting')">
            <v-icon size="15">mdi-cog-outline</v-icon>
          </v-icon-btn>

          <v-icon-btn
            size="24"
            :title="theme.global.name.value === 'light' ? '切换到深色' : '切换到浅色'"
            variant="text"
            @click="onClick"
          >
            <v-icon size="15">{{ theme.global.name.value === 'light' ? 'mdi-white-balance-sunny' : 'mdi-weather-night'
            }}</v-icon>
          </v-icon-btn>

          <v-divider class="win-divider mx-1" vertical />

          <v-icon-btn size="24" variant="text">
            <v-icon size="13">mdi-square</v-icon>
          </v-icon-btn>

          <v-icon-btn size="24" variant="text">
            <v-icon size="13">mdi-circle</v-icon>
          </v-icon-btn>

          <v-icon-btn size="24" variant="text">
            <v-icon size="13">mdi-triangle</v-icon>
          </v-icon-btn>
        </div>
      </v-system-bar>

      <v-navigation-drawer v-show="!isEditorFullscreen" v-model="drawer" class="!fixed top-24" width="240">
        <v-sheet class="pa-4">
          <div class="relative">
            <!-- v-menu 必须由 #activator 提供锚点元素，否则 location / offset 全部失效，菜单会飘在默认位置。
                 这里把 v-avatar 作为锚点，菜单就会定位在头像正下方。 -->
            <v-menu
              v-model="menu"
              class="rounded-[15px]"
              :close-on-content-click="false"
              :disabled="!userStore.isLoggedIn"
              location="top right"
              :offset="[-50, -60]"
            >
              <template #activator="{ props }">
                <!-- 菜单锚点必须是真实元素（见上面的说明），所以这里把头像本身当锚点。
                     v-bind="props" 照旧：菜单的定位/键盘交互都靠它。 -->
                <UserAvatar
                  class="mb-2"
                  interactive
                  :size="50"
                  v-bind="props"
                />
              </template>

              <v-card min-width="200">
                <v-list>
                  <v-list-item>
                    <template #prepend>
                      <UserAvatar :size="40" />

                      <div class="d-flex flex-column ml-3">
                        <span class="text-[14px]">{{ userStore.displayName }}</span>

                        <div class="d-flex items-center gap-1">
                          <span class="text-[12px]">广州延迅科技有限公司</span>
                          <v-icon color="#1055C9" size="15">mdi-check-decagram</v-icon>
                        </div>
                      </div>
                    </template>

                    <template #append />
                  </v-list-item>
                </v-list>

                <v-divider />

                <v-list>
                  <v-list-item>
                    <div class="d-flex items-center gap-2 hover:bg-[#F2F2F2] rounded-[5px] p-2 cursor-pointer">
                      <v-icon size="18">mdi-account</v-icon>
                      <span class="text-[12px]">个人信息</span>
                    </div>
                  </v-list-item>

                  <v-list-item>
                    <div class="d-flex items-center gap-2 hover:bg-[#F2F2F2] rounded-[5px] p-2 cursor-pointer">
                      <v-icon size="18">mdi-bell</v-icon>
                      <span class="text-[12px]">我的任务</span>
                    </div>
                  </v-list-item>

                  <v-list-item @click="handleLogout">
                    <div class="d-flex items-center gap-2 hover:bg-[#F2F2F2] rounded-[5px] p-2 cursor-pointer">
                      <v-icon size="18">mdi-logout</v-icon>
                      <span class="text-[12px]">退出登录</span>
                    </div>
                  </v-list-item>
                </v-list>
              </v-card>
            </v-menu>

            <div class="absolute top-8 left-8  p-0.3 d-flex justify-center items-center rounded-full w-[20px]">
              <v-img height="15" :src="logo" />
            </div>
          </div>

          <div class="text-[14px] ml-2 d-flex flex-column">
            <div v-if="userStore.isLoggedIn">
              <span class="text-[#4F4F4F] text-[12px] font-bold">{{ userStore.displayName }}</span>
              <span class="text-[#8B8B8B] text-[12px]">{{ userStore.user?.email }}</span>
            </div>
          </div>
        </v-sheet>

        <v-divider />

        <v-list nav>
          <v-list-item
            v-for="(item, index) in links"
            :key="item.icon"
            active-class="text-[#3378FF]"
            link
            rounded="15px"
            :to="item.to"
          >
            <template #prepend>
              <v-icon :icon="item.icon" size="20" />
              <v-badge
                v-if="item.to === '/mine' && pending.count > 0"
                bordered
                color="error"
                :content="pending.count > 99 ? '99+' : String(pending.count)"
                location="top right"
                :offset-x="-100"
                :offset-y="-10"
              />
            </template>

            <v-list-item-title class="text-[12px]" v-text="item.text" />
          </v-list-item>
        </v-list>

        <template #append>
          <div class="pa-2">
            <v-footer class="d-flex flex-column" color="teal" rounded="lg">
              <div class="d-flex ga-2 ms-auto w-100 justify-center">
                <v-btn
                  v-for="icon in icons"
                  :key="icon"
                  :icon="icon"
                  size="small"
                  variant="plain"
                />
              </div>

              <div class="text-center w-100 rounded-lg text-[11px] text-[#999]">
                <span>© 2026 审批系统 v.1.0.0</span>
              </div>
            </v-footer>
          </div>
        </template>
      </v-navigation-drawer>
    </template>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import logo from '@/assets/logo_.png'
  import UserAvatar from '@/components/UserAvatar.vue'
  import { drawerSet, isEditorFullscreen } from '@/composables/useEditorFullscreen'
  // PB 后台地址（顶栏「Collection」用）—— 与数据 API 同一个 PB 实例，只是路径不同，见该文件说明
  import { PB_ADMIN_URL } from '@/pocketbase'
  import { usePendingStore } from '@/stores/pending'
  import { useUserStore } from '@/stores/user'
  import { canAccess, canAct } from '@/utils/permissions'

  // 主题跟随 createVuetify 的 light/dark 主题，并记住用户上次的选择
  const theme = useTheme()
  const savedTheme = localStorage.getItem('app-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    theme.global.name.value = savedTheme
  }
  const userStore = useUserStore()
  const menu = ref(false)
  userStore.init()
  // 再从服务端拉一次最新记录覆盖 cookie 快照。
  // 必须做：PB 登录态是 base64 塞进单个 cookie 的（浏览器上限 4096 字节），
  // 带上 preferences 后必然超限、cookie 被静默丢弃，读到的就是旧记录 → 设置"下次重置"。
  userStore.refreshFromServer()
  // 偏好存在独立集合 user_preferences 里（不再挂在 users 上，否则登录 cookie 会超 4096 字节被丢），
  // 所以要在启动时单独读一次；两个用到偏好的页面都 watch 着它。
  userStore.loadPreferences()
  /** 侧边栏的**全部**菜单项（不过滤）；过滤后的 links 见下面 */
  const allLinks = [
    { icon: 'mdi-view-list', text: '所有审批单', to: '/home' },
    { icon: 'mdi-arrange-send-backward', text: '我的审批单', to: '/mine' },
    { icon: 'mdi-chart-areaspline', text: '分析', to: '/analyze' },
    { icon: 'mdi-creation', text: '任务', to: '/workStream' },
    { icon: 'mdi-file-table-box', text: '数据', to: '/setDatas' },
    { icon: 'mdi-tag-check', text: '审批模板', to: '/approvalModel' },
    { icon: 'mdi-account-group-outline', text: '角色设置', to: '/roleSetting' },
  ]
  /**
   * 侧边栏菜单：**按角色过滤**。
   * 用的是与路由守卫同一张表（utils/permissions.ts），所以"能看见的"与"进得去的"必然一致。
   */
  const links = computed(() => allLinks.filter(item => canAccess(userStore.appRole, item.to)))
  const drawer = computed(() => !isEditorFullscreen.value && drawerSet.value)
  const icons = [
    'mdi-vuetify',
    'mdi-language-typescript',
    'mdi-aws',
    'mdi-vuejs',
  ]
  const router = useRouter()
  async function handleLogout () {
    await userStore.logout()
    router.push('/login')
  }

  /**
   * 顶栏「Collection」入口**要不要显示**：只给超级管理员。
   *
   * 走 `utils/permissions` 的动作表（`pb:admin`），不在这里拿角色字符串比较 ——
   * 那张表是权限的唯一事实源，改口径只改一处（侧边栏菜单的 canAccess 就是这么用的）。
   */
  const canOpenPbAdmin = computed(() => canAct(userStore.appRole, 'pb:admin'))

  /**
   * 顶栏「Collection」：新标签页打开 PocketBase 自带后台。
   *
   * `noopener`：后台是另一套应用，没必要让它拿到本页的 `window` 引用
   * （不加的话新窗口能通过 `window.opener` 反操作本页，安全评审里这条是常规要求）。
   */
  function openPbAdmin () {
    window.open(PB_ADMIN_URL, '_blank', 'noopener')
  }
  const route = useRoute()
  const isPublic = computed(() => route.meta.public === true)
  const pending = usePendingStore()
  watch(() => userStore.isLoggedIn, logged => {
    if (logged) {
      void pending.refresh()
      pending.start()
    } else {
      pending.stop()
    }
  }, { immediate: true })

  watch(() => route.path, () => {
    if (userStore.isLoggedIn) {
      void pending.refresh()
    }
  })

  onBeforeUnmount(() => pending.stop())
  function setDrawer () {
    drawerSet.value = !drawerSet.value
  }
  function onClick () {
    const next = theme.global.name.value === 'light' ? 'dark' : 'light'
    theme.global.name.value = next
    localStorage.setItem('app-theme', next)
  }

  function routerGo (path: string) {
    router.push(path)
  }
</script>

<style lang="scss" scoped>
.app-titlebar {
  /* 让顶栏高 36px，给图标按钮更舒服的点击区 */
  min-height: 36px;
}

.app-titlebar :deep(.v-system-bar__content) {
  padding-inline: 8px;
}

/* 品牌标题：方块字加字距，避免挤成一团 */
.brand-name {
  letter-spacing: 2px;
  opacity: 0.95;
  padding-inline: 6px;
  padding-block: 2px;
  border-radius: 4px;
  background: rgb(255 255 255 / 8%);
}

/* 工具区与窗口控制之间的细分隔 */
.win-divider {
  height: 18px;
  opacity: 0.5;
  border-color: rgb(255 255 255 / 45%);
}
</style>
