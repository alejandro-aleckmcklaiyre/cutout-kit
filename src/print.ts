import { noise } from './tornPaper'

export const printLabels = {
  original: 'Original Color',
  halftone: 'B&W Halftone / Newsprint',
  risograph: 'Duotone / Risograph',
  xerox: 'Xerox / Photocopy',
}
export type PrintLook = keyof typeof printLabels

const palettes = {
  indigo: { label: 'Indigo / Rose', ink: [33, 30, 82], paper: [250, 187, 177] },
  forest: { label: 'Forest / Cream', ink: [21, 67, 51], paper: [250, 232, 180] },
  plum: { label: 'Plum / Lilac', ink: [78, 26, 59], paper: [232, 204, 248] },
}
export const paletteKeys = ['indigo', 'forest', 'plum'] as const
export const paletteLabels = {
  indigo: palettes.indigo.label,
  forest: palettes.forest.label,
  plum: palettes.plum.label,
}
export type Palette = typeof paletteKeys[number]

export const printDefaults = {
  dotSize: 42, halftoneContrast: 58, inkFade: 16,
  palette: 'indigo' as Palette, risoContrast: 53,
  threshold: 51, grit: 35,
}
export type PrintSettings = typeof printDefaults

const cos = Math.cos(Math.PI / 8)
const sin = Math.sin(Math.PI / 8)

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function printImage(source: HTMLCanvasElement, look: PrintLook, settings: PrintSettings, resolution: number) {
  if (look === 'original') return source
  const canvas = document.createElement('canvas')
  const { width, height } = source
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height)
  const { data } = pixels
  const luma = new Float32Array(width * height)
  for (let i = 0; i < luma.length; i++) {
    const p = i * 4
    luma[i] = (data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722) / 255
  }
  const pitch = (6 + settings.dotSize * 0.18) * resolution
  const fade = settings.inkFade / 100
  const halftoneContrast = 0.65 + settings.halftoneContrast * 0.017
  const risoContrast = 0.65 + settings.risoContrast * 0.017
  const { ink, paper } = palettes[settings.palette]
  const threshold = settings.threshold / 100
  const grit = settings.grit / 100
  const bleed = Math.max(1, Math.round(1.6 * resolution))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * 4
      if (!data[p + 3]) continue

      if (look === 'halftone') {
        const tone = 1 - clamp((luma[i] - 0.5) * halftoneContrast + 0.5)
        const u = (x * cos + y * sin) / pitch
        const v = (y * cos - x * sin) / pitch
        const distance = Math.hypot(u - Math.round(u), v - Math.round(v))
        const radius = tone <= 0.5 ? Math.sqrt(tone / Math.PI) : Math.SQRT1_2 - Math.sqrt((1 - tone) / Math.PI) * 0.77
        const dot = tone <= 0 ? 0 : tone >= 1 ? 1 : clamp(0.5 + (radius - distance) * pitch)
        // Tiny dots converge toward their average tone when the preview undersamples the screen.
        const screen = tone + (dot - tone) * clamp((pitch - 1) / 3)
        const gray = 248 - screen * (224 - fade * 154)
        data[p] = data[p + 1] = data[p + 2] = gray
      } else if (look === 'risograph') {
        const left = y * width + Math.max(0, x - bleed)
        const up = Math.max(0, y - bleed) * width + x
        const spread = Math.min(luma[i], data[left * 4 + 3] < 128 ? luma[i] : luma[left],
          data[up * 4 + 3] < 128 ? luma[i] : luma[up])
        const tone = clamp((luma[i] * 0.86 + spread * 0.14 - 0.5) * risoContrast + 0.5)
        for (let channel = 0; channel < 3; channel++) {
          data[p + channel] = ink[channel] + (paper[channel] - ink[channel]) * tone
        }
      } else {
        const sx = Math.floor(x / resolution)
        const sy = Math.floor(y / resolution)
        const fine = noise(sx, sy)
        const flecks = noise(sx >> 2, sy >> 2)
        const exposure = luma[i] + ((fine - 0.5) * 0.29 * resolution + (flecks - 0.5) * 0.20) * grit
        const toner = clamp((threshold - exposure) / 0.11 + 0.5)
        const gray = 251 - toner * 237 + (fine - 0.58) * 44 * grit * Math.sqrt(resolution)
        data[p] = data[p + 1] = data[p + 2] = gray
      }
    }
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

