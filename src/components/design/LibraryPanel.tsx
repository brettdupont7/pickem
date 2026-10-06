import { useMemo, useRef, useState } from 'react'
import { presets } from '../../data/presets'
import { blankTournament, instantiate, parseTournamentFile, serializeTournament, slugify, validateTournament, type ResultLayers } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import { useUiStore } from '../../store/ui'
import type { Tournament } from '../../types'
import { downloadFile } from './fields'

interface Row extends ResultLayers {
  tournament: Tournament
  updatedAt?: number
  isOpen: boolean
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Saved tournaments: open, duplicate, export, delete, plus new and import. */
export function LibraryPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const actual = useTournamentStore((s) => s.actual)
  const picks = useTournamentStore((s) => s.picks)
  const library = useTournamentStore((s) => s.library)
  const { openTournament, createTournament, duplicateTournament, deleteTournament } = useTournamentStore()
  const closeEditor = useUiStore((s) => s.closeEditor)
  const [withResults, setWithResults] = useState(true)
  const [message, setMessage] = useState<{ kind: 'error' | 'hint'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const rows: Row[] = useMemo(
    () => [
      { tournament, actual, picks, isOpen: true },
      ...Object.values(library)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((e) => ({ ...e, isOpen: false })),
    ],
    [tournament, actual, picks, library],
  )

  const create = (t: Tournament, layers?: ResultLayers) => {
    closeEditor()
    createTournament(t, layers)
    setMessage(null)
  }

  const exportRow = ({ tournament: t, actual: a, picks: p }: Row) =>
    downloadFile(`${slugify(t.name)}.json`, serializeTournament(t, withResults ? { actual: a, picks: p } : undefined))

  const remove = ({ tournament: t }: Row) => {
    if (window.confirm(`Delete ${t.name} and all its results? This can't be undone.`)) deleteTournament(t.id)
  }

  const importFile = async (file: File) => {
    try {
      const { tournament: t, layers } = parseTournamentFile(await file.text())
      create(instantiate(t), layers)
      const issues = validateTournament(t)
      setMessage(
        issues.length
          ? { kind: 'hint', text: `Imported ${t.name} with ${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} to fix below.` }
          : { kind: 'hint', text: `Imported ${t.name}.` },
      )
    } catch (e) {
      setMessage({ kind: 'error', text: `Couldn't import ${file.name}: ${(e as Error).message}` })
    }
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Tournaments</h2>
        <div className="row">
          <select
            value=""
            aria-label="New tournament"
            onChange={(e) => {
              const id = e.target.value
              if (id === 'blank') create(blankTournament())
              const preset = presets.find((p) => p.id === id)
              if (preset) create(instantiate(preset.tournament))
            }}
          >
            <option value="" disabled>
              + New tournament…
            </option>
            <option value="blank">Blank (8 teams, single elimination)</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                From {p.name}
              </option>
            ))}
          </select>
          <button className="button" onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importFile(file)
              e.target.value = ''
            }}
          />
        </div>
      </header>
      {message && <p className={message.kind}>{message.text}</p>}
      <div className="table-wrap">
        <table className="library__table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.tournament.id} className={row.isOpen ? 'is-open' : ''}>
                <td>
                  <span className="library__name">
                    {row.tournament.name}
                    {row.isOpen && <span className="status status--in-progress">Open</span>}
                  </span>
                </td>
                <td className="muted">
                  {row.tournament.stages.length} {row.tournament.stages.length === 1 ? 'stage' : 'stages'} ·{' '}
                  {Object.keys(row.tournament.teams).length} teams
                </td>
                <td className="muted">{row.updatedAt ? formatDate(row.updatedAt) : ''}</td>
                <td className="library__actions">
                  {!row.isOpen && (
                    <button className="button" onClick={() => (closeEditor(), openTournament(row.tournament.id))}>
                      Open
                    </button>
                  )}
                  <button
                    className="button button--ghost"
                    onClick={() => (closeEditor(), duplicateTournament(row.tournament.id))}
                    title="Copy the tournament with its picks and results"
                  >
                    Duplicate
                  </button>
                  <button
                    className="button button--ghost"
                    onClick={() => (closeEditor(), duplicateTournament(row.tournament.id, true))}
                    title="Copy the format and teams, without picks or results"
                  >
                    Duplicate design
                  </button>
                  <button className="button button--ghost" onClick={() => exportRow(row)}>
                    Export
                  </button>
                  <button className="button button--ghost" onClick={() => remove(row)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="check">
        <input type="checkbox" checked={withResults} onChange={(e) => setWithResults(e.target.checked)} />
        Include picks and results when exporting
      </label>
    </section>
  )
}
