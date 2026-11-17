// The Library page: what Hermux made and kept, in three parts behind a switch at the top: Canvases (the gallery),
// Files (the phone's file browser) and Projects. Each part is the page it was before, shown without its own bar; its
// buttons (Upload and New folder, New project) join the Library's top bar. The last part is remembered.
import { useState } from 'react'
import { savedPart, savePart, type LibraryPart } from '../library'
import { EmbeddedShell, ScreenShell, FilesScreen, ProjectsScreen } from './Screens'
import { GalleryScreen } from './Gallery'
import { Segmented } from './ui'

export function LibraryScreen({ onUse }: { onUse: (text: string) => void }) {
  const [part, setPart] = useState<LibraryPart>(savedPart)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <ScreenShell title="Library" actions={<span className="lib-actions" ref={setSlot} />}>
      <div className="lib-switch">
        <Segmented
          options={[
            { value: 'canvases' as LibraryPart, label: 'Canvases' },
            { value: 'files' as LibraryPart, label: 'Files' },
            { value: 'projects' as LibraryPart, label: 'Projects' }
          ]}
          value={part}
          onChange={p => {
            savePart(p)
            setPart(p)
          }}
        />
      </div>
      <EmbeddedShell.Provider value={{ slot }}>
        {part === 'canvases' && <GalleryScreen />}
        {part === 'files' && <FilesScreen onUse={onUse} />}
        {part === 'projects' && <ProjectsScreen />}
      </EmbeddedShell.Provider>
    </ScreenShell>
  )
}
