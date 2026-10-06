import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import { renderDetailPane } from './detail-pane.tsx'
import {
  composeStatus,
  crossedPercents,
  detailHeader,
  detailRows,
  formatWarning,
  percentOf,
  readAutoCompact,
  readDisplay,
  recordGrowth,
  resolveLimit,
  shouldAutoCompact,
} from './meter.ts'
import type { AutoCompact, Display } from './meter.ts'

const COMMAND = 'context-meter'
const ENABLED_KEY = 'isEnabled'
const USAGE = `사용법: /${COMMAND} [on|off|detail] — 인자 없이 실행하면 켜고 끄기를 전환, detail 은 카테고리별 내역 패널`
const PANE_ID = 'context-meter-detail'

// 켜짐/꺼짐은 세션을 넘어 유지된다 — 한 번도 끈 적 없으면 켜짐
const isEnabled = async ($: EngineInterface): Promise<boolean> =>
  (await $.store.get(ENABLED_KEY)) !== false

type Basis = { limit: number; isCompactBasis: boolean }

// 자동 압축 임계치는 측정 이벤트에 없어 breakdown(로컬 추정, API 요청 없음)에서 읽는다
const readBasis = async ($: EngineInterface, window: number): Promise<Basis> => {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const threshold = context.breakdown?.autoCompactThreshold

  return { limit: resolveLimit(window, threshold), isCompactBasis: threshold !== undefined }
}

// 경고 기준선(직전 측정의 %) — 재로드·clear 직후에는 비어 있어 첫 측정은 기준선만 잡는다
let lastPercent: number | undefined

const warnCrossings = ($: EngineInterface, tokens: number | undefined, basis: Basis): void => {
  if (tokens === undefined) {
    return
  }

  const percent = percentOf(tokens, basis.limit)

  for (const crossed of crossedPercents(lastPercent, percent)) {
    $.ui.toast(formatWarning(crossed, tokens, basis.limit, basis.isCompactBasis))
  }

  lastPercent = percent
}

// userConfig 로 고른 덧붙임 항목 — 설정을 바꾸면 모듈이 다시 로드돼 register 가 새 값을 넣는다
let display: Display = readDisplay({})

// 증가량 이력과 직전 토큰 — /clear 시 비운다
let growth: number[] = []
let lastTokens: number | undefined

const trackGrowth = (tokens: number | undefined): void => {
  if (tokens === undefined) {
    return
  }

  growth = recordGrowth(growth, lastTokens, tokens)
  lastTokens = tokens
}

// N% 자동 압축 설정과 시도 표시 — N 미만으로 내려가거나 /clear 하면 다시 시도할 수 있다
let autoCompact: AutoCompact = readAutoCompact({})
let isCompactAttempted = false

const AUTO_COMPACT_DELAY_MS = 1_000

// 엔진은 턴 중의 압축을 거부한다 — 거부·건너뜀은 알리고 재시도는 구간이 바뀔 때까지 미룬다
const runAutoCompact = async ($: EngineInterface): Promise<void> => {
  try {
    const result = await $.session.compact()

    if ('skip' in result) {
      $.ui.toast(`자동 압축을 건너뛰었습니다: ${result.skip}`)
    }
  } catch (error) {
    $.ui.toast(`자동 압축 실패: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 측정 디스패치 안에서 압축을 기다리지 않도록 잠시 뒤로 예약한다
const scheduleAutoCompact = ($: EngineInterface, tokens: number | undefined, basis: Basis): void => {
  if (tokens === undefined) {
    return
  }

  const percent = percentOf(tokens, basis.limit)

  if (percent < autoCompact.percent) {
    isCompactAttempted = false
    return
  }

  if (!shouldAutoCompact(percent, autoCompact, isCompactAttempted)) {
    return
  }

  isCompactAttempted = true
  $.clock.after(AUTO_COMPACT_DELAY_MS, () => {
    void runAutoCompact($)
  })
}

const resetHistory = (): void => {
  growth = []
  lastTokens = undefined
  lastPercent = undefined
  isCompactAttempted = false
}

// 측정 이벤트와 $.session.usage() 가 같은 이름으로 주는 값
type Snapshot = Pick<SessionUsage, 'context' | 'cost' | 'rateLimits'>

const draw = ($: EngineInterface, snapshot: Snapshot, basis: Basis): void => {
  $.ui.status(composeStatus({
    tokens: snapshot.context.tokens,
    limit: basis.limit,
    growth,
    cost: snapshot.cost,
    rateLimits: snapshot.rateLimits,
    display,
  }))
}

const showCurrent = async ($: EngineInterface): Promise<void> => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const threshold = usage.context.breakdown?.autoCompactThreshold
  draw($, usage, { limit: resolveLimit(usage.context.window, threshold), isCompactBasis: threshold !== undefined })
}

// 다시 그리기가 실패해도 압축·clear 자체는 막지 않는다 — next 는 재호출해도 같은 결과를 돌려준다
const passThrough = <E, R>($: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = (on, options) => {
  display = readDisplay(options)
  autoCompact = readAutoCompact(options)

  // 세션 시작(재로드 포함) 시 명령을 등록하고, 켜져 있으면 현재 값으로 한 번 그린다
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '상태 줄의 컨텍스트 사용량 표시를 켜거나 끄고, detail 로 내역 패널을 연다',
      argumentHint: '[on|off|detail]',
    })

    if (await isEnabled($)) {
      await showCurrent($)
    }

    return next(e)
  })

  // 턴마다 엔진이 측정값을 밀어 준다 — 컨텍스트가 바뀌었거나, 켜 둔 비용·한도가 바뀐 경우만 갱신
  on('session.measure', async ($, e, next) => {
    const isContextChange = e.changed.includes('context')
    const isExtraChange = (display.showCost && e.changed.includes('cost'))
      || (display.showRateLimits && e.changed.includes('rateLimits'))

    if ((isContextChange || isExtraChange) && (await isEnabled($))) {
      const basis = await readBasis($, e.context.window)

      if (isContextChange) {
        trackGrowth(e.context.tokens)
        warnCrossings($, e.context.tokens, basis)
        scheduleAutoCompact($, e.context.tokens, basis)
      }

      draw($, e, basis)

      if (isContextChange) {
        $.ui.invalidate('ui.render')
      }
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

    if (e.source !== 'clear') {
      return result
    }

    resetHistory()

    if (await isEnabled($)) {
      await showCurrent($)
    }

    return result
  }).catch(passThrough)

  // 내역 패널 — 열릴 때와 측정 뒤 다시 그릴 때마다 최신 내역을 읽는다
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const elements = $.ui.resolve(e)

    if (context.breakdown === undefined) {
      return renderDetailPane(elements, '내역을 읽을 수 없습니다', [])
    }

    const { categories, totalTokens, rawMaxTokens, autoCompactThreshold, autocompactSource } = context.breakdown
    // autocompactSource 'auto' 는 모델 자체 한도, 나머지는 누군가 정한 더 작은 압축 창이다
    const windowLabel = autocompactSource === 'auto' ? '모델 윈도우' : '압축 창'
    const header = detailHeader(totalTokens, rawMaxTokens, windowLabel, autoCompactThreshold)

    return renderDetailPane(elements, header, detailRows(categories, rawMaxTokens))
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'detail') {
      const opened = await $.ui.open({ id: PANE_ID, title: '컨텍스트 내역' })

      return { text: opened.isPlaced ? '컨텍스트 내역 패널을 열었습니다' : `내역 패널을 열지 못했습니다: ${opened.reason}` }
    }

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
