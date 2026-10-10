// terminal-pet 의 $.state 계약 — validate 가 계약 안의 import 를 읽지 못해 상태 타입도 여기서 정의한다

export type Species = 'cat' | 'dog' | 'dragon'

export type Stage = 'egg' | 'baby' | 'adult'

// 포만·기분은 0~100 소수 — 표시할 때만 반올림한다
export type PetState = {
  species: Species | null
  stage: Stage
  tokens: number
  fullness: number
  mood: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-pet': { pet: PetState | null; isEnabled: boolean }
  }
}
