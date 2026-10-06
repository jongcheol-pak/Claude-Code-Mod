# Claude Code Mode

Claude Code 모드(함수 훅 플러그인) 모음이다. 저장소 루트의 `.claude-plugin/marketplace.json`이 모드 목록이고, 모드마다 하위 폴더 하나를 쓴다.

## 모드 목록

| 모드 | 설명 |
| --- | --- |
| [context-meter](./context-meter) | 상태 줄에 현재 세션의 컨텍스트 윈도우 사용량을 표시한다. `/context-meter [on\|off]`로 켜고 끈다(인자 없으면 전환, 설정은 세션 간 유지). |

## 설치

터미널의 Claude Code 프롬프트에서 실행한다.

```
/plugin install context-meter --marketplace jongcheol-pak/Claude-Code-Mode
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
