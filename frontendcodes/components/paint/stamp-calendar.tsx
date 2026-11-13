/**
 * 물감 도장 달력.
 * 이번 달을 손으로 그린 칸에 그리고, 문제를 푼 날마다 물감 도장을 찍는다.
 * - 조금 푼 날: 연한 노랑 작은 도장 / 하루 목표를 채운 날: 진한 노랑 큰 도장 + 작은 별
 * - 이어서 푼 날끼리는 붓으로 쓱 이어 준다 (도장 뒤에)
 * - 오늘 칸은 펜으로 동그라미
 * - 화면이 나타나면 도장이 하나씩 톡톡 찍힌다. 움직임 줄이기를 켜면 처음부터 다 찍혀 있다
 * 칸은 누를 수 없다. 보기만 하는 그림이다.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { Font, Paint, Size } from '@/constants/paint';
import { DAILY_GOAL_TARGET, getKstDateKey } from '@/lib/daily-goal';
import { BodyText, RoughBox, useBoil } from './paint-ui';
import { blob, jitterPath, rng, roughLine, smoothOpen } from './rough';

const WEEK_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/* ── 색 섞기: 날마다 물감 색이 조금씩 달라 보이게 ── */
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** 이번 달 정보 (한국 날짜 기준) */
function monthInfo() {
  const todayKey = getKstDateKey();
  const [y, m, d] = todayKey.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = `${y}-${String(m).padStart(2, '0')}-`;
  return { year: y, month: m, today: d, firstWeekday, daysInMonth, keyOf: (day: number) => prefix + String(day).padStart(2, '0') };
}

/** 펜으로 한 번에 그린 동그라미. 시작과 끝이 살짝 겹친다 */
function penLoop(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const R = rng(seed);
  const pts: [number, number][] = [];
  const n = 14;
  const start = -Math.PI * 0.6;
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2.25;
    const k = 1 + (R() - 0.5) * 0.12 + (i / n) * 0.08;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smoothOpen(pts);
}

/** 작은 별 (잉크) */
function starPath(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/* ── 도장 하나: 톡 하고 찍힌다 ── */
function Stamp({
  x,
  y,
  size,
  count,
  seed,
  order,
  playKey,
  reduce,
}: {
  x: number;
  y: number;
  size: number;
  count: number;
  seed: number;
  order: number;
  playKey: number;
  reduce: boolean;
}) {
  const ratio = Math.min(count / DAILY_GOAL_TARGET, 1);
  const full = count >= DAILY_GOAL_TARGET;
  const R = rng(seed);
  const tint = R();
  const color = full ? mix(Paint.yellow, Paint.coral, tint * 0.18) : mix(Paint.yellowSoft, Paint.yellow, ratio * 0.5 + tint * 0.15);
  const opacity = full ? 0.92 : 0.6 + ratio * 0.3;
  const r = size * (0.26 + 0.16 * ratio);
  const c = size / 2;
  const d1 = useMemo(() => blob(c, c, r, r * (0.86 + tint * 0.12), seed, 0.14, 10), [c, r, seed, tint]);
  const d2 = useMemo(() => blob(c + 2, c + 1.5, r * 0.8, r * 0.72, seed + 7, 0.16, 9), [c, r, seed]);
  const star = useMemo(() => jitterPath(starPath(c + r * 0.82, c - r * 0.78, size * 0.11), seed + 3, 0.4), [c, r, size, seed]);

  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      p.value = 1;
      return;
    }
    p.value = 0;
    p.value = withDelay(order * 30, withSpring(1, { damping: 9, stiffness: 220 }));
  }, [playKey, reduce, order, p]);
  const st = useAnimatedStyle(() => ({
    opacity: Math.min(p.value * 2, 1),
    transform: [{ scale: 0.3 + 0.7 * p.value }, { rotate: `${(1 - p.value) * -18}deg` }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.abs, { left: x - c, top: y - c, width: size, height: size }, st]}>
      <Svg width={size} height={size}>
        <Path d={d1} fill={color} opacity={opacity} />
        <Path d={d2} fill={color} opacity={opacity * 0.45} />
        <Path d={d1} fill="none" stroke={color} strokeWidth={1.4} opacity={0.9} />
        {full ? <Path d={star} fill={Paint.ink} stroke={Paint.ink} strokeWidth={0.8} strokeLinejoin="round" /> : null}
      </Svg>
    </Animated.View>
  );
}

/* ── 이어서 푼 날을 잇는 붓 자국 (나타날 때 스르륵) ── */
function BrushLayer({ w, h, paths, width, playKey, reduce, delay }: { w: number; h: number; paths: string[]; width: number; playKey: number; reduce: boolean; delay: number }) {
  const o = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      o.value = 1;
      return;
    }
    o.value = 0;
    o.value = withDelay(delay, withTiming(1, { duration: 360 }));
  }, [playKey, reduce, delay, o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  if (!paths.length) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, { left: 0, top: 0, width: w, height: h }, st]}>
      <Svg width={w} height={h}>
        <G fill="none" stroke={Paint.yellow} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={0.42}>
          {paths.map((d, i) => (
            <Path key={i} d={d} />
          ))}
        </G>
      </Svg>
    </Animated.View>
  );
}

/**
 * 이번 달 물감 도장 달력.
 * counts: 날짜("YYYY-MM-DD")별 푼 문제 수. playKey가 바뀌면 도장을 처음부터 다시 찍는다.
 */
export function StampCalendar({ counts, playKey = 0 }: { counts: Record<string, number>; playKey?: number }) {
  const reduce = useReducedMotion();
  const boil = useBoil();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = e.nativeEvent.layout.width;
    if (Math.abs(nw - w) > 0.5) setW(nw);
  };

  const info = useMemo(monthInfo, []);
  const rows = Math.ceil((info.firstWeekday + info.daysInMonth) / 7);
  const cellW = w / 7;
  const cellH = Math.min(cellW * 0.92, 48);
  const gridH = rows * cellH;

  // 칸마다 위치와 푼 수
  const cells = useMemo(
    () =>
      Array.from({ length: info.daysInMonth }, (_, i) => {
        const day = i + 1;
        const slot = info.firstWeekday + i;
        const col = slot % 7;
        const row = Math.floor(slot / 7);
        return {
          day,
          col,
          row,
          cx: col * cellW + cellW / 2,
          cy: row * cellH + cellH / 2,
          count: counts[info.keyOf(day)] ?? 0,
          isToday: day === info.today,
          isFuture: day > info.today,
        };
      }),
    [info, counts, cellW, cellH]
  );

  const studied = cells.filter((c) => c.count > 0);
  const goalDays = studied.filter((c) => c.count >= DAILY_GOAL_TARGET).length;

  // 같은 줄에서 이어진 날끼리 붓 자국 (토요일→일요일은 줄이 바뀌니 끊는다)
  const brushPaths = useMemo(() => {
    if (!w) return [];
    const out: string[] = [];
    let run: typeof cells = [];
    const flush = () => {
      if (run.length >= 2) {
        const R = rng(run[0].day * 13 + 5);
        out.push(smoothOpen(run.map((c) => [c.cx, c.cy + (R() - 0.5) * cellH * 0.18] as [number, number])));
      }
      run = [];
    };
    cells.forEach((c) => {
      const prev = run[run.length - 1];
      if (c.count > 0 && prev && prev.row === c.row && prev.day === c.day - 1) run.push(c);
      else {
        flush();
        if (c.count > 0) run.push(c);
      }
    });
    flush();
    return out;
  }, [cells, cellH, w]);

  // 칸 사이 펜 선 (연하게)
  const gridLines = useMemo(() => {
    if (!w) return '';
    const parts: string[] = [];
    for (let r = 1; r < rows; r++) parts.push(roughLine(4, r * cellH, w - 4, r * cellH, 40 + r, 1.1));
    for (let c = 1; c < 7; c++) parts.push(roughLine(c * cellW, 4, c * cellW, gridH - 4, 60 + c, 1.1));
    return parts.join(' ');
  }, [w, rows, cellW, cellH, gridH]);

  const todayCell = cells.find((c) => c.isToday);
  const loop = useMemo(
    () => (todayCell && w ? penLoop(todayCell.cx, todayCell.cy, cellW * 0.42, cellH * 0.42, 7 + boil * 0.37) : ''),
    [todayCell, w, cellW, cellH, boil]
  );

  const a11y =
    `${info.month}월 물감 도장 달력. 이번 달 ${studied.length}일 배웠어요` +
    (goalDays ? `, 그중 ${goalDays}일은 하루 목표를 채웠어요` : '') +
    (studied.length ? `. 배운 날: ${studied.map((c) => `${c.day}일`).join(', ')}` : '');

  return (
    <View>
      <RoughBox seed={43} style={styles.box}>
        <View accessible accessibilityRole="image" accessibilityLabel={a11y}>
          <MonthLabel month={info.month} />
          <View style={styles.weekRow}>
            {WEEK_NAMES.map((n, i) => (
              <BodyText
                key={n}
                size={Size.caption}
                soft
                style={[styles.weekName, i === 0 && { color: Paint.coral }]}
              >
                {n}
              </BodyText>
            ))}
          </View>
          <View onLayout={onLayout} style={{ height: gridH || 6 * 44 }}>
            {w > 0 ? (
              <>
                <Svg width={w} height={gridH} style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Path d={gridLines} fill="none" stroke={Paint.line} strokeWidth={1.4} strokeLinecap="round" />
                </Svg>
                <BrushLayer
                  w={w}
                  h={gridH}
                  paths={brushPaths}
                  width={cellH * 0.34}
                  playKey={playKey}
                  reduce={reduce}
                  delay={studied.length * 30}
                />
                {studied.map((c, i) => (
                  <Stamp
                    key={c.day}
                    x={c.cx}
                    y={c.cy}
                    size={Math.min(cellW, cellH) * 1.05}
                    count={c.count}
                    seed={c.day * 7 + info.month}
                    order={i}
                    playKey={playKey}
                    reduce={reduce}
                  />
                ))}
                {cells.map((c) => (
                  <View
                    key={c.day}
                    pointerEvents="none"
                    style={[styles.abs, styles.cell, { left: c.col * cellW, top: c.row * cellH, width: cellW, height: cellH }]}
                  >
                    <BodyText
                      size={Size.small}
                      style={[
                        { color: c.isFuture ? Paint.inkFaint : Paint.ink },
                        (c.isToday || c.count >= DAILY_GOAL_TARGET) && { fontFamily: Font.story },
                      ]}
                    >
                      {c.day}
                    </BodyText>
                  </View>
                ))}
                {loop ? (
                  <Svg width={w} height={gridH} style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Path d={loop} fill="none" stroke={Paint.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </RoughBox>
      <BodyText size={Size.body} style={styles.summary}>
        {studied.length === 0 ? '이번 달은 아직 칠한 날이 없어요' : `이번 달 ${studied.length}일 칠했어요`}
        {goalDays ? <BodyText soft size={Size.small}>{`  · 목표 채운 날 ${goalDays}일`}</BodyText> : null}
      </BodyText>
    </View>
  );
}

function MonthLabel({ month }: { month: number }) {
  return (
    <BodyText soft size={Size.small} style={styles.monthLabel}>
      {month}월
    </BodyText>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  box: { marginHorizontal: 20, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12 },
  monthLabel: { textAlign: 'center', fontFamily: Font.story, marginBottom: 2 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekName: { flex: 1, textAlign: 'center' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  summary: { textAlign: 'center', marginTop: 10, paddingHorizontal: 20 },
});
