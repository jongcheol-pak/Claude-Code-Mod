// 엔진에 의존하지 않는 계산·표기 — register.ts 가 엔진 값을 넣어 호출한다

const BAR_WIDTH = 10

// 소수 첫째 자리까지, 0 이면 생략 (84.0 → 84, 84.5 → 84.5)
const trimDecimal = (value: number): string => {
  const fixed = value.toFixed(1)

  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

// 토큰 수를 200k · 84.5k · 1.5M 형태로 줄인다
export const formatTokens = (n: number): string => {
  if (n >= 1_000_000) {
    return `${trimDecimal(n / 1_000_000)}M`
  }

  if (n >= 1_000) {
    return `${trimDecimal(n / 1_000)}k`
  }

  return `${n}`
}

// % 의 분모: 자동 압축 임계치가 있으면 그것, 꺼져 있으면 모델 윈도우
export const resolveLimit = (window: number, autoCompactThreshold?: number): number =>
  autoCompactThreshold ?? window

export const percentOf = (tokens: number, limit: number): number =>
  Math.round((tokens / limit) * 100)

const renderBar = (percent: number): string => {
  const filled = Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH))

  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

// 상태 줄의 미터 부분: 막대 · % · 사용/기준. 첫 응답 전(tokens 없음)이면 기준만
export const formatMeter = (tokens: number | undefined, limit: number): string => {
  if (tokens === undefined) {
    return `컨텍스트 –/${formatTokens(limit)}`
  }

  const percent = percentOf(tokens, limit)

  return `컨텍스트 ${renderBar(percent)} ${percent}% · ${formatTokens(tokens)}/${formatTokens(limit)}`
}
