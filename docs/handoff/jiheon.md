# 지헌에게 — 받아쓰기(생성 모델)에 쓰는 파일

> 2026-10-18 재훈. 서버 `/data/handoff/jiheon/`에 같은 파일이 링크로 있다. 자세한 점검표는 `jaehun-to-jiheon-e5.md`.
> 묻고 싶은 게 있으면 단톡에.

## 한눈에

| 파일 | 서버 위치 | 크기 | 뭐에 쓰나 |
|---|---|---|---|
| `tokens_e5.json` | `/data/handoff/jiheon/tokens_e5.json` | 20MB | **학습 데이터.** 클립 80,000개의 토큰 열 |
| `model.pt` | `/data/handoff/jiheon/model.pt` | 16.5MB | **디코더.** 생성한 토큰 열 → 3D 동작 |
| `sentences.jsonl` | `/data/handoff/jiheon/sentences.jsonl` | 2.9MB | 문장 받아쓰기 입력 (형태소 열 + 비수지) |
| `splits/` | `/data/handoff/jiheon/splits/` | – | 학습 · 평가 나누기, 제외 클립, 평가용 새 조합 문장 |
| `full/`, `full_sen/` | `/data/handoff/jiheon/full`, `full_sen` | 9GB + 8.5GB | 동작 원본(npy)과 meta. 토큰만으로 단어 모델은 되므로 **당장은 안 봐도 됨** |

단어 모델은 `tokens_e5.json` + `splits/full.json`만 있으면 시작할 수 있다.
문장 모델은 거기에 `sentences.jsonl` + `splits/full_sen.json`.

## 1. `tokens_e5.json` — 토큰 파일 (계약 ②)

자모표 **E5**(단어 + 문장으로 학습, 상체 + 손 55점, 512개, 20만 회)로 모든 클립을 토큰으로 바꾼 것.

```json
{"vq": "runs/vq_e5", "vq_version": "v0.3-e5", "nb_code": 512, "down": 4,
 "clips": {
   "WORD0001_REAL01": {"item": "WORD0001", "signer": "REAL01", "type": "WORD",
                       "frames": [38, 122], "tokens": [465, 278, 243, ...]},
   "SEN0001_REAL01":  {"item": "SEN0001", "signer": "REAL01", "type": "SEN",
                       "frames": [0, 176],  "tokens": [...]}}}
```

| 필드 | 뜻 |
|---|---|
| `nb_code` | 토큰 종류 수 = 512. **코드에 512를 박지 말고 이 값을 읽을 것** |
| `down` | 토큰 1개 = 4프레임(0.13초). 토큰 수 × 4 = 동작 프레임 수 |
| `vq_version` | 자모표 버전. 디코더(`model.pt`)와 같은 버전끼리만 쓴다. 체크포인트에 이 값을 같이 저장할 것 |
| `frames` | 토큰으로 바꾼 프레임 구간 `[시작, 끝)`. **단어**는 움직임 구간(`active`) 앞뒤 4프레임 여유만, **문장**은 클립 전체 |
| `tokens` | 0 ~ 511. 끝 토큰은 없다 (모델에서 따로 둘 것) |

- 클립 수: WORD 48,000 (3,000단어 × 16명) · SEN 32,000 (2,000문장 × 16명)
- 토큰 길이: 단어 3 ~ 46개(평균 20), 문장 16 ~ 85개(평균 44)
- **80,000개가 모두 학습용은 아니다.** 아래 분할표대로 걸러서 쓴다
- 전에 준 `tokens_e4b.json`(단어로만 배운 자모표)은 **버린다.** 문장 손 오차가 37mm → 28mm로 좋아진 E5가 v1 후보
- 11/7 v1이 확정되면 `gen.tokenize` 한 번 + 재학습 한 번만 다시 하면 된다. 그때 `vq_version`이 `v1`로 바뀐다

## 2. `model.pt` — 디코더 (계약 ②)

```python
import torch
from vq.model import load_vqvae                       # /data/code/ml 에서

vq, cfg = load_vqvae("/data/handoff/jiheon/model.pt")   # cfg["nb_code"] == 512, cfg["parts"] == "body_hand"
idx = torch.tensor([[465, 278, 243, 120]])              # [배치, 토큰 수]
motion = vq.decode(idx)                                  # [배치, 토큰 수 × 4, 375]  = [1, 16, 375]
motion = motion[0].view(-1, 125, 3)                      # [T, 125, 3]  계약 ①과 같은 정규화 좌표
```

- 출력은 항상 375차원(125점 × 3). 이 자모표는 **상체 + 손 55점만 만들고 얼굴 70점은 학습 데이터의 평균 얼굴**로 채운다. 얼굴이 안 움직이는 건 정상
- 좌표는 목이 원점, 어깨너비 = 1, y 아래. 미터로 바꾸려면 meta의 `norm.scale`을 곱한다(생성 결과는 평균값 약 0.32 사용)
- 같은 폴더의 `config.json`은 학습 설정 기록. 안 봐도 됨

## 3. `sentences.jsonl` — 문장 라벨

한 줄에 문장 클립 하나. 라벨이 정상(`label == "ok"`)인 31,986개만 있다.

```json
{"clip": "SEN0557_REAL03", "gloss": ["교회", "확인", "맞다"], "nonmanual": []}
{"clip": "SEN0004_REAL01", "gloss": ["오른쪽"], "nonmanual": ["의문"]}
```

- `gloss`: 수어 형태소 열(시간순). 449종, 문장당 평균 3.2개(최대 7)
- `nonmanual`: 비수지. AI Hub 라벨에는 **`"의문"`만 있다**(968문장, 약 3%). 부정 등은 없다
- 한국어 원문은 AI Hub에 없다. 어순 변환기 출력과 맞추는 어휘 연결표(`vocab_map`)는 네 몫
- 같은 문장 번호인데 수행자마다 gloss가 조금 다른 경우가 545문장 있다(예: `운전 천천히` vs `운전 느리다`). 클립의 gloss를 그대로 쓰면 된다
- 형태소별 시작 · 끝 프레임이 필요하면 `full_sen/meta.jsonl`의 `segments[].f0 · f1`

## 4. `splits/` — 분할표 (계약 ①)

세 파일 모두 **학습 12명 / 검증 REAL04 · REAL11 / 평가 REAL03 · REAL12**로 같다. 모든 모델이 같은 평가 사람을 써야 비교표가 맞는다.

| 파일 | 대상 | 제외 클립 |
|---|---|---|
| `full.json` | 단어 48,000 | 1,855 (10fps 985, 순간 이상치 883 등) |
| `full_sen.json` | 문장 32,000 | 153 |
| `full_all.json` | 둘 다 | 2,008 |

쓰는 법 (토큰 파일 기준):

```python
import json
sp = json.load(open("/data/handoff/jiheon/splits/full.json", encoding="utf-8"))
train_signers = set(sp["signers"]["train"])
excluded = set(sp["exclude"]["clips"])
tk = json.load(open("/data/handoff/jiheon/tokens_e5.json", encoding="utf-8"))
train = {c: v for c, v in tk["clips"].items()
         if v["type"] == "WORD" and v["signer"] in train_signers and c not in excluded}
```

**문장 모델은 한 가지 더 뺀다.** `full_sen.json`의 `heldout_sentences`는 평가용 **새 조합 문장**이다.

```json
"heldout_sentences": {
  "sequences": [["119", "곳", "다음", "차내리다"], ["아파트", "저기"], ...],   // 새 단어 열 50개
  "items": ["SEN0012", ...],                                                   // 그 단어 열을 가진 문장 번호 71개
  "question_items": ["SEN0004", "SEN0068", "SEN0100", "SEN0112", "SEN0170"]}   // 새 "단어 + 의문" 5개
```

- 학습에서 뺄 클립: `gloss`가 `sequences`에 있거나, `item`이 `items` 또는 `question_items`에 있는 것 (학습 사람 기준 919개)
- 평가: 평가 사람(REAL03 · REAL12)의 그 클립 150개로, "학습에 없던 단어 순서"를 만들어 내는지 본다
- 단어는 모두 학습에 2번 이상 나오고, 같은 단어를 순서만 바꾼 열도 학습에 없다. `question_items`는 평서문("오른쪽")은 학습에 남기고 의문문("오른쪽?")만 뺀 것

## 5. `full/`, `full_sen/` — 동작 원본 (계약 ①)

`npy/<clip>.npy`(float32 `[T, 125, 3]`)와 `meta.jsonl`. 읽기는 `from common.data import load_data` → `load_data("/data/full")`이 `[T, 375]`로 펴서 준다 (전체 9GB가 메모리에 올라간다).
meta 필드와 좌표계는 `docs/contracts.md` ①. 토큰 대신 원본 좌표가 필요할 때(예: 기준선 B2 좌표 회귀)만 쓰면 된다.

## 부탁

1. `gen/tokenize.py` 출력에 `vq_version`이 없어서 이 파일엔 내가 직접 넣었다. 다음부터 출력에 넣어 줘 (계약 ②)
2. 학습 체크포인트에 `vq_version`을 기록해 줘. 자모표가 바뀌었는데 옛 토큰으로 학습한 모델을 섞어 쓰면 엉뚱한 동작이 나온다
3. 생성 결과를 뷰어로 볼 때는 `common/viewer.py`의 `write_viewer` (승혁 문서 참고)
