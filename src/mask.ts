import { context } from './paper'

export type Point = { x: number; y: number }
export type Brush = 'Keep' | 'Erase'

function canvasLike(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  return canvas
}

export function makeMask(source: HTMLCanvasElement, outline?: Point[]) {
  const mask = canvasLike(source)
  const ctx = context(mask)
  if (outline) {
    ctx.beginPath()
    ctx.moveTo(outline[0].x, outline[0].y)
    for (const point of outline.slice(1)) ctx.lineTo(point.x, point.y)
    ctx.closePath()
    ctx.fill('evenodd')
  } else {
    ctx.fillRect(0, 0, mask.width, mask.height)
  }
  return mask
}

export function paintMask(mask: HTMLCanvasElement, brush: Brush, size: number, from: Point, to: Point) {
  const ctx = context(mask)
  ctx.save()
  ctx.globalCompositeOperation = brush === 'Erase' ? 'destination-out' : 'source-over'
  ctx.beginPath()
  if (from.x === to.x && from.y === to.y) {
    ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.restore()
}

export function applyMask(source: HTMLCanvasElement, mask: HTMLCanvasElement | null) {
  if (!mask) return source
  const canvas = canvasLike(source)
  const ctx = context(canvas)
  ctx.drawImage(source, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function drawOutline(canvas: HTMLCanvasElement, points: Point[], source: HTMLCanvasElement) {
  if (!points.length) return
  const ctx = context(canvas)
  const bounds = canvas.getBoundingClientRect()
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height)
  if (!scale) return
  ctx.save()
  ctx.beginPath()
  const xScale = canvas.width / source.width
  const yScale = canvas.height / source.height
  ctx.moveTo(points[0].x * xScale, points[0].y * yScale)
  for (const point of points.slice(1)) ctx.lineTo(point.x * xScale, point.y * yScale)
  if (points.length >= 3) ctx.closePath()
  ctx.lineWidth = 4 / scale
  ctx.strokeStyle = '#1d2214'
  ctx.stroke()
  ctx.lineWidth = 2 / scale
  ctx.strokeStyle = '#d9f482'
  ctx.stroke()
  ctx.fillStyle = '#d9f482'
  for (const point of points) {
    ctx.beginPath()
    ctx.arc(point.x * xScale, point.y * yScale, 3 / scale, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
