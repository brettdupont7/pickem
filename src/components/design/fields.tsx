import type { ReactNode } from 'react'

/** A labelled control in a settings grid. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

interface NumberInputProps {
  value: number | undefined
  /** Called with undefined when cleared, if `optional`. */
  onChange: (value: number | undefined) => void
  optional?: boolean
  placeholder?: string
  min?: number
  step?: number
  label?: string
}

/** A number input; blank means "use the default" when `optional`. */
export function NumberInput({ value, onChange, optional, placeholder, min = 0, step = 1, label }: NumberInputProps) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        if (e.target.value === '') {
          if (optional) onChange(undefined)
          return
        }
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

/** Best-of input: odd numbers, stepping 1, 3, 5, ... */
export function BestOfInput(props: Omit<NumberInputProps, 'min' | 'step'>) {
  return <NumberInput {...props} min={1} step={2} />
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** A select over string options with labels. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Record<T, string>
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
      {(Object.entries(options) as [T, string][]).map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  )
}

/** Saves text as a file in the browser. */
export function downloadFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
