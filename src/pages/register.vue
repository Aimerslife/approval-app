<template>
  <v-row class="h-100">
    <v-col class="relative" cols="8">
      <v-img
        class="h-100"
        cover
        gradient="to top right, rgba(100,115,201,.33), rgba(25,32,72,.7)"
        :src="backgroud"
      />

      <div class="absolute bottom-25 left-5">
        <v-rating
          active-color="#B6284E"
          empty-icon="mdi-heart-outline"
          half-icon="mdi-heart-half-full"
          hover
          full-icon="mdi-heart"
          :length="5"
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
          <strong class="text-[20px]">创建账号</strong>
          <span class="text-[14px] text-[#8B8B8B]">开启审批流程——专注自动化</span>
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
            placeholder="密码"
            rounded="15px"
            v-model="password"
            :rules="passwordRules"
            :type="visible ? 'text' : 'password'"
            variant="outlined"
            @click:append-inner="visible = !visible"
          >
            <template #prepend-inner>
              <v-icon size="20">mdi-lock-outline</v-icon>
            </template>
          </v-text-field>

          <div class="mt--2 mb--5">
            <v-checkbox v-model="checkbox" color="#3378FF" density="compact">
              <template #label>
                <div class="text-[12px]">
                  我同意
                  <span
                    class="text-[#3378FF] cursor-pointer hover:underline font-bold hover:font-normal hover:text-[11px]"
                    @click.stop="goAgreement"
                  >使用协议</span>
                </div>
              </template>
            </v-checkbox>
          </div>

          <v-btn
            block
            class="mt-2"
            color="#3378FF"
            rounded="30px"
            size="large"
            type="submit"
            variant="flat"
          >注册</v-btn>
        </v-form>

        <div class="mt-10">
          <v-divider content-offset="0.5rem">
            <span class="text-[13px] text-[#8B8B8B]">或者</span>
          </v-divider>
        </div>

        <div class="d-flex justify-center text-[13px] text-[#8B8B8B] mt-15">已有账号？
          <span
            class="no-underline hover:underline text-[#3378FF] cursor-pointer hover:text-[12px]"
            @click="goLogin"
          >去登录</span>
        </div>
      </v-sheet>

      <v-snackbar-queue ref="snackbarQueue" v-model="messages" closable :total-visible="5" />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import backgroud from '@/assets/backgroud.jpg'
  import logo from '@/assets/logo.png'
  import { register } from '@/utils/collection'

  const router = useRouter()
  const email = ref('')
  const password = ref('')
  const loading = ref(false)
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
  const checkbox = ref(false)
  async function submit (event: Event) {
    if (!checkbox.value) {
      addMessage('error', '请同意使用协议')
      return
    }
    loading.value = true
    const results: any = await event
    loading.value = false
    console.log(results)
    const { valid, errors } = results
    if (valid) {
      register(email.value, password.value)
    } else {
      addMessage('error', errors[0].errorMessages[0])
    }
  }
  function goLogin () {
    router.push('/login')
  }
  function goAgreement () {
    router.push('/agreement')
  }
  interface SnackbarMessage {
    text: string
    color: string
    /** 必须是字面量联合（Vuetify 的 Variant），写 string 会与 v-snackbar-queue 的类型对不上（TS2322） */
    variant: 'elevated' | 'flat' | 'tonal' | 'outlined' | 'plain' | 'text'
    onDismiss: (reason: any) => void
  }

  const messages = ref<SnackbarMessage[]>([])
  const logs = ref<string[]>([])

  function addMessage (color: string, text: string) {
    messages.value.push({
      text,
      color,
      variant: 'elevated',
      onDismiss (reason: any) {
        logs.value.unshift(`Closed (${reason})`)
      },
    })
  }
</script>
