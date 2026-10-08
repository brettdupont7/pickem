import { useMemo } from 'react'
import { ordinal, previewStage, type ComputedStage } from '../../engine'
import { useTournamentState, useTournamentStore } from '../../store/tournament'
import type { Stage } from '../../types'
import { BracketView } from '../bracket/BracketView'
import { PreviewContext } from './preview'
import { TeamBadge } from './TeamBadge'
import { SwissView } from '../swiss/SwissView'

export function StageView({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  if (computed.status === 'invalid') {
    return <p className="error">This stage can't be played: {computed.error}</p>
  }

  if (computed.status === 'waiting') return <WaitingStage stage={stage} computed={computed} />

  return stage.config.format === 'swiss' ? (
    <SwissView stage={stage} computed={computed} />
  ) : (
    <BracketView stage={stage} computed={computed} />
  )
}

/**
 * A stage still waiting on earlier ones: the teams already through, then the
 * stage as it would start, with places that aren't settled yet as placeholders.
 */
function WaitingStage({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const tournament = useTournamentStore((s) => s.tournament)
  const state = useTournamentState()
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id
  const preview = useMemo(() => previewStage(tournament, stage.id, state.stages), [tournament, stage.id, state.stages])
  const qualified = computed.qualified ?? []
  const sources = [...new Set(qualified.map((q) => q.stageId))].map(stageName)
  const waitingOn = [
    ...new Set(
      stage.entrants.flatMap((e) => (e.kind === 'placement' && state.stages[e.stageId]?.status !== 'complete' ? [stageName(e.stageId)] : [])),
    ),
  ]

  return (
    <div className="waiting">
      {qualified.length > 0 && (
        <section className="waiting__qualified">
          <h3>
            Already through <span className="muted">· {qualified.length} of {stage.entrants.length}</span>
          </h3>
          <ul className="waiting__teams">
            {qualified.map(({ teamId, stageId }) => (
              <li key={teamId} title={`Certain to enter from ${stageName(stageId)}`}>
                <TeamBadge team={tournament.teams[teamId]} />
                {tournament.teams[teamId]?.name ?? teamId}
              </li>
            ))}
          </ul>
          <p className="hint">Seeds are set once {sources.join(' and ')} {sources.length === 1 ? 'finishes' : 'finish'}.</p>
        </section>
      )}
      {preview && preview.computed.status !== 'invalid' ? (
        <>
          <p className="hint">
            Preview: waiting for {waitingOn.join(' and ')} to finish. Teams whose place there isn't settled yet are shown by the
            place they qualify from; matches can be picked once the stage starts.
          </p>
          <PreviewContext.Provider value={preview.teams}>
            <StageView stage={preview.stage} computed={preview.computed} />
          </PreviewContext.Provider>
        </>
      ) : (
        <>
          <p className="hint">Waiting for earlier stages to finish. Entrants, in seed order:</p>
          <ol className="entrants">
            {stage.entrants.map((e, i) => (
              <li key={i}>
                {e.kind === 'team' ? tournament.teams[e.teamId]?.name ?? e.teamId : `${ordinal(e.place)} in ${stageName(e.stageId)}`}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
