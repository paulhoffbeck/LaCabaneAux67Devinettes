<script setup>
import { computed } from 'vue'
import PlayerBadge from './PlayerBadge.vue'

const props = defineProps({
  leaderboard: { type: Array, required: true }, // [{ id?, nickname, score, rank? }]
  limit: { type: Number, default: 10 },
  highlight: { type: String, default: '' }, // pseudo ou id à mettre en évidence
})

const rows = computed(() =>
  [...props.leaderboard]
    .sort((a, b) => b.score - a.score)
    .slice(0, props.limit)
    .map((p, i) => ({ ...p, rank: p.rank ?? i + 1, key: p.id ?? p.nickname })),
)

const isMe = (p) => props.highlight && (p.id === props.highlight || p.nickname === props.highlight)
</script>

<template>
  <TransitionGroup tag="ol" name="rank" class="scoreboard">
    <li v-for="p in rows" :key="p.key" :class="{ me: isMe(p), top: p.rank <= 3 }">
      <span class="rank">{{ p.rank }}</span>
      <PlayerBadge :player="p" size="sm" />
      <span class="score">{{ p.score.toLocaleString('fr-FR') }}</span>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.scoreboard {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

li {
  display: grid;
  grid-template-columns: 2ch minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.55rem 0.4rem;
  border-bottom: 1px solid var(--line, #dde1ea);
}

li:last-child {
  border-bottom: none;
}

li.me {
  background: var(--accent-soft, #e6eef7);
  border-radius: 0.4rem;
}

.rank {
  font-weight: 700;
  color: var(--ink-soft, #5b6478);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.top .rank {
  color: var(--gold, #c8901a);
}

.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rank-move {
  transition: transform 0.5s ease;
}
</style>
