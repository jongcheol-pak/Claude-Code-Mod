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

export const WARN_PERCENTS = [80, 90] as const

// 이전 측정에서 이번 측정 사이에 새로 넘은 경고 % — 이전 값이 없으면(첫 측정) 기준선만 잡는다
export const crossedPercents = (previous: number | undefined, current: number): number[] => {
  if (previous === undefined) {
    return []
  }

  return WARN_PERCENTS.filter(percent => previous < percent && current >= percent)
}

// 경고 토스트 문구 — 기준이 자동 압축 임계치인지 모델 윈도우인지 밝힌다
export const formatWarning = (percent: number, tokens: number, limit: number, isCompactBasis: boolean): string =>
  `컨텍스트 ${percent}% 도달 — ${isCompactBasis ? '자동 압축 기준' : '모델 윈도우'} ${formatTokens(limit)} 중 ${formatTokens(tokens)} 사용`

// 상태 줄에 덧붙이는 항목의 켜짐/꺼짐 — userConfig 값에서 읽는다
export type Display = { showDelta: boolean; showCost: boolean; showRateLimits: boolean }

// 값이 없거나 boolean 이 아니면 매니페스트 기본값과 같은 값을 쓴다
const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

export const readDisplay = (options: Readonly<Record<string, unknown>>): Display => ({
  showDelta: flag(options.show_delta, true),
  showCost: flag(options.show_cost, false),
  showRateLimits: flag(options.show_rate_limits, false),
})

const GROWTH_WINDOW = 3

// 최근 증가량 이력(양수만, 최근 3개) — 압축으로 줄어든 측정은 넣지 않는다
export const recordGrowth = (history: readonly number[], previous: number | undefined, current: number): number[] => {
  if (previous === undefined || current <= previous) {
    return [...history]
  }

  return [...history, current - previous].slice(-GROWTH_WINDOW)
}

// 기준까지 남은 턴 추정 — 이력 평균 증가량으로 나눈다, 이력이 없으면 모름
export const estimateTurns = (history: readonly number[], remaining: number): number | undefined => {
  if (history.length === 0) {
    return undefined
  }

  const average = history.reduce((sum, delta) => sum + delta, 0) / history.length

  return Math.max(0, Math.floor(remaining / average))
}

const RATE_LIMIT_LABELS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d' }

const formatGrowth = (tokens: number | undefined, limit: number, growth: readonly number[]): string | undefined => {
  const last = growth.at(-1)

  if (last === undefined || tokens === undefined) {
    return undefined
  }

  const turns = estimateTurns(growth, limit - tokens)

  return turns === undefined ? `+${formatTokens(last)}` : `+${formatTokens(last)} · ≈${turns}턴`
}

const formatRateLimits = (rateLimits: StatusInput['rateLimits']): string | undefined => {
  if (rateLimits.length === 0) {
    return undefined
  }

  return rateLimits
    .map(limit => `${RATE_LIMIT_LABELS[limit.kind] ?? limit.kind} ${limit.percentUsed}%`)
    .join(' · ')
}

export type StatusInput = {
  tokens: number | undefined
  limit: number
  growth: readonly number[]
  cost?: { usd: number }
  rateLimits: readonly { kind: string; percentUsed: number }[]
  display: Display
}

// 상태 줄 전체: 미터 · 증가량·남은 턴 · 비용 · 플랜 한도 (꺼졌거나 값이 없으면 생략)
export const composeStatus = (input: StatusInput): string => {
  const { tokens, limit, growth, cost, rateLimits, display } = input
  const parts = [
    formatMeter(tokens, limit),
    display.showDelta ? formatGrowth(tokens, limit, growth) : undefined,
    display.showCost && cost !== undefined ? `$${cost.usd.toFixed(2)}` : undefined,
    display.showRateLimits ? formatRateLimits(rateLimits) : undefined,
  ]

  return parts.filter(part => part !== undefined).join(' · ')
}

// 내역 패널의 한 줄 — % 는 사용 중인 행에만, 지연 로드 행은 합계 밖이라 표시만 한다
export type DetailRow = { name: string; tokens: string; percent?: string }

export type DetailCategory = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

const toDetailRow = (category: DetailCategory, rawMaxTokens: number): DetailRow => {
  const tokens = formatTokens(category.tokens)

  if (category.kind === 'used') {
    return { name: category.name, tokens, percent: `${percentOf(category.tokens, rawMaxTokens)}%` }
  }

  if (category.kind === 'deferred') {
    return { name: `${category.name} · 지연 로드`, tokens }
  }

  return { name: category.name, tokens }
}

// 엔진 순서를 지키되 지연 로드 행(합계 밖)은 맨 뒤로 보낸다
export const detailRows = (categories: readonly DetailCategory[], rawMaxTokens: number): DetailRow[] => {
  const inWindow = categories.filter(category => category.kind !== 'deferred')
  const deferred = categories.filter(category => category.kind === 'deferred')

  return [...inWindow, ...deferred].map(category => toDetailRow(category, rawMaxTokens))
}

// 내역의 분모(rawMaxTokens)는 모델 윈도우이거나 그보다 작은 압축 창이다 — 자동 압축 임계치와 다른 값이라 따로 적는다
export type WindowLabel = '모델 윈도우' | '압축 창'

export const detailHeader = (
  totalTokens: number,
  rawMaxTokens: number,
  windowLabel: WindowLabel,
  autoCompactThreshold: number | undefined,
): string => {
  const threshold = autoCompactThreshold === undefined ? '꺼짐' : formatTokens(autoCompactThreshold)

  return `사용 ${formatTokens(totalTokens)} / ${windowLabel} ${formatTokens(rawMaxTokens)} (${percentOf(totalTokens, rawMaxTokens)}%) · 자동 압축 ${threshold}`
}

// N% 자동 압축 설정 — 기본은 꺼짐, N 은 90
export type AutoCompact = { isEnabled: boolean; percent: number }

const DEFAULT_AUTO_COMPACT_PERCENT = 90

// 매니페스트(plugin.json)의 min·max 와 같은 범위
const MIN_AUTO_COMPACT_PERCENT = 50
const MAX_AUTO_COMPACT_PERCENT = 99

// 유한한 숫자가 아니면 기본값, 범위 밖이면 가까운 경계로 맞춘다
const readPercent = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_AUTO_COMPACT_PERCENT, Math.max(MIN_AUTO_COMPACT_PERCENT, value))
    : DEFAULT_AUTO_COMPACT_PERCENT

export const readAutoCompact = (options: Readonly<Record<string, unknown>>): AutoCompact => ({
  isEnabled: flag(options.auto_compact, false),
  percent: readPercent(options.auto_compact_percent),
})

// 이번 측정에서 자동 압축을 시도할지 — 같은 구간(N 이상)에서는 한 번만
export const shouldAutoCompact = (percent: number, setting: AutoCompact, isAttempted: boolean): boolean =>
  setting.isEnabled && percent >= setting.percent && !isAttempted
