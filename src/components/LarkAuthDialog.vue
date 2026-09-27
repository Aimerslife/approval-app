<template>
  <v-dialog max-width="520" :model-value="open" persistent @update:model-value="onDialogToggle">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center ga-2 py-3 text-[15px]">
        <v-avatar :image="feishu" size="20" />
        飞书授权
        <v-spacer />

        <v-btn icon size="small" variant="text" @click="close()">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <div class="frame-wrap">
        <v-progress-circular
          v-if="!loaded && !returned"
          class="frame-loading"
          color="primary"
          indeterminate
          size="28"
        />
        <!--
          飞书授权页直接嵌在这里（已验证：飞书不禁止被 iframe 嵌入，
          响应头里没有 X-Frame-Options / frame-ancestors，也没有前端 frame-busting）。

          `allow="local-network-access *"` 不要删：授权成功后是**飞书页（公共地址空间）**
          导航回本机地址，Chrome/Edge 142+ 的「本地网络访问限制」会拦这种请求，
          且该检查明确覆盖**子框架导航**；按 Edge 官方文档，宿主文档必须在 iframe 上
          把该权限政策委托出去，否则连"是否允许"的提示都不会弹。

          授权完成后 PB 会把 iframe 307 到它自己的界面（同源）——
          那一刻用 v-show 把它**藏起来**：用户要的是"跳到主页"，
          不该在框里看到 PB 的界面、更不该看到我们自己的站点。
        -->
        <iframe
          v-show="!returned"
          ref="frameEl"
          allow="local-network-access *"
          class="frame"
          :src="authUrl ?? undefined"
          title="飞书授权"
          @load="onFrameLoad"
        />

        <div v-if="returned" class="frame-done">
          <v-progress-circular class="mb-3" color="primary" indeterminate size="22" />
          <span class="text-[13px]" style="color: rgb(var(--v-theme-on-surface) / 60%)">已授权，正在进入首页…</span>
        </div>
      </div>

      <v-card-actions class="px-4 pb-3">
        <span class="text-[12px]" style="color: rgb(var(--v-theme-on-surface) / 60%)">用飞书扫码，授权后自动进入首页</span>
        <v-spacer />
        <v-btn variant="text" @click="close()">取消</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import feishu from '@/assets/feishu.png'

  const props = defineProps<{
    /** 是否打开授权对话框（父组件控制；本组件不自己改它，只发 close） */
    open: boolean
    /** 要嵌的飞书授权地址（由 PB SDK 的 urlCallback 回调给出） */
    authUrl?: string | null
  }>()

  const emit = defineEmits<{
    /** 请求关闭（用户取消 / 点右上角）；授权结果由调用方的 promise 决定，不在这里处理 */
    close: []
  }>()

  const frameEl = ref<HTMLIFrameElement>()
  /** 飞书页是否已经显示出内容（用来收掉转圈） */
  const loaded = ref(false)
  /** iframe 是否已经回到"我们这边"（PB 回调后的 307 目标与当前页同源）→ 藏起 iframe */
  const returned = ref(false)

  /** 轮询句柄与收圈兜底定时器：关闭对话框、组件卸载都必须清掉 */
  let timer: ReturnType<typeof setInterval> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const POLL_MS = 500
  /**
   * 转圈的兜底时限（毫秒）。
   *
   * ⚠️ 不能只等 iframe 的 load：飞书登录页是重资源 SPA，还挂着长期不结束的请求，
   *    load 事件会被**无限期推迟**（实测等 20 秒仍未触发）。所以最多显示这么久就收掉，
   *    之后由飞书页自己的加载动画接管视觉。
   */
  const FALLBACK_HIDE_MS = 4000

  /** 读 iframe 当前地址。跨源（还在飞书那边）会抛 SecurityError，返回 null 即可。 */
  function readHref (): string | null {
    try {
      return frameEl.value?.contentWindow?.location?.href ?? null
    } catch {
      return null
    }
  }

  /**
   * 判断 iframe 是否已经回到本应用的同源地址。
   *
   * 读不到 = 还在飞书那边（跨源），正常等待；
   * 读到且同源 = PB 的回调已经发生（它会把 iframe 307 到 `/_/#/auth/oauth2-redirect-*`）。
   * 至于授权码：**不在这里取** —— PB 的 307 会让带 code 的地址从不被渲染，
   * 前端读不到；code 由 PB SDK 通过 realtime 拿（见 utils/oauth.ts 的注释）。
   */
  function checkReturned () {
    if (returned.value) return
    const href = readHref()
    if (!href) return
    try {
      if (new URL(href).origin === window.location.origin) returned.value = true
    } catch {
      // 地址不合法就当还没回来，继续等
    }
  }

  function onFrameLoad () {
    loaded.value = true
    checkReturned()
  }

  function stop () {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
  }

  function close () {
    stop()
    emit('close')
  }

  function onDialogToggle (value: boolean) {
    if (!value) close()
  }

  /** 每次打开都复位：转圈重新开始、iframe 重新可见（上一次可能停在同一页） */
  function start () {
    stop()
    loaded.value = false
    returned.value = false
    timer = setInterval(checkReturned, POLL_MS)
    hideTimer = setTimeout(() => {
      loaded.value = true
    }, FALLBACK_HIDE_MS)
  }

  watch(() => props.open, isOpen => {
    if (isOpen) start()
    else stop()
  })

  onMounted(() => {
    if (props.open) start()
  })

  onUnmounted(stop)
</script>

<style scoped>
/* 固定高度：飞书登录页是整页应用，高度太小会把二维码挤掉 */
.frame-wrap {
  position: relative;
  height: 520px;
  /* 飞书授权页是白底 iframe，外框跟主题走（原来写死白，深色下是一块白板） */
  background: rgb(var(--v-theme-surface));
}

.frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

/* 转圈压在 iframe 上方居中（收掉后消失） */
.frame-loading {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
}

/* 授权已回到本机、正在换登录态时的过渡态：只显示一句提示，不再展示任何页面 */
.frame-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
