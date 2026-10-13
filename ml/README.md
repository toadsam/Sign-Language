# ml — 수어 동작 생성 AI 코드

"손짓의 알파벳" 계획의 프로그램 5개 중 1~3번 코드.

| # | 프로그램 | 경로 | 상태 |
|---|---|---|---|
| 1 | 데이터 정리기 | `prep/preprocess.py` | 샘플로 확인 |
| – | 정식 데이터 확인 | `prep/inspect_dataset.py` | 샘플·가짜 라벨로 확인 |
| 2 | 자모표 학습기 (VQ-VAE) | `vq/` | 샘플 과적합 테스트 완료 |
| 3 | 읽는 모델 (단어 인식) | `recog/` | 샘플로 코드 동작 확인 |
| 4 | 받아쓰기 모델 (단어) | `gen/train_word.py` | 샘플로 학습·비교 |
| 4 | 받아쓰기 모델 (문장) | `gen/train_sentence.py` | 코드 완료, 문장 데이터 필요 |
| – | 비교 기준선 ①② · 비교 실험 | `gen/baselines.py`, `gen/compare.py` | 샘플로 확인 |
| 5 | 아바타 연결기 | `../viewer/` (막대인간) | 뷰어만 |

`data/`, `runs/`는 AI Hub 데이터와 그 파생물이라 git에 올리지 않는다.

## 준비 (ml 폴더에서)

```bash
pip install -r requirements.txt   # torch는 CPU 버전도 됨
```

## 정식 데이터를 받으면 순서대로

```bash
# 0) 무엇이 들어 있는지 확인 — 라벨 파일, 한국어 원문, 수행자 수, 용량
python -m prep.inspect_dataset --root "<받은 폴더>" --out data/inspect_report.json

# 1) 정면 키포인트 → 정규화된 3D 동작 npy (하위 폴더 자동 탐색, 중간에 멈춰도 이어서 됨)
python -m prep.preprocess --src "<라벨링데이터 폴더>" --out data/full --types WORD,SEN --workers 8
#    받은 zip을 풀지 않고 바로 변환 (권장. zip 하나 = 표현자 한 명, 약 11GB → npy 약 0.5GB, 노트북 6작업자 2분)
python -m prep.preprocess --src "<...>/01_real_word_keypoint.zip" --out data/full --workers 6
#    정식 데이터 일부 클립은 3D가 mm 단위다. 자동으로 m로 바꾸고 meta의 check.src_unit 에 "mm" 로 남긴다

# 1-1) 고정 분할표 — 수행자 13/2/2명(정식 WORD 표현자 17명)으로 한 번 나눠 ml/splits/full.json 에 저장하고 커밋한다.
#      자모표·받아쓰기·읽는 모델이 모두 이 파일로 같은 test 수행자를 쓴다 (형식은 docs/contracts.md ①)
python -m prep.make_split --data data/full --val-signers 2 --test-signers 2

# 2) 자모표 학습 — 수행자 단위로 나눠 처음 보는 사람으로 평가. 끝나면 experiments.md 에 한 줄이 붙는다
#    E1 상체+손 55점 (Ours-H, 얼굴은 평균 고정) / E2 얼굴 포함 125점 (Ours-HF)
python -m vq.train --data data/full --run runs/vq_e1 --split signer --nb-code 512 --iters 100000 --parts body_hand --note "E1"
python -m vq.train --data data/full --run runs/vq_e2 --split signer --nb-code 512 --iters 100000 --parts all --note "E2"
#    Colab 등에서 끊기면 같은 명령에 --resume 을 붙이면 runs/<이름>/ckpt.pt 에서 이어 간다 (--save-every 로 저장 간격)
#    노트북에서 돌려 다른 작업이 느려지면 --threads 4

# 3) 읽는 모델 — 처음엔 단어 100개로 시작
python -m recog.train --data data/full --run runs/recog --types WORD --max-classes 100

# 2+3) 읽는 모델로 자모표 복원 동작 채점 (역번역)
python -m recog.backtranslate --recog runs/recog --vq runs/vq --data data/full

# 4) 받아쓰기 모델 — 모든 클립을 자모 토큰으로 바꾼 뒤 학습
python -m gen.tokenize --vq runs/vq --data data/full --out data/full/tokens.json
python -m gen.train_word --model gpt     --tokens data/full/tokens.json --data data/full --run runs/gen_gpt
python -m gen.train_word --model regress --tokens data/full/tokens.json --data data/full --run runs/gen_regress   # 기준선 ②
python -m gen.train_sentence --tokens data/full/tokens.json --sentences data/full/sentences.jsonl --run runs/gen_sent

# 비교 실험 — 우리 방법 vs 기준선 ① 이어붙이기 vs 기준선 ② 좌표 직접 예측
python -m gen.compare --data data/full --vq runs/vq --recog runs/recog --gpt runs/gen_gpt --regress runs/gen_regress --out runs/compare

# 발표용 그림
python -m vq.render_figures --run runs/vq --data data/full --pair <클립>:<프레임> --timeline <클립>
```

학습이 끝나면 `runs/<이름>/viewer.html`로 원본과 복원 동작을 비교한다.

## 샘플 결과 (단어 20개 · 수행자 1명, CPU)

| 항목 | 결과 |
|---|---|
| 자모표 복원 오차 — 학습 단어 / 처음 보는 단어 | 8.7mm / 33.6mm |
| 코드북 사용 | 128칸 중 81칸 |
| 읽는 모델 — 학습 단어 / 변형본 | 100% / 100% |
| 역번역 — 자모표 학습 단어 복원을 맞힌 비율 | 16/16 |
| 역번역 — 자모표 처음 보는 단어 복원을 맞힌 비율 | 0/4 (top-5 3/4) |

샘플은 수행자가 1명이라 **코드가 끝까지 도는지 확인하는 용도**다. 성능은 정식 데이터에서 수행자 단위로 나눠 다시 잰다.
