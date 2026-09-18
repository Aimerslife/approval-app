<template>
  <v-row class="h-100">
    <v-col class="relative" cols="8">
      <v-img
        class="h-100"
        cover
        gradient="to top right, rgba(100,115,201,.33), rgba(25,32,72,.7)"
        :src="background"
      />

      <div class="absolute bottom-25 left-5">
        <v-rating
          active-color="#B6284E"
          empty-icon="mdi-heart-outline"
          half-icon="mdi-heart-half-full"
          hover
          :length="5"
          full-icon="mdi-heart"
          :model-value="4"
          :size="40"
        />
      </div>

      <div class="absolute bottom-10 left-45">
        <v-snackbar
          color="#3546C9"
          contained
          model-value
          prepend-avatar="https://cdn.vuetifyjs.com/images/john.jpg"
          text="可能又是愉快的一天?"
          timeout="-1"
          title="John Leider"
        />
      </div>
    </v-col>

    <v-col cols="4">
      <v-sheet class="d-flex  flex-col gap-2 p-20 h-100  justify-center">
        <v-img max-height="50px" :src="logo" />

        <div class="d-flex flex-col gap-3 mb-10">
          <strong class="text-[20px]">欢迎回来</strong>
          <span class="text-[14px] text-[#8B8B8B]">登录你的账号后开启流程</span>
        </div>

        <v-form fast-fail @submit.prevent="submit">
          <v-text-field
            v-model="email"
            class="mb-4"
            label="邮箱"
            placeholder="请输入邮箱"
            rounded="15px"
            :rules="emailRules"
            variant="outlined"
          >
            <template #prepend-inner>
              <v-icon size="20">mdi-email-outline</v-icon>
            </template>
          </v-text-field>

          <v-text-field
            :append-inner-icon="visible ? 'mdi-eye-off' : 'mdi-eye'"
            label="密码"
            v-model="password"
            placeholder="密码"
            rounded="15px"
            :rules="passwordRules"
            :type="visible ? 'text' : 'password'"
            variant="outlined"
            @click:append-inner="visible = !visible"
          >
            <template #prepend-inner>
              <v-icon size="20">mdi-lock-outline</v-icon>
            </template>
          </v-text-field>

          <div class="d-flex justify-between mb-4">
            <span />

            <span
              class="text-body-small text-decoration-none text-blue cursor-pointer hover:underline"
              @click="goResetPassword"
            >忘记密码?</span>
          </div>

          <v-btn
            block
            class="mt-2"
            color="#3378FF"
            rounded="30px"
            size="large"
            type="submit"
            variant="flat"
          >登录</v-btn>
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

          <span>没有账号？</span>

          <span
            class="no-underline hover:underline text-[#3378FF] cursor-pointer hover:text-[12px]"
            @click="goRegister"
          >去注册</span>
        </div>
      </v-sheet>
    </v-col>
  </v-row>
  <!-- 登录失败提示：企业不匹配 / 组织信息获取失败 / 账号密码错误等 -->
  <v-snackbar
    v-model="snackbar.show"
    :color="snackbar.color"
    location="top"
    timeout="4000"
    variant="tonal"
  >
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script lang="ts" setup>
  import background from '@/assets/background.jpg'
  import feishu from '@/assets/feishu.png'
  import logo from '@/assets/logo.png'
  import { useUserStore } from '@/stores/user'
  import { loginWithLark } from '@/utils/oauth'

  const userStore = useUserStore()

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
  function showMsg (text: string, color: 'success' | 'error' | 'warning' = 'error') {
    snackbar.value = { show: true, text, color }
  }
  async function submit (event: Event) {
    loading.value = true
    const results: any = await event
    const { valid, errors } = results
    if (valid) {
      try {
        await userStore.login(email.value, password.value)
        router.push('/home')
      } catch (error: any) {
        console.error('登录失败:', error.response?.data ?? error.data ?? error)
        showMsg('邮箱或密码错误，请重试', 'error')
      }
    } else {
      console.log(errors)
    }
    loading.value = false
  }
  function goRegister () {
    router.push('/register')
  }
  function goResetPassword () {
    router.push('/sendEmail')
  }
  /**
   * 飞书登录：loginWithLark 内部已完成企业校验与用户信息落库。
   * 失败时它抛错（企业不匹配 / 组织接口异常 / 写库失败），统一在这里提示。
   *
   * 注意：不能再读 res.meta.rawUser.msg —— 失败时它返回 undefined，取属性会直接抛 TypeError。
   */
  async function loginWithLarks () {
    loading.value = true
    try {
      await loginWithLark()
      // 用落库后的最新记录刷新 Pinia，企业 / 部门字段立刻可用
      await userStore.init()
      router.push('/home')
    } catch (error: any) {
      console.error('飞书登录失败:', error)
      showMsg(error?.message ?? '飞书登录失败，请重试', 'error')
    } finally {
      loading.value = false
    }
  }
</script>
