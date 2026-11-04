import type { EngineInterface, Register } from 'claude-code'

import { composeStatus, resolveLimit } from './meter.ts'
import type { Effort } from './meter.ts'

type View = { model: string; effort: Effort; tokens: number | undefined; limit: number }

let lastDrawn: View | undefined
let effort: Effort
let lastStep: { model: string; effort: Effort } | undefined

const draw = ($: EngineInterface, next: View): void => {
  lastDrawn = next
  $.ui.status(composeStatus(next))
}

const readUsage = async ($: EngineInterface) => {
  const { context } = await $.session.usage({ breakdown: 'summary' })

  return { tokens: context.tokens, window: context.window, threshold: context.breakdown?.autoCompactThreshold }
}

const showCurrent = async ($: EngineInterface): Promise<void> => {
  const [model, usage] = await Promise.all([$.session.model(), readUsage($)])
  draw($, { model, effort, tokens: usage.tokens, limit: resolveLimit(usage.window, usage.threshold) })
}

const proceedEvenIfRedrawFails = <E, R>($: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await showCurrent($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const [model, { threshold }] = await Promise.all([$.session.model(), readUsage($)])
      draw($, { model, effort, tokens: e.context.tokens, limit: resolveLimit(e.context.window, threshold) })
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isChanged = e.agentId === undefined
      && (lastStep === undefined || lastStep.model !== e.model || lastStep.effort !== e.effort)

    if (isChanged) {
      lastStep = { model: e.model, effort: e.effort }
      effort = e.effort

      if (lastDrawn === undefined) {
        await showCurrent($)
      } else {
        draw($, { ...lastDrawn, model: await $.session.model(), effort })
      }
    }

    return yield* next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isMainCompaction = e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result)

    if (isMainCompaction) {
      await showCurrent($)
    }

    return result
  }).catch(proceedEvenIfRedrawFails)

  // /clear 는 session.start 를 다시 부르지 않는다 — classic SessionStart(source clear)로 받는다
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)

    if (e.source === 'clear') {
      await showCurrent($)
    }

    return result
  }).catch(proceedEvenIfRedrawFails)
}
