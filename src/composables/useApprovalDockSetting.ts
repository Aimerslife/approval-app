import { ref, watch } from 'vue'

/**
 * 审批页底部办理面板的「自动展开」设置（只作用于审批页的 panel 模式）。
 *
 * 为什么放在模块级单例里：
 *   · 组件自己 `ref(read())` 时，每个实例各读一次存储，路由切换 / 多实例下容易出现
 *     "这个实例读到的是旧值"的问题；
 *   · 单例只读一次、写一处，页面与组件看到的一定是同一个值。
 *
 * 存储约定：没存过 = 默认展开；只有明确写入 `'0'` 才是「进入时保持隐藏」。
 */
const STORAGE_KEY = 'approval.dock.autoOpen'

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    // 无痕模式 / 存储被禁用：退回默认「展开」
    return true
  }
}

const autoOpen = ref(read())

// 首次运行（还没存过）就把默认值落库：方便在 DevTools 里确认设置到底存了什么
try {
  if (localStorage.getItem(STORAGE_KEY) === null) {
    localStorage.setItem(STORAGE_KEY, '1')
  }
} catch {
  // 存储不可用：不影响本次会话的默认值
}

watch(autoOpen, value => {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // 存不下就只在本次会话生效
  }
})

/** 页面 / 组件共用的同一份设置（响应式，改动会同步到所有使用方） */
export function useApprovalDockSetting() {
  return { autoOpen }
}
