import { describe, expect, test } from 'claude-code/testing'

import {
  addTokens,
  applyToolResult,
  bandLine,
  decayTo,
  faceOf,
  newPet,
  restorePet,
  speciesFor,
} from '../hooks/pet.ts'
import type { PetState } from '../types'

const HOUR = 3_600_000

// 기준 펫 — 필요한 필드만 바꿔 쓴다
const pet = (fields: Partial<PetState> = {}): PetState => ({
  species: null,
  stage: 'egg',
  tokens: 0,
  fullness: 70,
  mood: 70,
  updatedAt: 0,
  ...fields,
})

describe('새 펫과 시간 감소', () => {
  test('[갈래1-1] 새 펫은 알이고 포만·기분 70 에서 시작한다', () => {
    expect(newPet(1_000)).toEqual(pet({ updatedAt: 1_000 }))
  })

  test('[갈래1-2] 포만감은 경과 시간에 비례해 시간당 4 줄고 기분은 그대로다', () => {
    expect(decayTo(pet(), 2 * HOUR)).toEqual(pet({ fullness: 62, updatedAt: 2 * HOUR }))
  })

  test('[갈래1-3] 포만감은 0 밑으로 내려가지 않는다', () => {
    expect(decayTo(pet(), 30 * HOUR).fullness).toBe(0)
  })

  test('[갈래1-4] 시각이 저장 시각보다 이르면 아무것도 바꾸지 않는다', () => {
    const later = pet({ updatedAt: 5_000 })

    expect(decayTo(later, 1_000)).toEqual(later)
  })

  test('[갈래1-14] 짧은 간격으로 여러 번 감소해도 한 번에 감소한 것과 같다', () => {
    let stepped = pet()
    for (let minute = 1; minute <= 120; minute += 1) {
      stepped = decayTo(stepped, minute * 60_000)
    }

    expect(Math.abs(stepped.fullness - 62)).toBeLessThan(1e-9)
  })
})

describe('도구 호출 결과', () => {
  test('[갈래1-5] 성공하면 포만 +2·기분 +1, 둘 다 100 을 넘지 않는다', () => {
    expect(applyToolResult(pet(), false, 0)).toEqual(pet({ fullness: 72, mood: 71 }))
    expect(applyToolResult(pet({ fullness: 99.5, mood: 100 }), false, 0)).toEqual(pet({ fullness: 100, mood: 100 }))
  })

  test('[갈래1-6] 실패하면 기분만 −5, 0 밑으로 내려가지 않는다', () => {
    expect(applyToolResult(pet(), true, 0)).toEqual(pet({ mood: 65 }))
    expect(applyToolResult(pet({ mood: 3 }), true, 0).mood).toBe(0)
  })

  test('[갈래1-15] 시간이 흐른 뒤의 성공은 감소를 먼저 적용한 다음 더한다', () => {
    // 100 → 1시간 감소 96 → 성공 +2 = 98
    expect(applyToolResult(pet({ fullness: 100 }), false, HOUR)).toEqual(pet({ fullness: 98, mood: 71, updatedAt: HOUR }))
  })
})

describe('성장', () => {
  test('[갈래1-7] 부화 임계(2만) 미만이면 알 그대로다', () => {
    const grown = addTokens(pet(), 19_999, 0.5, 0)

    expect(grown.evolvedTo).toBe(null)
    expect(grown.pet).toEqual(pet({ tokens: 19_999 }))
  })

  test('[갈래1-8] 부화하면 roll 의 3등분 구간으로 종이 정해진다', () => {
    const hatch = (roll: number) => addTokens(pet({ tokens: 19_000 }), 1_000, roll, 0)

    expect(hatch(0)).toEqual({ pet: pet({ tokens: 20_000, stage: 'baby', species: 'cat' }), evolvedTo: 'baby' })
    expect(hatch(0.33).pet.species).toBe('cat')
    expect(hatch(1 / 3).pet.species).toBe('dog')
    expect(hatch(0.66).pet.species).toBe('dog')
    expect(hatch(2 / 3).pet.species).toBe('dragon')
    expect(hatch(0.999).pet.species).toBe('dragon')
    expect(speciesFor(0.999)).toBe('dragon')
  })

  test('[갈래1-9] 성체 임계(30만)에 닿으면 성체가 되고 종은 유지된다', () => {
    const grown = addTokens(pet({ stage: 'baby', species: 'cat', tokens: 299_000 }), 1_000, 0.9, 0)

    expect(grown).toEqual({ pet: pet({ stage: 'adult', species: 'cat', tokens: 300_000 }), evolvedTo: 'adult' })
  })

  test('[갈래1-10] 한 번에 두 단계를 넘으면 종을 정하고 성체가 된다', () => {
    const grown = addTokens(pet(), 300_000, 0.5, 0)

    expect(grown).toEqual({ pet: pet({ stage: 'adult', species: 'dog', tokens: 300_000 }), evolvedTo: 'adult' })
  })
})

describe('표정과 문구', () => {
  const cat = pet({ stage: 'baby', species: 'cat' })
  const hungry = { ...cat, fullness: 0.4 }
  const sad = { ...cat, mood: 29 }

  test('[갈래1-11] 표정 순서 — 작업 중 > 배고픔 > 기분 나쁨 > 보통, 알은 작업 중만 가른다', () => {
    // 작업 중이면 배고픔·기분과 무관하게 같은 표정
    expect(faceOf(hungry, true)).toBe(faceOf(cat, true))
    expect(faceOf(sad, true)).toBe(faceOf(cat, true))
    expect(faceOf(cat, true)).not.toBe(faceOf(cat, false))
    // 배고픔이 기분 나쁨보다 앞선다
    expect(faceOf({ ...hungry, mood: 0 }, false)).toBe(faceOf(hungry, false))
    expect(faceOf(hungry, false)).not.toBe(faceOf(cat, false))
    expect(faceOf(sad, false)).not.toBe(faceOf(cat, false))
    expect(faceOf(sad, false)).not.toBe(faceOf(hungry, false))
    // 기분 30 은 아직 나쁘지 않다
    expect(faceOf({ ...cat, mood: 30 }, false)).toBe(faceOf(cat, false))
    // 종마다 그림이 다르다
    expect(faceOf({ ...cat, species: 'dog' }, false)).not.toBe(faceOf(cat, false))
    // 알은 배고파도 같은 그림이고, 작업 중이면 흔들린다
    expect(faceOf(pet({ fullness: 0 }), false)).toBe(faceOf(pet(), false))
    expect(faceOf(pet(), true)).not.toBe(faceOf(pet(), false))
  })

  test('[갈래1-12] 띠 문구에 이름·단계와 포만·기분 5칸 막대가 들어간다', () => {
    const line = bandLine({ ...cat, fullness: 59.6, mood: 100 }, false)

    expect(line).toContain('고양이')
    expect(line).toContain('새끼')
    expect(line).toContain('포만 ███░░')
    expect(line).toContain('기분 █████')
    expect(bandLine(pet(), false)).toContain('알')
  })

  test('[갈래1-13] 저장값이 온전하면 그대로, 아니면 새 펫으로 복원한다', () => {
    const saved = pet({ stage: 'adult', species: 'dragon', tokens: 400_000, fullness: 12.5, updatedAt: 77 })

    expect(restorePet(saved, 5)).toEqual(saved)
    expect(restorePet(undefined, 5)).toEqual(pet({ updatedAt: 5 }))
    expect(restorePet({ ...saved, stage: 'elder' }, 5)).toEqual(pet({ updatedAt: 5 }))
    expect(restorePet({ ...saved, fullness: 'many' }, 5)).toEqual(pet({ updatedAt: 5 }))
    expect(restorePet({ ...saved, species: 'fish' }, 5)).toEqual(pet({ updatedAt: 5 }))
  })
})
