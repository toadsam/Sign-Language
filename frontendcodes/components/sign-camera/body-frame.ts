/**
 * 카메라에서 뽑은 상체(MediaPipe Pose 33점)와 손(Hand 21점 × 최대 2)을
 * AI 동작과 같은 모양의 좌표로 바꾼다. 계약 ①의 앞 55점이다: 상체 13 · 왼손 21 · 오른손 21.
 *
 *  - 원점은 목(두 어깨의 가운데), 어깨너비 = 1, x 는 화면 오른쪽, y 는 아래
 *  - 어깨선이 수평이 되게 화면 안에서 돌린다 (몸을 조금 기울여도 같은 좌표)
 *  - 좌우가 뒤집힌 영상(셀카 저장본 등)은 스스로 알아채고 되돌린다
 *  - z 는 카메라 한 대로 잰 어림값이다. 채점에는 x · y 만 쓰는 것을 권한다
 *
 * 왼손 · 오른손은 MediaPipe 의 좌우 이름표가 아니라 "어느 손목에 붙어 있나"로 정한다.
 * 이름표는 거울 화면을 가정해서 카메라 원본에서는 자주 뒤바뀌기 때문이다.
 *
 * 관절 번호는 ml/common/skeleton.py 와 같다.
 *   상체 0 코 · 1 목 · 2–4 오른팔(어깨 · 팔꿈치 · 손목) · 5–7 왼팔 · 8 골반 가운데 · 9 오른눈 · 10 왼눈 · 11 오른귀 · 12 왼귀
 *   왼손 13–33, 오른손 34–54 (손목, 엄지 4, 검지 4, 중지 4, 약지 4, 새끼 4)
 */
export type Landmark = { x: number; y: number; z?: number; visibility?: number };

/** 한 프레임에서 인식기가 준 것. pose 와 hands 는 0 ~ 1 로 정규화된 화면 좌표 */
export type BodyCapture = {
  timestampMs: number;
  width: number;
  height: number;
  pose: Landmark[] | null;
  hands: Landmark[][];
};

export type BodyFrame = {
  timestampMs: number;
  /** 55점 × (x, y, z). 어깨너비 = 1, 원점 목 */
  points: number[];
  /** 그 부위를 실제로 봤는가. 못 본 손은 손목 자리에 모아 둔다 */
  mask: { leftHand: boolean; rightHand: boolean; hip: boolean };
  /** 어깨너비가 화면에서 몇 픽셀이었나 (너무 작으면 멀리 선 것) */
  shoulderPx: number;
  /** 좌우가 뒤집힌 입력이라 되돌렸는가 */
  flipped: boolean;
};

export const BODY_JOINTS = 55;
export const LEFT_HAND = 13;
export const RIGHT_HAND = 34;
const HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
const BODY_EDGES: [number, number][] = [[1, 0], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [0, 9], [0, 10], [9, 11], [10, 12]];

/** 그림용 연결선 (55점 번호 기준) */
export function bodyEdges(): [number, number][] {
  const edges = BODY_EDGES.slice();
  for (const root of [LEFT_HAND, RIGHT_HAND]) {
    HAND_PARENTS.forEach((parent, child) => {
      if (parent >= 0) edges.push([root + parent, root + child]);
    });
  }
  return edges;
}

// MediaPipe Pose 번호
const P = { nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 };
/** 골반이 화면 밖일 때 쓰는 어림 위치: 목에서 어깨너비의 이만큼 아래 */
const HIP_BELOW_NECK = 1.45;
/** 손은 이 거리(어깨너비 단위) 안에 있는 손목에만 붙는다 */
const HAND_REACH = 0.8;
const MIN_SHOULDER_PX = 12;

function seen(p: Landmark | undefined, min = 0.5): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility >= min);
}

type Px = { x: number; y: number; z: number };
type V3 = [number, number, number];

/**
 * 인식 결과 한 장을 55점 좌표로 바꾼다.
 * 상체(두 어깨)를 못 봤으면 null. 이때는 기준이 없어서 손만으로는 좌표를 정할 수 없다.
 */
export function toBodyFrame(capture: BodyCapture): BodyFrame | null {
  const { pose, width, height } = capture;
  if (!pose || pose.length < 25 || !(width > 0) || !(height > 0)) return null;
  if (!seen(pose[P.leftShoulder]) || !seen(pose[P.rightShoulder])) return null;

  // 화면 픽셀로. z 는 MediaPipe 가 x 와 비슷한 크기로 주므로 가로 길이를 곱한다
  const px = (p: Landmark): Px => ({ x: p.x * width, y: p.y * height, z: (p.z ?? 0) * width });
  const ls = px(pose[P.leftShoulder]);
  const rs = px(pose[P.rightShoulder]);
  const shoulderPx = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (shoulderPx < MIN_SHOULDER_PX) return null;

  // 마주 보고 선 사람의 왼어깨는 화면 오른쪽에 있다. 반대면 좌우가 뒤집힌 입력
  const flipped = ls.x < rs.x;
  const sx = flipped ? -1 : 1;
  const neck: Px = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
  const angle = Math.atan2(ls.y - rs.y, (ls.x - rs.x) * sx);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const norm = (p: Px): V3 => {
    const dx = (p.x - neck.x) * sx;
    const dy = p.y - neck.y;
    return [(dx * cos - dy * sin) / shoulderPx, (dx * sin + dy * cos) / shoulderPx, (p.z - neck.z) / shoulderPx];
  };

  const out: V3[] = new Array(BODY_JOINTS);
  const body = (index: number) => norm(px(pose[index]));
  out[0] = body(P.nose);
  out[1] = [0, 0, 0];
  out[2] = body(P.rightShoulder);
  out[3] = body(P.rightElbow);
  out[4] = body(P.rightWrist);
  out[5] = body(P.leftShoulder);
  out[6] = body(P.leftElbow);
  out[7] = body(P.leftWrist);
  const hip = seen(pose[P.leftHip]) && seen(pose[P.rightHip]);
  if (hip) {
    const a = px(pose[P.leftHip]);
    const b = px(pose[P.rightHip]);
    out[8] = norm({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  } else {
    out[8] = [0, HIP_BELOW_NECK, 0];
  }
  out[9] = body(P.rightEye);
  out[10] = body(P.leftEye);
  out[11] = body(P.rightEar);
  out[12] = body(P.leftEar);

  // 손을 손목에 붙인다: 거리 합이 가장 작은 짝을 고른다
  const wristPx = { left: px(pose[P.leftWrist]), right: px(pose[P.rightWrist]) };
  const hands = capture.hands.filter((h) => h.length === 21 && h.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).slice(0, 2);
  const gap = (hand: Landmark[], side: 'left' | 'right') =>
    Math.hypot(hand[0].x * width - wristPx[side].x, hand[0].y * height - wristPx[side].y) / shoulderPx;
  let left: Landmark[] | null = null;
  let right: Landmark[] | null = null;
  if (hands.length === 2) {
    const straight = gap(hands[0], 'left') + gap(hands[1], 'right');
    const crossed = gap(hands[0], 'right') + gap(hands[1], 'left');
    if (straight <= crossed) {
      left = hands[0];
      right = hands[1];
    } else {
      left = hands[1];
      right = hands[0];
    }
  } else if (hands.length === 1) {
    if (gap(hands[0], 'left') <= gap(hands[0], 'right')) left = hands[0];
    else right = hands[0];
  }
  if (left && gap(left, 'left') > HAND_REACH) left = null;
  if (right && gap(right, 'right') > HAND_REACH) right = null;

  const place = (hand: Landmark[] | null, root: number, wristJoint: number) => {
    if (!hand) {
      for (let j = 0; j < 21; j++) out[root + j] = [out[wristJoint][0], out[wristJoint][1], out[wristJoint][2]];
      return;
    }
    // 손 인식기의 z 는 손목 기준이다. 상체가 잰 손목 깊이에 얹는다
    const depth = out[wristJoint][2];
    for (let j = 0; j < 21; j++) {
      const n = norm({ x: hand[j].x * width, y: hand[j].y * height, z: neck.z });
      out[root + j] = [n[0], n[1], depth + ((hand[j].z ?? 0) * width) / shoulderPx];
    }
    // 손목은 손 인식기가 더 정확하다. 상체의 손목도 거기에 맞춘다 (데이터에서도 둘은 거의 겹친다)
    out[wristJoint] = [out[root][0], out[root][1], depth];
  };
  place(left, LEFT_HAND, 7);
  place(right, RIGHT_HAND, 4);

  const points: number[] = [];
  for (const p of out) points.push(p[0], p[1], p[2]);
  if (!points.every(Number.isFinite)) return null;
  return { timestampMs: capture.timestampMs, points, mask: { leftHand: !!left, rightHand: !!right, hip }, shoulderPx, flipped };
}
