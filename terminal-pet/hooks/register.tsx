import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PetState } from '../types'
import { addTokens, applyToolResult, bandLine, decayTo, evolutionMessage, restorePet, statusText } from './pet.ts'

const COMMAND = 'pet'
const PET_KEY = 'pet'
const ENABLED_KEY = 'isEnabled'
// 방치 중에도 띠의 포만감이 줄어 보이도록 감소를 저장하는 주기
const REFRESH_MS = 15 * 60_000
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

// 부화할 종을 고르는 [0, 1) 난수
const randomRoll = (): number => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

const saveDecay = ($: EngineInterface): Promise<void> =>
  withPet($, (pet, now) => [decayTo(pet, now), undefined])

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
    await saveDecay($)
    // 재로드로 이 훅이 다시 돌면 주기가 하나 더 생길 수 있지만, 감소는 시각의 함수라 겹쳐 저장해도 값이 같다
    $.clock.every(REFRESH_MS, () => {
      void saveDecay($)
    })

    return next(e)
  })

  // 도구가 답한 뒤 결과로 펫을 바꾼다 — 거절된 호출은 세지 않고, isError 는 원인과 무관하게 실패로 센다
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined) {
      await withPet($, (pet, now) => [applyToolResult(pet, ran.isError === true, now), undefined])
    }

    return ran
  }).catch(($, e, next) => next(e))

  // 메인 턴의 출력 토큰으로 자란다 — 서브에이전트 턴은 메인 usage 와 겹칠 수 있어 세지 않는다
  on('turn.complete', async ($, e, next) => {
    const tokens = e.agentId === undefined ? e.usage?.output_tokens : undefined

    if (tokens !== undefined && tokens > 0) {
      const evolved = await withPet($, (pet, now) => {
        const grown = addTokens(pet, tokens, randomRoll(), now)

        return [grown.pet, grown.evolvedTo === null ? null : grown.pet]
      })

      if (evolved !== null) {
        $.ui.toast(evolutionMessage(evolved))
      }
    }

    return next(e)
  })

  // 입력창 위 띠 — 꺼져 있거나 설문이 띠를 차지하면 엔진에 양보한다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // atom 을 읽어 두면 그 값이 바뀔 때 다시 그려진다. 켜짐 여부의 정본은 store
    const isShown = (await read($, enabledAtom)) && (await isEnabled($))

    if (e.props.hasSurvey || !isShown) {
      return next(e)
    }

    const now = await $.clock.now()
    // /clear 등으로 세션 상태가 비어 있으면 store 에서 읽는다
    const held = await read($, petAtom)
    const pet = held ?? restorePet(await $.store.get(PET_KEY), now)
    const { Text } = $.ui.resolve(e)

    return <Text>{bandLine(decayTo(pet, now), e.props.isWorking)}</Text>
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
