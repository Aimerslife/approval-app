<template>
  <v-empty-state
    headline="暂无内容"
    text="内容开发中，完成后开放"
    title=""
    @click:action="onClickAction"
  ></v-empty-state>
</template>
<script setup lang="ts">
   function onClickAction () {
    alert('You clicked the action button')
  }
</script>
