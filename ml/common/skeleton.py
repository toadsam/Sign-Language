"""125점 관절 구성 정의.

AI Hub 「수어 영상」 키포인트(OpenPose BODY_25 + 손 21 + 얼굴 70)에서
상체 13점만 남기고(하체 12점은 화면 밖 가짜 값) 손·얼굴은 전부 쓴다.
한 프레임 = [125, 3] (x 오른쪽, y 아래, z 카메라에서 멀어지는 방향).
"""

# BODY_25 원본 번호 중 쓰는 것: 0 코, 1 목, 2–4 오른팔, 5–7 왼팔, 8 골반 중앙, 15–18 눈·귀
POSE_KEEP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 18]

N_BODY, N_HAND, N_FACE = 13, 21, 70
N_JOINTS = N_BODY + 2 * N_HAND + N_FACE  # 125
FEAT_DIM = N_JOINTS * 3  # 375

BODY = slice(0, 13)
LHAND = slice(13, 34)
RHAND = slice(34, 55)
FACE = slice(55, 125)

# 새 번호(0–12) 기준 상체 관절
NOSE, NECK, R_SHOULDER, R_ELBOW, R_WRIST, L_SHOULDER, L_ELBOW, L_WRIST, MID_HIP = range(9)
L_HAND_ROOT = LHAND.start
R_HAND_ROOT = RHAND.start

# OpenPose 손 21점: 0 손목, 엄지 1–4, 검지 5–8, 중지 9–12, 약지 13–16, 새끼 17–20
HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19]

BODY_EDGES = [
    (NECK, NOSE), (NECK, R_SHOULDER), (R_SHOULDER, R_ELBOW), (R_ELBOW, R_WRIST),
    (NECK, L_SHOULDER), (L_SHOULDER, L_ELBOW), (L_ELBOW, L_WRIST), (NECK, MID_HIP),
    (NOSE, 9), (NOSE, 10), (9, 11), (10, 12),
]


def _chain(a, b, closed=False):
    e = [(i, i + 1) for i in range(a, b)]
    if closed:
        e.append((b, a))
    return e


FACE_EDGES_LOCAL = (
    _chain(0, 16)                      # 턱선
    + _chain(17, 21) + _chain(22, 26)  # 눈썹
    + _chain(27, 30) + _chain(31, 35)  # 콧대, 콧망울
    + _chain(36, 41, True) + _chain(42, 47, True)  # 눈
    + _chain(48, 59, True) + _chain(60, 67, True)  # 입술 바깥, 안쪽
)


def all_edges():
    """뷰어용 전체 연결선 (새 번호 기준)."""
    edges = list(BODY_EDGES)
    for root in (L_HAND_ROOT, R_HAND_ROOT):
        edges += [(root + p, root + c) for c, p in enumerate(HAND_PARENTS) if p >= 0]
    edges += [(FACE.start + a, FACE.start + b) for a, b in FACE_EDGES_LOCAL]
    return edges


def part_of(j):
    if j < BODY.stop:
        return "body"
    if j < RHAND.stop:
        return "hand"
    return "face"
