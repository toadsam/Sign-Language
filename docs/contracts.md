# 모델 사이 계약 (초안)

> 2026-10-11 초안. ①②는 지금 코드 그대로라 확정 가능하고, ③④⑤는 역할 분담 페이지의 제안을 옮긴 것이다. 첫 회의에서 확정한다.
> **이 파일의 형식 · 함수 모양을 바꾸려면 네 명 모두 승인한다.** 계약이 흔들리면 각자 따로 개발하다 합치는 방식이 깨진다.

| 계약 | 주는 사람 → 받는 사람 | 위치 | 상태 | 가짜 버전 |
|---|---|---|---|---|
| ① 동작 데이터 + 분할표 | 재훈 → 전원 | `ml/common/data.py`, `ml/splits/` | 코드 있음 | `data/sample`, `ml/splits/sample.json` |
| ② 토큰 + 디코더 | 재훈 → 지헌 | `ml/gen/tokenize.py`, `ml/vq/model.py` | 코드 있음 | `data/sample/tokens.json` |
| ③ 생성 함수 | 지헌 → 승현, 추론 서버 | `ml/gen/infer.py` | 제안 | B1 이어붙이기 |
| ④ 채점 함수 | 승현 → 재훈, 지헌 | `ml/recog/infer.py` | 제안 | `runs/recog_sample` |
| ⑤ API 응답 JSON | 지헌 → 승혁 | `ml/serve/`, `backend/` | 제안 | `viewer/samples/*.json` |

---

## ① 동작 데이터 + 분할표 (재훈)

### 동작 데이터

```
data/<세트>/                       정식 데이터는 노트북 C:/aihub/full (OneDrive 밖)
  npy/<clip>.npy     float32, 파일에는 [T, 125, 3]으로 저장. load_data가 [T, 375]로 펴서 준다
  npy/<clip>.json    클립 하나의 meta (meta.jsonl은 이것들을 모은 것)
  meta.jsonl         클립 하나에 한 줄
  sentences.jsonl    문장(SEN) 클립이 있을 때만: {"clip", "gloss", "nonmanual"}
```

```json
{"clip": "WORD1501_REAL01", "item": "WORD1501", "signer": "REAL01", "view": "F", "type": "WORD",
 "frames": 139, "active": [40, 112], "missing": 0.0,
 "norm": {"origin": [-0.00224, -0.10967, 2.3993], "yaw": -0.02343, "scale": 0.32641},
 "check": {"wrist_gap_cm": [0.91, 1.47], "bone_cv": [0.1362, 0.0], "src_unit": "m"},
 "label": "ok", "gloss": ["운전면허"],
 "segments": [{"name": "운전면허", "start": 1.675, "end": 3.9, "f0": 50, "f1": 117, "nonmanual": []}],
 "question": false, "dur_ratio": 1.0}
```

2026-10-14 추가된 필드 (기존 필드는 그대로, **팀 확인 필요**)
- `check.src_unit`: 원본 3D 단위. 정식 데이터의 약 27%가 `"mm"`이라 변환할 때 미터로 맞췄다
- `check.repair`: 귀·눈(9–12)을 다시 계산한 클립에만 있다(약 1.7만 클립, 주로 왼쪽 귀). 방법별 프레임 수 기록
- `label` `"ok"`·`"empty"`·`"missing"`, `gloss` 형태소 목록, `segments` 구간(초와 30fps 프레임 `f0`~`f1`), `question` 의문형 여부
- `dur_ratio`: 라벨의 영상 길이 / (프레임 수 / 30). 정상 1.0. **약 3이면 키포인트가 10fps로 뽑힌 클립**(동작이 3배 빠르게 보이고 `f0`·`f1`도 어긋남)
- **라벨이 필요한 모델**(받아쓰기 · 읽는 모델)은 `label == "ok"`이고 `0.85 ≤ dur_ratio < 1.5`인 클립만 쓴다

- 관절 125점: 상체 13 (0–12) · 왼손 21 (13–33) · 오른손 21 (34–54) · 얼굴 70 (55–124). 정의는 `ml/common/skeleton.py`
- 좌표: 원점 목, 어깨선이 x축과 평행, 어깨너비 = 1. x 오른쪽, y 아래, z 카메라에서 멀어지는 방향. `norm.scale`을 곱하면 미터
- `active`: 손이 움직이는 구간 [시작, 끝] 프레임. 단어 클립은 손 내린 자세로 시작하고 끝난다
- 읽기: `from common.data import load_data` → `load_data("data/full")`이 meta 각 줄에 `m["x"]`(`[T, 375]`)를 붙여 준다
- `data/`는 AI Hub 약관 때문에 커밋하지 않는다. 데이터를 다루는 사람은 각자 이용 신청을 한다

### 고정 분할표

모든 모델이 **같은 test 수행자**로 평가해야 비교표의 숫자가 맞는다. 분할은 한 번만 정해 파일로 커밋한다.

```
ml/splits/<데이터 폴더 이름>.json     예) data/full → ml/splits/full.json
```

```json
{"name": "full", "created": "2026-10-17", "seed": 0, "clips": 107000, "mode": "signer",
 "signers": {"train": ["REAL01", "..."], "val": ["..."], "test": ["..."]},
 "counts": {"train": 0, "val": 0, "test": 0}, "test_items_unseen": []}
```

- 만들기: `python -m prep.make_split --data data/full --val-signers 2 --test-signers 2` (재훈이 한 번만. 정식 WORD 표현자가 17명이라 13 / 2 / 2명)
- 쓰기:

```python
from common.data import load_data, load_split, apply_split
metas = load_data("data/full")
train, val, test = apply_split(metas, load_split("data/full"))
```

- `exclude.clips`: 품질 점검에서 학습 보류된 클립. `apply_split`이 자동으로 빼므로 따로 거를 필요가 없다. 기준은 `exclude.note`와 `ml/prep/quality_policy.md`
- `mode: "item"`은 수행자가 1명뿐인 샘플용이다(마지막 4단어가 test). 정식 데이터는 `"signer"`
- `val`은 설정을 고르는 데만 쓰고, 최종 숫자는 `test`로 낸다
- 이미 있는 분할표는 덮어쓰지 않는다(`--force` 없이는 거부). 바꿔야 하면 팀에 먼저 알린다

## ② 토큰 + 디코더 (재훈)

```json
{"vq": "runs/vq_v1", "vq_version": "v1", "nb_code": 512, "down": 4,
 "clips": {"WORD1501_REAL01": {"item": "WORD1501", "signer": "REAL01", "type": "WORD",
                               "frames": [36, 116], "tokens": [90, 0, 20, 96]}}}
```

```python
from vq.model import load_vqvae
vq, cfg = load_vqvae("runs/vq_v1/model.pt")
idx = vq.encode(x)        # x [B, T, 375] (T는 4의 배수) → [B, T/4]
motion = vq.decode(idx)   # [B, T'] → [B, T'×4, 375]
```

- 만들기: `python -m gen.tokenize --vq runs/vq_v1 --data data/full --out data/full/tokens.json`
- 단어 클립은 움직임 구간(앞뒤 4프레임 여유)만, 문장 클립은 전체를 토큰으로 바꾼다
- 입출력은 항상 375차원이다. 상체+손만 학습한 자모표(`parts=body_hand`, Ours-H)도 얼굴을 평균 얼굴로 채워 375로 돌려준다
- 받아쓰기 모델은 토큰 개수를 코드에 박지 않고 `nb_code`를 읽는다
- `vq_version`이 다른 토큰과 디코더를 섞지 않는다. 받아쓰기 체크포인트에 학습한 버전을 기록한다

### 자모표 버전과 동결일

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0 | 지금 | 샘플 자모표 128개, 20단어. 코드 개발용 |
| v0.x | 10/20 ~ 11/7 | 정식 데이터 실험 중간 결과. 수시로 전달 |
| **v1** | **11/7** | 관문 통과 설정. 이후 바꾸지 않는다 |
| v2 | 11/21까지만 | 꼭 필요할 때만 (예: 얼굴 포함 Ours-HF용) |

자모표가 바뀌면 받아쓰기는 명령 두 줄(토큰 변환 → 재학습)만 다시 돌린다.

## ③ 생성 함수 (지헌, 제안)

```python
class Generator:
    def __init__(self, run_dir: str, device: str = "cpu"): ...
    def generate(self, gloss: list[str], nonmanual: list[str] = (), seed: int | None = None) -> dict:
        """{"fps": 30, "motion": np.ndarray float32 [T, 125, 3],  # ①과 같은 정규화 좌표
            "tokens": list[int], "unknown": list[str], "source": "model" | "baseline"}"""
```

- 가짜 버전: `gen/baselines.py`의 `trimmed()`로 단어 클립을 이어 붙인다(`source: "baseline"`)
- 진짜로 바꿀 때는 `run_dir`만 바뀐다

## ④ 채점 함수 (승현, 제안)

```python
class Recognizer:
    def __init__(self, run_dir: str, device: str = "cpu"): ...
    def score(self, motion: np.ndarray, active: tuple[int, int] | None = None) -> dict:
        """motion: [T, 375] 또는 [T, 125, 3] (① 좌표)
        → {"top5": [("WORD1501", 0.82), ...], "probs": np.ndarray}"""
```

- 실제 사람 동작으로만 학습한다. 생성 결과로 학습하지 않는다

## ⑤ API 응답 JSON (지헌 → 승혁, 제안)

```
POST /generate   {"gloss": ["화장실", "있다"], "nonmanual": ["의문"]}
→ {"fps": 30, "joints": 125, "frames": 96, "units": "shoulder",
   "data": "base64(float32 little-endian [96×125×3])",
   "tokens": [47, 203], "segments": [{"gloss": "화장실", "start": 0, "end": 44}],
   "unknown": [], "source": "model"}            // "model" | "baseline" | "video"
```

- `units: "shoulder"`: 어깨너비 = 1, 원점 목, y 아래. 미터로 줄지는 회의에서 정한다
- 추론 서버가 죽으면 Spring이 `source: "video"`와 1학기 영상 재생 목록을 돌려준다

---

## 분할표 적용 요청

①의 고정 분할표가 생겼으니 각자 폴더에서 아래를 맞춰 주세요. 재훈의 자모표(`vq/train.py`)와 이를 쓰는 `vq/render_figures.py`, `recog/backtranslate.py`는 이미 분할표를 읽는다.

- **승현** `ml/recog/train.py`: 지금은 `split_by_signer(metas, args.test_signers, args.seed)`로 그때그때 나눈다. `load_split(args.data)`가 있으면 `apply_split`을 쓰도록 바꿔 주세요. 그래야 읽는 모델의 test 수행자가 자모표와 같다.
- **지헌** `ml/gen/train_word.py`: 지금은 모든 클립으로 학습한다. 정식 데이터에서는 `tokens.json`의 클립 중 분할표의 `train` 수행자만 학습에 쓰고, `test` 수행자는 평가용으로 남겨 주세요.
