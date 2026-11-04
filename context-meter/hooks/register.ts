import type { EngineInterface, Register } from 'claude-code'

import { composeStatus, resolveLimit } from './meter.ts'
import type { Effort } from './meter.ts'

// 마지막으로 그린 값 — 모델·effort 만 바뀐 요청은 이것으로 다시 그린다
type View = { model: string; effort: Effort; tokens: number | undefined; limit: number }

let view: View | undefined
let effort: Effort
let lastStep: { model: string; effort: Effort } | undefined

const draw = ($: EngineInterface, next: View): void => {
  view = next
  $.ui.status(composeStatus(next))
}

// 자동 압축 임계치는 측정 이벤트에 없어 breakdown(로컬 추정, API 요청 없음)에서 읽는다
const readUsage = async ($: EngineInterface) => {
  const { context } = await $.session.usage({ breakdown: 'summary' })

  return { tokens: context.tokens, window: context.window, threshold: context.breakdown?.autoCompactThreshold }
}

const showCurrent = async ($: EngineInterface): Promise<void> => {
  const [model, usage] = await Promise.all([$.session.model(), readUsage($)])
  draw($, { model, effort, tokens: usage.tokens, limit: resolveLimit(usage.window, usage.threshold) })
}

// 다시 그리기가 실패해도 압축·clear 자체는 막지 않는다 — next 는 재호출해도 같은 결과를 돌려준다
const passThrough = <E, R>($: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await showCurrent($)

    return next(e)
  })

  // 턴마다 엔진이 측정값을 밀어 준다 — 컨텍스트가 바뀐 경우만 갱신
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const [model, { threshold }] = await Promise.all([$.session.model(), readUsage($)])
      draw($, { model, effort, tokens: e.context.tokens, limit: resolveLimit(e.context.window, threshold) })
    }

    return next(e)
  })

  // effort 는 메인 루프의 모델 요청에만 실린다 — 모델·effort 가 바뀐 요청에서만 다시 그린다
  on('turn.step', async function* ($, e, next) {
    const isChanged = e.agentId === undefined
      && (lastStep === undefined || lastStep.model !== e.model || lastStep.effort !== e.effort)

    if (isChanged) {
      lastStep = { model: e.model, effort: e.effort }
      effort = e.effort

      if (view === undefined) {
        await showCurrent($)
      } else {
        draw($, { ...view, model: await $.session.model(), effort })
      }
    }

    return yield* next(e)
  })

  // 압축 직후 토큰은 다음 응답 전까지 비어 있다 — 메인 대화가 실제로 압축됐을 때만 다시 그린다
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isMainCompaction = e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result)

    if (isMainCompaction) {
      await showCurrent($)
    }

    return result
  }).catch(passThrough)

  // /clear 는 session.start 를 다시 부르지 않는다 — classic SessionStart(source clear)로 받는다
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)

    if (e.source === 'clear') {
      await showCurrent($)
    }

    return result
  }).catch(passThrough)
}
