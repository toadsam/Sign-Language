# PR 초안: feature/sentence-ui-seunghyeok → main

> 2026-11-24 초안. 12/1 통합 3 전에 팀과 순서를 정해 올린다. 올릴 때 커밋 수 · 검사 결과를 다시 확인한다.
> 제목: `[MERGE] 승혁: 문장 입력 화면 · 따라 하기 채점 보정 · 평가 영상 도구 · 30fps 측정 -승혁`

## 요약

main(9c8a6bb, 11/17)보다 커밋 20여 개 앞서 있고(올릴 때 다시 센다), 뒤처진 커밋은 없다. 바뀐 파일은 모두 승혁 폴더(`frontendcodes/` · `viewer/seunghyeok/` · `docs/ai-log/seunghyeok.md`) 안에 있다.
계약 ①~⑤의 형식과 함수 모양은 바꾸지 않았다. `data/` · `runs/` · `*.npy` · `*.pt` · AI Hub 좌표는 없다.

## 무엇이 바뀌나

**화면**
- 생성 작업실을 문장 입력 기준으로 정리 (6d66992, 9f45c58)
- 통역 화면: AI 손짓을 못 받으면 배포판에서도 "1학기 수어 영상으로 보여 줘요"를 띄움. 예전에는 조용히 영상으로 넘어갔다 (626cacb, 설계서 IT-08)
- 평가 영상 일괄 녹화 화면 `/sign-batch-record` (d7c24cf)
- 재생 화면 `?fpsmark=1` 촬영 표지 (03b80d2, 주소에 없으면 안 보임)
- 재생 프레임 고르기를 고르게: `frame-pick.ts`의 pickFrame을 단일 · 비교 재생에 적용. 60Hz에서 16.7ms · 50ms로 들쭉날쭉 보이던 장(11/23 측정 약 5%)의 원인 수정 (설계서 IT-03)
- 작업실 화면 링크를 replace로: 떠난 재생 화면이 뒤에서 계속 돌던 것 정리. 통역 · 따라 하기의 카메라 · 애니메이션 정리도 브라우저로 확인 (설계서 UT-12)

**따라 하기 채점** (재훈 파일 `body-score.ts` · `FollowAlong.web.tsx` · `check-body-score.cjs` 수정, 재훈과 답장으로 맞춤)
- 손 자리 기준선 [0.201, 0.49], 자리 : 모양 = 9 : 1, 손가락 안내 끔(`SHAPE_HINT_ON = false`, 코드는 남김), 기록 종류 "손 모양만 다름" 추가 (e1e1948, 109c576, 55573a0, b41af0a)
- 근거: 승혁 웹캠 기록 20개. 잘 따라 함 79~95점, 다른 동작 0~38점, 65점 기준 오판 0%

**평가 도구** (`viewer/seunghyeok/evaluation/`)
- `export_motion_json.py`: 평가 npy → 비교 화면 JSON (7b50d52)
- `prepare_videos.py`: 녹화 영상 → 무작위 번호 묶음 + 조건표, 조건 선택, 출처 표기 (c45ab59, 1efa90f)
- `make_candidates.py`: 단어 열 후보 표, 클립 빼기 · 화자 순서 (6736f5a, 5faa28d)

**측정 · 문서**
- 30fps 슬로모션 측정 도구 `tools/fps-from-video.py` (03b80d2): 화면 갱신 29.98회/초, 빠진 프레임 0
- 시연 안내 `DEMO_GUIDE.md`, 최종 요약 초안 `FINAL_SUMMARY.md`
- 로그인 설정 검사를 새 로그인 화면에 맞춤 (3da2a78)

## 남의 파일을 고친 것

| 파일 | 원래 주인 | 바꾼 것 |
|---|---|---|
| `frontendcodes/components/sign-camera/body-score.ts` | 재훈 | 기준선 · 9:1 · 손가락 안내 스위치 |
| `frontendcodes/components/sign-camera/FollowAlong.web.tsx` | 재훈 | 기록 종류 "손 모양만 다름" 하나 추가 |
| `frontendcodes/tools/check-body-score.cjs` | 재훈 | 바뀐 기준에 맞춘 기대값 |
| `frontendcodes/app/translator.tsx` | 재훈 | 영상 대체 안내 함수를 `lib/motion-note.ts`로 옮김 |
| `frontendcodes/app/_layout.tsx` | 1학기 팀원 | 개발 중 로그인 없이 여는 목록에 `sign-batch-record` 추가 |

## 검사

- `frontendcodes/tools/check-*.cjs` 17개 통과 (`check-generation-api`는 가짜 서버를 띄워 따로 실행)
- `npx tsc --noEmit` 오류 0
- `viewer/seunghyeok/evaluation/test_*.py`: prepare 7 · export 5 · candidates 5 통과
- `frontendcodes/tools/check-fps-from-video.py` 6항목 통과

## 합칠 때 확인할 것

- 재훈의 `jjh-accuracy`(끼워 넣기)와 같은 파일을 건드리지 않는지. 이 브랜치는 `ml/`을 고치지 않았다.
- 합친 뒤 재배포해야 통역 화면 안내 수정이 배포 주소에 반영된다 (재훈).
- 스테이징만 된 `.vscode/settings.json` · `start.sh`는 이 PR에 넣지 않는다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
