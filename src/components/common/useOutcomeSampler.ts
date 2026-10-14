import { useEffect, useRef, useState } from 'react'
import { createOutcomeSampler, simulationRatings, type OutcomeSamples } from '../../engine'
import { useTournamentStore } from '../../store/tournament'

/** As many as the Odds tab: a full Major takes a few seconds. */
export const SAMPLE_TOTAL = 2000
const CHUNK = 100

/**
 * Simulates the rest of the event from actual results only (picks never
 * count), in chunks so the page stays responsive, keeping each outcome.
 */
export function useOutcomeSampler() {
  const tournament = useTournamentStore((s) => s.tournament)
  const actual = useTournamentStore((s) => s.actual)
  const chaos = useTournamentStore((s) => s.simulation.chaos ?? 0)
  const [samples, setSamples] = useState<OutcomeSamples | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const cancel = useRef<() => void>()

  useEffect(() => {
    if (samples) setStale(true)
    // Only when the inputs change, not when new samples arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, actual, chaos])

  useEffect(() => () => cancel.current?.(), [])

  const run = () => {
    cancel.current?.()
    const sampler = createOutcomeSampler(tournament, actual, { chaos, ratings: simulationRatings(tournament, actual), seed: Date.now() })
    let stopped = false
    cancel.current = () => (stopped = true)
    setDone(0)
    setStale(false)
    const step = () => {
      if (stopped) return
      sampler.run(CHUNK)
      const n = sampler.samples().length
      if (n < SAMPLE_TOTAL) {
        setDone(n)
        setTimeout(step, 0)
      } else {
        setSamples([...sampler.samples()])
        setDone(null)
      }
    }
    step()
  }

  return { samples, running: done !== null, done: done ?? 0, stale, run }
}

/** A chance as a percentage, with a decimal for small ones and a floor for ones no simulation hit. */
export function formatChance(p: number): string {
  if (p === 0) return `<${(100 / SAMPLE_TOTAL).toFixed(2)}%`
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`
  return `${Math.round(p * 100)}%`
}
