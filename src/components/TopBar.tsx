import { useRef, type DragEvent } from 'react'
import type { HistoryDocMeta } from '../lib/history'
import { plural } from '../lib/plural'
import Menu from './Menu'
import { AlertIcon, BlinderMark, CheckIcon, ClockIcon, UploadIcon } from './icons'

// Сколько последних документов показывать в меню «История». Полный список с
// удалением остается на стартовом экране.
const RECENT_DOCS = 5

interface TopBarProps {
  fileName: string
  saveState: 'saved' | 'saving' | 'error'
  isLoading: boolean
  isDragging: boolean
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onPickFile: () => void
  historyDocs: HistoryDocMeta[]
  currentDocId: string | null
  onOpenDoc: (doc: HistoryDocMeta) => void
  onShowAllDocs: () => void
  onExportHistory: () => void
  onImportHistory: (file: File) => void
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function SaveStatus({ state }: { state: TopBarProps['saveState'] }) {
  if (state === 'error') return <span className="topbar-save is-error" role="status"><AlertIcon />Ошибка сохранения</span>
  if (state === 'saving') return <span className="topbar-save" role="status">Сохранение…</span>
  return <span className="topbar-save is-saved" role="status"><CheckIcon />Сохранено в браузере</span>
}

function TopBar({
  fileName, saveState, isLoading, isDragging, onDragOver, onDragLeave, onDrop,
  onPickFile,
  historyDocs, currentDocId, onOpenDoc, onShowAllDocs, onExportHistory, onImportHistory,
}: TopBarProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const recent = historyDocs.slice(0, RECENT_DOCS)

  return (
    <header
      className={`topbar${isDragging ? ' dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImportHistory(file)
          event.target.value = ''
        }}
      />
      <span className="topbar-brand"><BlinderMark />MD Blinder</span>
      <span className="topbar-divider" aria-hidden="true" />
      <div className="topbar-doc">
        {fileName && <span className="topbar-filename" title={fileName}>{fileName}</span>}
        <SaveStatus state={saveState} />
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-upload"
          disabled={isLoading}
          title="Или перетащите файл на эту панель"
          onClick={onPickFile}
        >
          <UploadIcon />Новый файл
        </button>
        <Menu label="История" icon={<ClockIcon />} panelClassName="menu-panel-wide">
          {(close) => (
            <>
              {recent.length === 0 && <p className="menu-note">История пуста.</p>}
              {recent.map((doc) => {
                const isCurrent = doc.id === currentDocId
                return (
                  <button
                    type="button"
                    key={doc.id}
                    className={`menu-item${isCurrent ? ' is-current' : ''}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => { close(); onOpenDoc(doc) }}
                  >
                    <span className="menu-item-title" title={doc.name}>{doc.name}</span>
                    <span className="menu-item-hint">
                      {isCurrent ? 'Открыт сейчас' : `${formatDate(doc.updatedAt)} · ${plural(doc.entityCount, ['находка', 'находки', 'находок'])}`}
                    </span>
                  </button>
                )
              })}
              <div className="menu-separator" />
              <p className="menu-note menu-note-warn">
                История хранится в этом браузере вместе с исходным текстом, без шифрования.
              </p>
              <div className="menu-row">
                <button type="button" className="menu-small" onClick={() => { close(); onShowAllDocs() }}>Все документы</button>
                <button type="button" className="menu-small" disabled={historyDocs.length === 0} onClick={() => { close(); onExportHistory() }}>Экспорт</button>
                <button type="button" className="menu-small" onClick={() => { close(); importInputRef.current?.click() }}>Импорт</button>
              </div>
            </>
          )}
        </Menu>
      </div>
    </header>
  )
}

export default TopBar
