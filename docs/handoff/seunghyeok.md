# 승혁에게 — 화면 · 뷰어에 쓰는 파일

> 2026-10-18 재훈. 서버 `/data/handoff/seunghyeok/`에 같은 파일이 링크로 있다.
> 계약 ⑤(API 응답 JSON)와 샘플 응답 파일은 **지헌**에게 받는다. 여기는 자모표 · 뷰어 쪽만.

## 한눈에

| 파일 | 서버 위치 | 뭐에 쓰나 | AI Hub 데이터 포함? |
|---|---|---|---|
| `token_atlas.html` | `/data/handoff/seunghyeok/token_atlas.html` | **자모표 격자** 완성본. 중간 발표 시연 화면 | ✗ 디코더가 만든 좌표만 |
| `viewer_e5.html` | `/data/handoff/seunghyeok/viewer_e5.html` | 원본 vs 복원 나란히 재생 예시 8클립 | ✓ 원본 동작 포함 → 외부 공유 금지 |
| `viewer/` | `/data/handoff/seunghyeok/viewer/` | 뷰어 템플릿 (`skeleton_viewer.html`) | ✗ |
| `code/ml/common/viewer.py` | `/data/code/ml/common/viewer.py` | 템플릿에 데이터를 넣는 함수 | ✗ |

## 1. `token_atlas.html` — 자모표 격자 (4.7MB)

역할표의 "자모표 그림용 토큰 10/24" 항목. 직접 만들 필요 없이 완성본을 보낸다.

- 자모표 E5의 토큰 512개가 칸마다 **0.13초(4프레임) 동작 조각을 반복 재생**한다. 상체 + 손만(얼굴은 이 자모표가 만들지 않음)
- 위쪽 메뉴: 정렬(많이 쓰는 순 · 번호 순 · 손 높이 순 · 움직임 큰 순), 단어 찾기(예: "학교" → 그 단어에 자주 나오는 토큰), 대기 자세 토큰 숨기기
- 칸을 누르면 그 토큰이 얼마나 쓰였는지(단어 · 문장 클립 수), 어떤 단어의 클립에 자주 나오는지(비율)
- 안에 든 데이터는 **디코더가 토큰 하나로 만들어 낸 좌표**뿐이다. AI Hub 원본 클립은 없어서 발표 화면 · 웹에 넣어도 된다
- 네 화면 스타일로 다시 만들고 싶으면: 파일 안의 `const D = {...}`가 전부다. `D.x[토큰][프레임][관절][x, y]`(55점, 2D), `D.edges`(선 연결), `D.use`(사용 횟수), `D.words`(단어 · 비율), `D.rest`(대기 토큰 여부). 만든 스크립트는 `ml/vq/token_atlas.py`
- 발표용 정지 그림은 `/data/runs/vq_e5/figures/자모표_격자.png`

## 2. 뷰어 템플릿과 데이터 형식 — `<SignPlayer>`의 출발점

`viewer/skeleton_viewer.html` 하나가 뷰어 전체다(three.js 없이 2D 캔버스). `common/viewer.py`의 `write_viewer()`가 아래 JSON을 `/*__DATA__*/null` 자리에 넣어 완성한다.

```json
{"edges": [[0, 1], [1, 2], ...],            // 선으로 이을 관절 쌍 (common/skeleton.py all_edges)
 "down": 4, "fps": 30,
 "labels": ["원본", "자모표로 바꿨다 되돌린 것"],   // 왼쪽 · 오른쪽 제목
 "title": null,
 "parts": {"body": [0, 13], "lhand": [13, 34], "rhand": [34, 55], "face": [55, 125]},
 "clips": [{"name": "WORD0773_REAL03", "split": "test", "frames": 138,
            "active": [39, 110], "tokens": [465, 278, ...],
            "orig":  [x, y, z, x, y, z, ...],   // 길이 138 × 375, 소수 3자리
            "recon": [x, y, z, ...]}]}
```

- 좌표계(계약 ①): **목이 원점, 어깨너비 = 1, x 오른쪽, y 아래, z 카메라에서 멀어지는 쪽.** y가 아래라 그릴 때 뒤집어야 한다(템플릿에 돼 있음). 축이 뒤집혀 몸이 거꾸로 나오면 이것부터 확인
- 125점 번호: 상체 13 (0 코, 1 목, 2 ~ 4 오른팔 어깨 · 팔꿈치 · 손목, 5 ~ 7 왼팔, 8 골반, 9 ~ 12 눈 · 귀) · 왼손 21 (13 ~ 33, 13이 손목) · 오른손 21 (34 ~ 54, 34가 손목) · 얼굴 70 (55 ~ 124). 손가락은 손목에서 4점씩 5줄
- `tokens`가 있으면 재생 중 현재 토큰 번호를 표시한다(4프레임마다 바뀜)
- 계약 ⑤의 응답은 `data`가 base64 float32 `[frames × 125 × 3]`이다. 풀면 위 `orig`와 같은 배열이 된다. `<SignPlayer>`는 이 하나만 받으면 된다

파이썬에서 뷰어 만들기:

```python
from common.viewer import write_viewer
write_viewer("out.html", [{"name": "예시", "a": motion_a, "b": motion_b, "active": [s, e], "tokens": [...]}],
             labels=("왼쪽 제목", "오른쪽 제목"))        # motion_*: numpy [T, 375]
```

## 3. `viewer_e5.html` — 예시 (16MB)

평가 사람(REAL03 · REAL12) 4클립 + 학습 사람 4클립. 왼쪽 원본, 오른쪽 자모표 E5로 복원. `<SignPlayer>` 만들 때 "이렇게 보여야 한다"의 기준. **원본 동작(AI Hub 파생)이 들어 있어 저장소 · 외부에 올리지 않는다.**

## 4. 웹캠 모델용 데이터 — 아직 없음

웹캠 인식(`ml/cam/`, 11월부터)은 AI Hub **다방향(D · F · L · R · U) 2D 손 좌표**가 필요한데 아직 안 받았다. 지금 받은 건 정면 3D뿐.
- 내가 받기 스크립트(`prep/batch_word.py`)를 갖고 있어서 내가 받는 게 빠를 수 있다. 용량이 정면의 약 4배라 **언제 · 누가 받을지 단톡에서 정하자**
- 2D는 `*_keypoints_2d` 필드(x, y, conf 픽셀). 손 21점 번호는 MediaPipe와 거의 같다

## 자모표 한 줄 요약 (화면 문구용)

수어 동작을 0.13초마다 512개 "동작 글자" 중 하나로 바꾼다. 자모표 E5는 단어 4.8만 + 문장 3.2만 클립으로 배웠고, 처음 보는 사람 손 오차 약 28mm, 512개 전부 사용.
