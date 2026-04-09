function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 3 && h.length !== 6) return { r: 14, g: 165, b: 233 }
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbStr({ r, g, b }, alpha = 1) {
  return `rgba(${r},${g},${b},${alpha})`
}

export function gradientFromColor(hex) {
  const c = hexToRgb(hex)
  const d = {
    r: Math.round(c.r * 0.52),
    g: Math.round(c.g * 0.52),
    b: Math.round(c.b * 0.55),
  }
  const m = {
    r: Math.round((c.r + d.r) / 2),
    g: Math.round((c.g + d.g) / 2),
    b: Math.round((c.b + d.b) / 2),
  }
  return `linear-gradient(180deg, ${rgbStr(c)}, ${rgbStr(m)})`
}

export function streamCssVarsFromHex(hex) {
  const c = hexToRgb(hex)
  const top = rgbStr({
    r: Math.min(255, c.r + 50),
    g: Math.min(255, c.g + 50),
    b: Math.min(255, c.b + 55),
  })
  const join = rgbStr({
    r: Math.round(c.r * 0.92),
    g: Math.round(c.g * 0.92),
    b: Math.round(c.b * 0.94),
  })
  const deep = rgbStr({
    r: Math.round(c.r * 0.42),
    g: Math.round(c.g * 0.42),
    b: Math.round(c.b * 0.48),
  })
  return {
    '--stream-top': top,
    '--stream-join': join,
    '--liquid-deep': deep,
  }
}
