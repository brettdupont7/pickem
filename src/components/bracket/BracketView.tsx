import type { ComputedStage } from '../../engine'
import type { BracketSide, Match, Stage } from '../../types'
import { MatchCard } from '../common/MatchCard'

/** Matches of one side, grouped into rounds (columns). */
function columnsOf(matches: Match[], side: BracketSide) {
  const rounds = new Map<number, Match[]>()
  for (const m of matches.filter((m) => m.side === side)) rounds.set(m.round, [...(rounds.get(m.round) ?? []), m])
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([, ms]) => ms)
}

function Columns({ stageId, columns, extra }: { stageId: string; columns: Match[][]; extra?: Match[] }) {
  return (
    <div className="bracket__columns">
      {columns.map((matches, i) => (
        <div key={i} className="bracket__column">
          <h3 className="column-title">{matches[0]?.label}</h3>
          <div className="bracket__matches">
            {matches.map((m) => (
              <MatchCard key={m.id} stageId={stageId} match={m} />
            ))}
          </div>
        </div>
      ))}
      {extra && extra.length > 0 && (
        <div className="bracket__column">
          {extra.map((m) => (
            <div key={m.id} className="bracket__extra">
              <h3 className="column-title">{m.label}</h3>
              <MatchCard stageId={stageId} match={m} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BracketView({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const { matches } = computed
  if (stage.config.format === 'single-elim') {
    return (
      <div className="bracket">
        <Columns stageId={stage.id} columns={columnsOf(matches, 'main')} extra={matches.filter((m) => m.side === 'third-place')} />
      </div>
    )
  }
  return (
    <div className="bracket">
      <h2 className="bracket__section">Upper bracket</h2>
      <Columns
        stageId={stage.id}
        columns={columnsOf(matches, 'upper')}
        extra={matches.filter((m) => m.side === 'grand-final')}
      />
      <h2 className="bracket__section">Lower bracket</h2>
      <Columns stageId={stage.id} columns={columnsOf(matches, 'lower')} />
    </div>
  )
}
