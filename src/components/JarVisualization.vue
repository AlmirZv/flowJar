<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gradientFromColor } from '../utils/liquidColors'

const props = defineProps({
  totalSeconds: { type: Number, default: 0 },
  isRunning: { type: Boolean, default: false },
  targetSeconds: { type: Number, default: 10000 },
  /** Multiple participants: { key, seconds, color }[] — bottom to top in array order */
  fillSegments: { type: Array, default: () => [] },
  /** Optional CSS vars for pour stream: { '--stream-top', '--stream-join', '--liquid-deep' } */
  accentStream: { type: Object, default: null },
  /** Smaller jar for tight layouts (e.g. project screen without scroll) */
  compact: { type: Boolean, default: false },
})

const jarRef = ref(null)
const jarRect = ref({ left: 0, top: 0, width: 170, height: 260 })
const streamVisible = ref(false)
const streamStarting = ref(false)
const streamStopping = ref(false)
let streamTimerId = null
const streamLines = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  left: `${Math.random() * 100}%`,
  delay: `${Math.random() * 0.9}s`,
  opacity: 0.45 + Math.random() * 0.5,
}))
const streamBubbles = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  left: `${10 + Math.random() * 80}%`,
  delay: `${Math.random() * 1.8}s`,
  size: `${2 + Math.random() * 3}px`,
}))
const edgeCutsLeft = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  width: `${0.8 + Math.random() * 1.8}px`,
  delay: `${Math.random() * 1.4}s`,
  duration: `${1.2 + Math.random() * 0.8}s`,
}))
const edgeCutsRight = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  width: `${0.8 + Math.random() * 1.8}px`,
  delay: `${Math.random() * 1.4}s`,
  duration: `${1.2 + Math.random() * 0.8}s`,
}))
const inflowParticles = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  delay: `${Math.random() * 1.2}s`,
  x: `${-14 + Math.random() * 28}px`,
}))
const foamDotsCenter = Array.from({ length: 26 }, (_, i) => ({
  id: i + 1,
  left: `${Math.random() * 100}%`,
  bottom: `${Math.random() * 11}px`,
  width: `${4 + Math.random() * 6}px`,
  height: `${3 + Math.random() * 4}px`,
  delay: `${Math.random() * 1.5}s`,
  duration: `${1.35 + Math.random() * 0.9}s`,
}))
const foamDotsSide = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  left: `${Math.random() * 100}%`,
  bottom: `${Math.random() * 10}px`,
  width: `${3 + Math.random() * 4}px`,
  height: `${2 + Math.random() * 3}px`,
  delay: `${Math.random() * 1.6}s`,
  duration: `${1.5 + Math.random() * 1.1}s`,
}))
const edgeSplashesLeft = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  delay: `${Math.random() * 1.1}s`,
  size: `${2 + Math.random() * 2}px`,
  dx: `${-6 - Math.random() * 10}px`,
  peak: `${6 + Math.random() * 8}px`,
  fall: `${18 + Math.random() * 10}px`,
}))
const edgeSplashesRight = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  delay: `${Math.random() * 1.1}s`,
  size: `${2 + Math.random() * 2}px`,
  dx: `${6 + Math.random() * 10}px`,
  peak: `${6 + Math.random() * 8}px`,
  fall: `${18 + Math.random() * 10}px`,
}))

const fillPercent = computed(() => {
  const targetSeconds = Math.max(1, Number(props.targetSeconds) || 10000)
  return Math.min(100, ((props.totalSeconds || 0) / targetSeconds) * 100)
})

const levelClass = computed(() => {
  if (fillPercent.value < 30) return 'level-low'
  if (fillPercent.value < 70) return 'level-mid'
  return 'level-high'
})

const streamLevelClass = computed(() => levelClass.value.replace('level-', 'stream-'))
const splashActive = computed(() => streamVisible.value && !streamStarting.value && fillPercent.value > 0)

const useMultiFill = computed(() => (props.fillSegments?.length || 0) > 1)

const stackedSegments = computed(() => {
  const segs = props.fillSegments || []
  if (segs.length <= 1) return []
  const total = segs.reduce((s, x) => s + Math.max(0, Number(x.seconds) || 0), 0)
  return segs.map((x, idx) => ({
    key: x.key ?? x.userId ?? idx,
    pct: total > 0 ? (Math.max(0, Number(x.seconds) || 0) / total) * 100 : 0,
    gradient: gradientFromColor(x.color || '#0ea5e9'),
  }))
})

const pourStreamClass = computed(() => {
  if (props.accentStream) return 'stream-accent'
  return streamLevelClass.value
})

const pourBaseStyle = computed(() => {
  const a = props.accentStream
  if (!a?.['--stream-top']) return {}
  return {
    ...a,
    background: `linear-gradient(180deg, ${a['--stream-top']}, ${a['--stream-join']})`,
  }
})
const inflowStyle = computed(() => {
  if (!props.accentStream) return {}
  const j = props.accentStream['--stream-join']
  const d = props.accentStream['--liquid-deep']
  if (!j || !d) return {}
  return {
    background: `linear-gradient(180deg, ${j}, ${d})`,
  }
})

const streamStyle = computed(() => {
  const fillPx = jarRect.value.height * (fillPercent.value / 100)
  const topY = jarRect.value.top + jarRect.value.height - fillPx
  const bodyOverlapPx = Math.min(14, Math.max(0, fillPx))
  return {
    left: `${jarRect.value.left + jarRect.value.width / 2}px`,
    height: `${Math.max(16, topY + bodyOverlapPx)}px`,
  }
})

function updateRect() {
  if (!jarRef.value) return
  const rect = jarRef.value.getBoundingClientRect()
  jarRect.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

let resizeObserver = null

onMounted(() => {
  updateRect()
  window.addEventListener('resize', updateRect)
  window.addEventListener('scroll', updateRect, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && jarRef.value) {
    resizeObserver = new ResizeObserver(() => updateRect())
    resizeObserver.observe(jarRef.value)
  }
})

watch(fillPercent, () => updateRect())

watch(
  () => props.compact,
  () => updateRect(),
)

watch(
  () => props.isRunning,
  (running) => {
    clearTimeout(streamTimerId)
    if (running) {
      streamVisible.value = true
      streamStopping.value = false
      streamStarting.value = true
      streamTimerId = setTimeout(() => {
        streamStarting.value = false
      }, 900)
      return
    }

    if (!streamVisible.value) return
    streamStarting.value = false
    streamStopping.value = true
    streamTimerId = setTimeout(() => {
      streamStopping.value = false
      streamVisible.value = false
    }, 900)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearTimeout(streamTimerId)
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', updateRect)
  window.removeEventListener('scroll', updateRect)
})
</script>

<template>
  <div class="jar-wrap" :class="{ 'jar-wrap--compact': compact }">
    <div
      v-if="streamVisible"
      class="pour-stream"
      :class="[pourStreamClass, { 'stream-starting': streamStarting, 'stream-stopping': streamStopping }]"
      :style="streamStyle"
    >
      <div class="pour-base" :style="pourBaseStyle" />
      <span
        v-for="cut in edgeCutsLeft"
        :key="`edge-left-${cut.id}`"
        class="edge-cut edge-cut-left"
        :style="{ width: cut.width, animationDelay: cut.delay, animationDuration: cut.duration }"
      />
      <span
        v-for="cut in edgeCutsRight"
        :key="`edge-right-${cut.id}`"
        class="edge-cut edge-cut-right"
        :style="{ width: cut.width, animationDelay: cut.delay, animationDuration: cut.duration }"
      />
      <span
        v-for="line in streamLines"
        :key="line.id"
        class="pour-line"
        :style="{ left: line.left, animationDelay: line.delay, opacity: line.opacity }"
      />
      <span
        v-for="bubble in streamBubbles"
        :key="`stream-bubble-${bubble.id}`"
        class="pour-bubble"
        :style="{ left: bubble.left, animationDelay: bubble.delay, width: bubble.size, height: bubble.size }"
      />
      <div v-if="splashActive" class="stream-foam stream-foam-center">
        <span
          v-for="dot in foamDotsCenter"
          :key="`foam-dot-${dot.id}`"
          class="foam-dot"
          :style="{
            left: dot.left,
            bottom: dot.bottom,
            width: dot.width,
            height: dot.height,
            animationDelay: dot.delay,
            '--foam-duration': dot.duration,
          }"
        />
      </div>
      <div v-if="splashActive" class="stream-foam stream-foam-side">
        <span
          v-for="dot in foamDotsSide"
          :key="`foam-side-dot-${dot.id}`"
          class="foam-dot foam-dot-side"
          :style="{
            left: dot.left,
            bottom: dot.bottom,
            width: dot.width,
            height: dot.height,
            animationDelay: dot.delay,
            '--foam-duration': dot.duration,
          }"
        />
      </div>
    </div>

    <div ref="jarRef" class="jar">
      <div
        v-if="useMultiFill"
        class="liquid liquid-stack"
        :class="[levelClass, { flowing: isRunning }]"
        :style="{ height: `${fillPercent}%` }"
      >
        <div
          v-for="seg in stackedSegments"
          :key="seg.key"
          class="liquid-layer"
          :style="{ height: `${seg.pct}%`, background: seg.gradient }"
        />
        <div v-if="isRunning" class="inflow-connector inflow-connector-accent" :style="inflowStyle" />
        <div class="liquid-surface" />
        <div class="liquid-wave wave-1" />
        <div class="liquid-wave wave-2" />
        <div class="bubble bubble-1" />
        <div class="bubble bubble-2" />
        <div class="bubble bubble-3" />
        <div v-if="splashActive" class="inflow-spread">
          <span
            v-for="p in inflowParticles"
            :key="`inflow-particle-${p.id}`"
            class="inflow-particle"
            :style="{ animationDelay: p.delay, '--drift-x': p.x }"
          />
        </div>
        <div v-if="splashActive" class="liquid-edge-splashes liquid-edge-splashes-left">
          <span
            v-for="s in edgeSplashesLeft"
            :key="`splash-left-${s.id}`"
            class="edge-splash-dot"
            :style="{
              animationDelay: s.delay,
              width: s.size,
              height: s.size,
              '--splash-dx': s.dx,
              '--splash-peak': s.peak,
              '--splash-fall': s.fall,
            }"
          />
        </div>
        <div v-if="splashActive" class="liquid-edge-splashes liquid-edge-splashes-right">
          <span
            v-for="s in edgeSplashesRight"
            :key="`splash-right-${s.id}`"
            class="edge-splash-dot"
            :style="{
              animationDelay: s.delay,
              width: s.size,
              height: s.size,
              '--splash-dx': s.dx,
              '--splash-peak': s.peak,
              '--splash-fall': s.fall,
            }"
          />
        </div>
      </div>
      <div
        v-else
        class="liquid"
        :class="[levelClass, { flowing: isRunning }]"
        :style="{ height: `${fillPercent}%` }"
      >
        <div v-if="isRunning" class="inflow-connector" :class="streamLevelClass" />
        <div class="liquid-surface" />
        <div class="liquid-wave wave-1" />
        <div class="liquid-wave wave-2" />
        <div class="bubble bubble-1" />
        <div class="bubble bubble-2" />
        <div class="bubble bubble-3" />
        <div v-if="splashActive" class="inflow-spread">
          <span
            v-for="p in inflowParticles"
            :key="`inflow-particle-${p.id}`"
            class="inflow-particle"
            :style="{ animationDelay: p.delay, '--drift-x': p.x }"
          />
        </div>
        <div v-if="splashActive" class="liquid-edge-splashes liquid-edge-splashes-left">
          <span
            v-for="s in edgeSplashesLeft"
            :key="`splash-left-${s.id}`"
            class="edge-splash-dot"
            :style="{
              animationDelay: s.delay,
              width: s.size,
              height: s.size,
              '--splash-dx': s.dx,
              '--splash-peak': s.peak,
              '--splash-fall': s.fall,
            }"
          />
        </div>
        <div v-if="splashActive" class="liquid-edge-splashes liquid-edge-splashes-right">
          <span
            v-for="s in edgeSplashesRight"
            :key="`splash-right-${s.id}`"
            class="edge-splash-dot"
            :style="{
              animationDelay: s.delay,
              width: s.size,
              height: s.size,
              '--splash-dx': s.dx,
              '--splash-peak': s.peak,
              '--splash-fall': s.fall,
            }"
          />
        </div>
      </div>
    </div>
    <p class="jar-caption">Filled: {{ fillPercent.toFixed(2) }}%</p>
  </div>
</template>
