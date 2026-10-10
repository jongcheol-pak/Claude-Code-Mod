import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { PetState } from '../types'

const HOUR = 3_600_000

const pet = (fields: Partial<PetState> = {}): PetState => ({
  species: null,
  stage: 'egg',
  tokens: 0,
  fullness: 70,
  mood: 70,
  updatedAt: 0,
  ...fields,
})

// 메모리 store 대역 — 테스트가 저장된 값을 직접 들여다볼 수 있게 Map 을 돌려준다
const stubStore = (on: On, initial: Record<string, unknown> = {}): Map<string, unknown> => {
  const data = new Map<string, unknown>(Object.entries(initial))
  on('store.get', ($, e) => ({ value: data.get(e.key) }))
  on('store.set', ($, e) => {
    data.set(e.key, e.value)

    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    data.delete(e.key)

    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...data.keys()] }))

  return data
}

// 엔진 대역: 명령 등록 기록 · 세션 시작 응답
const stubEngine = (on: On, registered: string[] = []): void => {
  on('command.register', ($, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

const START = { cwd: '.', surface: 'terminal' as const, isInteractive: true }

// 사람이 프롬프트에서 /pet 을 친 것과 같은 command.run 입력
const RUN = {
  command: 'pet',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
}

test('[갈래2-1] 세션 시작 시 /pet 을 등록하고 저장값이 없으면 알을 저장한다', async ($, on) => {
  const registered: string[] = []
  stubEngine(on, registered)
  mock.clock(on, { now: 1_000 })
  const data = stubStore(on)

  await $.session.start(START)

  expect(registered).toEqual(['pet'])
  expect(data.get('pet')).toEqual(pet({ updatedAt: 1_000 }))
})

test('[갈래2-1] 세션 시작 시 저장된 펫은 지금까지의 감소를 반영해 다시 저장한다', async ($, on) => {
  stubEngine(on)
  mock.clock(on, { now: 2 * HOUR })
  const data = stubStore(on, { pet: pet({ stage: 'baby', species: 'cat' }) })

  await $.session.start(START)

  expect(data.get('pet')).toEqual(pet({ stage: 'baby', species: 'cat', fullness: 62, updatedAt: 2 * HOUR }))
})

test('[갈래2-2] /pet 은 펫 상태를 보여 준다', async ($, on) => {
  stubEngine(on)
  mock.clock(on, { now: 0 })
  stubStore(on, { pet: pet({ stage: 'baby', species: 'cat', tokens: 25_000 }) })

  const result = await $.command.run({ ...RUN, args: '' })

  expect(result.text).toContain('고양이')
  expect(result.text).toContain('새끼')
  expect(result.text).toContain('70/100')
})

test('[갈래2-2] /pet off·on 은 표시를 끄고 켜며 store 에 남긴다', async ($, on) => {
  stubEngine(on)
  mock.clock(on)
  const data = stubStore(on)

  const off = await $.command.run({ ...RUN, args: 'off' })
  expect(off.text).toBe('펫 표시: 꺼짐')
  expect(data.get('isEnabled')).toBe(false)

  const back = await $.command.run({ ...RUN, args: 'ON' })
  expect(back.text).toBe('펫 표시: 켜짐')
  expect(data.get('isEnabled')).toBe(true)
})

test('[갈래2-2] /pet 에 모르는 인자를 주면 사용법을 알려 준다', async ($, on) => {
  stubEngine(on)
  mock.clock(on)
  stubStore(on)

  const result = await $.command.run({ ...RUN, args: 'feed' })

  expect(result.text).toStartWith('사용법: /pet')
})
