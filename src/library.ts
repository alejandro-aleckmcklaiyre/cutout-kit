import Dexie, { type Table } from 'dexie'
import type { Edge, Settings } from './paper'
import type { PrintLook, PrintSettings } from './print'

export type ProjectEdit = {
  original: Blob
  fileName: string
  mask: Blob | null
  edge: Edge
  look: PrintLook
  grain: boolean
  settings: Settings
  printSettings: PrintSettings
  brushSize?: number
}
export type ProjectDetails = { name: string; collection: string }
export type Project = ProjectEdit & ProjectDetails & { id: string; owner: string; updatedAt: number }
type Profile = { id: string; email: string; salt: Uint8Array; verifier: Uint8Array }
type Counter = { id: string; value: number }

export const guestLimit = 10
export const sessionKey = 'cutout-kit-profile'
const db = new Dexie('cutout-kit')
db.version(1).stores({ profiles: 'id,&email', projects: 'id,[owner+updatedAt]', counters: 'id' })
const profiles: Table<Profile, string> = db.table('profiles')
const projects: Table<Project, string> = db.table('projects')
const counters: Table<Counter, string> = db.table('counters')

async function deriveVerifier(passphrase: string, salt: BufferSource) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256',
  }, key, 256))
}

export async function signIn(email: string, passphrase: string, create: boolean) {
  email = email.trim().toLowerCase()
  let profile = await profiles.where('email').equals(email).first()
  if (create) {
    if (profile) throw new Error('That profile already exists in this browser. Sign in to continue.')
    const salt = crypto.getRandomValues(new Uint8Array(16))
    profile = { id: crypto.randomUUID(), email, salt, verifier: await deriveVerifier(passphrase, salt) }
    await profiles.add(profile)
  } else {
    if (!profile) throw new Error('Email or passphrase does not match a profile in this browser.')
    const candidate = await deriveVerifier(passphrase, new Uint8Array(profile.salt))
    let difference = 0
    for (let i = 0; i < candidate.length; i++) difference |= candidate[i] ^ profile.verifier[i]
    if (difference) throw new Error('Email or passphrase does not match a profile in this browser.')
  }
  localStorage.setItem(sessionKey, profile.id)
  return { id: profile.id, email: profile.email }
}

export async function currentProfile() {
  const id = localStorage.getItem(sessionKey)
  const profile = id ? await profiles.get(id) : undefined
  return profile ? { id: profile.id, email: profile.email } : null
}

export async function guestExports() {
  return (await counters.get('guest-exports'))?.value ?? 0
}

export async function claimGuestExport() {
  return db.transaction('rw', counters, async () => {
    const count = await guestExports()
    if (count >= guestLimit) return null
    await counters.put({ id: 'guest-exports', value: count + 1 })
    return count + 1
  })
}

export function listProjects(owner: string) {
  return projects.where('[owner+updatedAt]').between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true)
    .reverse().toArray()
}

export async function saveProject(owner: string, details: ProjectDetails, edit: ProjectEdit, id: string = crypto.randomUUID()) {
  return db.transaction('rw', projects, async () => {
    const existing = await projects.get(id)
    if (existing && existing.owner !== owner) throw new Error('This project belongs to another profile.')
    const project = { ...edit, ...details, id, owner, updatedAt: Date.now() }
    await projects.put(project)
    return project
  })
}

export async function renameProject(owner: string, id: string, details: ProjectDetails) {
  await db.transaction('rw', projects, async () => {
    if ((await projects.get(id))?.owner !== owner) throw new Error('This project is unavailable.')
    await projects.update(id, { ...details, updatedAt: Date.now() })
  })
}

export async function projectDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The PNG could not be created.')), 'image/png')
  })
}

export function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

