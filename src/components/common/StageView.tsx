import { ordinal, type ComputedStage } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { Stage } from '../../types'
import { BracketView } from '../bracket/BracketView'
import { SwissView } from '../swiss/SwissView'

export function StageView({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const tournament = useTournamentStore((s) => s.tournament)
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id

  if (computed.status === 'invalid') {
    return <p className="error">This stage can't be played: {computed.error}</p>
  }

  if (computed.status === 'waiting') {
    return (
      <div className="waiting">
        <p className="hint">Waiting for earlier stages to finish. Entrants, in seed order:</p>
        <ol className="entrants">
          {stage.entrants.map((e, i) => (
            <li key={i}>
              {e.kind === 'team'
                ? tournament.teams[e.teamId]?.name ?? e.teamId
                : `${ordinal(e.place)} in ${stageName(e.stageId)}`}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return stage.config.format === 'swiss' ? (
    <SwissView stage={stage} computed={computed} />
  ) : (
    <BracketView stage={stage} computed={computed} />
  )
}
