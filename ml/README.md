# ml — 동작 자모표(VQ-VAE) 학습 코드

수어링고 v2 계획서의 AI-1(동작 토큰 기반 문장 생성) 중 첫 단계인 동작 코드북 학습 코드.

## 구성

| 경로 | 내용 |
|---|---|
| `common/skeleton.py` | 125점 관절 구성 (상체 13 · 손 21×2 · 얼굴 70), 연결선 |
| `prep/preprocess.py` | AI Hub 키포인트 JSON → 정규화된 3D 동작 npy |
| `vq/model.py` | VQ-VAE (T2M-GPT 구조, EMA 코드북 + 미사용 코드 재할당) |
| `vq/train.py` | 학습·평가(MPJPE mm, 코드 사용률)·뷰어 내보내기 |
| `../viewer/skeleton_viewer.html` | 원본·복원 비교 뷰어 템플릿 |

`data/`, `runs/`는 AI Hub 데이터와 그 파생물이라 git에 올리지 않는다.

## 실행 (ml 폴더에서)

```bash
pip install -r requirements.txt   # torch는 CPU 버전도 됨

python -m prep.preprocess --src "<...>/라벨링데이터/REAL/WORD/01_real_word_keypoint" --out data/sample
python -m vq.train --data data/sample --run runs/vq_sample --iters 3000 --nb-code 128
```

학습이 끝나면 `runs/<이름>/viewer.html`을 브라우저로 열어 원본과 복원 동작을 비교한다.

## 샘플 데이터 주의

샘플은 단어 20개 · 수행자 1명이라 성능 측정용이 아니라 **코드가 끝까지 도는지 확인하는 과적합 테스트**용이다.
정식 데이터에서는 수행자 단위로 학습·평가를 나누고 `--nb-code 512`로 학습한다.
