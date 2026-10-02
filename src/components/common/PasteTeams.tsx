import { useState } from 'react'

export interface PasteAction {
  label: string
  run: (names: string[]) => void
}

export const parseTeamNames = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

/** Paste a list of team names, one per line, then apply one of `actions`. */
export function PasteTeams({ actions, onClose, hint }: { actions: PasteAction[]; onClose: () => void; hint?: string }) {
  const [text, setText] = useState('')
  const names = parseTeamNames(text)
  return (
    <div className="paste">
      <textarea
        autoFocus
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'One team per line, in seed order\nVitality\nMOUZ\nSpirit'}
        aria-label="Team names"
      />
      {hint && <p className="hint">{hint}</p>}
      <div className="row">
        {actions.map((action) => (
          <button
            key={action.label}
            className="button"
            disabled={names.length === 0}
            onClick={() => {
              action.run(names)
              onClose()
            }}
          >
            {action.label}
            {names.length > 0 && ` (${names.length})`}
          </button>
        ))}
        <button className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
