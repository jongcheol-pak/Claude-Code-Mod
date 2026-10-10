# Intent: terminal-pet 모드 — 입력창 위 ASCII 펫
Author: jongcheol-pak. Status: approved.

## Problem
원문 요청: "재미있는 모드는 없을까?" → 제안 목록 중 "터미널 펫 만들어줘". 인터뷰 답 — 방치 시: 「감소만, 죽음 없음」 · 펫 종류: 「알에서 무작위 3종」 · 후보 라운드: 작업 중 표정 포함, VS Code·모바일 상태 줄 표시 제외. 마켓플레이스에 실용 모드(context-meter)만 있어 재미 목적의 두 번째 모드를 더한다.

## Proposed outcome
새 모드 `terminal-pet` 이 입력창 위 띠에 ASCII 펫 한 줄(얼굴·이름·단계·포만감·기분)을 그린다. 알에서 시작해 누적 토큰으로 고양이·강아지·드래곤 중 하나가 무작위로 부화하고 새끼 → 성체로 진화하며 진화 때 토스트가 뜬다. 도구 호출 성공은 포만감·기분을 올리고 실패는 기분을 내린다. 실제 시간이 지나면 포만감이 줄어 0이면 배고픈 표정이 되지만 죽지 않는다. Claude 가 응답 중이면 작업 표정을 짓는다. `/pet` 은 상태를, `/pet on|off` 는 띠 표시를 바꾸며 상태는 세션 간 유지된다. `claude plugin validate`·`claude plugin test` 가 통과하고 marketplace.json·README 에 모드가 1줄씩 추가된다.

## Affected users and systems
GitHub 마켓플레이스(jongcheol-pak/Claude-Code-Mod)로 설치하는 Claude Code 사용자. 신규 `terminal-pet/` 모드, 루트 `.claude-plugin/marketplace.json`, `README.md`.

## Constraints
계층 분리 — 엔진 무의존 계산·표기(`hooks/pet.ts`) ← 훅·그리기(`hooks/register.tsx`) 단방향. UTF-8·LF·한글 주석·`tests/*.test.ts`. 플러그인 이름은 `claude-` 로 시작하지 않는다. 펫 상태는 `$.store` 로 세션 간 유지하고, 현재 시각·무작위 값은 바깥에서 넣을 수 있게 한다.

## Open questions
없음
