<template>
    <v-dialog :model-value="open" max-width="560" @update:model-value="onToggle">
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center ga-2 text-[14px]">
                <v-icon color="primary" size="18">mdi-function-variant</v-icon>
                <span>左值运算</span>
                <v-spacer />
                <v-chip v-if="mainField" size="x-small" variant="tonal" color="primary">主字段：{{ mainField }}</v-chip>
            </v-card-title>

            <v-card-text>
                <div class="math-hint mb-2">
                    左边可以不是单个字段，而是几个字段的加减乘除：例如 总库存金额 - 已接收数量。
                    支持 + - * / 与括号；字段取不到值（或语法有误）时这条条件<b>不命中</b>。
                </div>
                <input v-model="draft" class="math-editor" placeholder="总库存金额 - 已接收数量">
                <div class="d-flex flex-wrap ga-1 mt-2">
                    <v-btn v-for="t in MATH_TOKENS" :key="t" density="comfortable" size="small" variant="tonal"
                        @click="insert(t)">
                        {{ t }}
                    </v-btn>
                </div>
                <div class="d-flex flex-wrap ga-1 mt-2">
                    <v-chip v-for="f in fields" :key="f.value" size="x-small" variant="outlined" color="grey"
                        @click="insert(f.value)">
                        {{ f.label }}
                    </v-chip>
                </div>
                <v-alert v-if="check.error" class="mt-3 text-[12px]" density="compact" type="error" variant="tonal">
                    {{ check.error }}
                </v-alert>
                <v-alert v-else-if="unknown.length > 0" class="mt-3 text-[12px]" density="compact" type="warning" variant="tonal">
                    这些名字不在字段候选里：{{ unknown.join('、') }}。仍可保存（取值时按名字从上下文取），
                    但请确认没有拼错 —— 拼错的名字永远取不到值，这条条件会一直不命中。
                </v-alert>

                <div v-else-if="check.fields.length > 0" class="math-hint mt-2">
                    将读取：{{ check.fields.join('、') }}
                </div>
            </v-card-text>

            <v-card-actions>
                <v-btn v-if="hasExpr" class="text-none" color="error" size="small" variant="text" @click="commit('')">
                    清除运算
                </v-btn>

                <v-spacer />
                <v-btn class="text-none" size="small" variant="text" @click="emit('close')">取消</v-btn>
                <v-btn class="text-none" color="primary" :disabled="!!check.error" size="small" variant="flat"
                    @click="commit(draft)">
                    保存
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { parseArithmetic } from '@/utils/conditionMath'

/**
 * 运算符按钮只给半角：解析器认全角（会在 conditionMath 里折算），
 * 但写进模板的该是半角 —— 同一条式子里混着「（）」和「()」以后很难维护。
 */
const MATH_TOKENS = ['+', '-', '*', '/', '(', ')'] as const

const props = withDefaults(defineProps<{
    open: boolean
    /** 打开时的表达式（空 = 这条条件还没配运算） */
    expr?: string
    /** 字段候选：与调用方的条件字段清单**同源**（别在这里另写一份） */
    fields?: readonly { value: string, label: string }[]
}>(), {
    expr: '',
    fields: () => [],
})

const emit = defineEmits<{
    close: []
    /** 表达式（空串 = 清除运算，回到"单字段 vs 值"） */
    save: [expr: string]
}>()

/** 编辑中的草稿：点「取消」不能改动已保存的表达式 */
const draft = ref('')

watch(() => [props.open, props.expr], () => {
    if (props.open) {
        draft.value = props.expr
    }
}, { immediate: true })

const hasExpr = computed(() => String(props.expr ?? '').trim().length > 0)

/** 语法检查（**不取值**）：模板期没有行数据，能查的只有写法对不对 */
const check = computed(() => parseArithmetic(draft.value))

/** 主字段 = 表达式里的第一个变量（调用方写回 `field`，展示 / 分组等老口径还认它） */
const mainField = computed(() => check.value.fields[0] ?? '')

/** 不在候选清单里的名字：只提示不拦 —— 上下文里可能有候选表没列的键 */
const unknown = computed(() =>
    check.value.fields.filter(f => !props.fields.some(o => o.value === f)),
)

function onToggle(value: boolean | null) {
    if (!value) {
        emit('close')
    }
}

/** 点变量 / 运算符按钮：接到末尾（该补空格的地方补上，读起来才像一条式子） */
function insert(token: string) {
    const cur = draft.value.trimEnd()
    const needSpace = cur.length > 0 && !/[+\-*/(]$/.test(cur)
    draft.value = `${cur}${needSpace ? ' ' : ''}${token}${token === '(' ? '' : ' '}`
}

/** 提交（空串 = 清除）：关闭由调用方负责，它还要写回条件对象 */
function commit(expr: string) {
    emit('save', expr.trim())
}
</script>

<style scoped lang="scss">
/*
    输入框与面板里的 .panel-input 同款（26~30px 高、12px 字、浅描边）：
    但那个类是各页面自己的 scoped 样式，弹窗又 teleport 到 body，所以这里自备一份。
  */
.math-editor {
    width: 100%;
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--flow-input-text);
    background: var(--flow-input-bg);
    border: 1px solid var(--flow-input-border);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:hover {
        border-color: var(--flow-border-strong);
    }

    &:focus {
        border-color: var(--flow-input-focus);
        box-shadow: 0 0 0 2px rgb(245 158 11 / 12%);
    }

    &::placeholder {
        color: var(--flow-text-muted);
    }
}

.math-hint {
    font-size: 11px;
    line-height: 1.6;
    color: var(--flow-text-sub);
}
</style>
