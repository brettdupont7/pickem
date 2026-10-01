import { useEffect, useMemo, useState } from 'react'
import {
  describeMatch,
  FREE_SCORING,
  gameScoreStatus,
  seriesScoreError,
  termsFor,
  type ComputedStage,
  type GameInput,
} from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import { useUiStore } from '../../store/ui'
import type { Match, StageId } from '../../types'

const parseScore = (value: string): number | null => (value.trim() === '' ? null : Number(value))

interface GameDraft {
  name: string
  score: [string, string]
  inProgress: boolean
  winnerSlot: '' | '0' | '1'
}

function draftsFrom(match: Match, scoring: Parameters<typeof describeMatch>[1]): GameDraft[] {
  return describeMatch(match, scoring).games.map((g, i) => ({
    name: g.name ?? '',
    score: [g.score[0]?.toString() ?? '', g.score[1]?.toString() ?? ''],
    inProgress: match.report?.games?.[i]?.inProgress ?? false,
    winnerSlot: '',
  }))
}

/** Detailed result entry: series score, or game-by-game scores. */
export function MatchEditor({ stages }: { stages: Record<StageId, ComputedStage> }) {
  const editing = useUiStore((s) => s.editing)
  const close = useUiStore((s) => s.closeEditor)
  const match = editing ? stages[editing.stageId]?.matches.find((m) => m.id === editing.matchId) : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!editing || !match || match.slots.some((s) => !s.teamId)) return null
  return (
    <div className="modal" onClick={close}>
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <EditorContent key={match.id} stageId={editing.stageId} match={match} onClose={close} />
      </div>
    </div>
  )
}

function EditorContent({ stageId, match, onClose }: { stageId: StageId; match: Match; onClose: () => void }) {
  const tournament = useTournamentStore((s) => s.tournament)
  const editSource = useTournamentStore((s) => s.editSource)
  const store = useTournamentStore()
  const scoring = tournament.rules?.scoring ?? FREE_SCORING
  const terms = termsFor(tournament.rules)
  const view = describeMatch(match, scoring)
  const names = match.slots.map((s) => tournament.teams[s.teamId!]?.name ?? s.teamId!) as [string, string]

  const [series, setSeries] = useState<[string, string]>([
    view.seriesScore?.[0]?.toString() ?? '',
    view.seriesScore?.[1]?.toString() ?? '',
  ])
  const [games, setGames] = useState<GameDraft[]>(() => draftsFrom(match, scoring))
  const seriesError = useMemo(() => {
    const pair = series.map(parseScore)
    if (pair.some((n) => n === null)) return null
    return seriesScoreError(match.bestOf, pair as [number, number])
  }, [series, match.bestOf])

  const commitGame = (index: number, draft: GameDraft) => {
    const score = draft.score.map(parseScore) as [number | null, number | null]
    const input: GameInput = { name: draft.name || undefined, score, inProgress: draft.inProgress || undefined }
    if (draft.winnerSlot !== '') input.winnerSlot = Number(draft.winnerSlot) as 0 | 1
    if (score[0] !== null && score[1] !== null) {
      if (gameScoreStatus(scoring, score as [number, number], draft.inProgress).state === 'invalid') return
    }
    store.setGame(stageId, match, index, input)
  }

  const updateGame = (index: number, patch: Partial<GameDraft>) => {
    const next = [...games]
    next[index] = { ...next[index], ...patch }
    setGames(next)
    commitGame(index, next[index])
  }

  const addGame = () => {
    const draft: GameDraft = { name: '', score: ['', ''], inProgress: false, winnerSlot: '' }
    setGames([...games, draft])
    commitGame(games.length, draft)
  }

  const deleteGame = (index: number) => {
    setGames(games.filter((_, i) => i !== index))
    store.removeGame(stageId, match, index)
  }

  const applySeries = () => {
    const pair = series.map(parseScore)
    if (pair.some((n) => n === null) || seriesError) return
    store.setSeriesScore(stageId, match, pair as [number, number])
    setGames([])
  }

  const gameStatus = (draft: GameDraft): string => {
    const score = draft.score.map(parseScore)
    if (score.some((n) => n === null)) return ''
    const status = gameScoreStatus(scoring, score as [number, number], draft.inProgress)
    if (status.state === 'invalid') return status.error
    if (status.state === 'in-progress') return 'In progress'
    return `${names[status.winnerSlot]} wins`
  }

  const decided = games.length > 0 && view.winnerSlot !== null
  const canAddGame = games.length < match.bestOf && !decided

  return (
    <>
      <header className="editor__header">
        <div>
          <div className="editor__label">
            {match.label} · Bo{match.bestOf} · recording as <strong>{editSource === 'actual' ? 'actual result' : 'pick'}</strong>
          </div>
          <h2>
            {names[0]} <span className="muted">vs</span> {names[1]}
          </h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <section className="editor__section">
        <h3>Winner</h3>
        <div className="row">
          {([0, 1] as const).map((slot) => (
            <button
              key={slot}
              className={`chip${view.winnerSlot === slot ? ' chip--active' : ''}`}
              onClick={() => store.pickWinner(stageId, match, match.slots[slot].teamId!)}
            >
              {names[slot]}
            </button>
          ))}
          <button className="chip chip--ghost" onClick={() => store.clearMatch(stageId, match.id)}>
            Clear
          </button>
        </div>
      </section>

      {match.bestOf > 1 && (
        <section className="editor__section">
          <h3>Series score</h3>
          <div className="row">
            {([0, 1] as const).map((slot) => (
              <label key={slot} className="score-input">
                <span>{names[slot]}</span>
                <input
                  type="number"
                  min={0}
                  max={Math.ceil(match.bestOf / 2)}
                  value={series[slot]}
                  onChange={(e) => setSeries(slot === 0 ? [e.target.value, series[1]] : [series[0], e.target.value])}
                />
              </label>
            ))}
            <button className="button" onClick={applySeries} disabled={!!seriesError}>
              Set
            </button>
          </div>
          {seriesError && <p className="error">{seriesError}</p>}
          <p className="hint">Sets the series without {terms.game.toLowerCase()} details.</p>
        </section>
      )}

      <section className="editor__section">
        <h3>{terms.games}</h3>
        {games.length === 0 && <p className="hint">No {terms.games.toLowerCase()} recorded.</p>}
        {games.map((draft, index) => {
          const status = gameStatus(draft)
          const invalid = status !== '' && status !== 'In progress' && !status.endsWith('wins')
          return (
            <div key={index} className="game-row">
              <span className="game-row__index">
                {terms.game} {index + 1}
              </span>
              {tournament.rules?.gamePool?.length ? (
                <select value={draft.name} onChange={(e) => updateGame(index, { name: e.target.value })}>
                  <option value="">—</option>
                  {tournament.rules.gamePool.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="game-row__name"
                  placeholder="Name (optional)"
                  value={draft.name}
                  onChange={(e) => updateGame(index, { name: e.target.value })}
                />
              )}
              {([0, 1] as const).map((slot) => (
                <input
                  key={slot}
                  type="number"
                  min={0}
                  aria-label={`${names[slot]} ${terms.points.toLowerCase()}`}
                  placeholder={names[slot]}
                  value={draft.score[slot]}
                  onChange={(e) =>
                    updateGame(index, {
                      score: slot === 0 ? [e.target.value, draft.score[1]] : [draft.score[0], e.target.value],
                    })
                  }
                />
              ))}
              {scoring.kind === 'free' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.inProgress}
                    onChange={(e) => updateGame(index, { inProgress: e.target.checked })}
                  />
                  Live
                </label>
              )}
              <select
                value={draft.winnerSlot}
                title="Winner without a decisive score (e.g. forfeit)"
                onChange={(e) => updateGame(index, { winnerSlot: e.target.value as GameDraft['winnerSlot'] })}
              >
                <option value="">Winner: by score</option>
                <option value="0">Winner: {names[0]}</option>
                <option value="1">Winner: {names[1]}</option>
              </select>
              <button className="icon-button" onClick={() => deleteGame(index)} aria-label={`Remove ${terms.game}`}>
                ✕
              </button>
              {status && <span className={invalid ? 'error' : 'hint'}>{status}</span>}
            </div>
          )
        })}
        {canAddGame && (
          <button className="button button--ghost" onClick={addGame}>
            + Add {terms.game.toLowerCase()}
          </button>
        )}
        <p className="hint">
          {terms.points} to win:{' '}
          {scoring.kind === 'first-to'
            ? `first to ${scoring.target}${scoring.overtime ? `, overtime first to ${scoring.overtime.firstTo}` : ''}`
            : 'higher score wins'}
        </p>
      </section>
    </>
  )
}
