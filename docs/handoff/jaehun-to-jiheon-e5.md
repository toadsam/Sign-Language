# 재훈 → 지헌: E5 토큰·디코더 인수인계

점검일: 2026-10-18 (한국). 기준 소스: `fac1513d962c0c5eac0619bd0492708689aabfbe`.
상태: **파일 점검 통과 / 학습 코드의 필터 적용 필요 / 전송·수령·팀 승인 미확인**.

## 결론

- 버전은 `v0.3-e5`. v1 동결은 아직 팀 결정 전이며 이번 점검으로 승격하지 않았다.
- 토큰 80,000클립과 E5 디코더를 같은 묶음으로 전달한다. E1·E4b 디코더와 혼용하지 않는다.
- **80,000개 모두 학습용이 아니다.** 검증·평가 수행자, 품질 제외, 라벨·길이 조건, 문장 holdout을 먼저 적용한다.
- 현재 저장소의 `gen/train_word.py:load_setup`, `gen/train_sentence.py:build_pairs`는 필요한 필터를 적용하지 않는다. 그대로 정식 학습하지 않는다. 지헌 소유 코드이므로 이번에는 수정하지 않았다.

## 전달할 파일

아래 저장소 경로는 저장소 루트 기준이다. 수령자는 자신의 환경에 맞게 절대 경로를 지정한다.

| 파일 | 재훈 컴퓨터 위치 | 용도 |
|---|---|---|
| tokens_e5.json | `C:/aihub/tokens/tokens_e5.json` | 19,997,667바이트, WORD 48,000 + SEN 32,000 |
| model.pt | `ml/runs/vq_e5/model.pt` | 16,526,148바이트, 인코더·코드북·디코더 가중치 |
| config.json | `ml/runs/vq_e5/config.json` | 체크포인트 내부 설정과 일치 |
| full.json | `ml/splits/full.json` | WORD 분할표 |
| full_sen.json | `ml/splits/full_sen.json` | SEN 분할표와 새 조합 평가 목록 |
| full_all.json | `ml/splits/full_all.json` | 통합 분할표와 동일한 새 조합 평가 목록 |
| WORD meta.jsonl | `C:/aihub/full/meta.jsonl` | label, dur_ratio 등 필터 근거 |
| SEN meta.jsonl | `C:/aihub/full_sen/meta.jsonl` | 문장 item·gloss와 필터 근거 |
| sentences.jsonl | `C:/aihub/full_sen/sentences.jsonl` | 문장 gloss·nonmanual, 31,986행 |

실행 코드도 같은 소스 버전의 `ml/vq/model.py`, `ml/common/`, `ml/requirements.txt`를 사용한다.
현재 로컬에는 `C:/aihub/full_all`이 없다. 서버 학습 설정의 `/data/full_all`은 서버 경로다.
토큰의 `vq: runs/vq_e5`도 경로 힌트일 뿐 수령자의 파일 위치를 보장하지 않는다.
디코더는 수령한 `model.pt`의 경로로 직접 로드한다.

데이터·토큰·체크포인트는 Git에 넣지 않는다. 승인된 수령자와 약관에 맞는 전달 경로를 확인한 후 전송한다.
이번 작업은 로컬 점검과 문서 작성만 수행했다.

## 실제 점검 결과

- 토큰 80,000개와 두 meta 파일의 clip 집합이 정확히 일치하고, meta 중복이 없다.
- 모든 토큰의 item/signer/type, 정수 범위 0~511, 프레임 구간, 토큰 개수 × 4를 확인했다.
- WORD는 active 앞뒤 여유 4프레임, SEN은 전체 구간을 사용하며 끝은 4의 배수로 절삭한다. 전체 클립이 현재 `gen.tokenize.segment`와 일치한다.
- WORD 토큰 수 3~46개(평균 20.2276), SEN 16~85개(평균 43.7385). 512개 코드 모두 사용된다.
- 유형별·수행자별 1개와 최소·최대 길이를 합친 **36클립**만 실제 좌표를 읽어 재인코딩했다. 저장 토큰과 정확히 일치했다. 80,000클립 전부 재인코딩한 검사는 아니다.
- 같은 36클립 디코딩 결과가 float32 `[1, 토큰 수×4, 375]`이며 NaN/Inf가 없다.
- E5는 `parts=body_hand`다. 앞 55관절만 학습한 동작이고 뒤 얼굴 70관절은 평균 얼굴이다. 얼굴 표정·의문 표현 생성이 검증됐다는 뜻이 아니다.
- 체크포인트 자체의 버전 문자열만으로 연결을 보증하지 않는다. 아래 파일 해시와 설정 비교, 표본 재인코딩 일치를 근거로 이 묶음을 식별한다.
- 입력 토큰·모델·설정·메타·문장·분할표의 점검 전후 SHA-256이 모두 동일하다. 원본 데이터 수정·삭제·재학습 없음.

## 최신 분할표

| 데이터 | train | val | test | 품질 제외 |
|---|---:|---:|---:|---:|
| WORD | 34,574 | 5,664 | 5,907 | 1,855 |
| SEN | 23,884 | 3,986 | 3,977 | 153 |
| 합계 | 58,458 | 9,650 | 9,884 | 2,008 |

세 파일의 수행자 배정이 일치하고 서로 겹치지 않는다. 통합 제외 목록은 WORD·SEN 제외 목록의 합집합과 일치한다.
- train: REAL01, REAL02, REAL05~REAL10, REAL13~REAL16 (12명).
- val: REAL04, REAL11.
- test: REAL03, REAL12.

위 표는 품질 제외만 적용한 숫자다. 받아쓰기에는 다음 조건이 추가된다.

### 지헌 코드에 적용할 순서

1. clip 키로 토큰과 meta를 연결하고 타입(WORD/SEN)을 구분한다. 토큰 파일에는 label/dur_ratio/gloss가 없으므로 토큰만으로 필터를 끝낼 수 없다.
2. 해당 분할표의 `exclude.clips`를 제외한다. `apply_split`을 메타에 사용하면 수행자 배정과 함께 처리된다.
3. `label == "ok"` 및 `0.85 <= dur_ratio < 1.5`를 적용한다. 필드 누락 시 정상값으로 가정하지 말고 실패/제외 처리한다.
4. train 수행자만 학습에 사용하고 val/test는 분리한다. 단어 모델과 B2는 같은 대상·분할로 비교한다.
5. 문장에서는 아래 세 조건 중 하나라도 해당하면 새 조합 평가 대상이다. train에서 제외한다.
   - `tuple(meta.gloss)`가 `heldout_sentences.sequences`에 있음.
   - `meta.item`이 `heldout_sentences.items`에 있음.
   - `meta.item`이 `heldout_sentences.question_items`에 있음.
6. 일반 val로 설정을 고를 때에도 해당 holdout 152클립을 따로 격리하는 것을 권장한다. 새 조합 test는 모델 선택에 사용하지 않는다.
7. 필터 적용 후 train만으로 학습 목록을 만든다. 새 조합 평가 대상은 test 수행자의 150클립으로 별도 평가한다.

**`common.data.apply_split`은 `heldout_sentences`를 처리하지 않는다.** 별도 조건이 반드시 필요하다.

| 받아쓰기용 수치 | 확인 결과 |
|---|---:|
| WORD train (품질 + 라벨 + 길이) | 34,501 |
| WORD val / test (같은 조건) | 5,453 / 5,907 |
| SEN train (품질 + 라벨 + 길이) | 23,884 |
| SEN train에서 새 조합 제외 | 919 |
| SEN 최종 train | 22,965 |
| 새 조합 test | 150 (그중 의문 10) |
| 새 조합에 해당하는 val | 152 |

새 단어 열 50개, 해당 문장 번호 71개, 별도 의문 문장 번호 5개다.
문장 최종 train 22,965개에는 holdout 조건 일치 및 같은 단어 묶음의 순서 변형이 0개였다.
최종 train과 새 조합 test의 문장 라벨이 sentences.jsonl에 모두 있고 gloss도 meta와 일치했다.

E5는 SEN 추가 제외 58개 및 새 조합 holdout 설정 전에 학습됐다(기존 실험 기록).
이번에 모델을 다시 학습하지 않았다. 따라서 새 조합 평가는 **생성 모델의 학습에서 제외한 조합**을 뜻하며,
VQ까지 해당 동작을 전혀 보지 않았다는 주장은 하면 안 된다.

## 수령 확인

1. 아래 SHA-256과 파일 크기를 대조한다. PowerShell: `Get-FileHash -Algorithm SHA256 -LiteralPath '<수령한 파일 경로>'`.
2. 아래 디코더 smoke test를 CPU에서 실행한다. 이 검사는 출력 형식만 확인하며 실제 수어 품질 평가는 아니다.
3. 지헌 코드의 필터 적용 결과가 위 숫자와 맞는지 확인한다. train/val/test clip과 수행자가 겹치지 않는지 검사한다.
4. 생성 모델 체크포인트에 `vq_version=v0.3-e5`, 토큰·모델 해시 및 사용한 분할표 해시를 기록하도록 요청한다. 기존 코드가 자동 저장한다고 가정하지 않는다.
5. 수령 완료·실행 결과·버전 승인 여부를 팀에 회신한다. 그 전까지 상태는 '전달 준비'다.

`ml` 디렉터리에서 실행할 Python 예시:

```python
import torch
from vq.model import load_vqvae

vq, cfg = load_vqvae("runs/vq_e5/model.pt")  # 수령한 파일 위치
with torch.inference_mode():
    motion = vq.decode(torch.tensor([[0, 1, 2]], dtype=torch.long))
assert motion.shape == (1, 12, 375)
assert motion.dtype == torch.float32 and torch.isfinite(motion).all()
print("decoder OK", tuple(motion.shape))
```

전체 토큰 구조 + 메타/분할 + 36클립 재인코딩 검사를 재현하려면 `ml`에서:

```powershell
python -m vq.audit_handoff --tokens C:/aihub/tokens/tokens_e5.json --model runs/vq_e5/model.pt --word C:/aihub/full --sen C:/aihub/full_sen
```

이 명령은 재훈 로컬 경로 예시이며 수령 환경에 맞게 바꾼다. 원본을 변경하지 않고 요약 JSON만 출력한다.
최적화 옵션 `python -O`는 assert 검사를 끄므로 사용하지 않는다.

## 파일 해시 (SHA-256)

```text
tokens_e5.json   0ace9fd00ed814aa2bfaf2de4930081a95c73324fe7462d697f1504e5c7d0639
model.pt         939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38
config.json      d652055f41f973fb56fed84d84e009c8f747cc58f9ac1f7ccdb29467117ec574
full.json        7fbabab8daa8621dc602790ca0591c355ba629eb01271d3b44f1c8251632869f
full_sen.json    40fc852d470f26127a4416e29535999aca188c6132c867785da4302b8fa8d9a3
full_all.json    6cfc5d3601c3cd6a0a1d26d382839d1e7be55e7a9f726c823cecf4c52f5849c0
WORD meta.jsonl  a3cf1e2b974ca8e940f2f6eb3f8f90cf5d0fe3f814d9f267eb5e85fc7a72bb24
SEN meta.jsonl   b65bb8d16d4685f1423bb822c54964733532a4cce289fc97d3c6810d929d1240
sentences.jsonl  0909250841dc3ba930ff511049e9e87d7f53716c69af168ab0f15ee43807cb9a
```

## 지헌에게 보낼 메시지 초안

> 지헌아, E5 자모표의 토큰·디코더 전달 준비했고 실제 파일 점검도 끝냈어.
> 버전은 v0.3-e5고, v1 확정은 팀에서 따로 결정하면 돼.
> 토큰은 단어 48,000개 + 문장 32,000개야. E5 model.pt와 반드시 같이 써 줘.
> 최신 full/full_sen/full_all 분할표, 메타 파일과 문장 라벨도 같이 확인해 줘.
> 주의할 건 토큰 전체가 학습용은 아니라는 거야. 현재 학습 코드에는 필터가 빠져 있어서 적용 후 학습해야 해.
> 품질 제외 + 라벨/길이 + 수행자 분할을 적용하면 단어 train은 34,501개고,
> 문장은 새 조합 평가 목록까지 빼면 train 22,965개야. 새 조합 test는 150개야.
> apply_split만으로 새 조합이 빠지지는 않으니 sequences/items/question_items 조건을 별도로 적용해 줘.
> 디코더의 얼굴은 평균값이라 의문 표정을 생성하는 모델은 아니야.
> 첨부 인수인계 문서에 해시, 파일 목록, 점검 명령을 적어 뒀어. 수령 경로 확인 후 파일을 전달하고,
> 필터 적용 숫자와 디코더 실행 결과까지 확인해서 알려 줘.
