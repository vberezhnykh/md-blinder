import { useEffect } from 'react'

export interface ToastState {
  key: number
  text: string
  tone?: 'default' | 'warn' | 'error'
  action?: { label: string; onClick: () => void }
  durationMs: number
}

// Уведомление поверх раскладки: не сдвигает редактор и не пропадает раньше,
// чем его можно прочитать. Одновременно показывается одно — новое заменяет старое.
function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(onClose, toast.durationMs)
    return () => clearTimeout(id)
  }, [toast, onClose])

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className={`toast toast-${toast.tone ?? 'default'}`} key={toast.key}>
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Закрыть уведомление" onClick={onClose}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default Toast
