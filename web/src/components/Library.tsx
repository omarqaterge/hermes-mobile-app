// Library screen: canvas documents you kept, by category. Read-only previews (HTML never runs here: interactive pages
// belong in the canvas), and a copy can be put back on the open chat's canvas.
import { useEffect, useState } from 'react'
import { copyText, haptic, shareText as nativeShare } from '../bridge'
import { confirmDialog, promptDialog } from '../dialog'
import { ago } from '../unread'
import { setState, toast } from '../store'
import { deleteItem, getItem, loadLibrary, openInCanvas, setLibraryFilter, updateItem, useLibrary, type LibItem, type LibItemFull } from '../library'
import { DocView, Sheetish, TYPE_ICON } from './Canvas'
import { ScreenShell, Sheet, Status } from './Screens'
import { IconChip, PickerSheet, Row, Section, Segmented, type Option } from './ui'
import { Spinner } from './Spinner'

const NEW = '\u0000new'

/** Pick a category: the existing ones, or a new one typed in a dialog. */
export function CategoryPicker({ title = 'Category', current = '', onPick, onClose }: { title?: string; current?: string; onPick: (category: string) => void; onClose: () => void }) {
  const categories = useLibrary(s => s.categories)
  const loading = useLibrary(s => s.loading)
  useEffect(() => {
    void loadLibrary()
  }, [])
  const options: Option[] = [
    ...Object.entries(categories).map(([c, n]) => ({ value: c, label: c, sub: `${n} item${n === 1 ? '' : 's'}`, icon: '📚', tone: 'gold' as const })),
    { value: NEW, label: '＋ New category…', sub: loading && !Object.keys(categories).length ? 'Loading your categories…' : undefined }
  ]
  return (
    <PickerSheet
      title={title}
      options={options}
      value={current}
      onClose={onClose}
      onPick={v => {
        if (v !== NEW) return onPick(v)
        void promptDialog({ title: 'New category', placeholder: 'e.g. Recipes', confirmLabel: 'Save' }).then(c => {
          if (c && c.trim()) onPick(c.trim())
        })
      }}
    />
  )
}

function shareText(title: string, text: string): void {
  if (!nativeShare(title, text)) void copyText(text).then(() => toast('Copied (sharing works in the phone app)'))
}

function ItemMenu({ item, full, onClose, onMove, onGone }: { item: LibItem; full: LibItemFull | null; onClose: () => void; onMove: () => void; onGone: () => void }) {
  const run = (fn: () => void) => () => {
    haptic()
    onClose()
    fn()
  }
  return (
    <Sheetish title={item.title} onClose={onClose}>
      <Section>
        <Row icon="📚" tone="gold" title="Move to category…" sub={item.category} chevron onClick={run(onMove)} />
        <Row icon="✏️" tone="gold" title="Rename" onClick={run(() => void promptDialog({ title: 'Rename', value: item.title, placeholder: 'Title', confirmLabel: 'Rename' }).then(t => t && void updateItem(item.id, { title: t })))} />
      </Section>
      {full && (
        <Section title="Share">
          <Row icon="⧉" tone="teal" title="Copy" onClick={run(() => void copyText(full.content).then(() => toast('Copied')))} />
          <Row icon="↗" tone="green" title="Share…" onClick={run(() => shareText(item.title, full.content))} />
        </Section>
      )}
      <Section>
        <Row
          icon="🗑"
          danger
          title="Delete"
          onClick={run(() =>
            void confirmDialog({ title: `Delete “${item.title}”?`, message: 'It is removed from your Library. Chats and their canvases are not touched.', confirmLabel: 'Delete', danger: true }).then(ok => {
              if (!ok) return
              onGone()
              void deleteItem(item.id)
            })
          )}
        />
      </Section>
    </Sheetish>
  )
}

function Viewer({ id, onClose }: { id: string; onClose: () => void }) {
  const item = useLibrary(s => s.items.find(i => i.id === id))
  const [full, setFull] = useState<LibItemFull | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<null | 'item' | 'move'>(null)
  useEffect(() => {
    let live = true
    getItem(id).then(
      d => live && setFull(d),
      e => live && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [id])
  if (!item) return null
  return (
    <Sheet title={item.title} onClose={onClose}>
      <div className="lib-viewer">
        <div className="lib-viewer-bar">
          <span className="dim small">
            {TYPE_ICON[item.type] ?? '📄'} {item.category} · {ago(item.saved * 1000)}
          </span>
          <button
            className="btn primary"
            onClick={() => {
              haptic()
              void openInCanvas(item).then(ok => ok && setState({ screen: null, screenBack: null }))
            }}
          >
            Open in this chat’s canvas
          </button>
          <button className="icon-btn" aria-label="Item options" onClick={() => setMenu('item')}>
            ⋮
          </button>
        </div>
        <div className="lib-viewer-body">
          {error ? (
            <div className="notice notice-error">{error}</div>
          ) : !full ? (
            <div className="pad" aria-busy="true">
              <Spinner />
            </div>
          ) : full.type === 'html' ? (
            <div className="dim pad">🌐 A web page. Open it in a chat’s canvas to run it.</div>
          ) : (
            <DocView doc={{ ...full, rev: 0, updated: full.saved, by: '', path: '', created: full.saved }} text={full.content} network={false} />
          )}
        </div>
      </div>
      {menu === 'item' && <ItemMenu item={item} full={full} onClose={() => setMenu(null)} onMove={() => setMenu('move')} onGone={onClose} />}
      {menu === 'move' && <CategoryPicker title="Move to category" current={item.category} onClose={() => setMenu(null)} onPick={c => void updateItem(item.id, { category: c })} />}
    </Sheet>
  )
}

export function LibraryScreen() {
  const items = useLibrary(s => s.items)
  const categories = useLibrary(s => s.categories)
  const loading = useLibrary(s => s.loading)
  const error = useLibrary(s => s.error)
  const filter = useLibrary(s => s.filter)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void loadLibrary()
  }, [])
  const cats = Object.entries(categories)
  const shown = filter ? items.filter(i => i.category === filter) : items
  const tabs = [{ value: '', label: `All ${items.length}` }, ...cats.map(([c, n]) => ({ value: c, label: `${c} ${n}` }))]
  return (
    <ScreenShell title="Library">
      {cats.length > 0 && (
        <div className="lib-cats">
          {tabs.length <= 4 ? (
            <Segmented options={tabs} value={filter} onChange={setLibraryFilter} />
          ) : (
            <div className="chips-row">
              {tabs.map(t => (
                <button key={t.value} className={`pill${filter === t.value ? ' on' : ''}`} onClick={() => { haptic(); setLibraryFilter(t.value) }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Status loading={loading} error={loading ? error : ''} empty={!items.length} emptyText="Nothing saved yet. In a chat’s canvas, ⋮ → Save to library…" />
      {shown.length > 0 && (
        <Section>
          {shown.map(i => (
            <button key={i.id} className="set-row lib-row" onClick={() => { haptic(); setOpen(i.id) }}>
              <IconChip tone="gold">{TYPE_ICON[i.type] ?? '📄'}</IconChip>
              <span className="set-text">
                <span className="set-title">{i.title}</span>
                <span className="set-sub">
                  {i.category} · {ago(i.saved * 1000)}
                </span>
              </span>
              <span className="set-chev">›</span>
            </button>
          ))}
        </Section>
      )}
      {open && <Viewer id={open} onClose={() => setOpen(null)} />}
    </ScreenShell>
  )
}
