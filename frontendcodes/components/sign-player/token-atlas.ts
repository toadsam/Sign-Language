export type TokenAtlas = {
  n: number;
  frames: 4;
  body: 13;
  lhand: 34;
  lim: number;
  x: [number, number][][][];
  edges: [number, number][];
  use: number[];
  useWord: number[];
  useSen: number[];
  words: [string, number][][];
  hand: number[];
  move: number[];
  rest: boolean[];
  share: number[];
};

/** Read the exported JSON object only; never evaluate imported HTML or JavaScript. */
export function readTokenAtlas(text: string): TokenAtlas {
  if (text.length > 40000000) throw new Error('40MB 이하 토큰 atlas를 선택해주세요.');
  if (text.trimStart().startsWith('{')) return decodeTokenAtlas(JSON.parse(text));
  const match = /\bconst\s+D\s*=\s*/.exec(text);
  if (!match) throw new Error('토큰 atlas의 const D JSON을 찾을 수 없습니다.');
  const start = match.index + match[0].length;
  if (text[start] !== '{') throw new Error('토큰 atlas의 JSON 객체가 필요합니다.');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      if (!text.slice(i + 1).trimStart().startsWith(';')) {
        throw new Error('토큰 atlas의 JSON 선언이 완성되지 않았습니다.');
      }
      return decodeTokenAtlas(JSON.parse(text.slice(start, i + 1)));
    }
  }
  throw new Error('토큰 atlas의 JSON 선언이 완성되지 않았습니다.');
}

export function decodeTokenAtlas(value: unknown): TokenAtlas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('토큰 atlas 객체가 필요합니다.');
  }
  const atlas = value as TokenAtlas;
  if (
    !Number.isInteger(atlas.n) ||
    atlas.n < 1 ||
    atlas.n > 1024 ||
    atlas.frames !== 4 ||
    atlas.body !== 13 ||
    atlas.lhand !== 34
  ) {
    throw new Error('1~1024개 토큰, 4프레임, 상체13·왼손21·오른손21 형식이 필요합니다.');
  }
  if (!Number.isFinite(atlas.lim) || atlas.lim <= 0 || atlas.lim > 100) {
    throw new Error('표시 범위가 올바르지 않습니다.');
  }
  if (
    !Array.isArray(atlas.x) ||
    atlas.x.length !== atlas.n ||
    atlas.x.some(
      (token) =>
        !Array.isArray(token) ||
        token.length !== 4 ||
        token.some(
          (frame) =>
            !Array.isArray(frame) ||
            frame.length !== 55 ||
            frame.some(
              (point) =>
                !Array.isArray(point) ||
                point.length !== 2 ||
                point.some((coordinate) => !Number.isFinite(coordinate) || Math.abs(coordinate) > 100),
            ),
        ),
    )
  ) {
    throw new Error('토큰별 4×55×2 유한 좌표가 필요합니다.');
  }
  if (
    !Array.isArray(atlas.edges) ||
    !atlas.edges.length ||
    atlas.edges.length > 256 ||
    atlas.edges.some(
      (edge) =>
        !Array.isArray(edge) ||
        edge.length !== 2 ||
        edge.some((joint) => !Number.isInteger(joint) || joint < 0 || joint >= 55),
    )
  ) {
    throw new Error('55관절 연결 정보가 올바르지 않습니다.');
  }
  for (const key of ['use', 'useWord', 'useSen'] as const) {
    if (
      !Array.isArray(atlas[key]) ||
      atlas[key].length !== atlas.n ||
      atlas[key].some((count) => !Number.isSafeInteger(count) || count < 0)
    ) {
      throw new Error(`${key}: 토큰별 사용 횟수가 올바르지 않습니다.`);
    }
  }
  for (const key of ['hand', 'move', 'share'] as const) {
    if (
      !Array.isArray(atlas[key]) ||
      atlas[key].length !== atlas.n ||
      atlas[key].some((metric) => !Number.isFinite(metric) || (key === 'share' && (metric < 0 || metric > 1)))
    ) {
      throw new Error(`${key}: 토큰별 메타데이터가 올바르지 않습니다.`);
    }
  }
  if (
    !Array.isArray(atlas.rest) ||
    atlas.rest.length !== atlas.n ||
    atlas.rest.some((flag) => typeof flag !== 'boolean')
  ) {
    throw new Error('대기 토큰 정보가 올바르지 않습니다.');
  }
  if (
    !Array.isArray(atlas.words) ||
    atlas.words.length !== atlas.n ||
    atlas.words.some(
      (rows) =>
        !Array.isArray(rows) ||
        rows.length > 1000 ||
        rows.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== 2 ||
            typeof row[0] !== 'string' ||
            row[0].length > 500 ||
            !Number.isFinite(row[1]) ||
            row[1] < 0 ||
            row[1] > 1,
        ),
    )
  ) {
    throw new Error('토큰별 단어와 비율이 올바르지 않습니다.');
  }
  return atlas;
}

export type AtlasSort = 'use' | 'id' | 'hand' | 'move';
export function atlasTokens(atlas: TokenAtlas, query: string, sort: AtlasSort, hideRest: boolean): number[] {
  const trimmed = query.trim();
  return Array.from({ length: atlas.n }, (_, i) => i)
    .filter(
      (i) =>
        (!hideRest || !atlas.rest[i]) &&
        (!trimmed || String(i).includes(trimmed) || atlas.words[i].some((word) => word[0].includes(trimmed))),
    )
    .sort((a, b) => {
      const delta =
        sort === 'use'
          ? atlas.use[b] - atlas.use[a]
          : sort === 'hand'
            ? atlas.hand[a] - atlas.hand[b]
            : sort === 'move'
              ? atlas.move[b] - atlas.move[a]
              : a - b;
      return delta || a - b;
    });
}
export function atlasPreviewFrame(step: number): number {
  return [0, 1, 2, 3, 2, 1][Math.max(0, Math.floor(step)) % 6];
}
