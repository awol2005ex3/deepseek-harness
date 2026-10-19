/**
 * The file tree's body: the session's workspace root, listed one level at a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it asks
 * for goes through its injected face. The component itself only decides what to
 * draw for each absolute path and what a click means: a directory toggles, a
 * file opens through the owner's `tabActions` for a `file:` viewer to claim and
 * offers its own save through the authenticated file route, and anything else is
 * shown but refuses to open. A save that the file route refused is reported under
 * the row that asked for it. The header uses the shared PathLabel for the root,
 * followed by reload and workspace directory actions.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  FileTypeIcon, IconDownloadOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconRefreshOutlineRegular, Tooltip, classifyFileType,
  IconPauseOutlineRegular, IconPlayOutlineRegular, PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { childPath } from './face.ts'
import type { DownloadFailure, DownloadOutcome, FilesInjected } from './face.ts'
import type {} from './locales.ts'
import type { FilesTabState, createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.files.actions'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/** What every level shares: the tab's tree and its gestures. */
interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (parent: string, path: string) => void
  readonly onOpen: (path: string) => void
  readonly onDownload: (path: string, name: string) => Promise<DownloadOutcome>
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Say why the file route would not hand a file to the browser, in terms of the
 * file. Unlike a listing failure, a refusal has no code to carry: the route
 * answers with a status, which the face classes.
 * @param t - namespace-bound translate.
 * @param reason - the class the preflight settled with.
 * @returns the line to show under the row that asked.
 */
export function downloadLine(t: TranslateNS<'sidebarFiles'>, reason: DownloadFailure): string {
  switch (reason) {
    case 'notFound': return t('download.notFound')
    case 'denied': return t('download.denied')
    case 'tooLarge': return t('download.tooLarge')
    case 'unavailable': return t('download.unavailable')
  }
}

/** What one row's save is doing: preflighting, or refused with the reason to show. */
type DownloadPhase = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'failed'; readonly reason: DownloadFailure }

/** One file's row: the open gesture, and a save that reports its own refusal. */
function FileEntry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  const [phase, setPhase] = useState<DownloadPhase>({ kind: 'idle' })
  const inFlight = useRef(false)
  const save = (): void => {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'busy' })
    void tree.onDownload(path, entry.name).then((outcome) => {
      setPhase(outcome.kind === 'started' ? { kind: 'idle' } : { kind: 'failed', reason: outcome.reason })
    }).finally(() => { inFlight.current = false })
  }
  return (
    <li className={css.item} data-files-entry="file" data-files-path={path}>
      <div className={css.rowShell} data-files-download={phase.kind}>
        <button type="button" className={css.row} onClick={() => { tree.onOpen(path) }}>
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
          <span className={css.name}>{entry.name}</span>
        </button>
        <Tooltip portal label={tree.t('download')} side="top" delayMs={500}>
          <button
            type="button"
            className={css.rowAction}
            aria-label={tree.t('download')}
            aria-busy={phase.kind === 'busy'}
            disabled={phase.kind === 'busy'}
            data-files-download-action
            onClick={save}
          >
            <IconDownloadOutlineRegular size={14} />
          </button>
        </Tooltip>
      </div>
      {phase.kind === 'failed' && (
        <span className={css.note} data-files-row="download-failed">{downloadLine(tree.t, phase.reason)}</span>
      )}
    </li>
  )
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <button type="button" className={css.row} aria-expanded={expanded} onClick={() => { tree.onToggle(parent, path) }}>
          {expanded ? <IconFolderOpenRegular className={css.icon} /> : <IconFolderCloseRegular className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
        </button>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return <FileEntry parent={parent} entry={entry} tree={tree} />
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {level.failure !== undefined && <li className={css.note} data-files-row="failed">{failureLine(t, level.failure)}</li>}
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions,
  start, refresh, setAutoRefresh, toggle, download, t, renderSlot,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const tree: TreeContext = {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
    onDownload: (path, name) => download(path, name, signal),
    t,
  }
  const reload = (): void => {
    refresh(tab.id)
  }
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      <div className={css.header}>
        <PathLabel path={state.root} className={css.path} data-files-path />
        <span hidden>
          <button type="button" className={css.tool} aria-label={t('autoRefresh')}
            aria-pressed={state.autoRefresh} data-files-auto-refresh
            title={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')}
            onClick={() => { setAutoRefresh(tab.id, !state.autoRefresh) }}>
            {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
          </button>
        </span>
        <Tooltip label={t('reload')} shortcutKeys={tab.refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            aria-keyshortcuts={tab.refreshShortcut?.aria}
            data-files-reload
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
        {renderSlot('sidebar.right.tab.files.actions', {
          absolutePath: state.root,
        })}
      </div>
      <div
        ref={bodyRef}
        className={css.body}
        data-files-body
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
      >
        <ul className={css.level}><Level path={state.root} tree={tree} /></ul>
      </div>
    </div>
  )
}
