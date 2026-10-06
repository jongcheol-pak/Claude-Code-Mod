// /context-meter detail 패널의 트리 — 엔진을 받지 않고 요소 테이블과 행만 받는다
import type { Elements } from 'claude-code'

import type { DetailRow } from './meter.ts'

export type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text'>

const NAME_WIDTH = 28
const TOKENS_WIDTH = 7

// 이름 · 토큰 · % 를 고정 폭으로 맞춘 한 줄
const formatRow = (row: DetailRow): string =>
  `${row.name.padEnd(NAME_WIDTH)} ${row.tokens.padStart(TOKENS_WIDTH)}${row.percent === undefined ? '' : `  ${row.percent}`}`

export const renderDetailPane = (elements: PaneElements, header: string, rows: readonly DetailRow[]) => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      <Text key="header" bold>{header}</Text>
      {rows.map(row => (
        <Text key={row.name} dimColor={row.percent === undefined}>{formatRow(row)}</Text>
      ))}
    </Box>
  )
}
