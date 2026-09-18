<template>
  <v-container class="page-bg" fluid>
    <v-sheet class=" border-dashed border-accent p-3">
      <div class="block-title">审批单号</div>
      <v-divider class="my-3" />

      <v-data-table
        class="text-body-small"
        density="compact"
        :headers="headers"
        hide-default-footer
        item-value="name"
        hover
        :items="chians"
      >
        <template #item="{ item }">
          <tr class="text-no-wrap">
            <td>{{ item.name }}</td>
            <td>{{ item.approver }}</td>

            <td>
              <v-chip
                :color="item.result === 1 ? 'success' : item.result === 2 ? 'warning' : 'error'"
                size="small"
                variant="flat"
              >
                {{ item.result === 1 ? '通过' : item.result === 2 ? '退回' : '待审批' }}
              </v-chip>
            </td>

            <td>{{ item.opinion }}</td>

            <td>
              <span class="text-grey">{{ formatDate(item.cost) }}</span>
            </td>

            <td class="text-start">
              <v-btn class="pe-2 mr-3" color="#1055C9" size="small" variant="tonal">
                <span class="">通过</span>

                <v-dialog activator="parent" max-width="500">
                  <template #default="{ isActive }">
                    <v-card rounded="lg">
                      <v-card-text>
                        <div class="mb-2">审批意见</div>

                        <v-textarea
                          :counter="300"
                          persistent-counter
                          rows="2"
                          variant="outlined"
                        />

                        <div class="d-flex align-center ga-2">
                          <input
                            ref="fileInput"
                            class="d-none"
                            type="file"
                            @change="onFileSelected"
                          >

                          <v-btn
                            class="text-none pa-0"
                            color="primary"
                            prepend-icon="mdi-link-variant"
                            size="small"
                            variant="text"
                            @click="fileInput?.click()"
                          >
                            上传附件
                          </v-btn>

                          <span
                            v-if="fileName"
                            class="text-caption text-grey text-truncate text-[13px] text-decoration-underline"
                          >
                            {{ fileName }}
                            <v-btn
                              class="ml-2"
                              icon
                              size="20px"
                              variant="text"
                              @click="fileName = ''"
                            >
                              <v-icon class="text-grey" size="15px">mdi-close</v-icon>
                            </v-btn>
                          </span>
                        </div>
                      </v-card-text>

                      <v-divider />

                      <v-card-actions class="my-2 d-flex justify-end">
                        <v-btn
                          class="text-none"
                          rounded="xl"
                          text="取消"
                          @click="isActive.value = false"
                        />

                        <v-btn
                          class="text-none"
                          color="primary"
                          rounded="xl"
                          text="提交"
                          variant="flat"
                          @click="isActive.value = false"
                        />
                      </v-card-actions>
                    </v-card>
                  </template>
                </v-dialog>
              </v-btn>

              <v-btn color="error" size="small" variant="text">驳回</v-btn>
            </td>
          </tr>
        </template>
      </v-data-table>
    </v-sheet>

    <v-dialog v-model="dialog" width="auto">
      <v-card min-width="400" prepend-icon="mdi-delete" text="确认删除当前模板" title="删除审批模板">
        <template #actions>
          <v-btn class="ms-auto" text="确认" @click="dialog = false" />
          <v-btn text="取消" @click="dialog = false" />
        </template>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script lang="ts" setup>
  import { formatDate } from '@/utils/utils'

  const dialog = ref(false)
  const fileInput = ref<HTMLInputElement>()
  const fileName = ref('')

  // function calculateTime(time){
  //     const now=new Date()
  //     const diff=now.getTime()-time.getTime()
  //     return diff
  // }

  function onFileSelected (event: Event) {
    const input = event.target as HTMLInputElement
    fileName.value = input.files?.[0]?.name ?? ''
    // TODO: 上传附件
  }

  interface ApprovalDetailItem {
    name: string
    approver: string
    result: number // 0 待审批 1 通过 2 退回
    opinion: string
    cost: string
  }

  const chians = ref<ApprovalDetailItem[]>([
    {
      name: '部门经理审批',
      approver: '张伟',
      result: 1,
      opinion: '同意，预算合理',
      cost: '2026-08-01 09:30',
    },
    {
      name: '财务复核',
      approver: '李娜',
      result: 1,
      opinion: '金额无误，准予报销',
      cost: '2026-08-01 14:12',
    },
    {
      name: '总经理审批',
      approver: '王强',
      result: 2,
      opinion: '请补充差旅明细',
      cost: '2026-08-02 10:05',
    },
    {
      name: '分管副总审批',
      approver: '赵敏',
      result: 0,
      opinion: '等待材料补充',
      cost: '2026-08-03 16:40',
    },
    {
      name: '归档',
      approver: '系统',
      result: 0,
      opinion: '',
      cost: '',
    },
  ])

  const headers = [
    { title: '节点名称', key: 'name' },
    { title: '审批人', key: 'approver' },
    { title: '审批结果', key: 'result' },
    { title: '审批意见', key: 'opinion' },
    { title: '审批时长', key: 'cost' },
    { title: '操作', key: 'action' },
  ] as const

  function goEdit () {
    // TODO: 跳转到编辑页
  }

  onMounted(() => {})
</script>

<style scoped></style>
