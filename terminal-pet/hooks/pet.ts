// 엔진에 의존하지 않는 펫 상태 계산·표기 — register.tsx 가 현재 시각·무작위 값을 넣어 호출한다
import type { PetState, Species, Stage } from '../types'

// 밸런스 — 하루 가까이 방치하면 포만 0, 짧은 세션 몇 번에 부화
const INITIAL_LEVEL = 70
const MAX_LEVEL = 100
const FULLNESS_DECAY_PER_HOUR = 4
const FULLNESS_ON_SUCCESS = 2
const MOOD_ON_SUCCESS = 1
const MOOD_ON_FAILURE = 5
const SAD_BELOW = 30
const HATCH_TOKENS = 20_000
const ADULT_TOKENS = 300_000

const HOUR_MS = 3_600_000
const BAR_WIDTH = 5

const SPECIES: readonly Species[] = ['cat', 'dog', 'dragon']
const STAGES: readonly Stage[] = ['egg', 'baby', 'adult']

// 종마다 이름(주격 조사 포함)과 표정 네 벌
const LOOKS: Record<Species, { name: string; subject: string; normal: string; hungry: string; sad: string; working: string }> = {
  cat: { name: '고양이', subject: '고양이가', normal: '(=^.^=)', hungry: '(=;_;=)', sad: '(=-.-=)', working: '(=^o^=)' },
  dog: { name: '강아지', subject: '강아지가', normal: '(U^w^U)', hungry: '(U;_;U)', sad: '(U-_-U)', working: '(U*o*U)' },
  dragon: { name: '드래곤', subject: '드래곤이', normal: '<(^v^)>', hungry: '<(;_;)>', sad: '<(-_-)>', working: '<(*o*)>' },
}

const EGG_FACE = '( . )'
const EGG_WOBBLE_FACE = '~( . )~'
const STAGE_LABEL: Record<Stage, string> = { egg: '알', baby: '새끼', adult: '성체' }

const clamp = (value: number): number => Math.min(MAX_LEVEL, Math.max(0, value))

export const newPet = (now: number): PetState => ({
  species: null,
  stage: 'egg',
  tokens: 0,
  fullness: INITIAL_LEVEL,
  mood: INITIAL_LEVEL,
  updatedAt: now,
})

// 저장 시각부터 now 까지 포만감을 줄인다 — 소수로 남겨 짧은 간격의 반복 적용에도 감소분이 사라지지 않는다
export const decayTo = (pet: PetState, now: number): PetState => {
  if (now <= pet.updatedAt) {
    return pet
  }

  const hours = (now - pet.updatedAt) / HOUR_MS

  return { ...pet, fullness: clamp(pet.fullness - hours * FULLNESS_DECAY_PER_HOUR), updatedAt: now }
}

// 모든 쓰기는 감소를 먼저 적용한 다음 효과를 더한다
export const applyToolResult = (pet: PetState, isError: boolean, now: number): PetState => {
  const current = decayTo(pet, now)

  if (isError) {
    return { ...current, mood: clamp(current.mood - MOOD_ON_FAILURE) }
  }

  return {
    ...current,
    fullness: clamp(current.fullness + FULLNESS_ON_SUCCESS),
    mood: clamp(current.mood + MOOD_ON_SUCCESS),
  }
}

// roll ∈ [0, 1) 을 3등분해 종을 고른다
export const speciesFor = (roll: number): Species =>
  SPECIES[Math.min(SPECIES.length - 1, Math.floor(roll * SPECIES.length))]

const stageFor = (tokens: number): Stage => {
  if (tokens >= ADULT_TOKENS) {
    return 'adult'
  }

  return tokens >= HATCH_TOKENS ? 'baby' : 'egg'
}

// 누적 출력 토큰으로 자란다 — 단계가 오르면 evolvedTo 에 새 단계, 부화할 때 roll 로 종을 정한다
export const addTokens = (
  pet: PetState,
  tokens: number,
  roll: number,
  now: number,
): { pet: PetState; evolvedTo: Stage | null } => {
  const current = decayTo(pet, now)
  const total = current.tokens + Math.max(0, tokens)
  const stage = stageFor(total)

  if (STAGES.indexOf(stage) <= STAGES.indexOf(current.stage)) {
    return { pet: { ...current, tokens: total }, evolvedTo: null }
  }

  const species = current.species ?? speciesFor(roll)

  return { pet: { ...current, tokens: total, stage, species }, evolvedTo: stage }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// store 에서 읽은 값을 검사한다 — 형식이 틀리거나 없으면 새 펫
export const restorePet = (value: unknown, now: number): PetState => {
  if (typeof value !== 'object' || value === null) {
    return newPet(now)
  }

  const saved = value as Record<string, unknown>
  const isValid = (saved.species === null || SPECIES.includes(saved.species as Species))
    && STAGES.includes(saved.stage as Stage)
    && isFiniteNumber(saved.tokens)
    && isFiniteNumber(saved.fullness)
    && isFiniteNumber(saved.mood)
    && isFiniteNumber(saved.updatedAt)

  if (!isValid) {
    return newPet(now)
  }

  return {
    species: saved.species as Species | null,
    stage: saved.stage as Stage,
    tokens: saved.tokens as number,
    fullness: saved.fullness as number,
    mood: saved.mood as number,
    updatedAt: saved.updatedAt as number,
  }
}

// 표정 순서: 알은 작업 중이면 흔들리는 알 · 부화 후는 작업 중 > 배고픔 > 기분 나쁨 > 보통
export const faceOf = (pet: PetState, isWorking: boolean): string => {
  if (pet.species === null) {
    return isWorking ? EGG_WOBBLE_FACE : EGG_FACE
  }

  const look = LOOKS[pet.species]

  if (isWorking) {
    return look.working
  }

  if (Math.round(pet.fullness) === 0) {
    return look.hungry
  }

  return pet.mood < SAD_BELOW ? look.sad : look.normal
}

const renderBar = (level: number): string => {
  const filled = Math.round((level / MAX_LEVEL) * BAR_WIDTH)

  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

// 알이면 「알」, 부화 후는 「고양이(새끼)」
const labelOf = (pet: PetState): string =>
  pet.species === null ? STAGE_LABEL.egg : `${LOOKS[pet.species].name}(${STAGE_LABEL[pet.stage]})`

// 입력창 위 띠 한 줄
export const bandLine = (pet: PetState, isWorking: boolean): string =>
  `${faceOf(pet, isWorking)} ${labelOf(pet)} · 포만 ${renderBar(pet.fullness)} · 기분 ${renderBar(pet.mood)}`

const formatTokens = (n: number): string =>
  n >= 1_000 ? `${Math.round(n / 100) / 10}k` : `${n}`

// 다음 단계까지 남은 토큰 — 성체면 없음
const growthLine = (pet: PetState): string => {
  const next = pet.stage === 'egg' ? HATCH_TOKENS : pet.stage === 'baby' ? ADULT_TOKENS : null
  const grown = `성장 ${formatTokens(pet.tokens)} 토큰`

  return next === null ? `${grown} · 다 자람` : `${grown} · 다음 단계까지 ${formatTokens(next - pet.tokens)}`
}

// /pet 응답 — 표정·이름, 수치, 성장
export const statusText = (pet: PetState): string => [
  `${faceOf(pet, false)} ${labelOf(pet)}`,
  `포만 ${renderBar(pet.fullness)} ${Math.round(pet.fullness)}/100 · 기분 ${renderBar(pet.mood)} ${Math.round(pet.mood)}/100`,
  growthLine(pet),
].join('\n')

// 진화 토스트 — 부화와 성체를 가른다
export const evolutionMessage = (pet: PetState): string => {
  const subject = pet.species === null ? '알이' : LOOKS[pet.species].subject

  return pet.stage === 'adult' ? `${subject} 성체로 자랐습니다!` : `알이 부화했습니다! ${subject} 태어났어요`
}
