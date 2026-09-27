import { defineStore } from 'pinia'
import { ref } from 'vue'
import pb from '@/pocketbase.ts'
import { APPROVAL_STATUS } from '@/types/approval'

/**
 * 周期刷新间隔。
 *
 * 取 60s：这是个 COUNT 请求（很轻），但也不能太密 —— 角标晚一分钟变化没人会注意，
 * 而 10s 一次会让每个开着的标签页都持续打请求。窗口聚焦时的刷新补上了"实时感"。
 */
export const PENDING_REFRESH_MS = 60_000

/**
 * 「未审批单数」角标（侧边栏「我的审批单」上那个红点数字）。
 *
 * 口径必须与「我的审批单」列表**完全一致** —— pages/mine.vue 的 `pendingRows`
 * 就是 `status === APPROVAL_STATUS.PENDING`，这里是同一个条件，只是搬到服务端 COUNT。
 * 两边不一致会出现"角标 3、点进去 5 条"，是最难解释的一类 bug。
 *
 * ⚠️ 这个数字是**全部用户**的未结束单，不是"分给我办的"：
 * `getApprovalOrder()`（utils/collection.ts）拉的是 approval_chain 全量（filter 为空），
 * mine.vue 也没有按登录人过滤。若要让角标只算"轮到我办的"，**必须列表页与角标一起改**，
 * 只改角标会让数字与列表对不上。
 *
 * 为什么用 `getList(1, 1)` 而不是复用 `getApprovalOrder()`：
 * 角标只要数量，`getList` 的 totalItems 就是服务端 COUNT 的结果；
 * 而列表页那个接口会把整张单（含 `chain` 的 JSON 快照、`expand: relation`）全拉回来，
 * 为了一个数字去拉全部单据没有必要。
 */
export const usePendingStore = defineStore('pending', () => {
  /** 未审批（未结束）单数：status === PENDING */
  const count = ref(0)
  /** 有请求在飞 */
  const loading = ref(false)

  /** 周期刷新定时器，见下方 start() 的说明 */
  let timer: ReturnType<typeof setInterval> | undefined
  /** 是否已挂上监听/定时器 —— start() 会被多处调用（登录态变化、路由变化），靠它保证只挂一次 */
  let running = false

  async function refresh (): Promise<void> {
    /*
     * 上一次还没回来就跳过。这个请求会被定时器、窗口聚焦、路由切换、提交审批四处触发，
     * 重叠是常态（例如提交完立刻切页），不拦的话会同时打几个 COUNT 请求。
     */
    if (loading.value) return
    loading.value = true
    try {
      const res = await pb.collection('approval_chain').getList(1, 1, {
        filter: `status = ${APPROVAL_STATUS.PENDING}`,
      })
      count.value = res.totalItems
    } catch (error) {
      /*
       * 失败**保留上一次的数字**，不清零。
       * 角标是辅助信息：网络抖动时闪成 0（角标直接消失）比显示一个稍旧的数字更糟 ——
       * 用户会以为"待办清了"，反而更困惑。
       * 未登录时也会走到这里（PB 拒绝匿名请求），所以只打日志、不弹提示。
       */
      console.warn('[pending] 未审批单数刷新失败（保留上次的值）:', error)
    } finally {
      loading.value = false
    }
  }

  /** 页面不可见时不请求（切到别的标签页/最小化时没必要刷） */
  function refreshIfVisible (): void {
    if (document.visibilityState === 'visible') {
      void refresh()
    }
  }

  /**
   * 开始跟踪。两个触发源：
   *
   *  1. **窗口聚焦 / 重新可见**：用户去飞书或别的系统办完事回来，数字应该已经变了；
   *  2. **定时**：这一条不能省 —— 列表是全量单据（见文件顶部说明），
   *     **别人**审批同样会改变这个数字，光靠"自己操作后刷新"是追不上的。
   */
  function start (): void {
    if (running) return
    running = true
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    timer = setInterval(refreshIfVisible, PENDING_REFRESH_MS)
  }

  /**
   * 停止跟踪并清零。退出登录、App 卸载时调用 ——
   * 不清零会把上一个账号的数字留在角标上。
   */
  function stop (): void {
    running = false
    window.removeEventListener('focus', refreshIfVisible)
    document.removeEventListener('visibilitychange', refreshIfVisible)
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    count.value = 0
  }

  return { count, loading, refresh, start, stop }
})
