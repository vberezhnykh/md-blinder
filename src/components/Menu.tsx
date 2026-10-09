import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from './icons'

interface MenuProps {
  // Подпись кнопки; она же доступное имя, если не задан ariaLabel.
  label: ReactNode
  ariaLabel?: string
  icon?: ReactNode
  buttonClassName?: string
  // К какому краю кнопки прижата панель.
  align?: 'start' | 'end'
  panelClassName?: string
  disabled?: boolean
  // close() закрывает меню; пункт вызывает его после своего действия.
  children: (close: () => void) => ReactNode
}

// Раскрывающаяся панель под кнопкой (disclosure). Роль menu не используется:
// в панелях есть флажки и пояснения, а menu допускает только пункты меню.
// Панель закрывается по Escape (фокус возвращается на кнопку), по нажатию
// мыши вне меню и когда фокус уходит из меню клавишей Tab.
function Menu({ label, ariaLabel, icon, buttonClassName, align = 'end', panelClassName, disabled, children }: MenuProps) {
  const [requestedOpen, setOpen] = useState(false)
  // Отключенное меню (например, во время обработки файла) не показывает панель.
  const open = requestedOpen && !disabled
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      className="menu"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next && !rootRef.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`menu-button${buttonClassName ? ` ${buttonClassName}` : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon}
        {label}
        <ChevronDownIcon />
      </button>
      {open && (
        <div id={panelId} className={`menu-panel menu-panel-${align}${panelClassName ? ` ${panelClassName}` : ''}`}>
          {children(close)}
        </div>
      )}
    </div>
  )
}

export default Menu
