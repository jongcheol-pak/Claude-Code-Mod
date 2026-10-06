import { describe, expect, test } from 'claude-code/testing'

import { formatMeter, formatTokens, resolveLimit } from '../hooks/meter.ts'

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
