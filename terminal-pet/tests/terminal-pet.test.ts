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

// 도구 대역: 엔진이 돌려줄 결과를 그대로 답한다
const stubTool = (on: On, answer: object): void => {
  on('tool.call', () => answer as never)
}

const READ = { tool: 'Read' as const, file_path: 'a.md' }

test('[갈래2-3] 도구가 성공하면 포만·기분이, 실패하면 기분이 store 에 반영된다', async ($, on) => {
  mock.clock(on)
  const data = stubStore(on, { pet: pet() })

  stubTool(on, { result: 'ok' })
  await $.tool.call(READ)
  expect(data.get('pet')).toEqual(pet({ fullness: 72, mood: 71 }))
})

test('[갈래2-3] 도구 결과가 isError 면 기분만 내려간다', async ($, on) => {
  mock.clock(on)
  const data = stubStore(on, { pet: pet() })

  stubTool(on, { result: 'boom', isError: true, text: 'boom' })
  const ran = await $.tool.call(READ)

  expect(ran.isError).toBe(true)
  expect(data.get('pet')).toEqual(pet({ mood: 65 }))
})

test('[갈래2-4] 거절된 호출은 펫을 바꾸지 않고 거절을 그대로 돌려준다', async ($, on) => {
  mock.clock(on)
  const data = stubStore(on, { pet: pet() })

  stubTool(on, { deny: '막힘' })
  const ran = await $.tool.call(READ)

  expect(ran.deny).toBe('막힘')
  expect(data.get('pet')).toEqual(pet())
})

test('[갈래2-5] 병렬 도구 호출 둘이 모두 반영된다', async ($, on) => {
  mock.clock(on)
  const data = stubStore(on, { pet: pet() })

  stubTool(on, { result: 'ok' })
  await Promise.all([$.tool.call(READ), $.tool.call({ ...READ, file_path: 'b.md' })])

  expect(data.get('pet')).toEqual(pet({ fullness: 74, mood: 72 }))
})

// 턴 완료 입력 — 출력 토큰과 서브에이전트 여부만 바꾼다
const turn = (outputTokens: number | undefined, agentId?: string) => ({
  answer: '',
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer' as const,
  agentId,
  usage: outputTokens === undefined
    ? undefined
    : { input_tokens: 0, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'test-model' },
})

const stubTurn = (on: On, toasts: string[] = []): void => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined } as never
  })
}

test('[갈래2-6] 메인 턴의 출력 토큰이 누적된다', async ($, on) => {
  stubTurn(on)
  mock.clock(on)
  const data = stubStore(on, { pet: pet({ tokens: 100 }) })

  await $.turn.complete(turn(250))

  expect(data.get('pet')).toEqual(pet({ tokens: 350 }))
})

test('[갈래2-7] 서브에이전트 턴과 usage 없는 턴은 세지 않는다', async ($, on) => {
  stubTurn(on)
  mock.clock(on)
  const data = stubStore(on, { pet: pet({ tokens: 100 }) })

  await $.turn.complete(turn(5_000, 'agent-1'))
  await $.turn.complete(turn(undefined))

  expect((data.get('pet') as PetState).tokens).toBe(100)
})

test('[갈래2-8] 알이 부화하면 토스트가 한 번 뜬다', async ($, on) => {
  const toasts: string[] = []
  stubTurn(on, toasts)
  mock.clock(on)
  const data = stubStore(on, { pet: pet({ tokens: 19_000 }) })

  await $.turn.complete(turn(2_000))
  await $.turn.complete(turn(2_000))

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('부화')
  expect((data.get('pet') as PetState).stage).toBe('baby')
})

test('[갈래2-9] 성체로 자라면 토스트가 한 번 뜬다', async ($, on) => {
  const toasts: string[] = []
  stubTurn(on, toasts)
  mock.clock(on)
  stubStore(on, { pet: pet({ stage: 'baby', species: 'dragon', tokens: 299_000 }) })

  await $.turn.complete(turn(2_000))
  await $.turn.complete(turn(2_000))

  expect(toasts).toEqual(['드래곤이 성체로 자랐습니다!'])
})

// 띠 대역: 플러그인이 양보하면 엔진 자리표지 한 줄을 그린다(엔진은 null 응답을 구현 없음으로 읽는다)
const stubBand = (on: On): void => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return h(Text, {}, '엔진 기본')
  })
}

const SURFACES = ['terminal', 'desktop'] as const

const mountBand = ($: Parameters<Parameters<typeof test>[1]>[0], surface: (typeof SURFACES)[number], props: { hasSurvey?: boolean; isWorking?: boolean } = {}) =>
  $.ui.mount({
    plugin: 'terminal-pet',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: props.isWorking ?? false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  })

const CAT = pet({ stage: 'baby', species: 'cat', fullness: 100, mood: 100 })

test('[갈래2-10] 켜져 있으면 terminal·desktop 모두 펫 한 줄을 그린다', async ($, on) => {
  stubEngine(on)
  stubBand(on)
  mock.clock(on)
  stubStore(on, { pet: CAT })
  await $.session.start(START)

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)

    // Text 의 key 는 그려진 트리에 남지 않아 문구로 찾는다
    expect((await ui.find({ type: 'Text', text: /고양이\(새끼\)/ }))?.text).toContain('포만 █████')
    await ui.unmount()
  }
})

test('[갈래2-11] 응답 중이면 작업 표정을 그린다', async ($, on) => {
  stubEngine(on)
  stubBand(on)
  mock.clock(on)
  stubStore(on, { pet: CAT })
  await $.session.start(START)

  for (const surface of SURFACES) {
    const idle = await mountBand($, surface)
    const idleText = (await idle.find({ type: 'Text', text: /고양이/ }))?.text
    await idle.unmount()

    const busy = await mountBand($, surface, { isWorking: true })
    const busyText = (await busy.find({ type: 'Text', text: /고양이/ }))?.text
    await busy.unmount()

    expect(busyText).toBeDefined()
    expect(busyText).not.toBe(idleText)
  }
})

test('[갈래2-12] 설문이 띠를 차지하면 그리지 않는다', async ($, on) => {
  stubEngine(on)
  stubBand(on)
  mock.clock(on)
  stubStore(on, { pet: CAT })
  await $.session.start(START)

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, { hasSurvey: true })

    expect(await ui.find({ type: 'Text', text: /고양이/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('[갈래2-13] 표시를 끄면 그리지 않는다', async ($, on) => {
  stubEngine(on)
  stubBand(on)
  mock.clock(on)
  stubStore(on, { pet: CAT, isEnabled: false })
  await $.session.start(START)

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)

    expect(await ui.find({ type: 'Text', text: /고양이/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('[갈래2-13] 세션 상태가 비어 있어도 store 에 펫이 있으면 그린다', async ($, on) => {
  stubBand(on)
  mock.clock(on)
  stubStore(on, { pet: CAT })

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)

    expect(await ui.find({ type: 'Text', text: /고양이/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('[갈래2-14] 띠는 지금 시각까지의 감소를 반영해 그린다', async ($, on) => {
  stubBand(on)
  // 세션 시작을 거치지 않아 15분 타이머가 감소를 미리 저장하지 않는다 — 띠 자신의 감소 계산만 잰다
  mock.clock(on, { now: 2 * HOUR })
  // 70 → 2시간 뒤 62: 막대 5칸 중 4칸 → 3칸
  stubStore(on, { pet: pet({ stage: 'baby', species: 'cat' }) })

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)

    expect((await ui.find({ type: 'Text', text: /고양이/ }))?.text).toContain('포만 ███░░')
    await ui.unmount()
  }
})

test('[갈래2-15] 15분마다 감소를 저장한다', async ($, on) => {
  stubEngine(on)
  const clock = mock.clock(on)
  const data = stubStore(on, { pet: pet() })
  await $.session.start(START)

  await clock.advance(15 * 60_000)

  expect(data.get('pet')).toEqual(pet({ fullness: 69, updatedAt: 15 * 60_000 }))
})
