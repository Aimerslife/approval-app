<template>
    <v-container fluid class="page-bg min-h-screen px-6 py-10">
        <div class="mx-auto" style="max-width: 920px">
            <!-- 基本设置 -->
            <div class="d-flex align-center justify-space-between mb-3">
                <div class="block-title">基本设置</div>
                <v-chip size="small" variant="tonal" color="primary" label>账号信息</v-chip>
            </div>
            <v-sheet border rounded="xl" class="overflow-hidden mb-8">
                <template v-for="(item, i) in basicListItems" :key="item.key">
                    <div class="setting-row">
                        <div class="setting-row-label">{{ item.title }}</div>
                        <div class="setting-row-value">
                            <template v-if="item.key === 'avatar_url'">
                                <v-avatar size="42" color="primary" variant="tonal">
                                    <v-img v-if="userStore.user?.avatar_url" :src="userStore.user?.avatar_url"></v-img>
                                    <v-icon v-else icon="mdi-account" size="26"></v-icon>
                                </v-avatar>
                            </template>
                            <!-- 部门行把完整路径挂到 title 上，鼠标悬浮可见（如「总公司 / 财务部 / 财务BP组」） -->
                            <span v-else
                                :title="item.key === 'department' ? userStore.user?.department_path : undefined">{{
                                    fieldText(item.key) }}</span>
                        </div>
                        <v-spacer />
                        <v-icon-btn v-if="item.editable" icon="mdi-pencil-outline" size="small" variant="text"
                            color="primary" title="编辑" @click="handleEdit(item.key)"></v-icon-btn>
                        <v-icon v-else icon="mdi-lock-outline" size="15" class="mr-1" title="该字段不可编辑"></v-icon>
                    </div>
                    <v-divider v-if="i !== basicListItems.length - 1" :key="`d-${item.key}`"></v-divider>
                </template>
            </v-sheet>

            <!-- 字段设置 -->
            <div class="d-flex align-center flex-wrap ga-2 justify-space-between mb-2">
                <div class="block-title">字段设置</div>
                <div class="d-flex align-center ga-2">
                    <v-chip size="small" variant="tonal" color="success" label>
                        显示 {{headers.filter(h => h.visualable).length}}
                    </v-chip>
                    <v-chip size="small" variant="tonal" label>共 {{ headers.length }} 项</v-chip>
                </div>
            </div>
            <p class="text-[12.5px] text-medium-emphasis mb-3 mt-1">
                控制「呆滞库存数据」中字段列的展示，关闭后数据列表将隐藏对应列。
            </p>
            <v-sheet border rounded="xl" class="overflow-hidden mb-8">
                <div class="d-flex align-center justify-space-between px-5 py-3">
                    <div>
                        <v-icon icon="mdi-table-eye" size="16" color="primary" class="mr-2"></v-icon>
                    <span class="text-[13px] font-semibold">字段显隐开关</span>
                    </div>
                    <v-btn variant="tonal" size="small" color="primary" @click="saveSetting">保存</v-btn>
                </div>
                <v-divider />
                <div class="field-grid pa-4">
                    <div v-for="item in headers" :key="item.key" class="field-pill">
                        <span class="field-title" :title="item.title">{{ item.title }}</span>
                        <v-switch :model-value="item.visualable" color="primary" density="compact" hide-details
                            class="field-switch" @update:model-value="handleVisual(item.key)" 
                            true-icon="mdi-check" false-icon="mdi-close"></v-switch>
                    </div>
                </div>
            </v-sheet>

            <div class="d-flex align-center flex-wrap ga-2 justify-space-between mb-2">
                <div class="block-title">程序信息</div>
            </div>
            <v-sheet border rounded="xl" class="overflow-hidden mb-8">
                <template v-for="(item, i) in appListItems" :key="item.key">
                    <div class="setting-row">
                        <div class="setting-row-label">{{ item.title }}</div>
                        <v-spacer />
                    </div>
                    <v-divider v-if="i !== basicListItems.length - 1" :key="`d-${item.key}`"></v-divider>
                </template>
            </v-sheet>
        </div>

        <!-- 编辑账号字段：basicListItems 里目前只有邮箱可编辑 -->
        <v-dialog v-model="editDialog" max-width="420">
            <v-card>
                <v-card-title class="text-[16px]">修改邮箱</v-card-title>
                <v-card-text>
                    <v-text-field v-model="editEmail" label="邮箱" type="email" variant="outlined" density="compact"
                        hide-details="auto" autofocus @keyup.enter="confirmEdit"></v-text-field>
                    <v-alert v-if="editError" type="error" variant="tonal" density="compact" class="mt-3">
                        {{ editError }}
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="editDialog = false">取消</v-btn>
                    <v-btn color="primary" variant="flat" :loading="editSaving" @click="confirmEdit">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>
<script lang="ts" setup>
import type { UserInfo } from '@/stores/user'
import { useUserStore } from '@/stores/user'
import { DEFAULT_VISUALABLE, PRODUCT_FIELDS } from '@/utils/productFields'

const userStore = useUserStore()

/**
 * 安全读取用户字段的展示文本。
 * UserInfo 是具名接口、没有索引签名，模板里直接 user[key]（key: string）会触发
 * TS 报错；同时把「用户表里不存在的占位字段」统一兜底，避免永远空白却无人察觉。
 */
function fieldText(key: string): string {
    const u = userStore.user
    if (!u) return ''
    if (!(key in u)) return '未设置' // 部门 / 角色：用户表暂无对应字段，预留占位
    const v = u[key as keyof UserInfo]
    return v == null || v === '' ? '未填写' : String(v)
}
const basicListItems = [
    {
        title: '企业',
        key: 'company_name',
        editable: false,
    },
    {
        title: '姓名',
        key: 'name',
        editable: false,
    },
    {
        title: '头像',
        key: 'avatar_url',
        editable: false,
    },
    {
        title: '邮箱',
        key: 'email',
        editable: true,
    },
    {
        title: '部门',
        key: 'department',
        editable: false,
    },
    {
        title: '角色',
        key: 'role',
        editable: false,
    }
]

const appListItems = [
    {
        title: '使用文档',
        key: 'libary',
    },
    {
        title: '版本号',
        key: 'version',
    },
    {
        title: '问题反馈',
        key: 'contact',
    },
]


// 字段清单统一取自 productFields.ts（BI 增 / 删字段只改那一处，三份副本已合并）
const headers = ref(
    PRODUCT_FIELDS.map(f => ({ title: f.title, key: f.key, visualable: f.visualable })),
)

/** 用 PB 里的偏好覆盖默认值；数据异常（非布尔）时忽略，回落 productFields.ts 的默认值 */
function applyPreferences() {
    const saved = userStore.preferences.columnVisibility
    if (!saved) return
    headers.value.forEach((item) => {
        const v = saved[item.key]
        if (typeof v === 'boolean') item.visualable = v
    })
}
function saveSetting(){

}

// —— 账号字段编辑：basicListItems 里目前只有 email 标了 editable ——
const editDialog = ref(false)
const editEmail = ref('')
const editSaving = ref(false)
const editError = ref('')

function handleEdit(key: string) {
    if (key !== 'email') return
    editEmail.value = userStore.user?.email ?? ''
    editError.value = ''
    editDialog.value = true
}

async function confirmEdit() {
    if (editSaving.value) return
    editSaving.value = true
    editError.value = ''
    try {
        await userStore.updateProfile({ email: editEmail.value.trim() })
        editDialog.value = false
    } catch (err: any) {
        console.error('[userSetting] 更新邮箱失败:', err)
        // PocketBase 的字段级校验详情在 err.response.data 里
        editError.value = err?.response?.data?.message ?? err?.message ?? '保存失败，请稍后重试'
    } finally {
        editSaving.value = false
    }
}

/** 只把「与默认值不同」的项写回 PB，避免存一份会过期的全量快照 */
function persistPreferences() {
    const diff: Record<string, boolean> = {}
    for (const item of headers.value) {
        if (item.visualable !== DEFAULT_VISUALABLE[item.key]) diff[item.key] = item.visualable
    }
    userStore.savePreferences({ columnVisibility: diff }).catch((err) => {
        console.error('[userSetting] 保存字段显隐失败:', err)
    })
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function handleVisual(key: string) {
    const item = headers.value.find(h => h.key === key)
    if (!item) return
    item.visualable = !item.visualable
    // 开关可能连点，防抖后再落库，避免每个开关都发一次请求
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persistPreferences, 400)
}
// 登录态是异步恢复的（authStore 初始化 / 重新登录），偏好到位后再覆盖一次
watch(() => userStore.preferences.columnVisibility, applyPreferences, { deep: true })
onMounted(()=>{
    applyPreferences()
})
</script>
<style scoped lang="scss">
/* 基本设置行 */
.setting-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
}

.setting-row+.setting-row {
    border-top: 1px solid rgba(127, 140, 170, 0.18);
}

.v-theme--dark .setting-row+.setting-row {
    border-top-color: rgba(255, 255, 255, 0.08);
}

.setting-row-label {
    width: 100px;
    flex: none;
    font-size: 13px;
    color: grey;
}

.setting-row-value {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: 13.5px;
    color: rgb(var(--v-theme-on-surface));
}

/* 字段显隐栅格 */
.field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(235px, 1fr));
    gap: 6px 10px;
}

.field-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 12px;
    border-radius: 8px;
    // background-color: rgba(28, 50, 100, 0.05);
    border: 1px solid rgba(28, 50, 100, 0.06);
}

.v-theme--dark .field-pill {
    background-color: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.06);
}

.field-title {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.field-switch {
    flex: none;
    transform: scale(0.82);
    transform-origin: right center;
}
</style>