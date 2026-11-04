# Claude Code Mod

Claude Code 모드(함수 훅 플러그인) 모음이다. 저장소 루트의 `.claude-plugin/marketplace.json`이 모드 목록이고, 모드마다 하위 폴더 하나를 쓴다.

## 모드 목록

| 모드 | 설명 |
| --- | --- |
| [context-meter](./context-meter) | 상태 줄에 사용 중인 모델, effort, 컨텍스트 사용량을 한 줄로 표시한다(예: `Opus 5.5 · effort high · 컨텍스트 ████░░░░░░ 42% · 84k/200k`). 사용량은 자동 압축 임계치 기준(꺼져 있으면 모델 윈도우)이고, effort는 첫 응답 전에 `–`로 보인다. 명령과 설정 항목은 없다. |

## 설치

터미널의 Claude Code 프롬프트에서 실행한다.

```
/plugin install context-meter --marketplace jongcheol-pak/Claude-Code-Mod
```

마켓플레이스 추가 질문에 `y`, 설치 범위를 고르면 바로 활성화된다.

## 개발

모드 폴더를 직접 로드해 실행한다.

```
claude --plugin-dir ./context-meter
```

검증·테스트:

```
claude plugin validate ./context-meter
claude plugin test ./context-meter
```

새 모드를 추가하면 하위 폴더를 만들고 `.claude-plugin/marketplace.json`의 `plugins`와 위 모드 목록에 한 줄씩 추가한다.
