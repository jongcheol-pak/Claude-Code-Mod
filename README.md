# Claude Code Mode

Claude Code 모드(함수 훅 플러그인) 모음이다. 저장소 루트의 `.claude-plugin/marketplace.json`이 모드 목록이고, 모드마다 하위 폴더 하나를 쓴다.

## 모드 목록

| 모드 | 설명 |
| --- | --- |
| [context-meter](./context-meter) | 상태 줄에 컨텍스트 사용량을 자동 압축 임계치 기준(꺼져 있으면 모델 윈도우)으로 표시하고, 80%·90% 도달 시 토스트로 알린다. `/context-meter [on\|off]`로 켜고 끄며(인자 없으면 전환, 세션 간 유지) `/context-meter detail`로 카테고리별 내역 패널을 연다. 설정(`/config`): 증가량·남은 턴(기본 켬), 비용·플랜 한도(기본 끔), N% 자동 압축(기본 끔, N=90 — `/context-meter off` 상태에서는 동작하지 않음). |

## 설치

터미널의 Claude Code 프롬프트에서 실행한다.

```
/plugin install context-meter --marketplace jongcheol-pak/Claude-Code-Mod
```

마켓플레이스 추가 질문에 `y`, 설치 범위를 고르면 바로 활성화된다. 설정 항목(userConfig)이 있는 모드는 그 사이에 옵션 설정 화면이 이어질 수 있다.

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
