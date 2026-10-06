import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// 엔진 대역: 상태 줄 기록 · 측정 응답 · 현재 사용량 응답
const stubEngine = (on: On, shown: (string | undefined)[]): void => {
  on('ui.status', ($, e) => { shown.push(e.text); return null as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 50_000, window: 200_000, percent: 25 },
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

test('측정값이 오면 상태 줄에 퍼센트와 토큰 수를 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('ui.status', ($, e) => { shown.push(e.text); return null as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  mock.store(on)

  await $.session.measure({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [],
    changed: ['context'],
  })

  expect(shown).toEqual(['컨텍스트 ████░░░░░░ 42% · 84.0k/200.0k'])
})

test('첫 응답 전에는 윈도우 크기만 표시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('ui.status', ($, e) => { shown.push(e.text); return null as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  mock.store(on)

  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [],
    changed: ['context'],
  })

  expect(shown).toEqual(['컨텍스트 –/1.0M'])
})

test('컨텍스트가 바뀌지 않은 측정은 상태 줄을 건드리지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('ui.status', ($, e) => { shown.push(e.text); return null as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  mock.store(on)

  await $.session.measure({
    context: { tokens: 10, window: 200_000, percent: 0 },
    rateLimits: [],
    cost: { usd: 1 },
    changed: ['cost'],
  })

  expect(shown).toEqual([])
})

test('/context-meter off 는 상태 줄을 지우고 이후 측정을 무시한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const result = await $.command.run({ ...RUN,args: 'off' })
  await $.session.measure(MEASURE)

  expect(result.text).toBe('컨텍스트 사용량 표시: 꺼짐')
  expect(shown).toEqual([undefined])
})

test('/context-meter on 은 현재 사용량을 바로 표시하고 이후 측정도 반영한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on, { isEnabled: false })

  const result = await $.command.run({ ...RUN,args: 'on' })
  await $.session.measure(MEASURE)

  expect(result.text).toBe('컨텍스트 사용량 표시: 켜짐')
  expect(shown).toEqual([
    '컨텍스트 ███░░░░░░░ 25% · 50.0k/200.0k',
    '컨텍스트 ████░░░░░░ 42% · 84.0k/200.0k',
  ])
})

test('인자 없이 실행하면 켜짐과 꺼짐을 번갈아 전환한다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const first = await $.command.run({ ...RUN,args: '' })
  const second = await $.command.run({ ...RUN,args: '' })

  expect(first.text).toBe('컨텍스트 사용량 표시: 꺼짐')
  expect(second.text).toBe('컨텍스트 사용량 표시: 켜짐')
})

test('알 수 없는 인자는 사용법을 보여 주고 상태를 바꾸지 않는다', async ($, on) => {
  const shown: (string | undefined)[] = []
  stubEngine(on, shown)
  mock.store(on)

  const result = await $.command.run({ ...RUN,args: 'maybe' })

  expect(result.text).toContain('사용법')
  expect(shown).toEqual([])
})
