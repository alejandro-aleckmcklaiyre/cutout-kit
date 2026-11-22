import { downloadFile, projectDataUrl, type Project, type ProjectDetails, type ProjectEdit } from './library'
import { defaults, type Edge } from './paper'
import { paletteKeys, printDefaults, printLabels, type PrintLook, type PrintSettings } from './print'

export async function downloadBackup(project: Project) {
  const { name, collection, fileName, original, mask, edge, look, grain, settings, printSettings, brushSize } = project
  const data = {
    format: 'cutout-kit', version: 1, name, collection, fileName, edge, look, grain, settings, printSettings, brushSize,
    original: await projectDataUrl(original), mask: mask ? await projectDataUrl(mask) : null,
  }
  downloadFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${name}.cutout.json`)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project backup.')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid project backup.')
  return value.trim()
}

function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Invalid effect settings.')
  return value
}

async function readImage(value: unknown, mask = false) {
  if (typeof value !== 'string' || !(mask ? /^data:image\/png;base64,/ : /^data:image\/(png|jpeg|webp);base64,/i).test(value)) {
    throw new Error('The backup contains an unsupported image.')
  }
  return (await fetch(value)).blob()
}

export async function readBackup(file: File): Promise<ProjectEdit & ProjectDetails> {
  const data = object(JSON.parse(await file.text()))
  if (data.format !== 'cutout-kit' || data.version !== 1) throw new Error('Choose a Cutout Kit project backup.')
  const settings = object(data.settings)
  const print = object(data.printSettings)
  if (typeof data.look !== 'string' || !Object.hasOwn(printLabels, data.look) ||
      typeof data.edge !== 'string' || !['none', 'cutout', 'torn'].includes(data.edge) || typeof data.grain !== 'boolean' ||
      !paletteKeys.some((palette) => palette === print.palette)) throw new Error('Invalid effect settings.')
  const brushSize = data.brushSize
  if (brushSize !== undefined && (typeof brushSize !== 'number' || !Number.isInteger(brushSize) || brushSize < 2 || brushSize > 300)) {
    throw new Error('Invalid brush size.')
  }
  const values = Object.fromEntries(Object.keys(defaults).map((key) => [key, number(settings[key])])) as typeof defaults
  const printSettings = Object.fromEntries(Object.keys(printDefaults)
    .map((key) => [key, key === 'palette' ? print.palette : number(print[key])])) as PrintSettings
  return {
    name: text(data.name, 120),
    collection: text(data.collection, 80, false),
    fileName: text(data.fileName, 500),
    original: await readImage(data.original),
    mask: data.mask === null ? null : await readImage(data.mask, true),
    edge: data.edge as Edge,
    look: data.look as PrintLook,
    grain: data.grain,
    settings: values,
    printSettings,
    brushSize,
  }
}

