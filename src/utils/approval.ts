// 审批流程的判定条件
// ⚠️ 这里原来有两个**一模一样**的 isApproval（重复导出，TS 直接报
//    「Cannot redeclare exported variable」+「Duplicate function implementation」），已合并为一个。
export function isApproval (data: any) {
  return data.status === '待审批'
}
