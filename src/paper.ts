import { drawTornPaper, noise } from './tornPaper'
import { printImage, type PrintLook, type PrintSettings } from './print'

export const defaults = { roughness: 32, texture: 42, shadow: 28 }
export type Settings = typeof defaults
export type Edge = 'none' | 'cutout' | 'torn'
const paperTint = [237, 222, 192]


function addPaperGrain(output: ImageData, strength: number, resolution: number) {
  const { width, height, data } = output
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      if (!data[index + 3]) continue
      const sourceX = Math.floor(x / resolution)
      const sourceY = Math.floor(y / resolution)
      const grain = (noise(sourceX, sourceY) - 0.5) * 83 * resolution +
        (noise(sourceX >> 2, sourceY >> 1) - 0.5) * 33 * Math.min(1, 2 * resolution)
      for (let channel = 0; channel < 3; channel++) {
        const color = data[index + channel]
        data[index + channel] = color + ((paperTint[channel] - color) * 0.22 + grain) * strength
      }
    }
  }
}

function applyGrain(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number, resolution: number) {
  if (!strength) return
  const pixels = ctx.getImageData(0, 0, width, height)
  addPaperGrain(pixels, strength / 100, resolution)
  ctx.putImageData(pixels, 0, 0)
}

export function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable.')
  return ctx
}

export function paperLayout(width: number, height: number, edge: Edge) {
  const scale = Math.max(0.5, Math.min(4, Math.max(width, height) / 1400))
  const radius = Math.max(1, Math.round(12 * scale))
  const inset = Math.min(edge === 'torn' ? Math.ceil(39 + 22 * scale) : radius * 3, Math.floor((Math.min(width, height) - 1) / 4))
  return { scale, radius, inset }
}

export function render(canvas: HTMLCanvasElement, source: HTMLCanvasElement, edge: Edge, settings: Settings, grain: boolean,
  original = source, print?: { look: PrintLook; settings: PrintSettings }) {
  const { width, height } = source
  const resolution = Math.max(width, height) / Math.max(original.width, original.height)
  canvas.width = width
  canvas.height = height
  const target = context(canvas)
  const inked = print ? printImage(source, print.look, print.settings, resolution) : source
  if (edge === 'none') {
    target.drawImage(inked, 0, 0)
    if (grain) applyGrain(target, width, height, settings.texture, resolution)
    return
  }

  const { scale, radius, inset } = paperLayout(original.width, original.height, edge)
  const border = document.createElement('canvas')
  border.width = width
  border.height = height
  const backing = context(border)
  const insetX = inset * width / original.width
  const insetY = inset * height / original.height
  const artWidth = width - 2 * insetX
  const artHeight = height - 2 * insetY
  if (edge === 'torn') {
    drawTornPaper(backing, source, insetX, insetY, artWidth, artHeight, resolution, settings.roughness / 100, inked)
  } else {
    backing.drawImage(source, insetX, insetY, artWidth, artHeight)
    for (let step = 0; step < 24; step++) {
      const angle = step * Math.PI / 12
      backing.drawImage(source, insetX + Math.cos(angle) * radius * resolution, insetY + Math.sin(angle) * radius * resolution, artWidth, artHeight)
    }
    backing.globalCompositeOperation = 'source-in'
    backing.fillStyle = '#fffaf0'
    backing.fillRect(0, 0, width, height)
    backing.globalCompositeOperation = 'source-over'
    backing.drawImage(inked, insetX, insetY, artWidth, artHeight)
  }

  if (grain) applyGrain(backing, width, height, settings.texture, resolution)

  const depth = settings.shadow / 100
  if (depth) {
    target.shadowColor = `rgba(32, 24, 15, ${depth * 0.72})`
    target.shadowBlur = (3 + depth * 24) * scale * resolution
    target.shadowOffsetX = depth * 9 * scale * resolution
    target.shadowOffsetY = depth * 22 * scale * resolution
  }
  target.drawImage(border, 0, 0)
}

