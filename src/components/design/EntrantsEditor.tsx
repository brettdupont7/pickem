import { useMemo, useState } from 'react'
import { addBlankTeam, addTeams, formatRanges, placementUses, teamEntries, updateStage } from '../../engine'
import type { EntrantSource, Stage, StageId, Tournament } from '../../types'
import { PasteTeams } from '../common/PasteTeams'
import { NumberInput } from './fields'

interface Props {
  tournament: Tournament
  stage: Stage
  update: (fn: (t: Tournament) => Tournament) => void
}

/** A stage's entry slots in seed order: invited teams and placements from earlier stages. */
export function EntrantsEditor({ tournament, stage, update }: Props) {
  const [pasting, setPasting] = useState(false)
  const earlier = tournament.stages.filter((s) => s.phase < stage.phase)
  const entries = useMemo(() => teamEntries(tournament), [tournament])
  const stageName = (id: StageId) => tournament.stages.find((s) => s.id === id)?.name ?? id

  const setEntrants = (fn: (entrants: EntrantSource[]) => EntrantSource[]) =>
    update((t) => updateStage(t, stage.id, (s) => ({ ...s, entrants: fn(s.entrants) })))

  const setAt = (index: number, entrant: EntrantSource) => setEntrants((es) => es.map((e, i) => (i === index ? entrant : e)))
  const removeAt = (index: number) => setEntrants((es) => es.filter((_, i) => i !== index))
  const move = (index: number, by: -1 | 1) =>
    setEntrants((es) => {
      const next = [...es]
      const j = index + by
      if (j < 0 || j >= next.length) return es
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })

  const firstUnusedPlace = (stageId: StageId) => {
    const from = tournament.stages.find((s) => s.id === stageId)
    const used = placementUses(tournament, stageId)
    for (let place = 1; place <= (from?.entrants.length ?? 0); place++) if (!used.has(place)) return place
    return 1
  }

  const addTeam = () =>
    update((t) => {
      const unentered = Object.keys(t.teams).find((id) => !teamEntries(t).has(id))
      if (unentered) return updateStage(t, stage.id, (s) => ({ ...s, entrants: [...s.entrants, { kind: 'team', teamId: unentered }] }))
      const { tournament: next, id } = addBlankTeam(t)
      return updateStage(next, stage.id, (s) => ({ ...s, entrants: [...s.entrants, { kind: 'team', teamId: id }] }))
    })

  const pasteTeams = (names: string[]) =>
    update((t) => {
      const { tournament: next, ids } = addTeams(t, names)
      return updateStage(next, stage.id, (s) => ({
        ...s,
        entrants: [...s.entrants, ...ids.map((teamId): EntrantSource => ({ kind: 'team', teamId }))],
      }))
    })

  const changeKind = (index: number, kind: EntrantSource['kind']) => {
    if (kind === 'team') {
      const teamId = Object.keys(tournament.teams).find((id) => !entries.has(id)) ?? Object.keys(tournament.teams)[0]
      if (teamId) setAt(index, { kind: 'team', teamId })
    } else if (earlier[0]) {
      setAt(index, { kind: 'placement', stageId: earlier[0].id, place: firstUnusedPlace(earlier[0].id) })
    }
  }

  return (
    <div className="entrants-editor">
      {stage.entrants.length === 0 && <p className="hint">No entrants yet. Add teams, or places from an earlier stage.</p>}
      <ol className="entrant-list">
        {stage.entrants.map((entrant, i) => (
          <li key={i} className="entrant-row">
            <span className="entrant-row__seed">{i + 1}</span>
            <select
              value={entrant.kind}
              onChange={(e) => changeKind(i, e.target.value as EntrantSource['kind'])}
              aria-label={`Seed ${i + 1} source`}
            >
              <option value="team">Team</option>
              <option value="placement" disabled={earlier.length === 0}>
                Place in stage
              </option>
            </select>
            {entrant.kind === 'team' ? (
              <select value={entrant.teamId} onChange={(e) => setAt(i, { kind: 'team', teamId: e.target.value })} aria-label={`Seed ${i + 1} team`}>
                {!tournament.teams[entrant.teamId] && <option value={entrant.teamId}>Unknown team</option>}
                {Object.values(tournament.teams).map((team) => {
                  const enteredIn = entries.get(team.id)
                  const elsewhere = enteredIn && !(enteredIn === stage.id && team.id === entrant.teamId)
                  return (
                    <option key={team.id} value={team.id}>
                      {team.name}
                      {elsewhere ? ` (in ${stageName(enteredIn)})` : ''}
                    </option>
                  )
                })}
              </select>
            ) : (
              <span className="entrant-row__placement">
                <NumberInput
                  min={1}
                  value={entrant.place}
                  label={`Seed ${i + 1} place`}
                  onChange={(place) => setAt(i, { ...entrant, place: place ?? 1 })}
                />
                <span className="muted">in</span>
                <select value={entrant.stageId} onChange={(e) => setAt(i, { ...entrant, stageId: e.target.value })} aria-label={`Seed ${i + 1} stage`}>
                  {!earlier.some((s) => s.id === entrant.stageId) && <option value={entrant.stageId}>{stageName(entrant.stageId)} (not earlier)</option>}
                  {earlier.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="entrant-row__actions">
              <button className="icon-button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up">
                ↑
              </button>
              <button className="icon-button" onClick={() => move(i, 1)} disabled={i === stage.entrants.length - 1} aria-label="Move down" title="Move down">
                ↓
              </button>
              <button className="icon-button" onClick={() => removeAt(i)} aria-label="Remove" title="Remove">
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="row">
        <button className="button" onClick={addTeam}>
          + Team
        </button>
        <button className="button" onClick={() => setPasting(!pasting)}>
          Paste teams…
        </button>
        {stage.entrants.length > 0 && (
          <button className="button button--ghost" onClick={() => window.confirm(`Remove all entrants from ${stage.name}?`) && setEntrants(() => [])}>
            Clear
          </button>
        )}
      </div>
      {earlier.length > 0 && <AddPlaces tournament={tournament} earlier={earlier} firstUnused={firstUnusedPlace} onAdd={(es) => setEntrants((cur) => [...cur, ...es])} />}
      {pasting && (
        <PasteTeams
          onClose={() => setPasting(false)}
          hint="Names that match an existing team reuse it; the rest become new teams."
          actions={[{ label: `Add to ${stage.name}`, run: pasteTeams }]}
        />
      )}
    </div>
  )
}

/** "Add places 1–8 from Stage 1": the usual way stages are linked. */
function AddPlaces({
  tournament,
  earlier,
  firstUnused,
  onAdd,
}: {
  tournament: Tournament
  earlier: Stage[]
  firstUnused: (stageId: StageId) => number
  onAdd: (entrants: EntrantSource[]) => void
}) {
  const [stageId, setStageId] = useState(earlier.at(-1)!.id)
  const source = earlier.find((s) => s.id === stageId) ?? earlier.at(-1)!
  const teamCount = source.entrants.length
  const [range, setRange] = useState<[number | undefined, number | undefined]>([undefined, undefined])
  const used = placementUses(tournament, source.id)
  const unused = Array.from({ length: teamCount }, (_, i) => i + 1).filter((p) => !used.has(p))
  const from = range[0] ?? firstUnused(source.id)
  const to = range[1] ?? Math.max(from, unused.filter((p) => p >= from).find((p, i, ps) => ps[i + 1] !== p + 1) ?? from)

  return (
    <div className="row add-places">
      <span className="muted">Add places</span>
      <NumberInput min={1} value={from} label="From place" onChange={(n) => setRange([n, range[1]])} />
      <span className="muted">to</span>
      <NumberInput min={1} value={to} label="To place" onChange={(n) => setRange([range[0], n])} />
      <span className="muted">from</span>
      <select
        value={source.id}
        onChange={(e) => {
          setStageId(e.target.value)
          setRange([undefined, undefined])
        }}
        aria-label="From stage"
      >
        {earlier.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        className="button"
        disabled={to < from}
        onClick={() => {
          onAdd(Array.from({ length: to - from + 1 }, (_, i) => ({ kind: 'placement', stageId: source.id, place: from + i })))
          setRange([undefined, undefined])
        }}
      >
        Add
      </button>
      {unused.length > 0 && unused.length < teamCount && <span className="hint">Unused in {source.name}: {formatRanges(unused)}</span>}
    </div>
  )
}
