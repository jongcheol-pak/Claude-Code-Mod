import { describe, expect, test } from 'claude-code/testing'

import {
  composeStatus,
  crossedPercents,
  estimateTurns,
  formatMeter,
  formatTokens,
  readDisplay,
  recordGrowth,
  resolveLimit,
} from '../hooks/meter.ts'
import type { Display } from '../hooks/meter.ts'

describe('토큰 표기', () => {
  test('[갈래1-1] 정수 천 단위는 소수점 없이 k 로 쓴다', () => {
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(84_000)).toBe('84k')
  })

  test('[갈래1-2] 소수가 남는 천 단위는 소수 첫째 자리까지 쓴다', () => {
    expect(formatTokens(84_500)).toBe('84.5k')
    expect(formatTokens(1_250)).toBe('1.3k')
  })

  test('[갈래1-3] 백만 단위는 M 으로 쓰고 소수 0 은 생략한다', () => {
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })

  test('[갈래1-4] 1000 미만은 숫자 그대로 쓴다', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(0)).toBe('0')
  })
})

describe('% 기준', () => {
  test('[갈래2-1] 자동 압축 임계치가 있으면 그것이 기준이다', () => {
    expect(resolveLimit(200_000, 160_000)).toBe(160_000)
    expect(formatMeter(80_000, 160_000)).toBe('컨텍스트 █████░░░░░ 50% · 80k/160k')
  })

  test('[갈래2-2] 자동 압축이 꺼져 임계치가 없으면 모델 윈도우가 기준이다', () => {
    expect(resolveLimit(200_000, undefined)).toBe(200_000)
    expect(formatMeter(50_000, 200_000)).toBe('컨텍스트 ███░░░░░░░ 25% · 50k/200k')
  })

  test('[갈래2-3] 첫 응답 전에는 기준 크기만 보인다', () => {
    expect(formatMeter(undefined, 160_000)).toBe('컨텍스트 –/160k')
  })

  test('[갈래2-1] 기준을 넘으면 막대는 가득 차고 % 는 그대로 보인다', () => {
    expect(formatMeter(176_000, 160_000)).toBe('컨텍스트 ██████████ 110% · 176k/160k')
  })
})

describe('임계치 경고', () => {
  test('[갈래4-1] 80% 를 아래에서 위로 넘으면 80 을 낸다', () => {
    expect(crossedPercents(70, 82)).toEqual([80])
  })

  test('[갈래4-2] 90% 를 넘으면 90 을, 한 번에 둘 다 넘으면 둘 다 낸다', () => {
    expect(crossedPercents(85, 91)).toEqual([90])
    expect(crossedPercents(70, 95)).toEqual([80, 90])
  })

  test('[갈래4-3] 이미 넘은 구간 안에서 다시 재면 아무것도 내지 않는다', () => {
    expect(crossedPercents(82, 85)).toEqual([])
    expect(crossedPercents(80, 80)).toEqual([])
  })

  test('[갈래4-4] 아래로 내려갔다가 다시 넘으면 다시 낸다', () => {
    expect(crossedPercents(85, 40)).toEqual([])
    expect(crossedPercents(40, 81)).toEqual([80])
  })

  test('[갈래4-5] 이전 값이 없는 첫 측정은 기준선만 잡고 내지 않는다', () => {
    expect(crossedPercents(undefined, 95)).toEqual([])
  })
})

const DEFAULT_DISPLAY: Display = { showDelta: true, showCost: false, showRateLimits: false }

describe('증가량·남은 턴', () => {
  test('[갈래5-1] 기본값은 증가량·남은 턴을 켜고 비용·플랜 한도는 끈다', () => {
    expect(readDisplay({})).toEqual(DEFAULT_DISPLAY)
  })

  test('[갈래5-2] 증가 이력이 있으면 직전 증가량과 남은 턴을 덧붙인다', () => {
    const growth = recordGrowth(recordGrowth([], 76_000, 80_000), 80_000, 84_000)

    expect(growth).toEqual([4_000, 4_000])
    expect(estimateTurns(growth, 160_000 - 84_000)).toBe(19)
    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth, rateLimits: [], display: DEFAULT_DISPLAY }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k · +4k · ≈19턴')
  })

  test('[갈래5-3] 증가량 표시를 끄면 미터만 보인다', () => {
    const display = readDisplay({ show_delta: false })

    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth: [4_000], rateLimits: [], display }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k')
  })

  test('[갈래5-4] 이력이 없거나 압축으로 줄어든 측정은 증가량에 넣지 않는다', () => {
    expect(recordGrowth([], undefined, 50_000)).toEqual([])
    expect(recordGrowth([4_000], 150_000, 30_000)).toEqual([4_000])
    expect(estimateTurns([], 10_000)).toBeUndefined()
    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth: [], rateLimits: [], display: DEFAULT_DISPLAY }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k')
  })

  test('[갈래5-5] 이력은 최근 3개만 평균에 쓴다', () => {
    expect(recordGrowth([1_000, 2_000, 3_000], 10_000, 16_000)).toEqual([2_000, 3_000, 6_000])
  })
})

describe('비용·플랜 한도', () => {
  // readDisplay 는 케이스 안에서 부른다 — 파일 로드 시점에 부르면 실패가 케이스가 아니라 로드 실패로 보인다
  const FULL = { show_cost: true, show_rate_limits: true }
  const rateLimits = [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 12.5 }]

  test('[갈래6-1] 켜면 비용과 플랜 한도를 덧붙인다', () => {
    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth: [], cost: { usd: 1.234 }, rateLimits, display: readDisplay(FULL) }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k · $1.23 · 5h 40% · 7d 12.5%')
  })

  test('[갈래6-2] 기본값(끔)이면 값이 있어도 보이지 않는다', () => {
    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth: [], cost: { usd: 1 }, rateLimits, display: DEFAULT_DISPLAY }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k')
  })

  test('[갈래6-3] 켜도 값이 없으면(구독 아님·비용 장부 없음) 생략한다', () => {
    expect(composeStatus({ tokens: 84_000, limit: 160_000, growth: [], rateLimits: [], display: readDisplay({ show_delta: false, show_cost: true, show_rate_limits: true }) }))
      .toBe('컨텍스트 █████░░░░░ 53% · 84k/160k')
  })
})
