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

// 기준 160k 에서 지정한 % 가 되는 측정 이벤트
const measureAt = (percent: number) => ({
  context: { tokens: 1_600 * percent, window: 200_000 },
  rateLimits: [],
  changed: ['context' as const],
})

test('[갈래4-6] 측정이 80% 를 넘는 순간 토스트를 한 번 띄우고 같은 구간에서는 다시 띄우지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  const toasts: string[] = []
  stubEngine(on, shown)
  on('ui.toast', ($, e) => { toasts.push(e.text); return null as never })
  mock.store(on)

  await $.session.measure(measureAt(70))
  await $.session.measure(measureAt(82))
  await $.session.measure(measureAt(85))

  expect(toasts).toEqual(['컨텍스트 80% 도달 — 자동 압축 기준 160k 중 131.2k 사용'])
})

test('[갈래3-6] /clear 뒤 첫 측정은 기준선만 다시 잡아 토스트를 띄우지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  const toasts: string[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  on('ui.toast', ($, e) => { toasts.push(e.text); return null as never })
  mock.store(on)

  await $.session.measure(measureAt(70))
  await $.classic.SessionStart({ source: 'clear' })
  await $.session.measure(measureAt(85))

  expect(toasts).toEqual([])
})

const measureTokens = (tokens: number) => ({
  context: { tokens, window: 200_000 },
  rateLimits: [],
  changed: ['context' as const],
})

test('[갈래5-6] 기본 설정에서는 측정 사이 증가량과 남은 턴을 함께 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(measureTokens(80_000))
  await $.session.measure(measureTokens(84_000))

  expect(shown.at(-1)).toBe('컨텍스트 █████░░░░░ 53% · 84k/160k · +4k · ≈19턴')
})

test('[갈래5-7] show_delta 를 끄면 증가량을 표시하지 않는다', { options: { show_delta: false } }, async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure(measureTokens(80_000))
  await $.session.measure(measureTokens(84_000))

  expect(shown.at(-1)).toBe('컨텍스트 █████░░░░░ 53% · 84k/160k')
})

test('[갈래6-4] show_cost 를 켜면 비용만 바뀐 측정에도 다시 그린다', { options: { show_cost: true } }, async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  await $.session.measure({
    context: { tokens: 84_000, window: 200_000 },
    rateLimits: [],
    cost: { usd: 1.5 },
    changed: ['cost'],
  })

  expect(shown).toEqual(['컨텍스트 █████░░░░░ 53% · 84k/160k · $1.50'])
})

test('[갈래3-7] /clear 뒤에는 증가량 이력을 비운다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  stubCompaction(on)
  mock.store(on)

  await $.session.measure(measureTokens(80_000))
  await $.session.measure(measureTokens(84_000))
  await $.classic.SessionStart({ source: 'clear' })
  await $.session.measure(measureTokens(90_000))

  expect(shown.at(-1)).toBe('컨텍스트 ██████░░░░ 56% · 90k/160k')
})

const PANE_ID = 'context-meter-detail'

// 패널이 읽는 내역 — 카테고리와 합계를 채운 대역
const stubDetail = (on: On): void => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 58_000,
        window: 200_000,
        breakdown: {
          ...breakdown(160_000),
          totalTokens: 58_000,
          categories: [
            { name: 'System prompt', tokens: 8_000, color: 'promptBorder', isDeferred: false, kind: 'used' as const },
            { name: 'Messages', tokens: 50_000, color: 'permission', isDeferred: false, kind: 'used' as const },
            { name: 'Free space', tokens: 102_000, color: 'inactive', isDeferred: false, kind: 'free' as const },
          ],
        },
      },
      rateLimits: [],
    },
  }))
}

test('[갈래7-2] /context-meter detail 은 내역 패널을 연다', async ($, on) => {
  const opened: string[] = []
  stubEngine(on, [])
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true as const } } })
  mock.store(on)

  const result = await $.command.run({ ...RUN, args: 'detail' })

  expect(opened).toEqual([PANE_ID])
  expect(result.text).toBe('컨텍스트 내역 패널을 열었습니다')
})

test('[갈래7-3] 내역 패널은 terminal·desktop 모두 머리줄과 카테고리 행을 그린다', async ($, on) => {
  stubDetail(on)
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-meter',
      surface,
      component: 'Pane',
      requestId: PANE_ID,
      props: { title: '컨텍스트 내역', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })

    // Text 의 key 는 그려진 트리에 남지 않아 문구로 찾는다
    expect((await ui.find({ type: 'Text', text: /^사용 / }))?.text).toBe('사용 58k / 자동 압축 기준 160k (36%)')
    expect((await ui.find({ type: 'Text', text: /Messages/ }))?.text).toContain('31%')
    await ui.unmount()
  }
})

test('[갈래7-4] 컨텍스트 측정 뒤 패널을 다시 그리도록 요청한다', async ($, on) => {
  const invalidated: string[] = []
  stubEngine(on, [])
  on('ui.invalidate', ($, e) => { invalidated.push(e.event); return null as never })
  mock.store(on)

  await $.session.measure(MEASURE)

  expect(invalidated).toEqual(['ui.render'])
})

type CompactOutcome = 'compacted' | 'skipped' | 'rejected'

// 자동 압축 대역 — 호출 횟수를 센다(테스트 키트에서는 플러그인 호출의 trigger 가 비어 있어 trigger 로 가르지 않는다)
const stubAutoCompaction = (on: On, outcome: CompactOutcome, calls: string[]): void => {
  on('session.compact', () => {
    calls.push('compact')

    if (outcome === 'rejected') {
      throw new Error('turn is running')
    }

    return outcome === 'skipped' ? { skip: 'vetoed' } : { messages: SUMMARY }
  })
}

const AUTO_ON = { options: { auto_compact: true } }

test('[갈래8-4] 자동 압축이 꺼져 있으면 N% 를 넘어도 압축하지 않는다', async ($, on) => {
  const calls: string[] = []
  stubEngine(on, [])
  stubAutoCompaction(on, 'compacted', calls)
  const clock = mock.clock(on)
  mock.store(on)

  await $.session.measure(measureAt(95))
  await clock.advance(2_000)

  expect(calls).toEqual([])
})

test('[갈래8-5] 켜져 있으면 N% 이상 측정 1초 뒤 한 번 압축하고 같은 구간에서는 다시 하지 않는다', AUTO_ON, async ($, on) => {
  const calls: string[] = []
  stubEngine(on, [])
  stubAutoCompaction(on, 'compacted', calls)
  const clock = mock.clock(on)
  mock.store(on)

  await $.session.measure(measureAt(92))
  expect(calls).toEqual([])
  await clock.advance(1_000)
  await $.session.measure(measureAt(94))
  await clock.advance(2_000)

  expect(calls).toEqual(['compact'])
})

test('[갈래8-6] 압축이 거부되거나 건너뛰면 토스트를 한 번 띄우고 N 미만으로 내려가기 전까지 재시도하지 않는다', AUTO_ON, async ($, on) => {
  const calls: string[] = []
  const toasts: string[] = []
  stubEngine(on, [])
  stubAutoCompaction(on, 'rejected', calls)
  on('ui.toast', ($, e) => { toasts.push(e.text); return null as never })
  const clock = mock.clock(on)
  mock.store(on)

  await $.session.measure(measureAt(95))
  await clock.advance(1_000)
  await $.session.measure(measureAt(96))
  await clock.advance(1_000)
  await $.session.measure(measureAt(50))
  await $.session.measure(measureAt(91))
  await clock.advance(1_000)

  expect(calls).toEqual(['compact', 'compact'])
  expect(toasts.filter(text => text.startsWith('자동 압축'))).toHaveLength(2)
})

test('[갈래8-7] 재로드 직후 첫 측정이 이미 N% 이상이면 압축한다', AUTO_ON, async ($, on) => {
  const calls: string[] = []
  stubEngine(on, [])
  stubAutoCompaction(on, 'skipped', calls)
  on('ui.toast', () => null as never)
  const clock = mock.clock(on)
  mock.store(on)

  await $.session.measure(measureAt(97))
  await clock.advance(1_000)

  expect(calls).toEqual(['compact'])
})
