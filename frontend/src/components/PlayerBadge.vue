<script setup>
import { computed } from 'vue'

const props = defineProps({
  player: { type: Object, required: true }, // { nickname, color? }
  size: { type: String, default: 'md' }, // 'sm' | 'md'
})

// Sans couleur fournie par le serveur, on en déduit une du pseudo (toujours la même)
const PALETTE = ['#2f5d8a', '#8a4f7d', '#2b8a6e', '#b5651d', '#5a5fb0', '#9a3b3b', '#3f7f3f', '#7a6a2f']
const color = computed(() => {
  if (props.player.color) return props.player.color
  const sum = [...(props.player.nickname ?? '')].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return PALETTE[sum % PALETTE.length]
})
const initial = computed(() => props.player.nickname?.trim().charAt(0).toUpperCase() || '?')
</script>

<template>
  <span class="badge" :class="size">
    <span class="dot" :style="{ background: color }">{{ initial }}</span>
    <span class="name">{{ player.nickname }}</span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.55em;
  min-width: 0;
  font-weight: 600;
}

.dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9em;
  height: 1.9em;
  border-radius: 50%;
  color: #fff;
  font-size: 0.85em;
  font-weight: 700;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm {
  font-size: 0.9rem;
}

.md {
  font-size: 1rem;
}
</style>
