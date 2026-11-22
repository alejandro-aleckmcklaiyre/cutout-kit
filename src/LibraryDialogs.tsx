import { liveQuery } from 'dexie'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { downloadBackup, readBackup } from './backup'
import { listProjects, renameProject, signIn, type Project, type ProjectDetails, type ProjectEdit } from './library'

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="library-dialog" ref={dialog} aria-labelledby="dialog-title"
    onCancel={(event) => { event.preventDefault(); close() }}>
    <header><h2 id="dialog-title">{title}</h2><button onClick={close}>Close</button></header>
    {children}
  </dialog>
}

type Session = Awaited<ReturnType<typeof signIn>>

export function AuthDialog({ limited, close, complete }: {
  limited: boolean; close: () => void; complete: (profile: Session) => void
}) {
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return <Dialog title={create ? 'Create a local profile' : 'Sign in'} close={() => { if (!busy) close() }}>
    {limited && <p>You’ve used 10 guest PNG exports. Sign in to keep exporting with your current edit.</p>}
    <p className="tool-help">This profile and its projects are stored in this browser.</p>
    <form className="library-form" onSubmit={async (event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setBusy(true)
      setMessage('')
      try {
        complete(await signIn(String(data.get('email')), String(data.get('password')), create))
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Sign-in failed.')
      } finally {
        setBusy(false)
      }
    }}>
      <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Passphrase<input name="password" type="password" autoComplete={create ? 'new-password' : 'current-password'}
        required minLength={create ? 8 : undefined} maxLength={256} /></label>
      <button className="primary" type="submit" disabled={busy}>{create ? 'Create profile' : 'Sign in'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setCreate(!create); setMessage('') }}>
        {create ? 'Use an existing profile' : 'Create a local profile'}
      </button>
      {message && <p className="status error" role="alert">{message}</p>}
    </form>
  </Dialog>
}

function DetailsFields({ details }: { details: ProjectDetails }) {
  return <>
    <label>Asset name<input name="name" required maxLength={120} defaultValue={details.name} /></label>
    <label>Collection (optional)<input name="collection" maxLength={80} defaultValue={details.collection} /></label>
  </>
}

function readDetails(form: HTMLFormElement) {
  const data = new FormData(form)
  const name = String(data.get('name')).trim()
  if (!name) throw new Error('Enter an asset name.')
  return { name, collection: String(data.get('collection')).trim() }
}

export function SaveDialog({ details, close, save }: {
  details: ProjectDetails; close: () => void; save: (details: ProjectDetails) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return <Dialog title="Save project" close={() => { if (!busy) close() }}>
    <form className="library-form" onSubmit={async (event) => {
      event.preventDefault()
      setBusy(true)
      setMessage('')
      try { await save(readDetails(event.currentTarget)) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'The project could not be saved.') }
      finally { setBusy(false) }
    }}>
      <DetailsFields details={details} />
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save in this browser'}</button>
      {message && <p className="status error" role="alert">{message}</p>}
    </form>
  </Dialog>
}

export function LibraryDialog({ owner, close, open, restore, detailsChanged }: {
  owner: string; close: () => void; open: (project: Project) => Promise<void>;
  restore: (edit: ProjectEdit & ProjectDetails) => Promise<void>;
  detailsChanged: (id: string, details: ProjectDetails) => void
}) {
  const [projects, setProjects] = useState<Project[]>()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ text: '', error: false })
  const restoreFile = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const subscription = liveQuery(() => listProjects(owner)).subscribe({
      next: setProjects,
      error: () => setNotice({ text: 'The library could not be loaded.', error: true }),
    })
    return () => subscription.unsubscribe()
  }, [owner])
  const visible = (projects ?? []).filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()))

  async function perform(action: () => Promise<void>, success = '') {
    if (busy) return
    setBusy(true)
    setNotice({ text: '', error: false })
    try {
      await action()
      setNotice({ text: success, error: false })
    } catch (error) {
      setNotice({ text: error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'The operation failed. Check the project backup and try again.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return <Dialog title="Saved in this browser" close={() => { if (!busy) close() }}>
    <div className="library-toolbar">
      <label>Search by name<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      <button className="secondary" disabled={busy} onClick={() => restoreFile.current?.click()}>Restore backup</button>
      <input hidden ref={restoreFile} type="file" accept=".json,application/json" aria-label="Project backup file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void perform(async () => { await restore(await readBackup(file)); setQuery('') }, 'Backup restored.')
        }} />
    </div>
    {notice.text && <p className={notice.error ? 'status error' : 'status'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <h3>Recently edited</h3>
    {visible.length === 0 && <p className="tool-help">{!projects ? 'Loading projects…' : query ? 'No projects match this name.' : 'No saved projects yet.'}</p>}
    <ul className="library-projects">
      {visible.map((project) => <li key={project.id}>
        <div>
          <strong>{project.name}</strong>
          {project.collection && <p className="tool-help">{project.collection}</p>}
        </div>
        {editing === project.id
          ? <form className="library-form" onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            void perform(async () => {
              const details = readDetails(form)
              await renameProject(owner, project.id, details)
              detailsChanged(project.id, details)
              setEditing(undefined)
            }, 'Project details saved.')
          }}>
            <DetailsFields details={project} />
            <div className="library-buttons">
              <button className="primary" disabled={busy}>Save details</button>
              <button className="secondary" type="button" onClick={() => setEditing(undefined)}>Cancel</button>
            </div>
          </form>
          : <div className="library-buttons">
            <button className="secondary" disabled={busy} onClick={() => void perform(() => open(project))}>Open project</button>
            <button className="secondary" disabled={busy} onClick={() => setEditing(project.id)}>Edit details</button>
            <button className="secondary" disabled={busy} onClick={() => void perform(() => downloadBackup(project), 'Backup download ready.')}>Download backup</button>
          </div>}
      </li>)}
    </ul>
  </Dialog>
}

