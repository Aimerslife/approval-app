import { reactive } from 'vue'
import { avatarSources } from '@/utils/avatar'

/**
 * 头像的「逐级降级」状态机：**服务端代理 → 原始地址 → 首字**。
 *
 * 背景（详见 utils/avatar 的文件头）：飞书头像是带签名的临时地址，过期后浏览器直接 403，
 * 所以正常情况下应该走服务端代理；但代理服务偶尔会抽风，签名那会儿又还没过期 ——
 * 那就退回原地址再试一次，两个都不行才显示姓名首字。
 *
 * ## 为什么状态键是"原始地址"而不是"人"
 *
 * 同一个人在不同单据里的原始地址可能不同（签名每次都变），而**同一份数据**在重渲染时必须
 * 停在同一个候选上 —— 用原始地址当键，重渲染拿到的还是同一个值；换了地址（新数据）自然从头试。
 *
 * ## 与旧实现的差别
 *
 * 以前是 `failedAvatars[url] = true` **一票否决**：一次网络抖动 / 代理冷启动就把这张图
 * 永久拉黑到组件销毁为止（表现是"某些人头像一直是空圈，刷新页面才好"）。
 * 现在是"往下挪一格"，既不会无限重试同一张坏图，也不会因为一次失败就再也不试。
 */
export function useAvatarSrc () {
  /** 原始地址 → 当前试到第几个候选（越界 = 全部失败，返回空串让调用方退回首字） */
  const level = reactive<Record<string, number>>({})

  /** 空串表示"没有可用的图"，调用方据此显示首字 */
  function srcOf (raw?: string | null): string {
    const key = String(raw ?? '').trim()
    if (!key) {
      return ''
    }
    const list = avatarSources(key)
    return list[level[key] ?? 0] ?? ''
  }

  /** 贴图失败：换下一个候选；已经是最后一个就记为全部失败 */
  function onError (raw?: string | null): void {
    const key = String(raw ?? '').trim()
    if (!key) {
      return
    }
    const list = avatarSources(key)
    const next = (level[key] ?? 0) + 1
    level[key] = next < list.length ? next : list.length
  }

  /** 让它重新从第一个候选开始（换账号 / 手动刷新列表时用） */
  function reset (raw?: string | null): void {
    const key = String(raw ?? '').trim()
    if (key) {
      delete level[key]
    }
  }

  return { srcOf, onError, reset }
}
