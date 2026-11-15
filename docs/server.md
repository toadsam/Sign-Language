# sign-ml 서버 공용 안내 (2026-10-18, 재훈)

팀 수어지교 학습 서버. GCP 서울(asia-northeast3-b), Spot n1-highmem-8(8코어 · 52GB) + T4 GPU 1개.
요금은 재훈 계정으로 나간다. **켜 둔 시간만큼 나가므로(시간당 약 400원) 다 쓰면 반드시 끈다.**

## 규칙 (자세한 것은 docs/handoff/RULES.md)
1. 쓰기 전에 단톡에 "서버 쓴다"고 말한다. 서버와 GPU가 하나라 두 사람이 동시에 학습하면 둘 다 느려지거나 메모리가 모자란다.
2. 긴 학습은 끝나면 서버가 스스로 꺼지게 건다 (아래 예시). 짧게 쓸 때는 콘솔에서 **중지**.
3. Spot 서버라 구글이 중간에 끌 수 있다. 2,000회마다 저장되니 같은 명령에 `--resume`을 붙여 이어서 한다.
4. AI Hub 데이터(`/data/full*`)는 이용 신청이 승인된 사람만 쓴다. 서버 밖으로 복사해 공유하지 않는다.
5. `/data/full`, `/data/full_sen`, `/data/runs/vq_*`는 재훈 것이라 고치지 않는다. 자기 결과는 `/data/work/<이름>/`에 둔다.

## 접속
콘솔 https://console.cloud.google.com/compute/instances?project=signHandBack → `sign-ml` **시작** → **SSH** 버튼 (브라우저 터미널).
다 쓰면 **중지**.

## 폴더
```
/data/full/            단어 WORD 48,000클립 (npy + meta.jsonl)         ← 계약 ①
/data/full_sen/        문장 SEN 32,000클립 + sentences.jsonl
/data/full_all/        둘을 합친 것 (링크)
/data/runs/vq_e5/      자모표 v1 후보 E5 (model.pt = 디코더, viewer.html, figures/)   ← 계약 ②
/data/runs/tokens_e5.json   토큰 v0.3 (단어 + 문장 80,000클립)              ← 계약 ②
/data/runs/b1/         기준선 B1 결과 (summary.json)
/data/handoff/<이름>/  사람별로 필요한 것만 모아 둔 링크
/data/work/<이름>/     각자 학습 결과를 두는 곳 (자유)
/data/code/            저장소 최신본 (feature/ai-motion-vq). 분할표 ml/splits/, 계약 docs/contracts.md
```

## 실행
```bash
source /data/venv/activate          # = /home/jk636/venv (torch cu126, numpy, scipy, matplotlib)
cd /data/code/ml
nvidia-smi                          # GPU 보이는지
python -m vq.train --data /data/full --run /data/work/<이름>/test --split signer --iters 200 --no-record   # 1분 확인

# 긴 학습: 끝나면(실패해도) 자동 종료
nohup bash -c 'python -m recog.train --data /data/full --run /data/work/<이름>/recog_100 --max-classes 100; sudo shutdown -h +2' > /data/work/<이름>/log.txt 2>&1 &
tail -f /data/work/<이름>/log.txt
```

## 분할표 쓰기 (모든 모델 공통, 평가 사람 REAL03 · REAL12)
```python
from common.data import load_data, load_split, apply_split
metas = load_data("/data/full")                      # 전체 9GB를 메모리에 올린다 (서버 52GB라 됨)
train, val, test = apply_split(metas, load_split("/data/full"))
```
문장 받아쓰기는 분할표 `heldout_sentences`에 걸리는 클립을 학습에서 뺀다 (docs/contracts.md ①).
