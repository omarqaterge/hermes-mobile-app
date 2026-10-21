// Canvas gallery screen: every chat's canvas documents, by type, with a search over titles and text. Tap one to see it;
// open it on its chat's canvas or go to the chat it was made in. HTML runs here in the same offline sandbox as on the canvas.
import { useEffect, useState } from 'react'
import { copyText, haptic, shareText as nativeShare } from '../bridge'
import { confirmDialog, promptDialog } from '../dialog'
import { ago } from '../unread'
import { toast } from '../store'
import { deleteItem, itemContent, loadGallery, openItemChat, renameItem, setGalleryFilter, setGalleryQuery, useGallery, type GalleryItem } from '../gallery'
import { DocView, Sheetish, TYPE_ICON } from './Canvas'
import { ScreenShell, Sheet, Status } from './Screens'
import { Row, Section, Segmented } from './ui'
import { Spinner } from './Spinner'

function shareText(title: string, text: string): void {
  if (!nativeShare(title, text)) void copyText(text).then(() => toast('Copied (sharing works in the phone app)'))
}

const chatLabel = (i: GalleryItem) => (i.chat ? `“${i.chat.title || 'Untitled chat'}”${i.chat.archived ? ' (archived)' : ''}` : 'a deleted chat')

function ItemMenu({ item, text, onClose, onGone }: { item: GalleryItem; text: string | null; onClose: () => void; onGone: () => void }) {
  const run = (fn: () => void) => () => {
    haptic()
    onClose()
    fn()
  }
  return (
    <Sheetish title={item.title} onClose={onClose}>
      <Section>
        <Row icon="✏️" tone="gold" title="Rename" onClick={run(() => void promptDialog({ title: 'Rename', value: item.title, placeholder: 'Title', confirmLabel: 'Rename' }).then(t => t && void renameItem(item, t)))} />
      </Section>
      {text != null && (
        <Section title="Share">
          <Row icon="⧉" tone="teal" title="Copy" onClick={run(() => void copyText(text).then(() => toast('Copied')))} />
          <Row icon="↗" tone="green" title="Share…" onClick={run(() => shareText(item.title, text))} />
        </Section>
      )}
      <Section>
        <Row
          icon="🗑"
          danger
          title="Delete"
          onClick={run(() =>
            void confirmDialog({
              title: `Delete “${item.title}”?`,
              message: item.lib ? 'This saved copy is removed. The chat is not touched.' : `It is removed from the canvas of ${chatLabel(item)}. The chat itself is not touched.`,
              confirmLabel: 'Delete',
              danger: true
            }).then(ok => {
              if (!ok) return
              onGone()
              void deleteItem(item)
            })
          )}
        />
      </Section>
    </Sheetish>
  )
}

function Viewer({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const item = useGallery(s => s.items.find(i => i.key === itemKey))
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<null | 'item'>(null)
  const updated = item?.updated
  useEffect(() => {
    if (!item) return
    let live = true
    itemContent(item).then(
      t => live && setText(t),
      e => live && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, updated])
  if (!item) return null
  const go = (canvas: boolean) => () => {
    haptic()
    void openItemChat(item, canvas)
  }
  return (
    <Sheet title={item.title} onClose={onClose}>
      <div className="lib-viewer">
        <div className="lib-viewer-bar">
          <span className="dim small">
            {TYPE_ICON[item.type] ?? '📄'} {item.category} · from {chatLabel(item)} · {ago(item.updated * 1000)}
          </span>
          {!item.lib && item.chat && (
            <button className="btn primary" onClick={go(true)}>
              Open canvas
            </button>
          )}
          {item.chat && (
            <button className="btn" onClick={go(false)}>
              Go to chat
            </button>
          )}
          <button className="icon-btn" aria-label="Item options" onClick={() => setMenu('item')}>
            ⋮
          </button>
        </div>
        <div className="lib-viewer-body">
          {error ? (
            <div className="notice notice-error">{error}</div>
          ) : text == null ? (
            <div className="pad" aria-busy="true">
              <Spinner />
            </div>
          ) : (
            <DocView doc={{ id: item.doc, title: item.title, type: item.type, lang: item.lang, rev: 0, updated: item.updated, by: '', chars: item.chars, path: '', created: item.created, content: text }} text={text} network={false} />
          )}
        </div>
      </div>
      {menu === 'item' && <ItemMenu item={item} text={text} onClose={() => setMenu(null)} onGone={onClose} />}
    </Sheet>
  )
}

export function GalleryScreen() {
  const items = useGallery(s => s.items)
  const categories = useGallery(s => s.categories)
  const loading = useGallery(s => s.loading)
  const error = useGallery(s => s.error)
  const filter = useGallery(s => s.filter)
  const query = useGallery(s => s.query)
  const shownQuery = useGallery(s => s.shownQuery)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void loadGallery()
  }, [])
  const cats = Object.entries(categories)
  const shown = filter ? items.filter(i => i.category === filter) : items
  const tabs = [{ value: '', label: `All ${items.length}` }, ...cats.map(([c, n]) => ({ value: c, label: `${c} ${n}` }))]
  return (
    <ScreenShell title="Canvas gallery">
      <input className="search gallery-search" type="search" placeholder="Search titles and text…" value={query} onChange={e => setGalleryQuery(e.target.value)} />
      {cats.length > 0 && (
        <div className="lib-cats">
          {tabs.length <= 3 ? (
            <Segmented options={tabs} value={filter} onChange={setGalleryFilter} />
          ) : (
            <div className="chips-row">
              {tabs.map(t => (
                <button key={t.value} className={`pill${filter === t.value ? ' on' : ''}`} onClick={() => { haptic(); setGalleryFilter(t.value) }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Status loading={loading} error={loading ? error : ''} empty={!items.length} emptyText={shownQuery ? `Nothing matches “${shownQuery}”.` : 'Nothing here yet. Everything Hermes or you put on a chat’s canvas shows up here.'} />
      {shown.length > 0 && (
        <div className="gallery-grid">
          {shown.map(i => (
            <button key={i.key} className="gallery-card" onClick={() => { haptic(); setOpen(i.key) }}>
              <span className="gallery-card-top">
                <span className="gallery-icon" aria-hidden="true">{TYPE_ICON[i.type] ?? '📄'}</span>
                <span className="gallery-cat">{i.category}</span>
              </span>
              <span className="gallery-title">{i.title}</span>
              {i.snippet && <span className="gallery-snippet">{i.snippet}</span>}
              <span className="gallery-from">
                {i.chat ? `💬 ${i.chat.title || 'Untitled chat'}` : 'Chat deleted'} · {ago(i.updated * 1000)}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && <Viewer itemKey={open} onClose={() => setOpen(null)} />}
    </ScreenShell>
  )
}
