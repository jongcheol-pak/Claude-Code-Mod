# Intent: context-meter 0.2.0 — 정확도 개선과 표시 확장
Author: jongcheol-pak. Status: approved.

## Problem
원문 요청: "context-meter에 적용및 개선할 기능이 있을까?" → 제안 목록(①압축까지 남은 양 ②/compact·/clear 직후 갱신 ③표기 정리 ④80·90% 토스트 ⑤N% 자동 압축 ⑥증가량·남은 턴 ⑦비용·플랜 한도 ⑧/context-meter detail 패널 ⑨userConfig 옵션화, 권장 순서 1:①②③④ → 2:⑥⑦⑨ → 3:⑧⑤)에 대해 "권장 순서대로 적용해줘". 인터뷰 답 — 코드 구조: 「계층 분리」 · % 기준: 「압축 임계치 기준」 · 기본 켬 항목: 「증가량·남은 턴」만. 지금 상태 줄 %는 모델 윈도우 기준이라 실제 자동 압축 시점과 어긋나고, /compact·/clear 직후 값이 낡을 수 있으며, 커뮤니티 mod(token-ledger·quota-meter·cctop)가 주는 경고·비용·내역 기능이 없다.

## Proposed outcome
상태 줄 %·막대·임계치 경고가 자동 압축 임계치 기준(꺼져 있으면 모델 윈도우)으로 표시되고 `200k`처럼 짧게 표기되며 압축·clear 직후 갱신된다. 80%·90% 도달 시 토스트가 뜬다. 증가량·남은 턴(기본 켬)·비용·플랜 한도(기본 끔)를 userConfig로 켜고 끌 수 있다. `/context-meter detail`이 카테고리별 내역 패널을 열고, 설정 시 N%(기본 90)에서 자동 압축한다(기본 끔).

## Affected users and systems
본인과 GitHub 마켓플레이스(jongcheol-pak/Claude-Code-Mod)로 설치하는 사용자. `context-meter/` 모드의 훅 모듈·매니페스트·테스트, 레포 README.

## Constraints
계층 분리 — 엔진 무의존 계산·표기(`hooks/meter.ts`) ← 훅·그리기(`hooks/register.ts`) 단방향. 패널 트리는 `$` 를 받지 않는 별도 순수 파일(`hooks/detail-pane.tsx`)에 둘 수 있다(`register.ts` 파일명 유지). 기존 `/context-meter on|off` 동작 유지. 자동 압축은 기본 꺼짐.

## Open questions
없음
