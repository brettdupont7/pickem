import { useMemo } from 'react'
import {
  bracketAsPicked,
  bracketCardFromResults,
  bracketPickStatus,
  cardEditable,
  categoryLabels,
  categoryOf,
  cleanBracketCard,
  computeTournament,
  emptyBracketCard,
  emptySwissCard,
  pickableMatches,
  picksView,
  pickSwiss,
  playOrder,
  scoreBracketCard,
  scoreSwissCard,
  stageStarted,
  SWISS_PICK_CATEGORIES,
  swissCardFromResults,
  swissPickCounts,
  swissPickStatus,
  type ComputedStage,
  type PickemScore,
  type PickStatus,
  type SwissPickCategory,
} from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { BracketPickemCard, Match, PickemCard, Stage, SwissConfig, SwissPickemCard, TeamId } from '../../types'
import { TeamBadge } from '../common/TeamBadge'

const STATUS_MARK: Record<PickStatus, string> = { correct: '✓', wrong: '✗', pending: '…' }
const STATUS_TITLE: Record<PickStatus, string> = { correct: 'Correct', wrong: 'Wrong', pending: 'Still open' }

/**
 * Pick'em challenge cards, one per stage, scored against actual results.
 * Kept apart from picks: nothing here reads or changes the Bracket tab.
 */
export function PickemPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const actual = useTournamentStore((s) => s.actual)
  const picks = useTournamentStore((s) => s.picks)
  const pickem = useTournamentStore((s) => s.pickem)
  const setCard = useTournamentStore((s) => s.setPickemCard)
  const actualState = useMemo(() => computeTournament(tournament, actual), [tournament, actual])
  // Only for "Fill from my picks", so it's worked out on demand.
  const pickedStage = (stageId: string) => computeTournament(tournament, picksView(tournament, { actual, picks })).stages[stageId]

  const stages = playOrder(tournament.stages)
  const scores = stages.flatMap((stage) => {
    const computed = actualState.stages[stage.id]
    const card = pickem[stage.id]
    if (!card || !computed || computed.status === 'waiting' || computed.status === 'invalid') return []
    return [scoreOf(stage, card, computed)]
  })
  const correct = scores.reduce((sum, s) => sum + s.correct, 0)
  const passed = scores.filter((s) => s.correct >= s.needed).length

  return (
    <div className="pickem">
      <p className="hint">
        Fill in a card for each stage before it starts, as in Valve&apos;s Major Pick&apos;em. Cards are scored against actual
        results only, and are kept apart from your picks. A card locks once its stage has an actual result.
      </p>
      {scores.length > 0 && (
        <p className="pickem__total">
          <strong>{correct}</strong> correct so far · {passed} of {scores.length} {scores.length === 1 ? 'card' : 'cards'} passed
        </p>
      )}
      {stages.map((stage) => {
        const computed = actualState.stages[stage.id]
        const card = pickem[stage.id]
        return (
          <section key={stage.id} className="pickem__stage">
            <h3>{stage.name}</h3>
            {!computed || computed.status === 'invalid' ? (
              <p className="hint">This stage can&apos;t be played as designed.</p>
            ) : computed.status === 'waiting' ? (
              <p className="hint">Opens once the teams are known from actual results.</p>
            ) : stage.config.format === 'swiss' ? (
              <SwissCard
                stage={stage}
                config={stage.config}
                computed={computed}
                card={card?.kind === 'swiss' ? card : emptySwissCard()}
                onChange={(next) => setCard(stage.id, next)}
                fill={() => pickedStage(stage.id)}
              />
            ) : (
              <BracketCard
                stage={stage}
                computed={computed}
                earlier={actualState.stages}
                card={card?.kind === 'bracket' ? card : emptyBracketCard()}
                onChange={(next) => setCard(stage.id, next)}
                fill={() => pickedStage(stage.id)}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}

function scoreOf(stage: Stage, card: PickemCard, computed: ComputedStage): PickemScore {
  if (card.kind === 'swiss' && stage.config.format === 'swiss') return scoreSwissCard(card, stage.config, computed, computed.seeds?.length ?? 0)
  if (card.kind === 'bracket') return scoreBracketCard(card, computed, pickableMatches(computed).length)
  return { correct: 0, wrong: 0, pending: 0, total: 0, needed: 0 }
}

/** Score, pass/fail, lock and the card's buttons. */
function CardBar({
  score,
  full,
  computed,
  card,
  onChange,
  onFill,
  onClear,
}: {
  score: PickemScore
  full: number
  computed: ComputedStage
  card: PickemCard
  onChange: (card: PickemCard) => void
  onFill: () => void
  onClear: () => void
}) {
  const started = stageStarted(computed)
  const editable = cardEditable(card, computed)
  // Empty slots could still be filled while the card is editable.
  const reachable = score.correct + score.pending + (editable ? full - score.total : 0)
  const outcome =
    score.total === 0
      ? null
      : score.correct >= score.needed
        ? { label: 'Passed', className: 'status--complete' }
        : reachable < score.needed
          ? { label: "Can't pass", className: 'status--invalid' }
          : null
  return (
    <div className="toolbar pickem__bar">
      <span>
        <strong>{score.correct}</strong> correct · {score.wrong} wrong · {score.pending} open
        <span className="muted">
          {' '}
          ({score.total} of {full} picked; {score.needed} needed)
        </span>
      </span>
      {outcome && <span className={`status ${outcome.className}`}>{outcome.label}</span>}
      <span className="toolbar__spacer" />
      {editable && (
        <>
          <button className="button" onClick={onFill} title="Fill the card from where your picks and simulations have each team finishing">
            Fill from my picks
          </button>
          <button className="button button--ghost" onClick={onClear} disabled={score.total === 0}>
            Clear card
          </button>
        </>
      )}
      {started && (
        <button
          className="button button--ghost"
          onClick={() => onChange({ ...card, unlocked: !card.unlocked || undefined })}
          title={card.unlocked ? 'Lock the card again' : 'The stage has started; unlock to change the card anyway'}
        >
          {card.unlocked ? 'Lock card' : '🔒 Unlock'}
        </button>
      )}
    </div>
  )
}

function SwissCard({
  stage,
  config,
  computed,
  card,
  onChange,
  fill,
}: {
  stage: Stage
  config: SwissConfig
  computed: ComputedStage
  card: SwissPickemCard
  onChange: (card: SwissPickemCard) => void
  fill: () => ComputedStage | undefined
}) {
  const teams = useTournamentStore((s) => s.tournament.teams)
  const seeds = computed.seeds ?? []
  const counts = swissPickCounts(config, seeds.length)
  const labels = categoryLabels(config)
  const full = counts.undefeated + counts.advance + counts.winless
  const score = scoreSwissCard(card, config, computed, seeds.length)
  const editable = cardEditable(card, computed)
  const started = stageStarted(computed)

  const set = (teamId: TeamId, category: SwissPickCategory) =>
    onChange(pickSwiss(card, teamId, categoryOf(card, teamId) === category ? null : category, counts))
  const fillFromPicks = () => {
    const picked = fill()
    if (!picked?.swiss) return
    if (score.total > 0 && !window.confirm(`Replace the ${stage.name} card with your picks?`)) return
    onChange({ ...swissCardFromResults(config, picked, counts), unlocked: card.unlocked })
  }

  return (
    <>
      <CardBar
        score={score}
        full={full}
        computed={computed}
        card={card}
        onChange={(c) => onChange(c as SwissPickemCard)}
        onFill={fillFromPicks}
        onClear={() => onChange({ ...emptySwissCard(), unlocked: card.unlocked })}
      />
      <div className="table-wrap">
        <table className="odds__table pickem__table">
          <thead>
            <tr>
              <th>Seed</th>
              <th>Team</th>
              <th>
                Pick{' '}
                <span className="muted">
                  {SWISS_PICK_CATEGORIES.map((c) => `${labels[c]}: ${card[c].length}/${counts[c]}`).join(' · ')}
                </span>
              </th>
              {started && <th>Record</th>}
              {started && <th />}
            </tr>
          </thead>
          <tbody>
            {seeds.map((id, i) => {
              const category = categoryOf(card, id)
              const record = computed.swiss?.standings[id]
              const status = category ? swissPickStatus(category, config, record) : null
              return (
                <tr key={id}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <span className="pickem__team">
                      <TeamBadge team={teams[id]} />
                      {teams[id]?.name ?? id}
                    </span>
                  </td>
                  <td>
                    <div className="segmented pickem__choices" role="group" aria-label={`${teams[id]?.name ?? id} pick`}>
                      {SWISS_PICK_CATEGORIES.map((c) => (
                        <button
                          key={c}
                          className={category === c ? 'is-active' : ''}
                          disabled={!editable || (category !== c && card[c].length >= counts[c])}
                          onClick={() => set(id, c)}
                          aria-pressed={category === c}
                        >
                          {c === 'advance' ? 'Advance' : labels[c]}
                        </button>
                      ))}
                    </div>
                  </td>
                  {started && (
                    <td className="muted">
                      {record?.wins ?? 0}-{record?.losses ?? 0}
                    </td>
                  )}
                  {started && (
                    <td>{status && <span className={`pickem__mark is-${status}`} title={STATUS_TITLE[status]}>{STATUS_MARK[status]}</span>}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function BracketCard({
  stage,
  computed,
  earlier,
  card,
  onChange,
  fill,
}: {
  stage: Stage
  computed: ComputedStage
  earlier: Record<string, ComputedStage>
  card: BracketPickemCard
  onChange: (card: BracketPickemCard) => void
  fill: () => ComputedStage | undefined
}) {
  const tournament = useTournamentStore((s) => s.tournament)
  const picked = useMemo(() => bracketAsPicked(tournament, stage, earlier, card), [tournament, stage, earlier, card])
  const matches = pickableMatches(picked)
  const full = pickableMatches(computed).length
  const score = scoreBracketCard(card, computed, full)
  const editable = cardEditable(card, computed)
  const started = stageStarted(computed)

  // Keeps only winners that still play their match once the change ripples through.
  const save = (next: BracketPickemCard) => onChange(cleanBracketCard(next, bracketAsPicked(tournament, stage, earlier, next)))
  const pick = (match: Match, teamId: TeamId) => {
    const winners = { ...card.winners }
    if (winners[match.id] === teamId) delete winners[match.id]
    else winners[match.id] = teamId
    save({ ...card, winners })
  }
  const fillFromPicks = () => {
    const fromPicks = fill()
    if (!fromPicks) return
    if (score.total > 0 && !window.confirm(`Replace the ${stage.name} card with your picks?`)) return
    save({ ...bracketCardFromResults(fromPicks), unlocked: card.unlocked })
  }

  // Columns by side and round, in play order.
  const columns: { key: string; label: string; matches: Match[] }[] = []
  for (const m of matches) {
    const key = `${m.side}:${m.round}`
    let column = columns.find((c) => c.key === key)
    if (!column) columns.push((column = { key, label: m.label ?? `Round ${m.round + 1}`, matches: [] }))
    column.matches.push(m)
  }

  return (
    <>
      <CardBar
        score={score}
        full={full}
        computed={computed}
        card={card}
        onChange={(c) => onChange(c as BracketPickemCard)}
        onFill={fillFromPicks}
        onClear={() => onChange({ ...emptyBracketCard(), unlocked: card.unlocked })}
      />
      <div className="pickem__bracket">
        {columns.map((column) => (
          <div key={column.key} className="pickem__round">
            <div className="pickem__round-label muted">{column.label}</div>
            {column.matches.map((m) => {
              const winner = card.winners[m.id]
              const status = winner && started ? bracketPickStatus(m.id, winner, computed) : null
              return (
                <div key={m.id} className="pickem__match">
                  {m.slots.map((slot, i) => {
                    const team = slot.teamId ? tournament.teams[slot.teamId] : undefined
                    return (
                      <button
                        key={i}
                        className={`pickem__pick${winner && winner === slot.teamId ? ' is-picked' : ''}`}
                        disabled={!editable || !slot.teamId}
                        onClick={() => slot.teamId && pick(m, slot.teamId)}
                        title={slot.teamId ? `Pick ${team?.name ?? slot.teamId}` : 'Pick the match before this one first'}
                      >
                        <TeamBadge team={team} />
                        <span className="pickem__pick-name">{team?.name ?? (slot.teamId ? slot.teamId : 'TBD')}</span>
                        {status && winner === slot.teamId && (
                          <span className={`pickem__mark is-${status}`} title={STATUS_TITLE[status]}>
                            {STATUS_MARK[status]}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
