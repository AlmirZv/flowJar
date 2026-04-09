<script setup>
import { computed, ref } from 'vue'
import { formatDuration, formatHours } from '../composables/useTimeFormat'
import { TEAM_LIQUID_PALETTE } from '../stores/projects'

const props = defineProps({
  title: { type: String, default: 'Statistics' },
  todaySeconds: { type: Number, default: 0 },
  totalSeconds: { type: Number, default: 0 },
  byDays: { type: Array, default: () => [] },
  open: { type: Boolean, default: false },
  teamRows: { type: Array, default: () => [] },
  /** Per-user daily series for team charts; null = single series from byDays */
  teamSeries: { type: Array, default: null },
  /** Project detail: no internal scroll; content fits in viewport */
  fitWithoutScroll: { type: Boolean, default: false },
})

const MAX_DAYS_NO_SCROLL = 8

const showChart = ref(false)
const chartGranularity = ref('day')

function mondayKeyUtc(isoDay) {
  const dt = new Date(`${isoDay}T12:00:00.000Z`)
  const dow = dt.getUTCDay()
  const diff = (dow + 6) % 7
  const mon = new Date(dt.getTime())
  mon.setUTCDate(dt.getUTCDate() - diff)
  return mon.toISOString().slice(0, 10)
}

function bucketByDays(rows, mode) {
  const acc = new Map()
  for (const { day, duration } of rows) {
    let key = day
    if (mode === 'week') key = mondayKeyUtc(day)
    else if (mode === 'month') key = day.slice(0, 7)
    acc.set(key, (acc.get(key) || 0) + Number(duration || 0))
  }
  return Array.from(acc.entries())
    .map(([period, duration]) => ({ period, duration }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

function formatPeriodLabel(period, mode) {
  if (mode === 'day') {
    const parts = period.split('-')
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : period
  }
  if (mode === 'week') {
    const parts = period.split('-')
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : period
  }
  if (mode === 'month') {
    const [y, mo] = period.split('-')
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const mi = Number(mo) - 1
    return mi >= 0 && mi < 12 ? `${months[mi]} ${y}` : period
  }
  return period
}

function formatAxisSeconds(sec) {
  const h = sec / 3600
  if (h >= 1) return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`
  const m = Math.round(sec / 60)
  return `${m}m`
}

const seriesForChart = computed(() => {
  if (props.teamSeries?.length) {
    return props.teamSeries.map((s, i) => ({
      userId: s.userId,
      color: TEAM_LIQUID_PALETTE[i % TEAM_LIQUID_PALETTE.length],
      label:
        props.teamRows.find((r) => r.userId === s.userId)?.label || `Member ${i + 1}`,
      byDays: s.byDays || [],
    }))
  }
  return [
    {
      userId: '_',
      color: TEAM_LIQUID_PALETTE[0],
      label: 'Time',
      byDays: props.byDays || [],
    },
  ]
})

const byDaysForList = computed(() => {
  if (!props.fitWithoutScroll || props.byDays.length <= MAX_DAYS_NO_SCROLL) return props.byDays
  return props.byDays.slice(0, MAX_DAYS_NO_SCROLL)
})

const byDaysOmittedCount = computed(() => {
  if (!props.fitWithoutScroll) return 0
  return Math.max(0, props.byDays.length - MAX_DAYS_NO_SCROLL)
})

const chartModel = computed(() => {
  const mode = chartGranularity.value
  const bucketed = seriesForChart.value.map((s) => ({
    ...s,
    points: bucketByDays(s.byDays, mode),
  }))

  const periodSet = new Set()
  bucketed.forEach((s) => s.points.forEach((p) => periodSet.add(p.period)))
  const periods = Array.from(periodSet).sort((a, b) => a.localeCompare(b))

  const W = 320
  const compact = props.fitWithoutScroll
  const H = compact ? 118 : 150
  const padL = 42
  const padR = 8
  const padT = compact ? 6 : 8
  const padB = compact ? 28 : 38
  const iw = W - padL - padR
  const ih = H - padT - padB

  if (periods.length === 0) {
    return {
      W,
      H,
      padL,
      padT,
      periods: [],
      seriesLines: [],
      gridLines: [],
      ticks: [],
      xLabels: [],
    }
  }

  let maxVal = 1
  bucketed.forEach((s) => {
    s.points.forEach((p) => {
      if (p.duration > maxVal) maxVal = p.duration
    })
  })

  const n = periods.length

  function valueAt(seriesPoints, period) {
    const found = seriesPoints.find((p) => p.period === period)
    return found ? found.duration : 0
  }

  const seriesLines = bucketed.map((s) => {
    const pts = periods.map((period, i) => {
      const v = valueAt(s.points, period)
      const x = padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
      const y = padT + ih - (v / maxVal) * ih
      return { x, y, v }
    })
    const pointsStr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    return { ...s, pts, pointsStr }
  })

  const tickCount = 4
  const ticks = []
  const gridLines = []
  for (let t = 0; t <= tickCount; t++) {
    const frac = t / tickCount
    const val = maxVal * frac
    const y = padT + ih - frac * ih
    ticks.push({ y, label: formatAxisSeconds(val) })
    gridLines.push({ y })
  }

  const xTickIndices =
    n <= 8
      ? [...Array(n).keys()]
      : (() => {
          const set = new Set()
          for (let i = 0; i < 8; i++) set.add(Math.round((i * (n - 1)) / 7))
          return Array.from(set).sort((a, b) => a - b)
        })()

  const xLabels = xTickIndices.map((i) => ({
    x: padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw),
    text: formatPeriodLabel(periods[i], mode),
  }))

  return {
    W,
    H,
    padL,
    padT,
    periods,
    seriesLines,
    gridLines,
    ticks,
    xLabels,
  }
})
</script>

<template>
  <section class="stats-sheet" :class="{ open, 'stats-sheet--fit': fitWithoutScroll }">
    <div v-if="!fitWithoutScroll" class="swipe-hint">Swipe up to open, swipe down to close</div>
    <div v-else class="swipe-hint swipe-hint--compact">Swipe down to close</div>
    <h3 class="stats-sheet-title">{{ title }}</h3>
    <div class="stats-grid">
      <div>
        <p class="stats-label">Today</p>
        <p>{{ formatDuration(todaySeconds) }}</p>
      </div>
      <div>
        <p class="stats-label">Total</p>
        <p>{{ formatHours(totalSeconds) }} h</p>
      </div>
    </div>

    <div v-if="teamRows.length" class="team-sheet-block">
      <p class="stats-label">Team (all members)</p>
      <ul class="team-sheet-list">
        <li v-for="row in teamRows" :key="row.userId" class="team-sheet-row">
          <span>{{ row.label }}</span>
          <strong>{{ formatHours(row.seconds) }} h</strong>
        </li>
      </ul>
    </div>

    <div class="stats-sheet-fill">
    <div class="stats-history-toolbar">
      <div class="stats-view-toggle">
        <button
          type="button"
          class="stats-seg-btn"
          :class="{ active: !showChart }"
          @click="showChart = false"
        >
          List
        </button>
        <button
          type="button"
          class="stats-seg-btn"
          :class="{ active: showChart }"
          @click="showChart = true"
        >
          Chart
        </button>
      </div>
      <div v-if="showChart" class="stats-granularity">
        <button
          type="button"
          class="stats-seg-btn stats-seg-btn--sm"
          :class="{ active: chartGranularity === 'day' }"
          @click="chartGranularity = 'day'"
        >
          Days
        </button>
        <button
          type="button"
          class="stats-seg-btn stats-seg-btn--sm"
          :class="{ active: chartGranularity === 'week' }"
          @click="chartGranularity = 'week'"
        >
          Weeks
        </button>
        <button
          type="button"
          class="stats-seg-btn stats-seg-btn--sm"
          :class="{ active: chartGranularity === 'month' }"
          @click="chartGranularity = 'month'"
        >
          Months
        </button>
      </div>
    </div>

    <div v-if="showChart" class="stats-chart-wrap">
      <template v-if="chartModel.periods.length === 0">
        <p class="stats-chart-empty muted">No sessions yet</p>
      </template>
      <template v-else>
        <svg
          class="stats-chart-svg"
          :viewBox="`0 0 ${chartModel.W} ${chartModel.H}`"
          preserveAspectRatio="xMidYMid meet"
        >
          <line
            v-for="(g, gi) in chartModel.gridLines"
            :key="`g-${gi}`"
            :x1="chartModel.padL"
            :y1="g.y"
            :x2="chartModel.W - 8"
            :y2="g.y"
            class="stats-chart-grid"
          />
          <text
            v-for="(t, ti) in chartModel.ticks"
            :key="`ty-${ti}`"
            x="4"
            :y="t.y + 4"
            class="stats-chart-axis-text"
          >
            {{ t.label }}
          </text>
          <polyline
            v-for="s in chartModel.seriesLines"
            v-show="s.pts.length > 1"
            :key="`pl-${s.userId}`"
            fill="none"
            :stroke="s.color"
            stroke-width="2.25"
            stroke-linecap="round"
            stroke-linejoin="round"
            :points="s.pointsStr"
          />
          <circle
            v-for="s in chartModel.seriesLines"
            v-show="s.pts.length === 1"
            :key="`dot-${s.userId}`"
            :cx="s.pts[0].x"
            :cy="s.pts[0].y"
            r="4"
            :fill="s.color"
          />
          <text
            v-for="(xl, xi) in chartModel.xLabels"
            :key="`xl-${xi}`"
            :x="xl.x"
            :y="chartModel.H - 10"
            text-anchor="middle"
            class="stats-chart-axis-text stats-chart-x-label"
          >
            {{ xl.text }}
          </text>
        </svg>
        <ul v-if="seriesForChart.length > 1" class="stats-chart-legend">
          <li v-for="s in seriesForChart" :key="s.userId">
            <span class="stats-chart-swatch" :style="{ background: s.color }" />
            <span>{{ s.label }}</span>
          </li>
        </ul>
      </template>
    </div>

    <ul v-else class="days-list">
      <li v-for="day in byDaysForList" :key="day.day">
        <span>{{ day.day }}</span>
        <strong>{{ formatDuration(day.duration) }}</strong>
      </li>
      <li v-if="byDays.length === 0">No sessions yet</li>
      <li v-else-if="byDaysOmittedCount > 0" class="days-list-more muted">
        +{{ byDaysOmittedCount }} older day{{ byDaysOmittedCount === 1 ? '' : 's' }}
      </li>
    </ul>
    </div>
  </section>
</template>
