import { useEffect, useRef, useState } from 'react'
import { HLTV_BOOKMARKLET_HREF, HLTV_VRS_URL, parseHltvImport } from '../../data/hltv'
import { buildFromHltvEvent, isHltvEvent, parseHltvEvent, updateTeamsFromHltv, type EventImport, type HltvEvent } from '../../data/hltvEvent'
import { describeConfig, describeEntrants, instantiate } from '../../engine'
import { useCatalogStore } from '../../store/catalog'
import { useTournamentStore } from '../../store/tournament'
import { useUiStore } from '../../store/ui'
import type { Catalog } from '../../types'

const formatAsOf = (asOf: string) =>
  new Date(`${asOf}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

interface Props {
  onClose: () => void
  onDone: (message: string) => void
}

/**
 * Paste what the HLTV bookmarklet copied: VRS standings (imported as the
 * current ranking) or an event (built into a new tournament, or used to
 * update the open tournament's teams). HLTV doesn't allow the app to
 * download either, so the bookmarklet copies them in the viewer's browser.
 */
export function HltvImport({ onClose, onDone }: Props) {
  const importVrs = useCatalogStore((s) => s.importVrs)
  const offerVrs = useCatalogStore((s) => s.offerVrs)
  const storedVrs = useCatalogStore((s) => s.vrs)
  const tournament = useTournamentStore((s) => s.tournament)
  const createTournament = useTournamentStore((s) => s.createTournament)
  const updateTournament = useTournamentStore((s) => s.updateTournament)
  const closeEditor = useUiStore((s) => s.closeEditor)
  const bookmarklet = useRef<HTMLAnchorElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<{ event: HltvEvent; vrs: Catalog | null; built: EventImport } | null>(null)
  const canRead = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  // Set directly: React warns about javascript: URLs in href.
  useEffect(() => {
    bookmarklet.current?.setAttribute('href', HLTV_BOOKMARKLET_HREF)
  }, [])

  const accept = (raw: string) => {
    const text = raw.trim()
    setError(null)
    setEvent(null)
    try {
      if (!isHltvEvent(text)) {
        const vrs = parseHltvImport(text)
        importVrs(vrs)
        onDone(`Imported ${vrs.entries.length} teams from HLTV as of ${formatAsOf(vrs.asOf)}.`)
        return onClose()
      }
      const parsed = parseHltvEvent(text)
      // The event comes with the ranking of the day; keep it unless a newer one is stored.
      let vrs = storedVrs
      if (parsed.ranking) {
        try {
          vrs = offerVrs(parseHltvImport(parsed.ranking))
        } catch {
          // A ranking that didn't copy cleanly just means no fresher ratings.
        }
      }
      setEvent({ event: parsed, vrs, built: buildFromHltvEvent(parsed, vrs) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const readClipboard = async () => {
    try {
      accept(await navigator.clipboard.readText())
    } catch {
      setError("Couldn't read the clipboard. Paste into the box instead.")
    }
  }

  const create = () => {
    if (!event) return
    const t = instantiate(event.built.tournament)
    closeEditor()
    createTournament(t)
    onDone(`Created ${t.name} from HLTV.`)
    onClose()
  }

  const update = () => {
    if (!event) return
    try {
      const result = updateTeamsFromHltv(tournament, event.event, event.vrs)
      updateTournament(() => result.tournament)
      onDone(result.notes.join(' '))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (event) {
    const t = event.built.tournament
    return (
      <div className="vrs__panel">
        <strong>{t.name}</strong>
        <ul className="hltv__stages">
          {t.stages.map((stage) => (
            <li key={stage.id}>
              <strong>{stage.name}</strong> · {describeConfig(stage.config)} · {describeEntrants(t, stage)}
            </li>
          ))}
        </ul>
        {event.built.notes.map((note) => (
          <p key={note} className="hint">
            {note}
          </p>
        ))}
        {event.vrs && <p className="hint">Ratings and seeds use VRS as of {formatAsOf(event.vrs.asOf)}.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="button" onClick={create}>
            Create tournament
          </button>
          <button className="button button--ghost" onClick={update} title={`Keep ${tournament.name}'s stages and rules; replace its invited teams`}>
            Update {tournament.name}'s teams
          </button>
          <button className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="vrs__panel">
      <ol className="vrs__steps">
        <li>
          Drag this link to your bookmarks bar:{' '}
          <a ref={bookmarklet} className="vrs__bookmarklet" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
            Copy from HLTV
          </a>
        </li>
        <li>
          Open{' '}
          <a href={HLTV_VRS_URL} target="_blank" rel="noreferrer">
            HLTV's Valve ranking
          </a>{' '}
          or an event page (any of its stages) on HLTV and click the bookmark. It copies the standings, or the event's stages and
          teams.
        </li>
        <li>Come back and paste here.</li>
      </ol>
      <textarea
        className="vrs__paste"
        placeholder="Paste here"
        aria-label="Copied from HLTV"
        onPaste={(e) => {
          e.preventDefault()
          accept(e.clipboardData.getData('text'))
        }}
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        {canRead && (
          <button className="button" onClick={() => void readClipboard()}>
            Paste from clipboard
          </button>
        )}
        <button className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
