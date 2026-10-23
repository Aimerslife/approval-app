import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/*
 * 校验与规范化直接用前端那一份（纯函数、无依赖，见 types/people 的文件头）。
 * 两边各写一套的结局一定是"前端放行、服务端拒"或反过来，而且报错口径还不一样。
 */
import {
  findPersonProblem,
  normalizePeople,
  normalizePersonRow,
  type PersonRow,
} from '../src/types/people'

/**
 * 人员配置（团队 → 默认审批人）的**落盘文件**。
 *
 * 位置：仓库根目录 `data/people.json` —— 前端也 import 同一份（打包快照），
 * 所以"页面上新增"与"手工改 JSON"改的是同一个东西，不会出现两份数据互相打架。
 *
 * 为什么由 app server 落盘、而不是让浏览器直接改：
 *   浏览器碰不到仓库里的文件（打包后那份快照是只读的）。
 *   走这个接口，新增才算真正持久化（刷新、换个人打开都还在）。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PEOPLE_FILE = path.resolve(HERE, '..', 'data', 'people.json')

/** 读整份清单。文件不存在 / 内容坏掉都按"空清单"处理，不抛错（页面还有打包快照兜底） */
export async function readPeople (): Promise<PersonRow[]> {
  try {
    const raw = await readFile(PEOPLE_FILE, 'utf8')
    return normalizePeople(JSON.parse(raw))
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[People] 读取 data/people.json 失败，按空清单处理:', error?.message ?? error)
    }
    return []
  }
}

/**
 * 新增一行并落盘，返回**写完之后**的整份清单（前端拿它直接刷新内存表，不用再拉一次）。
 *
 * 失败一律抛带中文原因的 Error —— 调用方（路由）把它原样回给页面：
 * 「为什么没存上」必须说清楚，静默失败会让用户以为加上了。
 */
export async function addPerson (raw: unknown): Promise<PersonRow[]> {
  const row = normalizePersonRow(raw)
  if (!row) {
    throw new Error('缺少必填项：上级部门、团队名、默认审批人')
  }

  const list = await readPeople()
  // 判重与字段校验和前端同一口径（personKey：去空白 + 忽略大小写）
  const problem = findPersonProblem(row, list)
  if (problem) {
    throw new Error(problem)
  }

  const next = [...list, row]
  await writePeople(next)
  return next
}

/**
 * 整份写回：先写临时文件再 rename。
 *
 * 直接 writeFile 覆盖有个窗口期 —— 这一刻别人正好读，会读到写了一半的 JSON（解析失败）。
 * rename 在同一个分区上是原子的，读的人只会看到"旧文件"或"新文件"。
 */
async function writePeople (rows: readonly PersonRow[]): Promise<void> {
  await mkdir(path.dirname(PEOPLE_FILE), { recursive: true })
  const tmp = `${PEOPLE_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  await rename(tmp, PEOPLE_FILE)
}

/** 供启动日志用：文件在哪（只打路径，不打内容） */
export const PEOPLE_FILE_PATH = PEOPLE_FILE
