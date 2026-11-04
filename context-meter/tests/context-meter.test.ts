import type { On, SessionContextBreakdown, TurnStepInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type StubOptions = {
  // 자동 압축 임계치 — 없으면 자동 압축이 꺼진 세션
  threshold?: number
  // $.session.usage() 가 답하는 현재 토큰
  tokens?: number
}

// /context 내역(breakdown) 대역 — 필수 필드만 채우고 임계치만 바꾼다
const breakdown = (threshold: number | undefined): SessionContextBreakdown => ({
  categories: [],
  totalTokens: 0,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 0,
  gridRows: [],
  model: 'test-model',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: threshold,
  isAutoCompactEnabled: threshold !== undefined,
  apiUsage: null,
})

// 엔진 대역: 상태 줄 기록 · 측정 응답 · 현재 사용량 · /model 표기 모델 이름(model.name 으로 바꾼다)
const stubEngine = (on: On, shown: (string | undefined)[], options: StubOptions = {}) => {
  const threshold = 'threshold' in options ? options.threshold : 160_000
  const tokens = options.tokens ?? 50_000
  const model = { name: 'Opus 5.5' }
  on('ui.status', ($, e) => { shown.push(e.text); return { value: undefined } as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: model.name }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 200_000, breakdown: breakdown(threshold) },
      rateLimits: [],
    },
  }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  return model
}

const MEASURE = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [],
  changed: ['context' as const],
}

const step = (fields: Partial<TurnStepInput> = {}): TurnStepInput => ({
  turnId: 'turn-1',
  index: 0,
  model: 'claude-opus-5-5',
  messageCount: 1,
  ...fields,
})

// 스트림을 끝까지 읽어야 훅이 끝난다
const runStep = async ($: { turn: { step: (e: TurnStepInput) => AsyncGenerator<unknown, unknown> } }, e: TurnStepInput) => {
  for await (const _ of $.turn.step(e)) {
    // 청크는 쓰지 않는다
  }
}

test('[갈래4-1] 세션 시작 시 모델과 effort – 로 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(shown).toEqual(['Opus 5.5 · effort – · 컨텍스트 ███░░░░░░░ 31% · 50k/160k'])
})

test('[갈래4-2] 측정값이 바뀌면 모델·effort 를 포함해 다시 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(MEASURE)

  expect(shown).toEqual(['Opus 5.5 · effort – · 컨텍스트 █████░░░░░ 53% · 84k/160k'])
})

test('[갈래4-2] 자동 압축이 꺼진 세션은 모델 윈도우 기준, 첫 응답 전에는 기준 크기만 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown, { threshold: undefined })
  mock.store(on)

  await $.session.measure(MEASURE)
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })

  expect(shown).toEqual([
    'Opus 5.5 · effort – · 컨텍스트 ████░░░░░░ 42% · 84k/200k',
    'Opus 5.5 · effort – · 컨텍스트 –/1M',
  ])
})

test('[갈래4-3] 메인 요청의 effort 와 바뀐 모델이 상태 줄에 반영된다', async ($, on) => {
  const shown: (string | undefined)[] = []
  const model = stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(MEASURE)
  await runStep($, step({ effort: 'high' }))
  model.name = 'Sonnet 5.5'
  await runStep($, step({ index: 1, model: 'claude-sonnet-5-5', effort: 'low' }))

  expect(shown.at(-1)).toBe('Sonnet 5.5 · effort low · 컨텍스트 █████░░░░░ 53% · 84k/160k')
  expect(shown).toContain('Opus 5.5 · effort high · 컨텍스트 █████░░░░░ 53% · 84k/160k')
})

test('[갈래4-4] 서브에이전트 요청은 반영하지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(MEASURE)
  await runStep($, step({ effort: 'max', agentId: 'agent-1' }))

  expect(shown).toEqual(['Opus 5.5 · effort – · 컨텍스트 █████░░░░░ 53% · 84k/160k'])
})

// 압축 결과는 메시지를 하나 이상 남겨야 한다 — 요약 한 줄로 대신한다
const SUMMARY = [{ role: 'user' as const, text: '요약', toolUses: [] }]

// 압축 대역 — 엔진이 요약을 설치한 것처럼 답한다 · clear 의 classic SessionStart 도 답한다
const stubCompaction = (on: On): void => {
  on('session.compact', () => ({ messages: SUMMARY }))
  on('classic.SessionStart', () => ({}))
}

test('[갈래4-5] 메인 대화 압축이 끝나면 모델·effort 를 포함해 다시 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })

  expect(shown).toEqual(['Opus 5.5 · effort – · 컨텍스트 ███░░░░░░░ 31% · 50k/160k'])
})

test('[갈래4-6] /clear 직후 다시 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.classic.SessionStart({ source: 'clear' })

  expect(shown).toEqual(['Opus 5.5 · effort – · 컨텍스트 ███░░░░░░░ 31% · 50k/160k'])
})

test('[갈래4-7] 비용·플랜 한도만 바뀐 측정에는 다시 그리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure({
    context: { tokens: 10, window: 200_000, percent: 0 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    cost: { usd: 1 },
    changed: ['cost', 'rateLimits'],
  })

  expect(shown).toEqual([])
})

test('[갈래4-8] precompute·서브에이전트 압축에는 다시 그리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: SUMMARY })

  expect(shown).toEqual([])
})
