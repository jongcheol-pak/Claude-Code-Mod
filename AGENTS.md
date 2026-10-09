# AGENTS.md — Agent Guide

## 위키
- **프로젝트 페이지**: `20_projects/personal/claude-code-mod.md` (LLM WIKI vault)
- 프로젝트 성격·기술 스택·디렉터리 구조·**아키텍처 상세**·기능 목록은 **위키가 정본**이다.
  이 파일에 중복 기재하지 않는다 (단 `## Conventions`의 **아키텍처 선언 1줄**은 여기 남는다).

## Build & Test
- **Build**: 없음 (Claude Code가 .ts를 직접 로드)
- **Test**: `claude plugin test ./<모드>` · **Validate**: `claude plugin validate .` (마켓플레이스) · `claude plugin validate ./<모드>`
- **Run (개발)**: `claude --plugin-dir ./<모드>`
- **Release**: `<모드>/.claude-plugin/plugin.json`의 `version`을 올린 뒤 push — 설치본은 버전 단위로 캐시되므로 버전을 올리지 않으면 갱신되지 않음
> ⚠️ Build/Test가 비면 `pjc:implement`의 검증이 무의미해진다.

## 데이터 접근
- **DB/스토어**: 없음 (모드 상태는 엔진의 `$.store`·`$.state`)

## 산출물·파일 관리
- **런타임 생성물**: `<모드>/.claude-plugin/types/`, `<모드>/tsconfig.json` (엔진 생성, gitignore)

## Conventions
- **아키텍처**: 모드마다 `hooks/<도메인>.ts`(엔진 무의존 계산·표기, 순수 함수) ← `hooks/register.ts`(훅·`$` 호출·그리기) 단방향
- **인코딩** UTF-8(BOM 없음) / **줄바꿈** LF / **주석 언어** 한글 / **테스트 위치** `<모드>/tests/*.test.ts`
- **새 모드**: 하위 폴더 + `.claude-plugin/marketplace.json` `plugins`·README 모드 목록에 1줄씩

## DO NOT
- 실제 IP·계정·비밀번호·토큰을 코드·문서·plan에 기록 (환경변수 이름만)
- `.env*`·secrets 커밋
- 플러그인 `name`을 `claude-`로 시작 (validate 실패)
