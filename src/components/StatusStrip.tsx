import { plural } from '../lib/plural'
import Menu from './Menu'
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, TableIcon } from './icons'

interface StatusStripProps {
  unreviewedCount: number
  // Значения, которые сейчас заменяются, и сколько всего мест они занимают.
  replacedValues: number
  replacedPlaces: number
  exportFileName: string
  onShowCandidates: () => void
  onExport: () => void
  onCopy: () => void
  onExportCsv: () => void
}

type StepState = 'done' | 'active' | 'todo'

function Step({ index, label, state }: { index: number; label: string; state: StepState }) {
  return (
    <li className={`status-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <span className="status-step-mark" aria-hidden="true">{state === 'done' ? <CheckIcon size={12} /> : index}</span>
      <span className="status-step-label">{label}</span>
    </li>
  )
}

function summary(values: number, places: number): string {
  if (values === 0) return 'Замен пока нет'
  return `Заменено ${plural(values, ['значение', 'значения', 'значений'])} в ${plural(places, ['месте', 'местах', 'местах'])}`
}

// Строка над рабочей областью: где пользователь находится в работе с документом,
// можно ли отдавать результат и как его получить. Загрузка на экране документа
// всегда завершена; «Проверка» активна, пока есть непроверенные кандидаты.
function StatusStrip({
  unreviewedCount, replacedValues, replacedPlaces, exportFileName,
  onShowCandidates, onExport, onCopy, onExportCsv,
}: StatusStripProps) {
  const ready = unreviewedCount === 0
  return (
    <div className="status-strip">
      <ol className="status-steps" aria-label="Этапы работы с документом">
        <Step index={1} label="Загрузка" state="done" />
        <Step index={2} label="Проверка" state={ready ? 'done' : 'active'} />
        <Step index={3} label="Выдача" state={ready ? 'active' : 'todo'} />
      </ol>
      <div className="status-info">
        {ready ? (
          <span className="status-chip is-ready"><CheckIcon />Готово к выдаче</span>
        ) : (
          <button type="button" className="status-chip is-pending" onClick={onShowCandidates}>
            <AlertIcon />Не проверено: {plural(unreviewedCount, ['кандидат', 'кандидата', 'кандидатов'])}
          </button>
        )}
        <span className="status-summary">{summary(replacedValues, replacedPlaces)}</span>
      </div>
      <div className="split-button">
        <button type="button" className="primary split-main" onClick={onExport}>
          <DownloadIcon />Экспортировать .md
        </button>
        <Menu label={null} ariaLabel="Другие варианты выдачи" buttonClassName="primary split-toggle" panelClassName="menu-panel-wide">
          {(close) => (
            <>
              <button type="button" className="menu-item menu-item-icon" onClick={() => { close(); onCopy() }}>
                <CopyIcon />
                <span>
                  <span className="menu-item-title">Копировать текст</span>
                  <span className="menu-item-hint">Обезличенный Markdown в буфер обмена</span>
                </span>
              </button>
              <button type="button" className="menu-item menu-item-icon" onClick={() => { close(); onExport() }}>
                <DownloadIcon />
                <span>
                  <span className="menu-item-title">Экспортировать .md</span>
                  <span className="menu-item-hint">Файл «{exportFileName}»</span>
                </span>
              </button>
              <div className="menu-separator" />
              <button type="button" className="menu-item menu-item-icon is-sensitive" onClick={() => { close(); onExportCsv() }}>
                <TableIcon />
                <span>
                  <span className="menu-item-title">Таблица замен (.csv)</span>
                  <span className="menu-item-hint">Содержит исходные данные. Не передавайте ее вместе с обезличенным текстом.</span>
                </span>
              </button>
            </>
          )}
        </Menu>
      </div>
    </div>
  )
}

export default StatusStrip
