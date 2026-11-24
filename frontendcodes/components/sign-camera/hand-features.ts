export type HandFrame = {
  timestampMs: number;
  width: number;
  height: number;
  hands: { side: string; score: number; points: { x: number; y: number }[] }[];
};

/** Local preparation schema; not the ONNX model's agreed tensor contract. */
export function prepareHandInput(frame: HandFrame) {
  if (
    !Number.isFinite(frame.timestampMs) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new Error('손 좌표의 입력 크기가 올바르지 않습니다.');
  }
  const features = Array<number>(84).fill(0);
  const mask = [0, 0];
  const selectedScores = [0, 0];
  for (const [slot, side] of ['Left', 'Right'].entries()) {
    const candidates = frame.hands
      .filter(
        (candidate) =>
          candidate.side === side &&
          Number.isFinite(candidate.score) &&
          candidate.points.length === 21 &&
          candidate.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      )
      .sort((a, b) => b.score - a.score);
    const hand = candidates[0];
    if (!hand) continue;
    const wrist = hand.points[0];
    const relative = hand.points.map((point) => ({
      x: (point.x - wrist.x) * frame.width,
      y: (point.y - wrist.y) * frame.height,
    }));
    const scale = Math.max(...[5, 9, 13, 17].map((i) => Math.hypot(relative[i].x, relative[i].y)));
    if (scale < 1e-6) continue;
    relative.forEach((point, j) => {
      features[slot * 42 + j * 2] = point.x / scale;
      features[slot * 42 + j * 2 + 1] = point.y / scale;
    });
    mask[slot] = 1;
    selectedScores[slot] = hand.score;
  }
  return {
    schema: 'signlingo-hand-input-v1',
    shape: [1, 2, 21, 2],
    handOrder: ['Left', 'Right'],
    axisOrder: ['x', 'y'],
    normalization: 'wrist-origin,max-wrist-to-MCP-pixel-distance',
    features,
    mask,
    selectedScores,
    raw: frame,
  };
}
