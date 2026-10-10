import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PetState } from '../types'
import { decayTo, restorePet, statusText } from './pet.ts'

const COMMAND = 'pet'
const PET_KEY = 'pet'
const ENABLED_KEY = 'isEnabled'
const USAGE = `사용법: /${COMMAND} [on|off] — 인자 없이 실행하면 펫 상태, on/off 는 입력창 위 펫 표시 켜기·끄기`

// 띠가 읽는 값 — 쓰면 띠가 다시 그려진다. 정본은 store 이고 이것은 그 사본이다
const petAtom = atom({ plugin: 'terminal-pet', key: 'pet' } as const, null)
const enabledAtom = atom({ plugin: 'terminal-pet', key: 'isEnabled' } as const, true)

// 표시 켜짐/꺼짐은 세션을 넘어 유지된다 — 한 번도 끈 적 없으면 켜짐
const isEnabled = async ($: EngineInterface): Promise<boolean> =>
  (await $.store.get(ENABLED_KEY)) !== false

// 한 세션 안의 읽기-계산-쓰기를 줄 세운다 — 병렬 도구 호출 둘이 같은 값을 읽고 서로 덮어쓰지 않게
let queue: Promise<unknown> = Promise.resolve()

// store 에서 펫을 다시 읽어 change 를 적용하고 저장한다. change 는 [새 펫, 호출자에게 돌려줄 값]
const withPet = <T,>($: EngineInterface, change: (pet: PetState, now: number) => [PetState, T]): Promise<T> => {
  const run = async (): Promise<T> => {
    const now = await $.clock.now()
    const [next, result] = change(restorePet(await $.store.get(PET_KEY), now), now)
    await $.store.set(PET_KEY, next)
    await update($, petAtom, () => next)

    return result
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)

  return result
}

export const register: Register = on => {
  // 세션 시작(재로드 포함) 시 명령을 등록하고, 방치된 동안의 감소를 반영해 저장한다
  on('session.start', async ($, e, next) => {
    // 이름은 리터럴로 둔다 — validate 가 리터럴로 등록·매칭한 명령만 「자기 명령 응답」으로 읽는다
    await $.command.register({
      name: 'pet',
      description: '터미널 펫의 상태를 보거나 입력창 위 펫 표시를 켜고 끈다',
      argumentHint: '[on|off]',
    })

    const shouldShow = await isEnabled($)
    await update($, enabledAtom, () => shouldShow)
    await withPet($, (pet, now) => [decayTo(pet, now), undefined])

    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      const pet = await withPet($, (stored, now) => {
        const current = decayTo(stored, now)

        return [current, current]
      })

      return { text: statusText(pet) }
    }

    if (arg !== 'on' && arg !== 'off') {
      return { text: USAGE }
    }

    const shouldShow = arg === 'on'
    await $.store.set(ENABLED_KEY, shouldShow)
    await update($, enabledAtom, () => shouldShow)

    return { text: `펫 표시: ${shouldShow ? '켜짐' : '꺼짐'}` }
  })
}
