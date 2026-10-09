import type { ReactNode } from 'react'

// Контурные значки интерфейса. Цвет берется из currentColor, размер задается
// пропом; значки декоративные, подпись дает кнопка или текст рядом.
function Icon({ size = 16, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

type IconProps = { size?: number }

export const UploadIcon = ({ size }: IconProps) => (
  <Icon size={size}><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></Icon>
)

export const ClockIcon = ({ size }: IconProps) => (
  <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
)

export const ChevronDownIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size}><path d="m6 9 6 6 6-6" /></Icon>
)

export const CheckIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} strokeWidth={2.4}><path d="M20 6 9 17l-5-5" /></Icon>
)

export const AlertIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size} strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></Icon>
)

export const DownloadIcon = ({ size }: IconProps) => (
  <Icon size={size}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></Icon>
)

export const CopyIcon = ({ size }: IconProps) => (
  <Icon size={size}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Icon>
)

export const TableIcon = ({ size }: IconProps) => (
  <Icon size={size}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M10 4v16" /></Icon>
)

export const ShieldIcon = ({ size }: IconProps) => (
  <Icon size={size}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></Icon>
)

// Знак приложения: три полосы разной длины, как зачерненные строки.
export function BlinderMark() {
  return (
    <svg className="blinder-mark" width="20" height="20" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="18" height="3.5" rx="1" />
      <rect x="2" y="9.25" width="11" height="3.5" rx="1" />
      <rect x="2" y="15.5" width="15" height="3.5" rx="1" />
    </svg>
  )
}
