<template>
  <v-container class="pa-0" fluid>
    <v-row class="h-100vh" no-gutters>
      <v-col class="relative" cols="8" no-gutters>
        <v-img class="h-100" cover gradient="to top right, rgba(100,115,201,.33), rgba(25,32,72,.7)"
          :src="background" />
        <div class="word-badge absolute bottom-10 left-15">
          <v-rating active-color="#B6284E" empty-icon="mdi-heart-outline" half-icon="mdi-heart-half-full" hover
            :length="5" full-icon="mdi-heart" :model-value="4" :size="40" />

          <v-sheet class="word-card" color="#3546C9" rounded="10">
            <div class="d-flex align-center gap-2">
              <v-avatar :image="title" size="35" />
              <div class="word-card__title">今日鸡汤</div>
            </div>
            <div class="word-card__text p-2">{{ word }}</div>
          </v-sheet>
        </div>
      </v-col>

      <v-col cols="4" no-gutters>
        <v-sheet class="d-flex  flex-col gap-2 p-20 h-100  justify-center">
          <v-img max-height="50px" :src="logo" />

          <div class="d-flex flex-col gap-3 mb-10">
            <strong class="text-[20px]">欢迎回来</strong>
            <span class="text-[14px] text-[#8B8B8B]">登录你的账号后开启流程</span>
          </div>

          <v-form fast-fail @submit.prevent="submit">
            <v-text-field v-model="email" class="mb-4" label="邮箱" placeholder="请输入邮箱" rounded="15px" :rules="emailRules"
              variant="outlined">
              <template #prepend-inner>
                <v-icon size="20">mdi-email-outline</v-icon>
              </template>
            </v-text-field>

            <v-text-field :append-inner-icon="visible ? 'mdi-eye-off' : 'mdi-eye'" label="密码" v-model="password"
              placeholder="密码" rounded="15px" :rules="passwordRules" :type="visible ? 'text' : 'password'"
              variant="outlined" @click:append-inner="visible = !visible">
              <template #prepend-inner>
                <v-icon size="20">mdi-lock-outline</v-icon>
              </template>
            </v-text-field>

            <div class="d-flex justify-between mb-4">
              <span />

              <span class="text-body-small text-decoration-none text-blue cursor-pointer hover:underline"
                @click="goResetPassword">忘记密码?</span>
            </div>

            <v-btn block class="mt-2" color="#3378FF" rounded="30px" size="large" type="submit"
              variant="flat">登录</v-btn>
          </v-form>

          <div class="mt-10">
            <v-divider content-offset="0.5rem">
              <span class="text-[13px] text-[#8B8B8B]">或者</span>
            </v-divider>
          </div>

          <div class="d-flex justify-center text-[13px] text-[#8B8B8B] mt-15 align-center">
            <v-btn class="mr-4" icon size="32" @click="loginWithLarks">
              <v-avatar :image="feishu" size="18" />
            </v-btn>

            <!-- <span>没有账号？</span>

          <span class="no-underline hover:underline text-[#3378FF] cursor-pointer hover:text-[12px]"
            @click="goRegister">去注册</span> -->
          </div>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>

  <!-- 登录失败提示：企业不匹配 / 组织信息获取失败 / 账号密码错误等 -->
  <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="4000" variant="tonal">
    {{ snackbar.text }}
  </v-snackbar>
  <LarkAuthDialog :open="authDialog" :auth-url="authUrl" @close="authDialog = false" />
</template>

<script lang="ts" setup>
import background from '@/assets/background.jpg'
import title from '@/assets/title.png'
import feishu from '@/assets/feishu.png'
import logo from '@/assets/logo.png'
import { useUserStore } from '@/stores/user'
import { loginWithLarkEmbedded } from '@/utils/oauth'
import LarkAuthDialog from '@/components/LarkAuthDialog.vue'
import { getWord } from '@/api/api'

const userStore = useUserStore()
const word = ref('可能又是愉快的一天')
const email = ref('')
const password = ref('')
const loading = ref(false)
const router = useRouter()
const emailRules = [
  (value: string) => {
    if (!value) return '邮箱不能为空'
    const pattern = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
    if (!pattern.test(value)) return '邮箱格式不正确'
    return true
  },
]
const passwordRules = [
  (value: string) => !!value || '密码不能为空',
  (value: string) => {
    if (value.length < 8) return '密码至少 8 位'
    if (value.length > 30) return '密码最多 30 位'
    return true
  },
  (value: string) => {
    const hasUpper = /[A-Z]/.test(value)
    const hasLower = /[a-z]/.test(value)
    const hasNumber = /\d/.test(value)
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};:'",.<>?/]/.test(value)

    if (!hasUpper) return '密码至少包含一个大写字母'
    if (!hasLower) return '密码至少包含一个小写字母'
    if (!hasNumber) return '密码至少包含一个数字'
    if (!hasSpecial) return '密码至少包含一个特殊字符 (!@#$%^&* 等)'
    return true
  },
]
const visible = ref(false)
/** 统一提示：避免各处手写 snackbar 三连 */
const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'error' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' = 'error') {
  snackbar.value = { show: true, text, color }
}
async function submit(event: Event) {
  loading.value = true
  const results: any = await event
  const { valid, errors } = results
  if (valid) {
    try {
      await userStore.login(email.value, password.value)
      // 登录后落到 index.vue（路由 `/`）。⚠️ 该页当前渲染的是脚手架欢迎页（HelloWorld），
      // 若这里要的是"进主界面"，应改成 '/home'。
      router.push('/')
    } catch (error: any) {
      console.error('登录失败:', error.response?.data ?? error.data ?? error)
      showMsg('邮箱或密码错误，请重试', 'error')
    }
  } else {
    console.log(errors)
  }
  loading.value = false
}
function goRegister() {
  router.push('/register')
}
function goResetPassword() {
  router.push('/sendEmail')
}
/** 应用内嵌授权：要嵌的飞书授权地址（由 SDK 的 urlCallback 回调给出；关掉对话框就清掉） */
const authUrl = ref<string | null>(null)
const authDialog = ref(false)

/**
 * 飞书登录（授权页嵌在应用内，成功后**顶层**跳转 /home）。
 *
 * 为什么不用 PB 默认的方式：`authWithOAuth2` 默认走 `window.open` 弹一个独立窗口 ✗。
 * 这里用它的 `urlCallback` 把"打开方式"换成对话框里的 iframe ——
 * 取 code、换登录态仍由 SDK 负责（它靠 realtime 把 code 收回来，见 utils/oauth.ts 的注释）。
 *
 * 对话框只负责显示授权页：PB 回调后会把 iframe 307 到同源地址，那一刻对话框会把 iframe
 * 藏掉，所以**不会**把 PB 的界面或我们自己的站点显示在框里。
 *
 * 注意：不能再读 res.meta.rawUser.msg —— 失败时它返回 undefined，取属性会直接抛 TypeError。
 */
async function loginWithLarks() {
  loading.value = true
  try {
    await loginWithLarkEmbedded((url) => {
      authUrl.value = url
      authDialog.value = true
    })
    // 走到这里说明 SDK 已换到登录态（授权码是它通过 realtime 收回来的）：
    // 刷新 Pinia（企业 / 部门字段立刻可用），然后**顶层**跳 index.vue（路由 `/`）——
    // 跳转必须在这里发生，对话框只负责显示授权页。
    // ⚠️ index.vue 当前渲染的是脚手架欢迎页（HelloWorld），若这里要的是"进主界面"，改成 '/home'。
    await userStore.init()
    await router.push('/')
  } catch (error: any) {
    console.error('飞书登录失败:', error)
    showMsg(error?.message ?? '飞书登录失败，请重试', 'error')
  } finally {
    loading.value = false
    // 无论成败都关掉对话框：成功时已经在跳转了，失败时让用户看到提示再重来
    authDialog.value = false
    authUrl.value = null
  }
}
onMounted(async () => {
  try {
    const res = await getWord()
    /*
     * `?? word.value` 不能省：
     *   · 类型上：`res?.data?.hitokoto` 是 `string | undefined`，而 word 是 Ref<string>
     *     —— 直接赋值会报 TS2322（不能把 undefined 赋给 string）；
     *   · 行为上：一言接口失败 / 字段缺失时保留默认文案，否则卡片会变成空白。
     */
    word.value = res?.data?.hitokoto ?? word.value
  } catch (error) {
    // 接口异常不能让 onMounted 里出现未捕获的 promise rejection（那会打断页面后续初始化）
    console.error('[login] 获取一言失败，沿用默认文案:', error)
  }
})
</script>

<style scoped>
.word-badge {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  /* 整块不超出视口；宽屏下也不至于铺得太长 */
  max-width: min(88vw, 560px);
}

.word-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: fit-content;
  max-width: 100%;
  padding: 10px 14px;
  color: #fff;
}

.word-card__title {
  font-size: 13px;
  font-weight: 600;
}

.word-card__text {
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.95;
  /* 长文案在 max-width 处自然换行（不要 nowrap，否则会冲出容器） */
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
