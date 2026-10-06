import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

const BAR_WIDTH = 10

// 토큰 수를 1.2k / 1.0M 형태로 줄인다
const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
    : `${n}`

// 상태 줄 한 줄: 막대 · 퍼센트 · 사용/전체
export const formatContext = (context: SessionContextUsage): string => {
  const window = formatTokens(context.window)

  if (context.tokens === undefined) {
    return `컨텍스트 –/${window}`
  }

  const percent = context.percent ?? Math.round((context.tokens / context.window) * 100)
  const filled = Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH))
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)

  return `컨텍스트 ${bar} ${percent}% · ${formatTokens(context.tokens)}/${window}`
}

const COMMAND = 'context-meter'
const ENABLED_KEY = 'isEnabled'
const USAGE = `사용법: /${COMMAND} [on|off] — 인자 없이 실행하면 켜고 끄기를 전환한다`

// 켜짐/꺼짐은 세션을 넘어 유지된다 — 한 번도 끈 적 없으면 켜짐
const isEnabled = async ($: EngineInterface): Promise<boolean> =>
  (await $.store.get(ENABLED_KEY)) !== false

const showCurrent = async ($: EngineInterface): Promise<void> => {
  const { context } = await $.session.usage()
  $.ui.status(formatContext(context))
}

export const register: Register = on => {
  // 세션 시작(재로드 포함) 시 명령을 등록하고, 켜져 있으면 현재 값으로 한 번 그린다
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '상태 줄의 컨텍스트 사용량 표시를 켜거나 끈다',
      argumentHint: '[on|off]',
    })

    if (await isEnabled($)) {
      await showCurrent($)
    }

    return next(e)
  })

  // 턴마다 엔진이 측정값을 밀어 준다 — 켜져 있고 컨텍스트가 바뀐 경우만 갱신
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && (await isEnabled($))) {
      $.ui.status(formatContext(e.context))
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: USAGE }
    }

    const shouldEnable = arg === '' ? !(await isEnabled($)) : arg === 'on'
    await $.store.set(ENABLED_KEY, shouldEnable)

    if (shouldEnable) {
      await showCurrent($)
    } else {
      $.ui.status(undefined)
    }

    return { text: `컨텍스트 사용량 표시: ${shouldEnable ? '켜짐' : '꺼짐'}` }
  })
}
