/**
 * '색칠 마을' 디자인 값.
 * 종이 위에 펜으로 그리고 수채 물감으로 칠한 느낌. 배운 곳마다 마을에 색이 하나씩 칠해진다.
 * 화면에서 색이나 글꼴을 직접 적지 말고 여기 값을 가져다 쓴다.
 */

export const Paint = {
  paper: '#FBF5E6',
  paperDeep: '#F3EADB',
  card: '#FFFDF6',
  ink: '#2E2620',
  inkSoft: '#6B5D4F',
  inkFaint: '#8F826F',
  line: 'rgba(46,38,32,0.18)',

  // 물감
  yellow: '#FFC83D',
  yellowSoft: '#FFE08A',
  coral: '#F2937A',
  leaf: '#93C47D',
  sky: '#A9CFEA',
  mint: '#7CC6A4',
  skin: '#F6CDA8',
  hair: '#5B4636',

  // 맞음 · 틀림 (물감 색 위에 진한 글씨를 쓴다)
  right: '#7CC6A4',
  rightSoft: '#E6F5EC',
  wrong: '#F2937A',
  wrongSoft: '#FDEAE4',
} as const;

/** 메뉴마다 정해진 물감 색. 메뉴를 옮길 때 이 색이 화면을 쓸고 지나간다 */
export const TabColor = {
  home: Paint.yellow,
  learn: Paint.leaf,
  translator: Paint.sky,
  mypage: Paint.coral,
} as const;

/** 글꼴: 이야기하는 글(제목)은 고운바탕, 설명 글은 고운돋움 */
export const Font = {
  story: 'GowunBatang_700Bold',
  storyRegular: 'GowunBatang_400Regular',
  body: 'GowunDodum_400Regular',
} as const;

export const Size = {
  caption: 12,
  small: 13,
  body: 15,
  lead: 17,
  title: 21,
  heading: 25,
  display: 30,
} as const;
