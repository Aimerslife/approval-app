/**
 * templateRef.ts
 *
 * 「引用模板」的**建单期展开**：把流程里的 `ref` 节点换成**源模板的流程**（整段搬进来）。
 *
 * ## 为什么是"建单期展开"，而不是"运行期解析"
 *
 * 三条理由与 utils/approvalProbe、utils/approvalRotation 同源：
 *  1. `rebuildChain` 是**纯同步**函数、被审批页 / 首页抽屉反复调用 —— 塞 IO 等于每次渲染打库；
 *  2. 同一份 decisions 必须永远算出同一条链，否则历史单会"漂移"（待办人自己变、时间线错位）；
 *  3. 引用关系会变（源模板被改、被删、被改名），运行期解析等于让历史单跟着变。
 *
 * 所以：**建单那一刻读一次源模板，把内容冻进本单快照**。
 * 由此得到两个可预期的行为（也是这个功能对用户的承诺）：
 *  · 源模板改了 → **之后新建**的单用新版，**已建的单不受影响**；
 *  · 源模板被删 → 之后建单**当场失败并报出是哪张卡片**（不会静默少一段流程）。
 *
 * ## 三件必须做对的事（每一件漏掉都会出难查的 bug）
 *
 * ① **id 加前缀**：`rebuildChain` 用 `containerById` / `membersById` **按 id 索引**步骤
 *    （见 types/approval 的 collect）。同一张模板被引两次、或源模板里 id 与外面撞了，
 *    不加前缀就会"串味"——表现是待办落在错的环节上，几乎查不出来。
 * ② **清掉源模板的出口标记**（`branch.isEnd`）：源模板里"连线直达结束节点"表示
 *    **那个模板**结束了；搬进别人流程的中间时，它的含义只是"**这一段**走完了"，
 *    后面还要继续。照搬 `isEnd` 会让单子在这段结束时**整单终止**（与 loop 卡片
 *    内部"结束 = 这一环走完"完全同款，见 utils/loopCardGraph 的 clearExit）。
 * ③ **成环与失控拦截**：A 引 B、B 引 A（或自引用）在建单期就要报出来；
 *    间接的层层引用也给个总量上限，避免"看起来能保存、建单时才炸"。
 * ④ **补「驳回 → 回退」的边界**：保存期只给**本模板**的环节补回退分支，源模板里那一段的
 *    **首个**环节当时没有"上一级" —— 搬进来之后它是有的（本流程的上一环），必须补上，
 *    否则那个环节**无法驳回**（其余环节的回退在源模板保存时已补好，重复跑是幂等的）。
 * ⑤ **按结论分流**：画布上给引用卡片接了 ≥2 条出线时，段内容后面还要编译出一个分支组 ——
 *    "这一段最后办出来的结论 → 走哪条线"（见下面 openedSeg 之后的说明）。
 *    分支里的步骤是**本模板的下游**，所以**不做 id 前缀**（与段内容相反）。
 *
 * ## 展开顺序（在 utils/expandFlowForOrder 中是第 ⓪ 步）
 *
 * 必须**早于** probe / loop 展开：引用进来的段落里可能自带数据查询与轮询卡片，
 * 那些也必须被求值展开 —— 顺序反了，快照里就会残留 probe/loop，
 * 单子办到那一环提交时才炸（正是 expandFlowForOrder 文件头踩过的坑）。
 */
import type { ApprovalFlow } from '@/types/approval'
/*
 * 补「驳回 → 回退」：跑在**搬进来那一段**上（幂等，见 hasRejectBack）。
 * 为什么需要：保存期只给"本模板自己的环节"补过回退（见 utils/approvalFlow 的 ensureRejectLoopBack），
 * 源模板里那一段的**首个**环节当时没有"上一级" —— 不补的话它被引用后无法驳回。
 */
import { ensureRejectLoopBackInSteps } from '@/utils/approvalFlow'

/**
 * 一次建单最多展开多少个引用（防病态层层引用把单据撑爆）。
 *
 * ⚠️ 这个数是按**真实模板**定的，不是拍脑袋：线上「美1组模板」= 13 处引用
 *    （每个组一段）× 每段里再引 4 张通知（本地仓 / 海外仓各 2）= **65 次展开**。
 *    原来写 50，等于把这套正常模板判死 —— 报错还是那句"请减少引用数量"，
 *    可用户数来数去只有 13 处引用，根本对不上（实测踩过）。
 *    所以这里要留足冗余：引用次数 ≠ 画布上的卡片数，每张引用卡片都会把它引用的
 *    模板连同**里面的引用**一起再展开一遍。
 */
const MAX_REFS = 500

/**
 * 展开后的节点总量上限。
 *
 * 引用上限防的是"数量"，这里防的是"体积"：17 次引用也可能搬进来几千个环节
 * （源模板本身很大，或被层层引用），那种单子每条快照都有几 MB，列表和 rebuildChain 都会拖垮。
 * 真实量级参考：美1组模板展开后 409 个节点、美2组模板 709 个 —— 上限留了一个数量级的余量。
 */
const MAX_EXPANDED_NODES = 5000

/** 源模板（读取结果）：`flow` 是模板记录里的流程，`name` 只用于报错文案 */
export interface TemplateRefSource {
  id: string
  name?: string
  flow: ApprovalFlow
}

export interface TemplateRefExpansion {
  /** 展开好的流程（原对象不改，引用段落都是深拷贝） */
  flow: ApprovalFlow
  /** 展开不了的地方。**非空即应判该条建单失败**（与 probe/loop 展开同一口径） */
  issues: string[]
  /** 实际用到（读到）的源模板，供日志留痕；同一模板引两次只列一次 */
  usedTemplates: { id: string, name?: string }[]
}

/** 流程里的一处引用（供"模板是否被引用"的检查用，见 collectTemplateRefs） */
export interface TemplateRefUsage {
  /** 引用卡片的**步骤 / 节点 id**（报错定位用） */
  nodeId: string
  /** 卡片名（没写名字时给个默认叫法） */
  label: string
  refTemplateId: string
}

/**
 * 把流程里的 `ref` 节点展开成源模板的内容。
 *
 * @param loadFlow 读源模板（生产实现读 app_chain，见 utils/collection 的 getTemplateFlowForRef）
 */
export async function expandTemplateRefs (
  flow: ApprovalFlow,
  loadFlow: (templateId: string) => Promise<TemplateRefSource | null>,
): Promise<TemplateRefExpansion> {
  const issues: string[] = []
  const usedTemplates = new Map<string, string | undefined>()
  /** 已展开的引用次数（到 MAX_REFS 就停，见常量说明） */
  let expandedRefs = 0
  /**
   * 源模板缓存：**同一张源模板在一次展开里只读一次**。
   *
   * 不是优化洁癖：美1组模板有 13 处引用指向同一张「弃置模板-美1」，那张里又引了 4 张通知 ——
   * 没有缓存时同一张模板要被读 13+ 次，一批几十行就是上千次 PB 往返，建单慢到像卡死。
   * 缓存的生命周期只有这一次展开：源模板在建单途中被改是极小概率，而"同一单里两段内容不一致"更难接受。
   * 读到 null（模板被删 / 没有流程）也缓存 —— 否则同一张坏模板会被反复重试。
   */
  const sources = new Map<string, TemplateRefSource | null>()

  /**
   * 一个节点走完之后，"上一级环节"变成谁 —— 与 `ensureRejectLoopBackInSteps` 内部的 prevId 口径一致：
   * 分支组（含我们注入的 `:reject-back`）不占上一级，真环节才占。
   */
  function tailStepId (node: any, fallback?: string): string | undefined {
    /*
     * 分支组 / 数据查询**不是**"一段的末尾"：它们是容器，真正办完的是里面的环节，
     * 所以要往下钻。段尾是分支组（"分支各自到结束"这种画法）时，
     * 末尾环节在分支**内部** —— 只返回 fallback 会把段尾算成"分支组之前那一环"（= 段外），
     * 于是「按结论分流」各分支首个环节的"上一级"、以及链式引用的 prevId 都会落错地方。
     *
     * 各分支末尾不同时只能取一个（回退目标是 flow 里的静态值）：按 branches 顺序取
     * 最后一个取得到的环节 —— 它至少是**这一段里真实办过的环节**，比段外那一环接近语义。
     */
    if (node?.type === 'branch' || node?.type === 'probe') {
      return (node.branches ?? []).reduce(
        (acc: string | undefined, b: any) => (b?.steps ?? []).reduce(
          (inner: string | undefined, s: any) => tailStepId(s, inner),
          acc,
        ),
        fallback,
      )
    }
    return String(node?.id ?? '') || fallback
  }

  /**
   * 展开一层节点数组（顶层 / 分支 steps / 轮询卡片 steps 共用）。
   *
   * @param incomingPrev 本层**第一个环节的"上一级"**（外层上一个环节的 id）
   * @param inRef 是否身处"从引用模板搬进来的内容"里 —— 只有那时才补「驳回 → 回退」，
   *   本模板自己的内容在**保存期**已经补过了（见 utils/approvalFlow 的 ensureRejectLoopBack），
   *   这里再跑一遍会多出无用的对象（结果幂等，但没必要动它）
   * @param asStep 本层是不是**步骤位**（分支 / 轮询卡片内部的 steps）——
   *   决定搬进来的内容要不要按步骤形态归一（见 toStepShape）
   */
  async function expandList (
    nodes: any[] | undefined,
    stack: string[],
    incomingPrev?: string,
    inRef = false,
    asStep = false,
  ): Promise<any[]> {
    const out: any[] = []
    let prevId = incomingPrev
    /** 本层里「引用卡片 id → 搬进来那一段的首个环节 id」：本层结束时统一重映射（见 remapRefTargets） */
    const refTargets = new Map<string, string>()
    for (const node of nodes ?? []) {
      // 先把它**内部**的引用展开（分支步骤、轮询卡片内部子流程），再决定它自己是不是引用
      const withKids = await expandInside(node, stack, prevId, inRef)
      if (withKids.type !== 'ref') {
        out.push(withKids)
        prevId = tailStepId(withKids, prevId)
        continue
      }

      const label = String(withKids.name ?? '').trim() || '引用模板'
      const refId = String(withKids.refTemplateId ?? '').trim()
      if (!refId) {
        issues.push(`「${label}」还没有选择要引用的模板，请回到模板编辑里选一个`)
        continue
      }
      if (stack.includes(refId)) {
        // 直接给出链路（A → B → A），用户一眼看得出该去掉哪一处
        issues.push(`「引用模板」成环：${[...stack, refId].map(id => id.slice(0, 8)).join(' → ')}，请去掉其中一处引用`)
        continue
      }
      if (expandedRefs >= MAX_REFS) {
        issues.push(
          `「${label}」超出上限：一次建单最多展开 ${MAX_REFS} 个引用模板`
          + `（已展开 ${expandedRefs} 个，注意嵌套引用会一并展开），请减少引用数量或拆成多张模板`,
        )
        continue
      }
      expandedRefs++

      /*
       * 读源模板失败（网络 / 权限 / PB 异常）**不向上抛**：变成 issue，让这一条建单失败并点名卡片。
       * 与"读不到就当没有"相比，这是安全的那一边；文案上也要能区分
       * "模板没了" 与 "这次没读到"，否则运维会去删一张其实还在的模板。
       */
      let src: TemplateRefSource | null
      if (sources.has(refId)) {
        src = sources.get(refId) ?? null
      } else {
        try {
          src = await loadFlow(refId)
          sources.set(refId, src)
        } catch (error) {
          // 读失败不缓存：下一次（别的引用处）还有机会读到
          issues.push(`「${label}」读取引用的模板失败：${error instanceof Error ? error.message : String(error)}`)
          continue
        }
      }
      if (!src) {
        issues.push(`「${label}」引用的模板已不存在（可能被删了），请回到模板编辑里重新选择`)
        continue
      }
      usedTemplates.set(refId, src.name)

      const issuesBeforeInner = issues.length
      /*
       * 段内第一个环节的"上一级"由**本流程**的上一环决定 → 把 prevId 传进去（inRef：要补回退）。
       * `asStep` 原样传下去：落在步骤位时，源模板自己的顶层审批节点也要转成步骤形态（见 toStepShape）。
       */
      const inner = await expandList(clone(src.flow ?? []), [...stack, refId], prevId, true, asStep)
      /*
       * 源模板里的结束 = "这一段走完"，所以清掉出口标记（见文件头 ②）；
       * 再按**落点**归一形态：落在步骤位时，源模板的顶层审批节点带的是 `nodes`，
       * 而步骤（含引擎与界面）读的是 `members` —— 不转这一环就**没有任何人**（见 toStepShape）。
       */
      const spliced = prefixFlow(clone(inner), `${withKids.id}:ref:`)
        .map((s: any) => (asStep ? toStepShape(s) : s))
      /*
       * 只有"里面展开**本身没问题**"时才判"这一段没人办"：
       * 否则环 / 空引用的报错下还会叠一句"没有审批环节"（那是上一句的后果，不是原因），
       * 两句并列反而让人以为是两个问题。
       */
      if (issues.length === issuesBeforeInner && !countApprovals(spliced)) {
        issues.push(`「${label}」引用的模板「${src.name ?? refId}」里没有审批环节，引用进来这一段没人办`)
        continue
      }
      /*
       * 给搬进来这一段的**首个环节**补「驳回 → 回退到本流程的上一环」（见文件头 ④），幂等。
       * `prevId` 为空（引用就在流程最开头）时不补 —— 没有上一级可退，与保存期同一口径。
       */
      const openedSeg = ensureRejectLoopBackInSteps(spliced, prevId) as any[]
      out.push(...openedSeg)
      // 这一段里最后一个真环节：既是"下一环节的上一级"，也是分流分支里首个环节的上一级
      const segTail = openedSeg.reduce<string | undefined>((acc, s) => tailStepId(s, acc), prevId)
      // 本层后续环节若把"这张引用卡片"当成上一级（保存期生成的驳回目标），要换成这一段的**首个环节**
      const firstId = firstRealStepId(openedSeg)
      if (firstId) {
        refTargets.set(String(withKids.id), firstId)
      }
      /*
       * **按结论分流**（画布上接了 ≥2 条出线）：段内容后面编译出一个分支组。
       *
       * 命中哪条线由这一段**最后办出来的结论**决定 —— 引擎把这个结论写在求值上下文的
       * `result` 上带下来（见 types/approval 的 formOf），分支组就用它选路，
       * 与「审批结果分支」是同一套口径。
       *
       * ⚠️ 分支里的 `steps` 是**本模板自己的下游**（不是源模板的），所以照原样搬、**不加前缀** ——
       *    与上面那一段正好相反（`prefixFlow` 只作用在段内容上，这里天然碰不到它）。
       * ⚠️ 它们第一个环节的"上一级"应当是**这一段的末尾环节**，而保存期不知道段内容（补不了），
       *    所以在这里带着 `segTail` 补一次 —— 那个函数幂等，其余环节的回退也一并补齐、不会重复。
       */
      if (Array.isArray(withKids.branches) && withKids.branches.length > 0) {
        const branches = withKids.branches.map((b: any) => ({
          ...b,
          steps: ensureRejectLoopBackInSteps(b.steps ?? [], segTail) as any[],
        }))
        out.push({ id: `${withKids.id}:exits`, type: 'branch', branches })
      }
      prevId = segTail
    }
    remapRefTargets(out, refTargets)
    return out
  }

  /** 展开一个节点**内部**的引用（它自己的类型不变）；inRef / prevId 见 expandList 的说明 */
  async function expandInside (node: any, stack: string[], prevId?: string, inRef = false): Promise<any> {
    const isBranchGroup = node?.type === 'branch' || node?.type === 'probe'
    /*
     * **凡是带 `branches` 的节点都要往下走**，不是只认 branch / probe。
     *
     * 为什么：`branches` 不止分支组有 —— **「引用模板」卡片自己也有**（画布上给它接了 ≥2 条出线，
     * 表示"这一段办完按结论分流"，见下面 :exits 那一段）。而引用卡片的 branches 里挂的正是
     * **本模板自己的下游**，那些环节后面**照样可能有引用卡片**。
     * 早先这里按类型白名单处理，引用卡片的 branches 直接被原样返回 ——
     * 里面的引用永远轮不到展开，一直到 `expandFlowForOrder` 的自检才炸成
     * 「流程里还有没展开的「引用模板」卡片（…）」，而那时**单子已经建不出来**了
     * （实测：一张模板 36 处引用，其中 22 处就这么漏掉）。
     *
     * 分支里的 `steps` 是**步骤位**（asStep=true）—— 引用落在这里要转成步骤形态。
     */
    if (Array.isArray(node?.branches) && node.branches.length > 0) {
      const branches: any[] = []
      for (const b of node.branches ?? []) {
        const steps = await expandList(b.steps ?? [], stack, prevId, inRef, true)
        /*
         * 只有**分支组 / 查询**才在这里补「驳回 → 回退到分支组之前那一环」（与保存期同一口径）。
         * 引用卡片的按结论分流不能在这儿补：它的回退目标应当是**这一段的最后一环**，
         * 由下面编译 `:exits` 时带着 `segTail` 补（那里幂等，这里补早了会占住目标）。
         */
        branches.push({ ...b, steps: isBranchGroup && inRef ? (ensureRejectLoopBackInSteps(steps, prevId) as any[]) : steps })
      }
      return { ...node, branches }
    }
    // 轮询卡片内部的子流程同样是**步骤位**（每个组各走一遍的那段）
    if (node?.type === 'loop') {
      const steps = await expandList(node.steps ?? [], stack, prevId, inRef, true)
      return { ...node, steps: inRef ? (ensureRejectLoopBackInSteps(steps, prevId) as any[]) : steps }
    }
    // 其余（审批 / 提醒 / 引用自己）原样返回：引用卡片由调用它的 expandList 处理形态
    return node
  }

  const expanded = await expandList(flow as unknown as any[], [])

  /*
   * 体积兜底（见 MAX_EXPANDED_NODES）：引用**次数**没超不代表搬进来的东西不多 ——
   * 一张很大的源模板被引十几次，快照就会有几千个环节。这种单子建得出来但也用不了
   * （列表 / rebuildChain / 审批页都会拖垮），所以在建单那一刻就报出来。
   */
  const nodeCount = countFlowNodes(expanded)
  if (nodeCount > MAX_EXPANDED_NODES) {
    issues.push(
      `流程展开后有 ${nodeCount} 个节点，超过上限 ${MAX_EXPANDED_NODES}`
      + `（引用模板展开后体积过大），请减少引用或拆成多张模板`,
    )
  }

  return { flow: expanded as ApprovalFlow, issues, usedTemplates: [...usedTemplates].map(([id, name]) => ({ id, name })) }
}

/** 流程里的节点总数（顶层 + 分支 / 轮询卡片内部都算），见 MAX_EXPANDED_NODES */
function countFlowNodes (nodes: any[]): number {
  let n = 0
  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') {
      continue
    }
    n++
    for (const b of node.branches ?? []) {
      n += countFlowNodes(b?.steps ?? [])
    }
    n += countFlowNodes(node.steps ?? [])
  }
  return n
}

/**
 * 把一个**源模板的顶层审批节点**转成"步骤"形态（`nodes` → `members`）。
 *
 * 为什么必须转：人员字段有两种写法，取决于**位置**而不是内容 ——
 *   · 顶层节点（ApprovalFlowApprovalNode）：`nodes`；
 *   · 分支 / 轮询里的步骤（ApprovalFlowStep）：`members`。
 * 而引用是"把源模板的整段流程搬到本流程的某个位置"：源模板的顶层审批节点若落到
 * 本流程的**分支里**，位置变成了"步骤"，字段名却还留在 `nodes` ——
 * 引擎与界面读的是 `members`（见 types/approval 的 stepMembersOf），
 * 结果就是这个环节**一个人都没有**：时间线整环空白，办理端也没人能办。
 * （实测：单据流转到「弃置模板」那一段时，第一环「财务初审」的人员取不到。）
 *
 * 只动这一处字段名，其余（分支、选项树、退回目标、name…）原样带过。
 * 反向（步骤落到顶层）不需要处理：源模板里的步骤本来就是 `members`，顶层节点读 `nodes`，
 * 只有"顶层 → 步骤"这一个方向存在错位。
 */
function toStepShape (node: any): any {
  if (!node || node.type !== 'approval' || !Array.isArray(node.nodes)) {
    return node
  }
  const { nodes, ...rest } = node
  return { ...rest, members: nodes }
}

/**
 * 列出流程里所有的引用（顶层、分支内、轮询卡片内部都看）。
 *
 * 用途：模板管理页删除前的"**是否被别的模板引用**"检查 ——
 * 这个项目里没有引用计数表，删除前现查一遍是最省事、也不会失真的做法。
 */
export function collectTemplateRefs (flow: ApprovalFlow | undefined | null): TemplateRefUsage[] {
  const out: TemplateRefUsage[] = []
  const walkSteps = (steps?: any[]) => {
    for (const s of steps ?? []) {
      if (s?.type === 'ref') {
        out.push({ nodeId: String(s.id ?? ''), label: String(s.name ?? '').trim() || '引用模板', refTemplateId: String(s.refTemplateId ?? '') })
      }
      if (s?.type === 'branch' || s?.type === 'probe') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
      }
      walkSteps(s?.steps)
    }
  }
  for (const n of (flow ?? []) as any[]) {
    if (n?.type === 'ref') {
      out.push({ nodeId: String(n.id ?? ''), label: String(n.name ?? '').trim() || '引用模板', refTemplateId: String(n.refTemplateId ?? '') })
    }
    if (n?.type === 'branch' || n?.type === 'probe') {
      for (const b of n.branches ?? []) {
        walkSteps(b.steps)
      }
    }
    walkSteps(n?.steps)
  }
  return out
}

/** 流程里有没有引用（保存期给一句提示：这份模板的线性链不含引用段落） */
export function hasTemplateRef (flow: ApprovalFlow | undefined | null): boolean {
  return collectTemplateRefs(flow).length > 0
}

/**
 * 给搬进来的一段流程**重命名 id**（加前缀）并**清掉出口标记**。
 *
 * 只改"结构性 id"，不动别的字段：`members`（审批人是人）、`conditions`（条件）、
 * `optionGroups`（选项树里存的是分支名 / 文案）一律原样带走 ——
 * 所以这里**手写结构遍历**而不是"递归改所有叫 id 的键"：成员对象上也有 id（用户 id），
 * 那种"通用改写"会把审批人改坏（极难查）。
 */
function prefixFlow (nodes: any[], prefix: string): any[] {
  const prefixNode = (n: any): any => {
    const out: any = { ...n, id: prefix + String(n.id ?? '') }
    if (out.type === 'branch' || out.type === 'probe') {
      out.branches = (n.branches ?? []).map((b: any) => prefixBranch(b))
    }
    if (out.type === 'loop') {
      out.steps = (n.steps ?? []).map((s: any) => prefixNode(s))
      if (out.afterLoop?.stepId) {
        out.afterLoop = { stepId: prefix + String(out.afterLoop.stepId) }
      }
    }
    return out
  }
  const prefixBranch = (b: any): any => {
    const out: any = { ...b, id: prefix + String(b.id ?? ''), steps: (b.steps ?? []).map((s: any) => prefixNode(s)) }
    // 源模板的"到达结束"= 这一段走完（见文件头 ②），出口标记一律清掉
    delete out.isEnd
    // 跳转 / 回退的目标都在源模板**内部**，所以用同一个前缀跟上
    if (out.loopBackTo?.stepId) {
      out.loopBackTo = { stepId: prefix + String(out.loopBackTo.stepId) }
    }
    if (out.exitTo?.stepId) {
      out.exitTo = { stepId: prefix + String(out.exitTo.stepId) }
    }
    return out
  }
  return nodes.map((n: any) => prefixNode(n))
}

/**
 * 一段流程里**第一个"可当上一级"的环节 id**。
 *
 * 为什么需要：保存期给"引用卡片后面那个环节"生成驳回目标时，上一级是**引用卡片的 id**
 * （见 utils/approvalFlow 的 ensureRejectLoopBack）；那个 id 展开后就不存在了 ——
 * 要把它换成搬进来那一段的首个环节，否则被引用段落之后的环节**一驳回就会报"目标环节不存在"**。
 *
 * 与「组间轮询」卡片的口径一致：卡片展开后同样被重映射到"第一环的第一个环节"
 * （见 utils/approvalRotation 的 rename / firstOf）。
 * 段首若是条件分支组（它不是"一步"），就往它的默认分支里找第一个环节。
 */
function firstRealStepId (nodes: any[]): string | undefined {
  for (const n of nodes) {
    if (!n) {
      continue
    }
    if (n.type === 'branch' || n.type === 'probe') {
      const b = (n.branches ?? []).find((x: any) => !x?.conditions?.length && !x?.condition) ?? (n.branches ?? [])[0]
      const inner = firstRealStepId(b?.steps ?? [])
      if (inner) {
        return inner
      }
      continue
    }
    const id = String(n.id ?? '')
    if (id) {
      return id
    }
  }
  return undefined
}

/**
 * 把**指向引用卡片**的跳转目标（`loopBackTo` / `exitTo` / `afterLoop`）改写成本层记录的真实环节 id。
 *
 * 只动这几个字段：它们是"按 id 跳转"的引用；`members`（审批人）、`conditions`（条件）、
 * `optionGroups`（选项树）一律不碰 —— 与 prefixFlow 同一份克制的口径。
 * 目标是**本层**的引用卡片，所以按传入的映射表精确匹配（引用卡片 id 由 uid 生成，不会撞）。
 *
 * ⚠️ 为什么 `afterLoop`（轮询卡片的「轮完走向」）也必须在这里换掉：
 * 它和 `exitTo` 一样是"按 id 跳转"，只是**由轮询展开生成分支**（见 utils/approvalRotation 的
 * loopEndBranchGroup）—— 那次生成发生在**本函数之后**（引用展开是最前一步，见
 * utils/expandFlowForOrder 的顺序说明），生成出来的分支已经没人再给它重映射了。
 * 漏掉它的表现：`afterLoop` 指着引用卡片 → 展开后那个 id 不存在 →
 * 建单/办理时抛「跳出循环目标环节不存在」（与 `exitTo` 漏映射同一个坑，那里踩过）。
 */
function remapRefTargets (nodes: any[], targets: Map<string, string>): void {
  if (targets.size === 0) {
    return
  }
  const fixBranch = (b: any) => {
    if (b?.loopBackTo?.stepId && targets.has(b.loopBackTo.stepId)) {
      b.loopBackTo = { stepId: targets.get(b.loopBackTo.stepId)! }
    }
    if (b?.exitTo?.stepId && targets.has(b.exitTo.stepId)) {
      b.exitTo = { stepId: targets.get(b.exitTo.stepId)! }
    }
    for (const s of b?.steps ?? []) {
      visitStep(s)
    }
  }
  const visitStep = (n: any) => {
    if (n?.type === 'branch' || n?.type === 'probe') {
      for (const b of n.branches ?? []) {
        fixBranch(b)
      }
      return
    }
    if (n?.type === 'loop') {
      // 「轮完走向」（卡片级，存的是目标节点 id）：目标正是本层的引用卡片时换掉（理由见函数说明）
      const after = String(n.afterLoop ?? '')
      if (after && targets.has(after)) {
        n.afterLoop = targets.get(after)!
      }
      for (const s of n.steps ?? []) {
        visitStep(s)
      }
    }
  }
  for (const n of nodes) {
    visitStep(n)
  }
}

/** 这段流程里有没有"有人办"的环节（审批 / 轮询卡片内部）——引用进来一段全是提醒的流程是不合法的 */
function countApprovals (nodes: any[]): number {
  let n = 0
  const walkSteps = (steps?: any[]) => {
    for (const s of steps ?? []) {
      // 步骤形态下缺省 type 就是审批（兼容旧数据）
      if (!s?.type || s.type === 'approval') {
        n++
      }
      if (s?.type === 'branch' || s?.type === 'probe') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
      }
      walkSteps(s?.steps)
    }
  }
  for (const node of nodes) {
    if (node?.type === 'approval') {
      n++
    }
    if (node?.type === 'branch' || node?.type === 'probe') {
      for (const b of node.branches ?? []) {
        walkSteps(b.steps)
      }
    }
    walkSteps(node?.steps)
  }
  return n
}

/**
 * 深拷贝纯数据（flow 是 JSON 可序列化的）。
 *
 * ⚠️ 用 JSON 往返而不是 `structuredClone`：后者遇到 Vue 的 Proxy 会抛 DataCloneError
 * （模板数据从 PB 来是纯数据，但编辑器侧随时可能把它换成响应式对象）。
 * 与项目里其它画布 / 流程快照的写法一致（见 components/flow/LoopCardDialog.vue 的 cloneGraph）。
 */
function clone<T> (value: T): T {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- 见上：Proxy 会让 structuredClone 抛 DataCloneError
  return JSON.parse(JSON.stringify(value)) as T
}
