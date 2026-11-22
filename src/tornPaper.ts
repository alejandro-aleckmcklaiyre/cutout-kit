export function noise(x: number, y: number) {
  const hash = Math.imul(x + 113, 374761393) + Math.imul(y + 357, 668265263)
  return ((Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0) / 4294967296)
}

const layers = new WeakMap<HTMLCanvasElement, { photo: ImageData; distance: Float32Array }>()
const diagonal = Math.SQRT2

function boundaryDistances(photo: ImageData) {
  const { width, height, data } = photo
  const inside = new Uint8Array(width * height)
  const distances = new Float32Array(inside.length).fill(Infinity)
  for (let i = 0; i < inside.length; i++) inside[i] = Number(data[i * 4 + 3] >= 128)

  // Seed both sides of every alpha boundary, then propagate distance in two sweeps.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const neighbor = inside[i]
      if ((x > 0 ? inside[i - 1] : 0) !== neighbor ||
          (x + 1 < width ? inside[i + 1] : 0) !== neighbor ||
          (y > 0 ? inside[i - width] : 0) !== neighbor ||
          (y + 1 < height ? inside[i + width] : 0) !== neighbor) distances[i] = 0.5
      if (x > 0) distances[i] = Math.min(distances[i], distances[i - 1] + 1)
      if (y === 0) continue
      distances[i] = Math.min(distances[i], distances[i - width] + 1)
      if (x > 0) distances[i] = Math.min(distances[i], distances[i - width - 1] + diagonal)
      if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i - width + 1] + diagonal)
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + 1] + 1)
      if (y === height - 1) continue
      distances[i] = Math.min(distances[i], distances[i + width] + 1)
      if (x > 0) distances[i] = Math.min(distances[i], distances[i + width - 1] + diagonal)
      if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + width + 1] + diagonal)
    }
  }
  for (let i = 0; i < inside.length; i++) {
    if (inside[i]) distances[i] = -distances[i]
  }
  return distances
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function field(x: number, y: number, spacing: number, seed: number) {
  const gx = x / spacing
  const gy = y / spacing
  const ix = Math.floor(gx) + seed
  const iy = Math.floor(gy) - seed
  const u = gx - Math.floor(gx)
  const v = gy - Math.floor(gy)
  const sx = u * u * (3 - 2 * u)
  const sy = v * v * (3 - 2 * v)
  const a = noise(ix, iy)
  const b = noise(ix, iy + 1)
  const top = a + (noise(ix + 1, iy) - a) * sx
  const bottom = b + (noise(ix + 1, iy + 1) - b) * sx
  return top + (bottom - top) * sy
}

export function drawTornPaper(
  backing: CanvasRenderingContext2D, source: HTMLCanvasElement,
  insetX: number, insetY: number, artWidth: number, artHeight: number,
  resolution: number, intensity: number, inked: HTMLCanvasElement,
) {
  const { width, height } = source
  const artwork = document.createElement('canvas')
  artwork.width = width
  artwork.height = height
  const art = artwork.getContext('2d', { willReadFrequently: true })!
  let layer = layers.get(source)
  if (!layer) {
    art.drawImage(source, insetX, insetY, artWidth, artHeight)
    const photo = art.getImageData(0, 0, width, height)
    layer = { photo, distance: boundaryDistances(photo) }
    layers.set(source, layer)
  }

  const { photo, distance } = layer
  const paper = new ImageData(width, height)
  let printing
  if (inked === source) {
    printing = new ImageData(new Uint8ClampedArray(photo.data), width, height)
  } else {
    art.clearRect(0, 0, width, height)
    art.drawImage(inked, insetX, insetY, artWidth, artHeight)
    printing = art.getImageData(0, 0, width, height)
  }
  const feather = Math.max(0.75, 0.85 * resolution)
  const amplitude = 0.68 + intensity * 0.62
  const fiberAmplitude = 1 + intensity * 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const i = pixel * 4
      const signedDistance = distance[pixel]
      if (signedDistance > 38 * resolution + feather) continue

      const sx = x / resolution
      const sy = y / resolution
      let coverage = 1
      if (signedDistance >= 0) {
        const sweep = field(sx, sy, 132, 31)
        const fold = field(sx + sweep * 58, sy - sweep * 37, 66, 73)
        const macro = clamp(0.5 + (sweep * 0.73 + fold * 0.27 - 0.5) * 2.45 * amplitude)
        const fibers = (field(sx, sy, 2.3, 97) - 0.5) * 2 * fiberAmplitude
        const reach = (4 + 31 * macro + fibers) * resolution
        coverage = clamp(0.5 + (reach - signedDistance) / feather)
      }
      if (!coverage) continue
      // Sparse, elongated fibers cross in the exposed pulp, independent of Paper Grain.
      const texture = signedDistance > -5 * resolution
        ? (noise(Math.floor(sx / 6), Math.floor(sy)) - 0.5) * 11 +
          (noise(Math.floor(sx + sy / 3), Math.floor(sy / 8)) - 0.5) * 7
        : 0
      paper.data[i] = 242 + texture
      paper.data[i + 1] = 239 + texture
      paper.data[i + 2] = 233 + texture
      paper.data[i + 3] = 255 * coverage

      if (printing.data[i + 3] && signedDistance >= -3 * resolution - feather) {
        const fiber = field(sx, sy, 2.3, 97)
        const erosion = (0.25 + fiber * (0.55 + intensity * 1.25)) * resolution
        printing.data[i + 3] *= clamp(0.5 + (-signedDistance - erosion) / feather)
      }
    }
  }
  backing.putImageData(paper, 0, 0)
  art.putImageData(printing, 0, 0)

  const seam = document.createElement('canvas')
  seam.width = width
  seam.height = height
  const shade = seam.getContext('2d')!
  shade.filter = `blur(${3 * resolution}px)`
  shade.drawImage(artwork, 0, 0)
  shade.filter = 'none'
  shade.globalCompositeOperation = 'source-in'
  shade.fillStyle = 'rgba(58, 53, 47, 0.22)'
  shade.fillRect(0, 0, width, height)
  backing.globalCompositeOperation = 'source-atop'
  backing.drawImage(seam, 0, 0)
  backing.globalCompositeOperation = 'source-over'
  backing.drawImage(artwork, 0, 0)
}

