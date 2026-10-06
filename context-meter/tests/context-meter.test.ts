import type { On, SessionContextBreakdown } from 'claude-code'
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
  maxTokens: threshold ?? 200_000,
  rawMaxTokens: threshold ?? 200_000,
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

// 엔진 대역: 상태 줄 기록 · 측정 응답 · 현재 사용량(내역 포함) 응답
const stubEngine = (on: On, shown: (string | undefined)[], options: StubOptions = {}): void => {
  // { threshold: undefined } 를 명시하면 기본값 대신 「꺼짐」으로 읽는다
  const threshold = 'threshold' in options ? options.threshold : 160_000
  const tokens = options.tokens ?? 50_000
  on('ui.status', ($, e) => { shown.push(e.text); return null as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 200_000, breakdown: breakdown(threshold) },
      rateLimits: [],
    },
  }))
}

// 사람이 프롬프트에서 /context-meter 를 친 것과 같은 command.run 입력
const RUN = {
  command: 'context-meter',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
}

const MEASURE = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [],
  changed: ['context' as const],
}

test('[갈래2-1] 측정값을 자동 압축 임계치 기준 % 와 토큰 수로 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(MEASURE)

  expect(shown).toEqual(['컨텍스트 █████░░░░░ 53% · 84k/160k'])
})

test('[갈래2-2] 자동 압축이 꺼진 세션은 모델 윈도우 기준으로 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown, { threshold: undefined })
  mock.store(on)

  await $.session.measure(MEASURE)

  expect(shown).toEqual(['컨텍스트 ████░░░░░░ 42% · 84k/200k'])
})

test('[갈래2-3] 첫 응답 전에는 기준 크기만 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown, { threshold: undefined })
  mock.store(on)

  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [],
    changed: ['context'],
  })

  expect(shown).toEqual(['컨텍스트 –/1M'])
})

test('[갈래6-5] 비용 표시가 꺼져 있으면 비용만 바뀐 측정에 반응하지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure({
    context: { tokens: 10, window: 200_000, percent: 0 },
    rateLimits: [],
    cost: { usd: 1 },
    changed: ['cost'],
  })

  expect(shown).toEqual([])
})

test('[갈래9-1] /context-meter off 는 상태 줄을 지우고 이후 측정을 무시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const result = await $.command.run({ ...RUN, args: 'off' })
  await $.session.measure(MEASURE)

  expect(result.text).toBe('컨텍스트 사용량 표시: 꺼짐')
  expect(shown).toEqual([undefined])
})

test('[갈래9-2] /context-meter on 은 현재 사용량을 바로 표시하고 이후 측정도 반영한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on, { isEnabled: false })

  const result = await $.command.run({ ...RUN, args: 'on' })
  await $.session.measure(MEASURE)

  expect(result.text).toBe('컨텍스트 사용량 표시: 켜짐')
  expect(shown).toEqual([
    '컨텍스트 ███░░░░░░░ 31% · 50k/160k',
    '컨텍스트 █████░░░░░ 53% · 84k/160k',
  ])
})

test('[갈래9-3] 인자 없이 실행하면 켜짐과 꺼짐을 번갈아 전환한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const first = await $.command.run({ ...RUN, args: '' })
  const second = await $.command.run({ ...RUN, args: '' })

  expect(first.text).toBe('컨텍스트 사용량 표시: 꺼짐')
  expect(second.text).toBe('컨텍스트 사용량 표시: 켜짐')
})

test('[갈래9-4] 알 수 없는 인자는 사용법을 보여 주고 상태를 바꾸지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const result = await $.command.run({ ...RUN, args: 'maybe' })

  expect(result.text).toContain('사용법')
  expect(shown).toEqual([])
})

// 압축 결과는 메시지를 하나 이상 남겨야 한다 — 요약 한 줄로 대신한다
const SUMMARY = [{ role: 'user' as const, text: '요약', toolUses: [] }]

// 압축 대역 — 엔진이 요약을 설치한 것처럼 답한다 · clear 의 classic SessionStart 도 답한다
const stubCompaction = (on: On): void => {
  on('session.compact', () => ({ messages: SUMMARY }))
  on('classic.SessionStart', () => ({}))
}

test('[갈래3-1] 메인 대화 압축이 끝나면 상태 줄을 다시 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })

  expect(shown).toEqual(['컨텍스트 ███░░░░░░░ 31% · 50k/160k'])
})

test('[갈래3-2] 미리 계산하는 precompute 압축에는 다시 그리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })

  expect(shown).toEqual([])
})

test('[갈래3-3] 서브에이전트 압축에는 다시 그리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: SUMMARY })

  expect(shown).toEqual([])
})

test('[갈래3-4] /clear 직후 상태 줄을 다시 그린다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.classic.SessionStart({ source: 'clear' })

  expect(shown).toEqual(['컨텍스트 ███░░░░░░░ 31% · 50k/160k'])
})

test('[갈래3-5] 표시가 꺼져 있으면 압축·clear 뒤에도 그리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on, { isEnabled: false })

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await $.classic.SessionStart({ source: 'clear' })

  expect(shown).toEqual([])
})
