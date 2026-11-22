import { createRoot } from 'react-dom/client'
import { ClerkProvider, useClerk, useUser } from '@clerk/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as CanvasPointerEvent } from 'react'
import { ArrowCounterClockwise, DownloadSimple, ImageSquare, Scissors, Stack, UploadSimple } from '@phosphor-icons/react'
import { context, defaults, paperLayout, render, type Edge, type Settings } from './paper'
import { applyMask, drawOutline, makeMask, paintMask, type Brush, type Point } from './mask'
import { createAutomaticMask } from './autoCutout'
import { paletteKeys, paletteLabels, printDefaults, printLabels, type Palette, type PrintLook, type PrintSettings } from './print'
import { AuthDialog, LibraryDialog, SaveDialog } from './LibraryDialogs'
import { canvasPng, claimGuestExport, currentProfile, downloadFile, guestExports, guestLimit, saveProject,
  sessionKey, type Project, type ProjectDetails, type ProjectEdit } from './library'
import './style.css'

const controls: [keyof Settings, string][] = [
  ['roughness', 'Edge roughness'],
  ['texture', 'Grain strength'],
  ['shadow', 'Shadow'],
]
type PrintSlider = Exclude<keyof PrintSettings, 'palette'>
const printControls: Record<PrintLook, [PrintSlider, string][]> = {
  original: [],
  halftone: [['dotSize', 'Dot size'], ['halftoneContrast', 'Contrast'], ['inkFade', 'Ink fade']],
  risograph: [['risoContrast', 'Contrast']],
  xerox: [['threshold', 'Threshold'], ['grit', 'Grit']],
}
const printChoices = ['original', 'halftone', 'risograph', 'xerox'] as const

type Source = { canvas: HTMLCanvasElement; preview: HTMLCanvasElement; original: Blob; name: string; transparent: boolean }
type Profile = NonNullable<Awaited<ReturnType<typeof currentProfile>>>
type DialogName = 'auth' | 'limit' | 'library' | 'save'
type Background = 'Checkerboard' | 'Light' | 'Dark'
const edgeLabels: Record<Edge, string> = { none: 'None', cutout: 'Paper Cutout', torn: 'Torn Paper Edge' }
type Tool = 'Outline' | Brush

function makePreview(source: HTMLCanvasElement) {
  const ratio = Math.min(1, 800 / Math.max(source.width, source.height))
  if (ratio === 1) return source
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * ratio))
  canvas.height = Math.max(1, Math.round(source.height * ratio))
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function brushLimit(canvas: HTMLCanvasElement) {
  return Math.max(60, Math.min(300, Math.round(Math.max(canvas.width, canvas.height) / 2)))
}

async function decodeImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas is unavailable.')
    ctx.drawImage(bitmap, 0, 0)
    return canvas
  } finally {
    bitmap.close()
  }
}

function makeSource(canvas: HTMLCanvasElement, original: Blob, name: string): Source {
  const pixels = context(canvas).getImageData(0, 0, canvas.width, canvas.height).data
  let transparent = false
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] === 255) continue
    transparent = true
    break
  }
  return { canvas, preview: makePreview(canvas), original, name, transparent }
}

async function decodeProject(edit: ProjectEdit) {
  const canvas = await decodeImage(edit.original)
  const mask = edit.mask ? await decodeImage(edit.mask) : null
  if (mask && (mask.width !== canvas.width || mask.height !== canvas.height)) throw new Error('The mask size does not match the original.')
  return { source: makeSource(canvas, edit.original, edit.fileName), mask }
}

function imagePoint(event: CanvasPointerEvent<HTMLCanvasElement>, source: HTMLCanvasElement, edge: Edge) {
  const canvas = event.currentTarget
  const bounds = canvas.getBoundingClientRect()
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height)
  const x = (event.clientX - bounds.left - (bounds.width - canvas.width * scale) / 2) / (canvas.width * scale)
  const y = (event.clientY - bounds.top - (bounds.height - canvas.height * scale) / 2) / (canvas.height * scale)
  // Paper Cutout insets the artwork to make room for its border and shadow.
  const inset = edge === 'none' ? 0 : paperLayout(source.width, source.height, edge).inset
  return {
    x: (x * source.width - inset) * source.width / (source.width - 2 * inset),
    y: (y * source.height - inset) * source.height / (source.height - 2 * inset),
  }
}

type HostedAuth = {
  ready: boolean
  profile: Pick<Profile, 'id' | 'email'> | null
  signIn: () => void
  signOut: () => Promise<unknown>
}

function App({ hostedAuth }: { hostedAuth?: HostedAuth }) {
  const [source, setSource] = useState<Source>()
  const [localProfile, setProfile] = useState<Profile | null>(null)
  const profile = hostedAuth ? hostedAuth.profile : localProfile
  const [guestReady, setGuestReady] = useState(false)
  const sessionReady = guestReady && (hostedAuth?.ready ?? true)
  const [guestCount, setGuestCount] = useState(0)
  const [dialog, setDialog] = useState<DialogName>()
  const [activeProject, setActiveProject] = useState<(ProjectDetails & { id: string; owner: string })>()
  const [selectedEdge, setEdge] = useState<Edge>('none')
  const [look, setLook] = useState<PrintLook>('original')
  const [printSettings, setPrintSettings] = useState(printDefaults)
  const [grain, setGrain] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const [settings, setSettings] = useState(defaults)
  const [background, setBackground] = useState<Background>('Checkerboard')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [tool, setTool] = useState<Tool | null>(null)
  const [outline, setOutline] = useState<Point[]>([])
  const [brushSize, setBrushSize] = useState(24)
  const [maskRevision, setMaskRevision] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const request = useRef(0)
  const exportLock = useRef(false)
  const mask = useRef<HTMLCanvasElement | null>(null)
  const maskedPreview = useRef<{ source: Source; revision: number; image: HTMLCanvasElement } | null>(null)
  const stroke = useRef<{ tool: Brush; pointerId: number; point: Point } | null>(null)
  const hasMask = maskRevision > 0
  const canUseEdge = Boolean(source && (source.transparent || hasMask))
  const edge = canUseEdge ? selectedEdge : 'none'
  const hasEdge = edge !== 'none'
  const hasEffect = hasEdge || grain || look !== 'original'
  const maxBrushSize = source ? brushLimit(source.canvas) : 60

  useEffect(() => {
    void Promise.allSettled([hostedAuth ? Promise.resolve(null) : currentProfile(), guestExports()]).then(([session, count]) => {
      if (session.status === 'fulfilled') setProfile(session.value)
      if (count.status === 'fulfilled') setGuestCount(count.value)
      setGuestReady(true)
    })
  }, [])

  useLayoutEffect(() => {
    if (!source || !preview.current) return
    const frame = requestAnimationFrame(() => {
      if (!preview.current) return
      try {
        const original = showOriginal || tool === 'Outline'
        let image = source.preview
        if (!original && mask.current) {
          if (maskedPreview.current?.source !== source || maskedPreview.current.revision !== maskRevision) {
            maskedPreview.current = { source, revision: maskRevision, image: applyMask(source.preview, mask.current) }
          }
          image = maskedPreview.current.image
        }
        render(preview.current, image, original ? 'none' : edge, settings, grain && !original, source.canvas,
          original ? undefined : { look, settings: printSettings })
        if (tool === 'Outline') drawOutline(preview.current, outline, source.canvas)
      } catch {
        setError(true)
        setMessage('The preview could not be rendered. Try a smaller image.')
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [source, edge, grain, look, printSettings, showOriginal, settings, tool, outline, maskRevision])

  function chooseTool(next: Tool | null) {
    stroke.current = null
    setTool(next)
    setOutline([])
    setShowOriginal(false)
  }

  function applyOutline() {
    if (!source || outline.length < 3) return
    mask.current = makeMask(source.canvas, outline)
    setMaskRevision((revision) => revision + 1)
    chooseTool(null)
  }

  function startMark(event: CanvasPointerEvent<HTMLCanvasElement>) {
    if (!source || !tool || busy || exporting || event.button !== 0 || !event.isPrimary) return
    const point = imagePoint(event, source.canvas, tool === 'Outline' ? 'none' : edge)
    if (point.x < 0 || point.y < 0 || point.x > source.canvas.width || point.y > source.canvas.height) return
    if (tool === 'Outline') {
      setOutline((points) => [...points, point])
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = mask.current ??= makeMask(source.canvas)
    stroke.current = { tool, pointerId: event.pointerId, point }
    paintMask(current, tool, brushSize, point, point)
    setMaskRevision((revision) => revision + 1)
  }

  function moveMark(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = stroke.current
    if (!source || !active || active.pointerId !== event.pointerId || !mask.current) return
    if (!(event.buttons & 1)) {
      stopMark(event)
      return
    }
    const point = imagePoint(event, source.canvas, edge)
    paintMask(mask.current, active.tool, brushSize, active.point, point)
    active.point = point
    setMaskRevision((revision) => revision + 1)
  }

  function stopMark(event: CanvasPointerEvent<HTMLCanvasElement>) {
    if (stroke.current?.pointerId === event.pointerId) stroke.current = null
  }

  function openEdit(nextSource: Source, nextMask: HTMLCanvasElement | null, edit?: ProjectEdit) {
    chooseTool(null)
    mask.current = nextMask
    maskedPreview.current = null
    setMaskRevision(nextMask ? 1 : 0)
    const defaultBrush = Math.max(12, Math.round(Math.max(nextSource.canvas.width, nextSource.canvas.height) / 25))
    setBrushSize(Math.min(brushLimit(nextSource.canvas), edit?.brushSize ?? defaultBrush))
    setEdge(edit?.edge ?? 'none')
    setLook(edit?.look ?? 'original')
    setPrintSettings(edit?.printSettings ?? printDefaults)
    setGrain(edit?.grain ?? false)
    setSettings(edit?.settings ?? defaults)
    setAdjust(false)
    setSource(nextSource)
  }

  async function openSavedProject(project: Project) {
    const decoded = await decodeProject(project)
    openEdit(decoded.source, decoded.mask, project)
    setActiveProject(project)
    setMessage('')
    setError(false)
    setDialog(undefined)
  }

  async function saveCurrentProject(details: ProjectDetails) {
    if (!source || !profile) return
    const edit = {
      original: source.original, fileName: source.name, mask: mask.current ? await canvasPng(mask.current) : null,
      edge, look, grain, settings, printSettings, brushSize,
    }
    const project = await saveProject(profile.id, details, edit, activeProject?.owner === profile.id ? activeProject.id : undefined)
    setActiveProject(project)
    setDialog(undefined)
    setError(false)
    setMessage('Project saved in this browser.')
  }

  async function restoreProject(backup: ProjectEdit & ProjectDetails) {
    if (!profile) return
    await decodeProject(backup)
    const { name, collection, ...edit } = backup
    await saveProject(profile.id, { name, collection }, edit)
  }

  async function importImage(file?: File) {
    if (!file) return
    const id = ++request.current
    setBusy(true)
    setMessage('')
    setError(false)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
        throw new Error('Choose a PNG, JPEG, or WebP image.')
      }
      const canvas = await decodeImage(file)
      if (id !== request.current) return
      const mime = /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg'
      const original = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ? file : file.slice(0, file.size, mime)
      const nextSource = makeSource(canvas, original, file.name)
      openEdit(nextSource, null)
      setActiveProject(undefined)
    } catch (failure) {
      if (id !== request.current) return
      setError(true)
      setMessage(failure instanceof Error && failure.message.startsWith('Choose')
        ? failure.message : 'This image could not be opened. Try another file.')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  async function removeBackground() {
    if (!source || busy || exporting) return
    const id = ++request.current
    chooseTool(null)
    setBusy(true)
    setError(false)
    try {
      const nextMask = await createAutomaticMask(source.canvas, (phase) => {
        if (id === request.current) {
          setMessage(phase === 'loading' ? 'Loading background removal model…' : 'Processing background removal…')
        }
      })
      if (id !== request.current) return
      mask.current = nextMask
      setMaskRevision((revision) => revision + 1)
      setMessage('Background removed. Use Keep or Erase to refine the edges.')
    } catch {
      if (id !== request.current) return
      setError(true)
      setMessage('Background removal failed. Check your connection and try again.')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  async function exportPng() {
    if (!source || busy || exporting || !sessionReady || exportLock.current) return
    exportLock.current = true
    setExporting(true)
    setMessage('')
    setError(false)
    try {
      const session = await currentProfile()
      if (!session) {
        const used = await guestExports()
        setGuestCount(used)
        if (used >= guestLimit) {
          setProfile(null)
          setDialog('limit')
          return
        }
      }
      const output = document.createElement('canvas')
      render(output, applyMask(source.canvas, mask.current), edge, settings, grain, source.canvas, { look, settings: printSettings })
      const blob = await canvasPng(output)
      const name = source.name.replace(/\.[^.]+$/, '') || 'image'
      const printSuffix = look === 'original' ? '' : `-${look}`
      const edgeSuffix = edge === 'cutout' ? '-paper-cutout' : edge === 'torn' ? '-torn-paper-edge' : ''
      const suffix = printSuffix + edgeSuffix || (grain ? '-paper-grain' : hasMask ? '-cutout' : '-original')
      if (!session) {
        const count = await claimGuestExport()
        setGuestCount(count ?? guestLimit)
        if (count === null) {
          setDialog('limit')
          return
        }
        if (count === guestLimit) setDialog('limit')
      }
      downloadFile(blob, `${name}${suffix}.png`)
      setMessage('PNG download ready.')
    } catch {
      setError(true)
      setMessage('The PNG could not be exported. Try again.')
    } finally {
      exportLock.current = false
      setExporting(false)
    }
  }

  return (
    <div className="app" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault()
      if (!exporting && !dialog) void importImage(event.dataTransfer.files[0])
    }}>
      <input hidden type="file" ref={input} accept="image/png,image/jpeg,image/webp" onChange={(event) => {
        void importImage(event.currentTarget.files?.[0])
        event.currentTarget.value = ''
      }} />
      <header className="top">
        <div className="brand"><span className="brand-icon"><Scissors size={22} weight="bold" /></span><h1>Cutout Kit</h1></div>
        <div className="actions">
          {profile ? <>
            <button className="secondary" disabled={busy || exporting} onClick={() => setDialog('library')}>Library</button>
            <button className="secondary" disabled={!source || busy || exporting} onClick={() => setDialog('save')}>Save project</button>
            <button className="secondary" disabled={busy || exporting} title={profile.email} onClick={() => {
              if (hostedAuth) {
                void hostedAuth.signOut().catch(() => {
                  setError(true)
                  setMessage('Could not sign out. Try again.')
                })
              } else {
                localStorage.removeItem(sessionKey)
              }
              setProfile(null)
              setActiveProject(undefined)
            }}>Sign out</button>
          </> : <>
            {sessionReady && <span className="guest-count">{Math.max(0, guestLimit - guestCount)} guest exports left</span>}
            <button className="secondary" disabled={!sessionReady || exporting} onClick={() => hostedAuth ? hostedAuth.signIn() : setDialog('auth')}>Sign in</button>
          </>}
          <button className="secondary" disabled={exporting} onClick={() => input.current?.click()}><UploadSimple size={17} /> Import image</button>
          <button className="primary" disabled={!source || busy || exporting || !sessionReady} onClick={() => void exportPng()}><DownloadSimple size={18} /> {exporting ? 'Preparing PNG…' : 'Download PNG'}</button>
        </div>
      </header>
      <main className="editor">
        <section className="preview" aria-label="Image preview">
          <div className="toolbar">
            <span className="filename"><ImageSquare size={17} /> <span>{source?.name ?? 'Untitled image'}</span></span>
            <div className="segmented" aria-label="Preview mode">
              <button disabled={!source} aria-pressed={showOriginal || tool === 'Outline' || (!hasEffect && !hasMask)} onClick={() => {
                chooseTool(null)
                setShowOriginal(true)
              }}>Original</button>
              <button disabled={!hasEffect && !hasMask} aria-pressed={(hasEffect || hasMask) && !showOriginal && tool !== 'Outline'} onClick={() => chooseTool(null)}>
                {hasEffect ? 'Effect' : 'Cutout'}
              </button>
            </div>
          </div>
          <div className={`stage ${background.toLowerCase()}`}>
            {source ? <canvas ref={preview} tabIndex={tool === 'Outline' ? 0 : undefined} role="img"
              style={{ width: '100%', height: '100%', maxWidth: source.canvas.width, maxHeight: source.canvas.height }}
              className={tool ? 'mask-canvas' : undefined}
              aria-label={tool === 'Outline' ? 'Image outline editor' : showOriginal ? 'Original image preview' :
                look !== 'original' ? printLabels[look] + ' preview' : hasEdge ? edgeLabels[edge] + ' preview' :
                hasMask ? 'Masked image preview' : grain ? 'Paper Grain preview' : 'Original image preview'}
              onPointerDown={startMark} onPointerMove={moveMark} onPointerUp={stopMark}
              onPointerCancel={stopMark} onLostPointerCapture={(event) => {
                if (!event.buttons) stopMark(event)
              }}
              onKeyDown={(event) => {
                if (tool !== 'Outline') return
                if (event.key === 'Enter') applyOutline()
                if (event.key === 'Escape') chooseTool(null)
              }} /> :
              <div className="empty">
                <div className="empty-icon"><ImageSquare size={40} weight="thin" /></div>
                <h2>{busy ? 'Opening image…' : 'Drop an image here'}</h2>
                <p>PNG, JPEG, or WebP</p>
                <button className="secondary" onClick={() => input.current?.click()}>Browse files</button>
              </div>}
          </div>
          <div className="preview-footer">
            <span className="dimensions">{source ? `${source.canvas.width} × ${source.canvas.height} px` : 'No image loaded'}</span>
            <div className="backgrounds" aria-label="Preview background">
              <span>Background</span>
              {(['Checkerboard', 'Light', 'Dark'] as const).map((value) =>
                <button key={value} aria-label={value} title={value} aria-pressed={background === value} onClick={() => setBackground(value)}>
                  <span className={value.toLowerCase()} />
                </button>)}
            </div>
          </div>
        </section>
        <aside className="panel" aria-label="Effects and adjustments">
          <section className="mask-panel" aria-label="Background removal">
            <h2><Scissors size={19} /> Background removal</h2>
            <button className="primary" disabled={!source || busy || exporting} onClick={() => void removeBackground()}>
              Remove Background
            </button>
            <div className="mask-tools" style={{ marginTop: 8 }}>
              {(['Outline', 'Keep', 'Erase'] as const).map((value) => (
                <button key={value} aria-pressed={tool === value} disabled={!source || busy || exporting || (value === 'Keep' && !hasMask)}
                  onClick={() => chooseTool(tool === value ? null : value)}>{value}</button>
              ))}
            </div>
            {tool === 'Outline' && <>
              <p className="tool-help">Click around the area you want to keep, then apply the outline.</p>
              <div className="mask-actions">
                <button disabled={outline.length < 3 || busy || exporting} onClick={applyOutline}>Apply outline</button>
                <button disabled={!outline.length} onClick={() => setOutline((points) => points.slice(0, -1))}>Undo point</button>
              </div>
            </>}
            {(tool === 'Keep' || tool === 'Erase') && <div className="controls mask-controls">
              <label>
                <span>Brush size<output>{brushSize} px</output></span>
                <input type="range" min="2" max={maxBrushSize}
                  value={brushSize} onChange={(event) => setBrushSize(event.currentTarget.valueAsNumber)} />
              </label>
            </div>}
            {hasMask && tool !== 'Outline' && <button className="clear-mask" disabled={busy || exporting} onClick={() => {
              chooseTool(null)
              if (!source?.transparent) setEdge('none')
              mask.current = null
              maskedPreview.current = null
              setMaskRevision(0)
            }}>Reset mask</button>}
          </section>
          <section className="effect-group" aria-labelledby="print-look">
            <h2 id="print-look"><Stack size={19} /> Print Look</h2>
            <div className="effect-options" role="group" aria-labelledby="print-look">
              {printChoices.map((choice) => (
                <button key={choice} aria-pressed={look === choice} disabled={!source || busy || tool === 'Outline'} onClick={() => {
                  setLook(choice)
                  setShowOriginal(false)
                }}>{printLabels[choice]}</button>
              ))}
            </div>
          </section>
          <section className="effect-group" aria-labelledby="edge-treatment">
            <h2 id="edge-treatment">Edge Treatment</h2>
            <div className="effect-options" role="group" aria-labelledby="edge-treatment" aria-describedby={source && !canUseEdge ? 'edge-help' : undefined}>
              {(['none', 'cutout', 'torn'] as const).map((choice) => (
                <button key={choice} aria-pressed={edge === choice} disabled={!canUseEdge || busy || tool === 'Outline'} onClick={() => {
                  stroke.current = null
                  setEdge(choice)
                  setShowOriginal(false)
                }}>{edgeLabels[choice]}</button>
              ))}
            </div>
            {source && !canUseEdge && <p className="tool-help" id="edge-help">Use Remove Background or apply a mask to enable paper edges.</p>}
          </section>
          <section className="effect-group" aria-labelledby="paper-grain">
            <h2 id="paper-grain">Paper Grain</h2>
            <label className="grain-toggle">
              <input type="checkbox" disabled={!source || busy || tool === 'Outline'} checked={grain} onChange={(event) => {
                setGrain(event.currentTarget.checked)
                setShowOriginal(false)
              }} />
              Add grain
            </label>
          </section>
          <div className="adjust-header">
            <button className="plain" disabled={!hasEffect} aria-expanded={adjust && hasEffect} aria-controls={adjust && hasEffect ? 'adjustments' : undefined} onClick={() => setAdjust(!adjust)}>
              Adjust <span aria-hidden="true">{adjust && hasEffect ? '−' : '+'}</span>
            </button>
            {hasEffect && adjust && <button className="reset" title="Reset adjustments" aria-label="Reset adjustments" onClick={() => {
              setSettings(defaults)
              setPrintSettings(printDefaults)
              setShowOriginal(false)
            }}><ArrowCounterClockwise size={16} /></button>}
          </div>
          {hasEffect && adjust && <div id="adjustments" className="controls">
            {look === 'risograph' && <label>
              <span>Palette</span>
              <select value={printSettings.palette} onChange={(event) => {
                setPrintSettings({ ...printSettings, palette: event.currentTarget.value as Palette })
                setShowOriginal(false)
              }}>
                {paletteKeys.map((palette) => <option key={palette} value={palette}>{paletteLabels[palette]}</option>)}
              </select>
            </label>}
            {printControls[look].map(([key, label]) => <label key={key}>
              <span>{label}<output>{printSettings[key]}%</output></span>
              <input type="range" min="0" max="100" value={printSettings[key]} onChange={(event) => {
                setPrintSettings({ ...printSettings, [key]: event.currentTarget.valueAsNumber })
                setShowOriginal(false)
              }} />
            </label>)}
            {controls.filter(([key]) => key === 'texture' ? grain : key === 'roughness' ? edge === 'torn' : hasEdge).map(([key, label]) => <label key={key}>
              <span>{label}<output>{settings[key]}%</output></span>
              <input type="range" min="0" max="100" value={settings[key]} onChange={(event) => {
                setSettings({ ...settings, [key]: event.currentTarget.valueAsNumber })
                setShowOriginal(false)
              }} />
            </label>)}
          </div>}
          <p className={error ? 'status error' : 'status'} role={error ? 'alert' : 'status'}>{message || (busy ? 'Opening image…' : '')}</p>
        </aside>
      </main>
      {dialog === 'limit' && hostedAuth && !profile && <dialog className="library-dialog" open aria-label="Guest export limit">
        <header><h2>Guest export limit reached</h2><button onClick={() => setDialog(undefined)}>Close</button></header>
        <p>Sign in to keep editing this image and download it.</p>
        <button className="primary" onClick={() => { setDialog(undefined); hostedAuth.signIn() }}>Sign in</button>
      </dialog>}
      {!hostedAuth && (dialog === 'auth' || dialog === 'limit') && <AuthDialog limited={dialog === 'limit'} close={() => setDialog(undefined)} complete={(account) => {
        setProfile(account)
        setDialog(undefined)
      }} />}
      {dialog === 'library' && profile && <LibraryDialog owner={profile.id} close={() => setDialog(undefined)} open={openSavedProject} restore={restoreProject}
        detailsChanged={(id, details) => setActiveProject((project) => project?.id === id ? { ...project, ...details } : project)} />}
      {dialog === 'save' && profile && source && <SaveDialog close={() => setDialog(undefined)} save={saveCurrentProject}
        details={activeProject?.owner === profile.id ? activeProject : { name: source.name.replace(/\.[^.]+$/, '').slice(0, 120), collection: '' }} />}
    </div>
  )
}

function HostedApp() {
  const clerk = useClerk()
  const { isLoaded, user } = useUser()
  return <App hostedAuth={{
    ready: isLoaded,
    profile: user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? '' } : null,
    signIn: () => clerk.openSignIn(),
    signOut: () => clerk.signOut(),
  }} />
}

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()
createRoot(document.getElementById('root')!).render(publishableKey
  ? <ClerkProvider publishableKey={publishableKey}><HostedApp /></ClerkProvider>
  : <App />,
)

