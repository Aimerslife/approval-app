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
          <strong class="text-[20px]">密码重置</strong>
          <span class="text-[14px] text-[#8B8B8B]">发送邮件重置你的登录密码</span>
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

          <v-btn
            block
            class="mt-2"
            color="#3378FF"
            rounded="30px"
            size="large"
            type="submit"
            variant="flat"
          >发送重置链接</v-btn>
        </v-form>

        <div class="mt-10">
          <v-divider content-offset="0.5rem">
            <span class="text-[13px] text-[#8B8B8B]">或者</span>
          </v-divider>
        </div>

        <div class="d-flex justify-center text-[13px] text-[#8B8B8B] mt-15">记得你的密码？
          <span
            class="no-underline hover:underline text-[#3378FF] cursor-pointer hover:text-[12px]"
            @click="goLogin"
          >去登录</span>
        </div>
      </v-sheet>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import { resetPassword } from '@/api/api'
  import background from '@/assets/background.jpg'
  import logo from '@/assets/logo.png'

  const email = ref('')
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
  async function sendEmail (email: string) {
    const res = await resetPassword(email)
    console.log(res)
  }
  async function submit (event: Event) {
    loading.value = true
    const results: any = await event
    loading.value = false
    console.log(results)
    const { valid, errors } = results
    if (valid) {
      sendEmail(email.value)
    } else {
      console.log(errors)
    }
  }
  function goLogin () {
    router.push('/login')
  }
</script>
