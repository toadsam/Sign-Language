/**
 * 따라 하기 채점: 친구(AI가 만든 동작)와 내 동작을 직접 비교한다.
 *
 * 1) 손을 내리고 서 있는 앞뒤는 잘라 낸다
 * 2) 사람마다 빠르기가 다르므로 시간축을 맞춘다 (DTW: 두 동작의 장을 순서를 지키며 가장 싸게 짝짓기)
 * 3) 짝지은 장끼리 거리를 잰다. 좌우 · 위아래(x · y)만 쓴다. 카메라 한 대의 깊이(z)는 믿기 어렵다
 *      위치: 팔꿈치 · 손목이 몸의 어디에 있나 (어깨너비 단위)
 *      손 모양: 손목에서 본 손가락 20점 (어깨너비 단위)
 * 4) 거리를 0 ~ 100 점으로 바꾸고, 가장 달랐던 곳을 말로 알려 준다
 *
 * 점수 기준선은 임시값이다. 지헌의 기록(docs/ai-log/jiheon.md)에서 가져왔다:
 * 같은 단어를 서로 다른 사람이 했을 때 몸+손 거리 약 0.20 · 손 모양 약 0.08,
 * 서로 다른 단어끼리는 약 0.55. 그래서 "사람끼리 수준"이면 80점대, "다른 단어 수준"이면 0점에 가깝게 나오게 맞췄다.
 * 재는 방법이 완전히 같지는 않으므로(여기는 2D, 웹캠, 시간 맞춤) 실제로 따라 해 보며 다시 맞춰야 한다.
 */

/** 장마다 55점 이상이 들어 있는 동작. stride 는 한 장의 숫자 개수 (55점이면 165, 125점이면 375) */
export type ScoreMotion = {
  frames: number;
  fps: number;
  data: Float32Array;
  stride: number;
  /** 그 장에서 손을 실제로 봤는가. 없으면 늘 본 것으로 친다 */
  leftHand?: boolean[];
  rightHand?: boolean[];
};
export type ScoreSegment = { gloss: string; start: number; end: number };

export type FollowScore = {
  /** 0 ~ 100 */
  score: number;
  position: { distance: number; score: number };
  /** 비교할 손 모양이 한 장도 없으면 null */
  shape: { distance: number; score: number } | null;
  parts: { rightArm: number; leftArm: number; rightHand: number | null; leftHand: number | null };
  /** 낱말마다 (친구 동작에 낱말 구간이 있을 때만) */
  words: { gloss: string; score: number }[];
  /** 가장 달랐던 곳부터, 많아야 세 줄 */
  hints: string[];
  /** 거울처럼 반대 손으로 했을 때가 훨씬 잘 맞았다 */
  mirrored: boolean;
  /** 앞뒤를 잘라 내고 실제로 비교한 장 수 */
  compared: { mine: number; friend: number };
  /** 잘라 내고 남은 구간 [시작, 끝 다음). 원래 동작의 장 번호 */
  active: { mine: [number, number]; friend: [number, number] };
  /** 낱말마다, 시간을 맞춘 결과로 본 "내 동작의 어느 구간이 그 낱말인가". 읽는 모델에 낱말별로 물어볼 때 쓴다 */
  aligned: { gloss: string; friend: [number, number]; mine: [number, number] }[];
};

const R_ELBOW = 3, R_WRIST = 4, L_ELBOW = 6, L_WRIST = 7;
const L_HAND = 13, R_HAND = 34;
/** 손이 이만큼(어깨너비) 넘게 올라오면 "움직이는 중" */
const RAISED = 0.2;
const PAD = 4;
/** 손을 못 봤는데 친구는 손을 쓰고 있을 때 주는 손 모양 거리 */
const UNSEEN_SHAPE = 0.2;
const SHAPE_WEIGHT = 1.5;
/** 친구가 쓰지 않는 팔의 무게 (쓰는 팔은 1) */
const IDLE_ARM_WEIGHT = 0.15;
/** 손 모양 거리가 이보다 크면 "손가락 모양이 달랐어요"라고 알린다 (사람끼리는 약 0.08) */
const SHAPE_HINT = 0.1;
// 거리 → 점수. [이 거리 이하면 100, 이 거리 이상이면 0]
// 2026-11-17 승혁: 손 자리만 웹캠 실제 시도 10회로 다시 맞췄다 (tools/follow-baseline.cjs).
// 자리: 100점 = "잘 따라 함" 거리 중앙값 0.201(지헌 기록의 사람끼리 약 0.20과 비슷), 0점 = "다른 동작" 중앙값 0.49. 이전 [0.12, 0.5]
// 모양: 그대로 둔다. 웹캠으로 잘 따라 한 손 모양 거리(중앙 0.137)가 편 손 ↔ 주먹 차이(0.13)와 비슷해서,
//       모양 기준을 같이 느슨하게 하면 주먹을 쥐어도 100점이 된다.
// 결과(같은 기록): 잘 따라 함 59~65 → 70~78점, 다른 동작 0~25점. 한 사람 · 한 문장(저는 학교에 갑니다.) 기록이라 더 모으면 다시 맞춘다.
const POSITION_RANGE: [number, number] = [0.201, 0.49];
const SHAPE_RANGE: [number, number] = [0.05, 0.2];

function toScore(distance: number, [best, worst]: [number, number]) {
  return Math.round(100 * Math.min(1, Math.max(0, 1 - (distance - best) / (worst - best))));
}

type Hand = { ok: boolean; shape: Float32Array };
type Frame = {
  /** 팔꿈치 · 손목 x, y: [오른 팔꿈치, 오른 손목, 왼 팔꿈치, 왼 손목] */
  arm: Float32Array;
  right: Hand;
  left: Hand;
};

function readFrames(m: ScoreMotion, mirror: boolean): Frame[] {
  const out: Frame[] = [];
  const sx = mirror ? -1 : 1;
  for (let f = 0; f < m.frames; f++) {
    const o = f * m.stride;
    const x = (j: number) => m.data[o + j * 3] * sx;
    const y = (j: number) => m.data[o + j * 3 + 1];
    const hand = (root: number, seen: boolean | undefined): Hand => {
      const shape = new Float32Array(40);
      let size = 0;
      for (let j = 1; j <= 20; j++) {
        shape[(j - 1) * 2] = x(root + j) - x(root);
        shape[(j - 1) * 2 + 1] = y(root + j) - y(root);
        size = Math.max(size, Math.hypot(shape[(j - 1) * 2], shape[(j - 1) * 2 + 1]));
      }
      // 못 본 손은 손목 자리에 모여 있어서 크기가 0 이다
      return { ok: seen !== false && size > 0.03, shape };
    };
    // 거울로 볼 때는 좌우 팔 · 손을 바꿔 읽는다
    const [re, rw, le, lw, rh, lh] = mirror ? [L_ELBOW, L_WRIST, R_ELBOW, R_WRIST, L_HAND, R_HAND] : [R_ELBOW, R_WRIST, L_ELBOW, L_WRIST, R_HAND, L_HAND];
    const seenR = mirror ? m.leftHand?.[f] : m.rightHand?.[f];
    const seenL = mirror ? m.rightHand?.[f] : m.leftHand?.[f];
    out.push({
      arm: Float32Array.of(x(re), y(re), x(rw), y(rw), x(le), y(le), x(lw), y(lw)),
      right: hand(rh, seenR),
      left: hand(lh, seenL),
    });
  }
  return out;
}

/** 손목이 가장 낮았던 자리보다 올라와 있는 장이 "움직이는 중"이다. 손마다 따로 본다 */
function activity(frames: Frame[]) {
  const side = (index: number) => {
    let rest = -Infinity, top = Infinity;
    for (const f of frames) {
      rest = Math.max(rest, f.arm[index]);
      top = Math.min(top, f.arm[index]);
    }
    // 내내 거의 안 움직인 손은 쓰지 않는 손이다
    const used = rest - top > RAISED * 0.75;
    return frames.map((f) => used && f.arm[index] < rest - RAISED);
  };
  return { right: side(3), left: side(7) };
}

function trim(frames: Frame[]) {
  const act = activity(frames);
  let first = -1, last = -1;
  for (let i = 0; i < frames.length; i++) {
    if (act.right[i] || act.left[i]) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0 || last - first < 6) return { start: 0, end: frames.length, act };
  return { start: Math.max(0, first - PAD), end: Math.min(frames.length, last + PAD + 1), act };
}

const dist2 = (a: Float32Array, b: Float32Array, i: number) => Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
function shapeDistance(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let j = 0; j < 40; j += 2) sum += Math.hypot(a[j] - b[j], a[j + 1] - b[j + 1]);
  return sum / 20;
}

type Cell = { position: number; rightArm: number; leftArm: number; rightHand: number | null; leftHand: number | null; shape: number | null };

/** 내 한 장과 친구 한 장의 거리. friendUses 는 친구가 그 손을 쓰는 중인가 */
function compare(mine: Frame, friend: Frame, friendUsesRight: boolean, friendUsesLeft: boolean): Cell {
  // 손목은 팔꿈치보다 두 배로 센다
  const rightArm = (dist2(mine.arm, friend.arm, 0) + 2 * dist2(mine.arm, friend.arm, 2)) / 3;
  const leftArm = (dist2(mine.arm, friend.arm, 4) + 2 * dist2(mine.arm, friend.arm, 6)) / 3;
  const hand = (a: Hand, b: Hand, uses: boolean): number | null => {
    if (!uses || !b.ok) return null;
    return a.ok ? shapeDistance(a.shape, b.shape) : UNSEEN_SHAPE;
  };
  const rightHand = hand(mine.right, friend.right, friendUsesRight);
  const leftHand = hand(mine.left, friend.left, friendUsesLeft);
  const shapes = [rightHand, leftHand].filter((v): v is number => v !== null);
  // 친구가 쓰는 팔을 주로 본다. 둘 다 내리고 있는 팔까지 똑같이 세면 그 0 이 평균을 깎아 점수가 후해진다
  const wr = friendUsesRight ? 1 : IDLE_ARM_WEIGHT;
  const wl = friendUsesLeft ? 1 : IDLE_ARM_WEIGHT;
  return {
    position: (rightArm * wr + leftArm * wl) / (wr + wl),
    rightArm,
    leftArm,
    rightHand,
    leftHand,
    shape: shapes.length ? shapes.reduce((a, b) => a + b, 0) / shapes.length : null,
  };
}

type Pass = {
  score: number;
  position: number;
  shape: number | null;
  parts: FollowScore['parts'];
  /** 짝지은 장들 [내 장, 친구 장] (잘라 낸 뒤의 번호) */
  path: [number, number][];
  cells: Cell[];
  mine: Frame[];
  friend: Frame[];
  friendStart: number;
  mineStart: number;
  friendUses: { right: boolean[]; left: boolean[] };
  unseen: { right: number; left: number };
};

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
// 2026-11-17 승혁: 자리 · 모양 반영 비율을 6:4에서 8:2로. 웹캠은 손가락보다 손 위치를 훨씬 정확하게 잡는다
// (잘 따라 한 시도의 모양 점수가 40점대). 같은 기록에서 잘 따라 함 70~78 → 80~89점, 다른 동작 0~25 → 0~33점.
// 모양이 틀리면 여전히 감점되고 "손가락 모양" 안내는 SHAPE_HINT로 따로 나온다.
function combine(position: number, shape: number | null) {
  const p = toScore(position, POSITION_RANGE);
  return shape === null ? p : Math.round(0.8 * p + 0.2 * toScore(shape, SHAPE_RANGE));
}

function pass(mineMotion: ScoreMotion, friendMotion: ScoreMotion, mirror: boolean): Pass | null {
  const mineAll = readFrames(mineMotion, mirror);
  const friendAll = readFrames(friendMotion, false);
  const mt = trim(mineAll);
  const ft = trim(friendAll);
  const mine = mineAll.slice(mt.start, mt.end);
  const friend = friendAll.slice(ft.start, ft.end);
  const n = mine.length, m = friend.length;
  if (n < 2 || m < 2) return null;
  const usesRight = ft.act.right.slice(ft.start, ft.end);
  const usesLeft = ft.act.left.slice(ft.start, ft.end);

  // 시간 맞추기. 너무 멀리 어긋난 짝은 보지 않는다 (전체 길이의 40%)
  const band = Math.max(Math.abs(n - m) + 2, Math.ceil(0.4 * Math.max(n, m)));
  const cost = new Float32Array(n * m).fill(Infinity);
  const total = new Float32Array(n * m).fill(Infinity);
  const from = new Int8Array(n * m);
  const cells: (Cell | null)[] = new Array(n * m).fill(null);
  for (let i = 0; i < n; i++) {
    const center = Math.round((i * (m - 1)) / Math.max(1, n - 1));
    for (let j = Math.max(0, center - band); j <= Math.min(m - 1, center + band); j++) {
      const c = compare(mine[i], friend[j], usesRight[j], usesLeft[j]);
      cells[i * m + j] = c;
      cost[i * m + j] = c.position + SHAPE_WEIGHT * (c.shape ?? 0);
      let best = i === 0 && j === 0 ? 0 : Infinity;
      let step = 0;
      if (i > 0 && j > 0 && total[(i - 1) * m + j - 1] < best) { best = total[(i - 1) * m + j - 1]; step = 1; }
      if (i > 0 && total[(i - 1) * m + j] < best) { best = total[(i - 1) * m + j]; step = 2; }
      if (j > 0 && total[i * m + j - 1] < best) { best = total[i * m + j - 1]; step = 3; }
      total[i * m + j] = best + cost[i * m + j];
      from[i * m + j] = step;
    }
  }
  if (!Number.isFinite(total[n * m - 1])) return null;
  const path: [number, number][] = [];
  for (let i = n - 1, j = m - 1; ; ) {
    path.push([i, j]);
    const step = from[i * m + j];
    if (step === 1) { i--; j--; } else if (step === 2) i--; else if (step === 3) j--; else break;
  }
  path.reverse();

  const along = path.map(([i, j]) => cells[i * m + j]!);
  const pick = (key: 'rightHand' | 'leftHand' | 'shape') => along.map((c) => c[key]).filter((v): v is number => v !== null);
  const position = mean(along.map((c) => c.position));
  const shapes = pick('shape');
  const shape = shapes.length ? mean(shapes) : null;
  const rightHands = pick('rightHand'), leftHands = pick('leftHand');
  const unseenRatio = (side: 'right' | 'left', uses: boolean[]) => {
    const cellsUsing = path.filter(([, j]) => uses[j]);
    return cellsUsing.length ? cellsUsing.filter(([i]) => !mine[i][side].ok).length / cellsUsing.length : 0;
  };
  return {
    score: combine(position, shape),
    position,
    shape,
    parts: {
      rightArm: mean(along.map((c) => c.rightArm)),
      leftArm: mean(along.map((c) => c.leftArm)),
      rightHand: rightHands.length ? mean(rightHands) : null,
      leftHand: leftHands.length ? mean(leftHands) : null,
    },
    path,
    cells: along,
    mine,
    friend,
    friendStart: ft.start,
    mineStart: mt.start,
    friendUses: { right: usesRight, left: usesLeft },
    unseen: { right: unseenRatio('right', usesRight), left: unseenRatio('left', usesLeft) },
  };
}

function hintsFor(p: Pass, words: FollowScore['words'], mirrored: boolean): string[] {
  const hints: { weight: number; text: string }[] = [];
  if (mirrored) hints.push({ weight: 9, text: '거울처럼 반대 손으로 했어요. 친구와 같은 쪽 손으로 해 보세요.' });
  const wrist = (name: string, index: number, uses: boolean[], outward: number) => {
    const used = p.path.filter(([, j]) => uses[j]);
    if (used.length < 3) return;
    const dx = mean(used.map(([i, j]) => p.mine[i].arm[index - 1] - p.friend[j].arm[index - 1]));
    const dy = mean(used.map(([i, j]) => p.mine[i].arm[index] - p.friend[j].arm[index]));
    // y 는 아래가 +. 내 손이 더 아래면 dy 가 +
    if (dy > 0.15) hints.push({ weight: dy, text: `${name}을 더 높이 들어 보세요.` });
    else if (dy < -0.15) hints.push({ weight: -dy, text: `${name}을 조금 낮춰 보세요.` });
    // outward 는 그 손의 바깥 방향 (오른손 -1, 왼손 +1)
    if (dx * outward > 0.15) hints.push({ weight: dx * outward, text: `${name}을 몸 쪽으로 더 모아 보세요.` });
    else if (dx * outward < -0.15) hints.push({ weight: -dx * outward, text: `${name}을 바깥쪽으로 더 뻗어 보세요.` });
  };
  wrist('오른손', 3, p.friendUses.right, -1);
  wrist('왼손', 7, p.friendUses.left, 1);
  if (p.unseen.right > 0.5) hints.push({ weight: 0.5, text: '오른손이 화면에 잘 안 보였어요. 손 전체가 보이게 해 주세요.' });
  else if (p.parts.rightHand !== null && p.parts.rightHand > SHAPE_HINT) hints.push({ weight: p.parts.rightHand * 2, text: '오른손 손가락 모양이 달랐어요.' });
  if (p.unseen.left > 0.5) hints.push({ weight: 0.5, text: '왼손이 화면에 잘 안 보였어요. 손 전체가 보이게 해 주세요.' });
  else if (p.parts.leftHand !== null && p.parts.leftHand > SHAPE_HINT) hints.push({ weight: p.parts.leftHand * 2, text: '왼손 손가락 모양이 달랐어요.' });
  if (words.length > 1) {
    const worst = words.reduce((a, b) => (b.score < a.score ? b : a));
    if (worst.score < 60) hints.push({ weight: 0.25, text: `「${worst.gloss}」 부분이 가장 달랐어요.` });
  }
  return hints.sort((a, b) => b.weight - a.weight).slice(0, 3).map((h) => h.text);
}

/**
 * 내 동작(mine)을 친구 동작(friend)에 견주어 채점한다.
 * 견줄 만큼 동작이 잡히지 않았으면 null.
 */
export function scoreFollow(mine: ScoreMotion, friend: ScoreMotion, segments: ScoreSegment[] = []): FollowScore | null {
  const straight = pass(mine, friend, false);
  if (!straight) return null;
  const flipped = pass(mine, friend, true);
  const mirrored = !!flipped && flipped.score >= straight.score + 15;

  // 낱말마다: 그 낱말 구간의 친구 장과 짝지어진 것만 모아 다시 점수를 낸다
  const words = segments
    .map((segment) => {
      const cells = straight.cells.filter((_, k) => {
        const friendFrame = straight.path[k][1] + straight.friendStart;
        return friendFrame >= segment.start && friendFrame < segment.end;
      });
      if (cells.length < 2) return null;
      const shapes = cells.map((c) => c.shape).filter((v): v is number => v !== null);
      return { gloss: segment.gloss, score: combine(mean(cells.map((c) => c.position)), shapes.length ? mean(shapes) : null) };
    })
    .filter((w): w is { gloss: string; score: number } => w !== null);

  const aligned = segments
    .map((segment) => {
      const frames = straight.path
        .filter(([, j]) => j + straight.friendStart >= segment.start && j + straight.friendStart < segment.end)
        .map(([i]) => i + straight.mineStart);
      if (frames.length < 2) return null;
      const mine: [number, number] = [Math.min(...frames), Math.max(...frames) + 1];
      const friend: [number, number] = [segment.start, segment.end];
      return { gloss: segment.gloss, friend, mine };
    })
    .filter((a): a is { gloss: string; friend: [number, number]; mine: [number, number] } => a !== null);

  return {
    score: straight.score,
    position: { distance: straight.position, score: toScore(straight.position, POSITION_RANGE) },
    shape: straight.shape === null ? null : { distance: straight.shape, score: toScore(straight.shape, SHAPE_RANGE) },
    parts: straight.parts,
    words,
    hints: hintsFor(straight, words, mirrored),
    mirrored,
    compared: { mine: straight.mine.length, friend: straight.friend.length },
    active: {
      mine: [straight.mineStart, straight.mineStart + straight.mine.length],
      friend: [straight.friendStart, straight.friendStart + straight.friend.length],
    },
    aligned,
  };
}

/** 점수를 한마디로 */
export function verdict(score: number): string {
  if (score >= 85) return '친구와 거의 같아요';
  if (score >= 65) return '거의 맞아요';
  if (score >= 40) return '조금 달랐어요';
  return '많이 달랐어요. 친구를 다시 보고 해 봐요';
}
