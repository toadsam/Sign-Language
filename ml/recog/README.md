# 승현: 읽는 모델과 비교 평가

2026-10-13 역할 문서 기준 10/17 전달물인 계약 ④와 `ml/eval/`을 구현했다.
작업 브랜치: `feature/recog-seunghyun` (기준 `origin/feature/ai-motion-vq`).
데이터와 학습 체크포인트는 이 저장소에 포함되어 있지 않다. 아래 명령의 입력은 별도로 받아야 한다.

## 실행 환경과 확인

`ml/`에서 실행한다. 팀 권장 환경은 Python 3.11 + `requirements.txt`이다.
이번 개발 검증은 로컬 Python 3.13 가상환경에서 수행했다. 공용 의존성 파일은 변경하지 않았다.

```sh
cd ml
source .venv/bin/activate
python -m unittest recog.test_contract -v
```

테스트는 인공 좌표와 임시 체크포인트만 사용한다. 마지막 테스트는 train/val/test 표현자 분리 학습,
체크포인트 재로딩, 네 조건 비교표 저장, train 클립의 정식 평가 거부까지 실행한다.
인공 좌표 테스트에서 나오는 정확도는 실제 수어 성능이 아니다.

## 계약 ④ 사용

```python
from recog.infer import Recognizer

recognizer = Recognizer("runs/recog_100", device="cpu")
result = recognizer.score(motion, active=(40, 112))
print(result["top5"])  # [(단어 ID, 확률), ...] 최대 5개
```

`motion`은 정규화된 `[T,375]` 또는 `[T,125,3]` 좌표다.
`active`는 끝을 포함한다. 생략하면 전체 프레임을 사용한다.
`probs`는 `recognizer.items` 순서의 float32 확률이다. 기존 체크포인트의
`classes` 인덱스 순서를 그대로 사용한다. 모델은 한 번 로딩하고 계속 재사용한다.
빈 배열, NaN/Inf, 잘못된 관절 수, 범위를 벗어난 active는 거부한다.
기존 `runs/recog_sample/model.pt`도 함수 확인에 사용할 수 있다.

## 실제 사람 데이터로 학습

```sh
# 표현자 1명짜리 샘플은 함수 확인 전용
python -m recog.train --data data/sample --run runs/recog_sample --iters 800 --smoke

# 정식 데이터: 100단어에서 시작
python -m recog.train --data data/full --run runs/recog_100 --types WORD --test-signers 4 --max-classes 100 --device cuda

# 얼굴(입술·눈썹) 포함 비교. 같은 분할표와 설정을 사용한다.
python -m recog.train --data data/full --run runs/recog_100_face --types WORD --test-signers 4 --max-classes 100 --with-face --device cuda
```

`ml/splits/full.json`이 있으면 `--test-signers`보다 공용 분할표가 우선한다.
없으면 seed로 test 표현자 수를 고르고 추가 1명을 val로 남긴다. 팀 본 실험 전에
재훈이 만든 공용 분할표로 모두 통일해야 한다. 겹치는 표현자, 미등록 표현자,
단어 기준 분할표는 정식 인식 학습에서 거부한다.

val 정확도로 체크포인트를 선택하고, test는 선택된 모델에 대해 마지막에 한 번 평가한다.
공용 분할에 val이 없거나 학습 어휘에 해당하는 val 클립이 없으면 학습 증강 정확도로 선택하고
`summary.json`에 이 사실을 기록한다. 학습에 없는 test 단어는 점수 분모에서 제외하고
`excluded_test_clips`로 수를 기록한다. 따라서 어휘 수와 평가 클립 수도 정확도와 함께 보고한다.
`--smoke`는 test를 만들지 않고 `evaluated_on_unseen_signers: false`를 기록한다.
생성 동작을 학습용 `data/full`에 넣으면 안 된다. 학습 입력은 실제 사람 동작만 사용한다.

## 네 조건을 같은 클립으로 평가

`python -m eval.compare`는 생성 모델 구현에 의존하지 않고 저장된 좌표를 평가한다.
지헌에게 각 조건의 동일 단어 생성 결과를 npy로 받는다. B1의 원재료는 train 클립에서만
선택해야 하며, B2/Ours 모델 역시 공용 test 표현자를 학습에 사용하지 않아야 한다.
이 도구가 차단하는 것은 채점관 train/val 클립을 정답으로 사용하는 경우다.
생성 모델의 학습 이력은 모델 담당자와 별도로 확인해야 한다.

`generated.json` 예시 (npy 경로는 JSON 파일 위치 기준):

```json
{
  "records": [
    {
      "clip": "WORD1501_REAL10",
      "conditions": {
        "B1": {"motions": ["motions/b1.npy"]},
        "B2": {"motions": ["motions/b2.npy"]},
        "Ours-H": {"motions": ["motions/h_0.npy", "motions/h_1.npy"]},
        "Ours-HF": {"motions": ["motions/hf_0.npy", "motions/hf_1.npy"]}
      }
    }
  ]
}
```

```sh
python -m eval.compare --data data/full --recog runs/recog_100 --manifest runs/generated.json --out runs/compare
python -m recog.backtranslate --recog runs/recog_100 --vq runs/vq_v1 --data data/full --out runs/backtranslate/summary.json
```

`summary.json`, `rows.csv`, `table.md`에 원본과 B1/B2/Ours-H/Ours-HF 점수를 저장한다.
각 기록마다 네 조건을 모두 요구하며, 중복 정답 clip을 거부한다.
샘플용 체크포인트는 비교 및 역번역에 `--smoke`를 명시해야 한다.
기존 `python -m gen.compare ...` 명령은 `eval.legacy_compare`로 연결되며,
표현자 분리 없는 기존 샘플 진단용이라는 경고를 출력한다. 정식 결과에는 사용하지 않는다.

측정 항목:

- 역번역 top-1/top-5: 원래 단어가 예측 결과에 포함되는 비율.
- DTW mm: 실제 정답의 `norm.scale * 1000`을 곱한 관절 평균 거리.
- 움직임 크기: 생성/정답 손목 이동 거리. 정답이 정지 상태면 미측정.
- 다양성 mm: 같은 단어의 여러 생성 동작 사이 평균 DTW. 한 번만 생성하면 미측정.
- 전환 jerk: spec에 `boundaries: [경계 프레임, ...]`와 `fps: 30`을 제공하면 경계 ±8프레임에서
  측정한다. 경계가 없으면 미측정. 단위는 어깨너비/초³이며 모든 조건에서 fps를 같게 쓴다.
  이는 저장 동작 내부 경계의 지표다. 문장 의미의 역번역 평가는 별도 문장 인식기를 요구한다.

각 지표의 측정 클립 수도 기록한다. 미측정은 0점으로 채우지 않는다.
다양성 본 실험은 단어당 5개 동작을 요청한다. 자동 표의 조건 평균은 클립당 동일 가중치다.

## 아직 필요한 실제 입력과 운영 작업

- 재훈: 실제 사람 `data/full`과 공용 표현자 분할표, 역번역용 VQ 체크포인트.
- 지헌: 네 조건별 생성 좌표, 생성 설정과 학습 분할 이력.
- 승현: 100 → 500 → 3,000단어 실험 및 실제 top-1/top-5 기록. 메모리에 데이터를 올리는
  현재 구조의 대규모 사용량을 확인하고, 필요하면 스트리밍 데이터셋으로 확장한다.
- 승현: 어휘 연결표 안에서 학습에 없는 조합 50문장 선정, 평가자 섭외,
  지도교수님과 IRB/동의서 확인, 무작위 영상 ID 대응표와 사람 평가 분석.

실제 샘플 비교표, 정식 모델 성능, 사람 평가 결과는 아직 측정하지 않았다.
AI Hub 신청이나 평가자 연락은 이 코드 작업에서 대신 수행하지 않았다.
