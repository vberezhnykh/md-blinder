import { useRef } from 'react'
import type { HistoryDocMeta } from '../lib/history'
import { plural } from '../lib/plural'

interface HistoryPanelProps {
  docs: HistoryDocMeta[]
  currentId: string | null
  errorText?: string
  onOpen: (doc: HistoryDocMeta) => void
  onDelete: (doc: HistoryDocMeta) => void
  onExport: () => void
  onImport: (file: File) => void
}

function HistoryPanel({ docs, currentId, errorText, onOpen, onDelete, onExport, onImport }: HistoryPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImport(file)
    e.target.value = ''
  }

  return (
    <div className="history-panel">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleImportChange}
      />
      <div className="history-header">
        <h3>История ({docs.length})</h3>
        <div>
          <button type="button" onClick={onExport} disabled={docs.length === 0}>
            Экспортировать историю
          </button>
          <button type="button" onClick={() => importInputRef.current?.click()}>
            Импортировать историю
          </button>
        </div>
      </div>

      <p className="history-warning">
        История хранится в этом браузере вместе с исходным текстом, без шифрования. Экспорт истории тоже
        содержит исходные данные.
      </p>

      {errorText && <p className="history-error">{errorText}</p>}

      {docs.length === 0 ? (
        <p className="text-muted">История пуста.</p>
      ) : (
        docs.map((doc) => (
          <div className="history-row" key={doc.id}>
            <span className="history-name" title={doc.name}>
              {doc.name}
            </span>
            <span className="history-meta">
              {new Date(doc.updatedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · {plural(doc.entityCount, ['находка', 'находки', 'находок'])} · {doc.format}
            </span>
            <button type="button" onClick={() => onOpen(doc)}>
              {doc.id === currentId ? 'Открыт' : 'Открыть'}
            </button>
            <button
              type="button"
              className="history-delete"
              title="Удалить"
              aria-label={`Удалить «${doc.name}»`}
              onClick={() => onDelete(doc)}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  )
}

export default HistoryPanel
