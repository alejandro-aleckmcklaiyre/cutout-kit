import type { BackgroundRemovalPipeline } from '@huggingface/transformers'
import { context } from './paper'

let remover: Promise<BackgroundRemovalPipeline> | undefined

export async function createAutomaticMask(source: HTMLCanvasElement, status: (phase: 'loading' | 'processing') => void) {
  if (!remover) {
    status('loading')
    remover = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('background-removal', 'Xenova/modnet', { device: 'wasm' }),
    ).catch((error: unknown) => {
      remover = undefined
      throw error
    })
  }
  const segment = await remover
  status('processing')
  // Give the browser a paint before CPU work starts.
  if (!document.hidden) await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  const { RawImage } = await import('@huggingface/transformers')
  const size = Math.min(1, 1024 / Math.max(source.width, source.height))
  const input = document.createElement('canvas')
  input.width = Math.max(1, Math.round(source.width * size))
  input.height = Math.max(1, Math.round(source.height * size))
  const ctx = context(input)
  ctx.drawImage(source, 0, 0, input.width, input.height)
  const pixels = ctx.getImageData(0, 0, input.width, input.height)
  const [result] = await segment(new RawImage(pixels.data, input.width, input.height, 4))
  if (!result || result.channels !== 4) throw new Error('Missing subject mask.')
  input.width = result.width
  input.height = result.height
  ctx.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0)
  const mask = document.createElement('canvas')
  mask.width = source.width
  mask.height = source.height
  context(mask).drawImage(input, 0, 0, mask.width, mask.height)
  return mask
}
