// File checkpoints of one chat, from the plugin (`checkpoints.py`). Hermes snapshots the FOLDER of a file
// before write_file/patch (its project root, else the file's own folder), which is often not the chat's
// cwd, so Hermes's own rollback.* methods (cwd only) can't see them. The plugin records which snapshots
// each chat caused and runs Hermes's checkpoint manager for diff and restore.
import { api, qs } from './api'

export interface Snapshot {
  /** tree@date: survives Hermes rewriting the chain when it prunes old snapshots */
  id: string
  hash: string
  date: string
  reason: string
  /** files (relative to the folder) this chat edited right after the snapshot */
  files: string[]
}
export interface CheckpointFolder {
  workdir: string
  snapshots: Snapshot[]
  /** snapshots of this chat Hermes already pruned (it keeps 20 per folder) */
  pruned: number
}
export interface DiffFile {
  file: string
  /** since the snapshot: added = created after it, deleted = removed after it */
  status: 'added' | 'deleted' | 'modified'
  added: number
  removed: number
  diff: string
}
export interface RestoreResult {
  ok: boolean
  restored_files?: string[]
  skipped_user_edits?: string[]
  skipped_oversize?: string[]
  failed_deletes?: string[]
}

const P = '/api/plugins/hermes-mobile/checkpoints'
const call = <T,>(method: string, path: string, body?: unknown) => api<T>(method, path, body, { profile: false })

export const listCheckpoints = (session: string) => call<{ folders: CheckpointFolder[] }>('GET', `${P}?${qs({ session })}`).then(r => r.folders)

export const checkpointDiff = (session: string, workdir: string, snap: string) =>
  call<{ files: DiffFile[] }>('GET', `${P}/diff?${qs({ session, workdir, snap })}`).then(r => r.files)

export const restoreCheckpoint = (session: string, workdir: string, snap: string, file = '') =>
  call<RestoreResult>('POST', `${P}/restore`, { session, workdir, snap, file })

/** A deleted chat's list goes too (the folder snapshots stay: other chats may use them). */
export const forgetCheckpoints = (session: string) => call('DELETE', `${P}?${qs({ session })}`).catch(() => {})

/** `/root/projects/app` → `~/projects/app`; long paths keep their last two folders. */
export function folderLabel(workdir: string, home = '/root'): string {
  let p = workdir.startsWith(home + '/') ? '~' + workdir.slice(home.length) : workdir
  const parts = p.split('/').filter(Boolean)
  if (parts.length > 3) p = `${parts[0] === '~' ? '~/' : '/'}…/${parts.slice(-2).join('/')}`
  return p
}

/** What a restore will do to each file, for the confirmation. `only` = restoring that one file. */
export function restoreLines(files: DiffFile[], only = ''): string[] {
  const picked = only ? files.filter(f => f.file === only) : files
  return picked.map(f =>
    f.status === 'added' ? `${f.file}: deleted (made after this snapshot)` : f.status === 'deleted' ? `${f.file}: brought back` : `${f.file}: back to how it was`
  )
}

/** Toast after a restore: what changed and what was left alone. */
export function restoreSummary(r: RestoreResult, only = ''): { text: string; warn: boolean } {
  const done = r.restored_files ?? (only ? [only] : [])
  const kept = [...(r.skipped_user_edits ?? []), ...(r.skipped_oversize ?? []), ...(r.failed_deletes ?? [])]
  let text = done.length === 0 ? 'Nothing to restore' : done.length === 1 ? `Restored ${done[0]}` : `Restored ${done.length} files`
  if (kept.length) text += ` · kept ${kept.length === 1 ? kept[0] : `${kept.length} files`} (changed by you or too big)`
  return { text, warn: kept.length > 0 }
}

/** Whether a single file can be put back on its own (a file made after the snapshot has nothing to go back to). */
export const canRestoreFile = (files: DiffFile[], file: string): boolean => {
  const f = files.find(x => x.file === file)
  return !!f && f.status !== 'added'
}
