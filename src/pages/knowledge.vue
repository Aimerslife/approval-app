<template>
  <v-container>
    <v-sheet class="d-flex align-center gap-2">
      <v-card class="mx-auto" max-width="400" v-for="i in 10" :key="i">
          <v-img class="align-end text-white" height="100" src="https://cdn.vuetifyjs.com/images/cards/docks.jpg" cover>
            <v-card-title>Top 10 Australian beaches</v-card-title>
          </v-img>

          <v-card-subtitle class="pt-4">
            Number 10
          </v-card-subtitle>

          <v-card-text>
            <div>Whitehaven Beach</div>

            <div>Whitsunday Island, Whitsunday Islands</div>
          </v-card-text>

          <v-card-actions>
            <v-btn color="orange" text="Share"></v-btn>

            <v-btn color="orange" text="Explore"></v-btn>
          </v-card-actions>
        </v-card>
    </v-sheet>
  </v-container>
</template>
<script setup lang="ts">

</script>