# 지헌 작업 인계 (받아쓰기 · 추론 서버)

2026-11-15 지헌 작성. 브랜치 `feature/sentence-jiheon` (GitHub에 push됨). **main에는 아직 합치지 않았다. 팀이 모여서 같이 합친다.**

이 파일 하나로 내 작업의 결과물이 어디에 있고, 어떻게 진행되어 왔는지 볼 수 있게 정리했다.

## 1. 한 줄 요약

한국어 문장을 넣으면 3D 수어 동작이 나오는 경로가 VM에서 끝까지 동작한다.

```
한국어 문장 → [번역기] 글로스 열 → [글로스 표 v2] 동작 단위 열 → [문장 GPT] 동작 토큰 → [VQ 디코더(재훈)] 좌표 [T,125,3]
```

| 부품 | 성능 |
|---|---|
| 번역기 v5n | 처음 보는 문장 F1 0.79 (정답끼리 일치도 0.85). 사람 판정 90%가 엉뚱한 단어 없이 옮겨짐 |
| 문장 GPT | 사람 동작과의 차이 0.179 (사람끼리 0.230, 단순 이어붙이기 0.220). 경계 튐 1.03 (이어붙이기 5.65) |
| 응답 시간 | 문장당 약 0.2~0.3초 (GPU) |

## 2. 먼저 읽을 문서

| 문서 | 내용 |
|---|---|
| `docs/handoff/first_prototype_collaborate.md` | 결과 자세히, 번역기 정확도 풀이, API 사용법(승혁 질문 답), 테스트 문장, 합치는 순서 |
| `docs/ai-log/jiheon.md` | 작업마다 목표, AI에게 맡긴 것, 바꾼 계획, 내가 판단한 것, 검증 숫자 (아래 4절 표의 자세한 판) |
| `ml/serve/README.md` "문장 경로와 검증 화면" | 추론 서버 문장 모드와 환경 변수 |
| `docs/contracts.md` ⑤ | `/generate` 응답 형식 (segments 메모 포함) |

## 3. 결과물 위치

### 코드 (GitHub `feature/sentence-jiheon`)

| 부품 | 폴더 |
|---|---|
| 번역기 (madi + 대체어 표) | `ml/gen/translate/` |
| 글로스 표 | `ml/gen/gloss_table.py` |
| 문장 GPT (학습 · 생성 · 평가) | `ml/gen/sentence_*.py`, `ml/gen/train_sentence_gpt.py` |
| 단어 GPT | `ml/gen/` (`infer.py`, `train_word.py` 등) |
| 추론 서버 (`/translate`, `/generate`, `/verify`) | `ml/serve/` |
| Spring 연결 (serve 모드, segments) | `backend/src/main/java/com/wow/signlanguage/generation/` |

### 모델 · 데이터 파일 (VM `sign-ml`, git에는 없음: AI Hub 파생물)

| 결과물 | VM 경로 |
|---|---|
| 문장 GPT 모델 (평가 결과 `eval_*.json` 포함) | `/data/work/jiheon/sent_gpt/runs/sent_gpt_v1/` |
| 문장 GPT 서비스 설정 (guidance 2) | `/data/work/jiheon/sent_gpt/runs/sent_gpt_v1_serve/` |
| 단어 GPT 모델 | `/data/work/jiheon/runs/word_gpt_d384_20261030/bundle_g2_s12x2/` |
| 번역기 (서비스용 v5n) | `/data/work/jiheon/translate/translator_v5n_service.json` |
| 글로스 표 v2 | `/data/work/jiheon/vocab/gloss_table_v2.json` |
| 서버에 올린 코드 | `/data/work/jiheon/code/sentence_20261114/ml/` (`VERSION` 파일에 커밋 번호) |
| Spring jar | `/data/work/jiheon/code/spring_462fcf6_20261114/sign-language-backend.jar` |
| 실행 스크립트 | `/data/work/jiheon/serve_vm_sentence/` (`start_sentence.sh`, `stop.sh`, `status.sh`) |
| 비교 뷰어 데이터 (실제 화자 vs 문장 GPT) | `/data/work/jiheon/review/` |

## 4. 작업은 어떻게 진행되었나

자세한 기록은 `docs/ai-log/jiheon.md`에 날짜별로 있다. 커밋 본문에도 무엇을 왜 바꿨는지 적었다.

| 날짜 | 한 일 | 커밋 |
|---|---|---|
| 10-24 ~ 10-29 | 생성 학습 · 추론 · 서비스 1차 통합, 단어 GPT 진단 · 3000단어 재학습, 정답과의 거리 채점 | e88f2a0, bbd948a, 8827840 등 |
| 11-02 | 단어 GPT를 VM 추론 서버 + Spring으로 운영 시작 (승혁 화면 확인) | – |
| 11-08 ~ 11-14 | 글로스 표 v2: 문장 구간 449 + 단어 3,000을 한 표로. 동음이의어는 직접 표시해 "눈" 하나만 | db0fbb9, 31c77c7 |
| 11-14 | 번역기 v1~v4: madi 사용, 여러 정답 F1, 사람 판정 50문장 | 9f2305d ~ 53a28f1 |
| 11-14 | 문장 GPT 학습 · 평가 (단어 사이 연결 동작까지 생성) | 2fc01c3 |
| 11-14 ~ 11-15 | 추론 서버 문장 모드, 검증 화면, Spring serve 모드, segments, VM 배포 | d578b9f ~ 42d5658 |
| 11-15 | 번역기 반복 버그 수정, LLM 다시 고르기 시험(효과 없어 접음), v5n 대체어 표 | a61f1da ~ 86e63eb |

작업 방식: Claude Code(하위 에이전트 포함)로 구현과 실험을 맡기고, 방향 결정 · 사람 판정 · 승인은 지헌이 했다. 각 결정은 AI 기록의 "내가 판단한 것" 칸에 있다.

## 5. 바로 확인하는 법

1. VM 전원은 지헌이 관리한다. 켜져 있는지 먼저 물어본다.
2. VM에 접속할 때 8080(앱 API)과 8000(검증 화면) 포트를 연결한다.
   ```
   gcloud compute ssh <내 계정>@sign-ml --project=project-bd08e20d-00af-4b04-81b --zone=asia-northeast3-b -- -L 8080:127.0.0.1:8080 -L 8000:127.0.0.1:8000
   ```
3. VM 안에서 켠다 (1~2분).
   ```
   bash /data/work/jiheon/serve_vm_sentence/start_sentence.sh
   ```
4. 브라우저에서 `http://localhost:8000/verify`를 열고 문장을 넣으면 번역된 글로스와 동작이 바로 나온다.
5. 앱 쪽은 `POST http://localhost:8080/api/sign/generate`에 `{"text": "저는 학교에 갑니다."}`를 보낸다.
6. 다 보면 끈다: `bash /data/work/jiheon/serve_vm_sentence/stop.sh`. 끈 뒤 지헌에게 알려 준다.

## 6. 다음에 같이 할 것

| 할 일 | 누가 |
|---|---|
| `feature/sentence-jiheon` → main PR 리뷰 (main과 충돌 없음은 미리 확인) | 팀 전체 |
| 화면을 문장 모드에 연결, `unknown` 표시, segments로 현재 단어 자막 | 승혁 (프론트는 재훈과 나눠서) |
| 읽는 모델 검증이 끝나면 문장 동작 채점 | 승현 |
