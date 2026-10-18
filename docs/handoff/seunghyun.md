# 승현에게 — 읽는 모델 · 비교 실험에 쓰는 파일

> 2026-10-18 재훈. 서버 `/data/handoff/seunghyun/`에 같은 파일이 링크로 있다.

## 한눈에

| 파일 | 서버 위치 | 뭐에 쓰나 |
|---|---|---|
| `full/` | `/data/handoff/seunghyun/full` | **읽는 모델 학습 데이터.** 단어 48,000클립 (9GB) |
| `splits/full.json` 등 | `/data/handoff/seunghyun/splits/` | 학습 · 평가 사람 나누기 (전 모델 공통) |
| `b1/summary.json`, `rows.json` | `/data/handoff/seunghyun/b1/` | 기준선 B1 결과. 비교표의 B1 칸 |
| `model.pt` | `/data/handoff/seunghyun/model.pt` | 자모표 E5 디코더. 역번역(복원 동작 채점)용 |

## 1. `full/` — 단어 동작 데이터 (계약 ①)

```
full/
  npy/WORD0001_REAL01.npy   float32 [T, 125, 3]  정규화 좌표 (목 원점, 어깨너비 1, y 아래)
  npy/WORD0001_REAL01.json  클립 하나의 meta
  meta.jsonl                클립 하나에 한 줄 (48,000줄)
```

meta 한 줄에서 읽는 모델에 중요한 것:

| 필드 | 뜻 |
|---|---|
| `item` | 단어 번호 `WORD0001` ~ `WORD3000` = 분류 라벨 |
| `gloss` | 단어 이름 (예: `["운전면허"]`). 발표 · 표에 쓸 때 |
| `signer` | 수행자 `REAL01` ~ `REAL16` |
| `active` | 손이 움직이는 구간 `[시작, 끝]` 프레임. 대기 자세를 잘라낼 때. `recog/features.py`가 이미 쓴다 |
| `label` | `"ok"`면 라벨 정상. `"missing"`(61) · `"empty"`(10)은 뺄 것 |
| `dur_ratio` | 라벨 길이 / 프레임 길이. **0.85 ~ 1.5 밖이면 뺄 것** (약 3이면 10fps로 뽑혀 3배 빠른 클립) |
| `norm.scale` | 곱하면 미터. mm 오차를 낼 때 ×1000 |
| `check.repair` | 귀 · 눈 좌표를 다시 계산한 클립 표시(약 1.7만). 손 · 팔은 안 건드렸다 |

- 125점: 상체 13 (0 ~ 12) · 왼손 21 (13 ~ 33) · 오른손 21 (34 ~ 54) · 얼굴 70 (55 ~ 124). `common/skeleton.py`
- 읽기: `from common.data import load_data` → `load_data("/data/full")` → 각 줄에 `m["x"]` `[T, 375]`가 붙는다. 9GB가 메모리에 올라간다(서버 52GB라 됨). 일부만 볼 땐 `load_data(..., per_signer=300)`
- 얼굴 포함 여부는 `recog/train.py --with-face`. 자모표 실험에서는 얼굴을 넣으면 손이 나빠졌다(E2) — 읽는 모델에서는 다를 수 있으니 한 번 비교해 볼 가치가 있다

## 2. `splits/full.json` — 분할표 (계약 ①)

**학습 12명 / 검증 REAL04 · REAL11 / 평가 REAL03 · REAL12.** 제외 클립 1,855개(10fps, 순간 이상치, 라벨 없음)는 `exclude.clips`에 있고 `apply_split`이 자동으로 뺀다.

```python
from common.data import load_data, load_split, apply_split
metas = load_data("/data/full")
train, val, test = apply_split(metas, load_split("/data/full"))   # 34,574 / 5,664 / 5,907
```

**부탁:** `recog/train.py`가 지금은 `split_by_signer(metas, args.test_signers, args.seed)`로 그때그때 나눈다. `load_split`이 있으면 `apply_split`을 쓰게 바꿔 줘. 평가 사람이 자모표 · 받아쓰기와 같아야 비교표의 숫자가 맞는다. (`recog/backtranslate.py`는 이미 분할표를 읽는다.)

## 3. `b1/` — 기준선 B1 결과

B1 = 지금 서비스 방식(단어 클립 이어붙이기)을 좌표로 재현한 것. 평가 사람 5,907클립, 상체 + 손 55점.

`summary.json`:

```json
{"word": {"B1 저장 클립":      {"dtw_mm": {"mean": 52.7, "median": 50.4}, "size_ratio": {...}, "len_ratio": {...}},
          "자모표 복원 (상한)": {"dtw_mm": {"mean": 31.6, "median": 31.0}, ...}},
 "sentence": {"그대로 잇기 (1학기 방식)":        {"rest_dips": 2.08, "jerk": 383.6, "seconds": 12.21},
              "움직임만 잘라 8프레임 보간 (B0)": {"rest_dips": 2.06, "jerk": 441.1, "seconds": 8.59},
              "자른 구간 토큰 이어 복원":         {"rest_dips": 2.00, "jerk": 369.0, "seconds": 7.91}},
 "stored_signers": ["REAL01", ...], "test_clips": 5907}
```

| 값 | 뜻 |
|---|---|
| `B1 저장 클립` `dtw_mm` 52.7 | 같은 단어를 **다른 사람(REAL01)**이 한 클립과 평가 사람 동작의 DTW 거리. "사람 사이 차이"의 기준값이지 틀렸다는 뜻이 아님 |
| `자모표 복원 (상한)` 31.6 | 평가 사람 동작을 토큰으로 바꿨다 되돌린 것. 토큰 방식이 낼 수 있는 상한 |
| `size_ratio` | 손목 이동 거리 / 정답. 1에 가까울수록 뭉개지지 않음 |
| `rest_dips` | 단어 3개를 이었을 때 중간에 손이 대기 자세로 내려간 횟수. **세 방식 모두 약 2회** → 전환은 이어붙이기로 해결 안 됨 |
| `jerk` | 손목 가속도 변화량. 클수록 튄다 |

- `rows.json`: 클립별 · 조합별 원자료 (단어 5,907 × 2, 문장 400 × 3)
- 만든 스크립트 `ml/vq/baseline_b1.py`. 지헌의 생성 결과가 나오면 **같은 잣대(DTW, 55점, 평가 사람)**로 재서 비교표에 넣으면 된다. 지표 함수는 `common/metrics.py`
- 문장 데이터가 없을 때 만든 거라 "단어 3개 잇기"는 같은 사람의 단어 클립을 무작위로 이은 것. 진짜 문장 평가는 아래 새 조합 문장으로

## 4. 평가 문장 50개 — 이미 떼어 놓았다

역할표에서 네 몫(~11/14)이었는데 문장 데이터를 정리하면서 먼저 만들었다. `splits/full_sen.json`의 `heldout_sentences`.

- **새 단어 열 50개** (`sequences`, 문장 번호 `items` 71개): 단어는 모두 학습에 2번 이상 나오지만, 그 순서로 된 문장은 학습에 없다. 같은 단어를 순서만 바꾼 열도 학습에 없다. 2 ~ 6단어
- **새 "단어 + 의문" 5개** (`question_items`): 평서문은 학습에 남기고 의문문만 뗀 것. 의문 표정(비수지)을 처음 보는 단어에 붙이는지
- 평가 클립: 평가 사람의 150개 (의문 10)
- 만든 스크립트 `ml/prep/holdout_sentences.py`. 기준이 마음에 안 들면 바꿔서 다시 만들 수 있다 (`--force`, 단 지헌이 학습 시작하기 전에)

**확인 부탁:** 이 기준이면 되는지. 되면 지헌에게 "이 클립은 학습에서 빼라"고 내가 이미 전했다.

## 5. `model.pt` — 자모표 E5 디코더

역번역(자모표로 복원한 동작을 읽는 모델에 넣어 원래 단어가 나오는지)에 쓴다. `recog/backtranslate.py --vq /data/runs/vq_e5 --recog <네 run> --data /data/full`. 상체 + 손만 만들고 얼굴은 평균 얼굴이니 `--with-face` 모델로 채점하면 불리하다.

## 자모표 쪽 숫자 (비교표 작성 참고)

평가 사람 REAL03 · REAL12, 손 오차 mm (낮을수록 좋음):

| 자모표 | 단어 | 문장 | 코드 사용 |
|---|---|---|---|
| E4b 단어로만 학습 | 27.1 | 37.3 | 100% |
| **E5 단어 + 문장 (v1 후보)** | 28.4 | 28.1 | 100% |

전체 표는 `ml/experiments.md`.
