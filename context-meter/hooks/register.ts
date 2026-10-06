import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

import { formatMeter, resolveLimit } from './meter.ts'

const COMMAND = 'context-meter'
const ENABLED_KEY = 'isEnabled'
const USAGE = `사용법: /${COMMAND} [on|off] — 인자 없이 실행하면 켜고 끄기를 전환한다`

// 켜짐/꺼짐은 세션을 넘어 유지된다 — 한 번도 끈 적 없으면 켜짐
const isEnabled = async ($: EngineInterface): Promise<boolean> =>
  (await $.store.get(ENABLED_KEY)) !== false

// 자동 압축 임계치는 측정 이벤트에 없어 breakdown(로컬 추정, API 요청 없음)에서 읽는다
const readLimit = async ($: EngineInterface, window: number): Promise<number> => {
  const { context } = await $.session.usage({ breakdown: 'summary' })

  return resolveLimit(window, context.breakdown?.autoCompactThreshold)
}

const showContext = async ($: EngineInterface, context: SessionContextUsage): Promise<void> => {
  const limit = await readLimit($, context.window)
  $.ui.status(formatMeter(context.tokens, limit))
}

const showCurrent = async ($: EngineInterface): Promise<void> => {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const limit = resolveLimit(context.window, context.breakdown?.autoCompactThreshold)
  $.ui.status(formatMeter(context.tokens, limit))
}

// 다시 그리기가 실패해도 압축·clear 자체는 막지 않는다 — next 는 재호출해도 같은 결과를 돌려준다
const passThrough = <E, R>($: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = on => {
  // 세션 시작(재로드 포함) 시 명령을 등록하고, 켜져 있으면 현재 값으로 한 번 그린다
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '상태 줄의 컨텍스트 사용량 표시를 켜거나 끈다',
      argumentHint: '[on|off]',
    })

    if (await isEnabled($)) {
      await showCurrent($)
    }

    return next(e)
  })

  // 턴마다 엔진이 측정값을 밀어 준다 — 켜져 있고 컨텍스트가 바뀐 경우만 갱신
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && (await isEnabled($))) {
      await showContext($, e.context)
    }

    return next(e)
  })

  // 압축 직후 토큰은 다음 응답 전까지 비어 있다 — 메인 대화가 실제로 압축됐을 때만 다시 그린다
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isMainCompaction = e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result)

    if (isMainCompaction && (await isEnabled($))) {
      await showCurrent($)
    }

    return result
  }).catch(passThrough)

  // /clear 는 session.start 를 다시 부르지 않는다 — classic SessionStart(source clear)로 받는다
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)

    if (e.source === 'clear' && (await isEnabled($))) {
      await showCurrent($)
    }

    return result
  }).catch(passThrough)

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: USAGE }
    }

    const shouldEnable = arg === '' ? !(await isEnabled($)) : arg === 'on'
    await $.store.set(ENABLED_KEY, shouldEnable)

    if (shouldEnable) {
      await showCurrent($)
    } else {
      $.ui.status(undefined)
    }

    return { text: `컨텍스트 사용량 표시: ${shouldEnable ? '켜짐' : '꺼짐'}` }
  })
}
