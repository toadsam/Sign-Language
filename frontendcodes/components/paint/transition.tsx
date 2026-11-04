/**
 * 화면 전환: 물감이 화면을 덮었다가 걷히면서 다음 화면이 나온다.
 *  - brush: 큰 노란 붓이 세 번 지나간다 (학습·퀴즈로 들어갈 때)
 *  - bloom: 누른 자리에서 물감이 번졌다가 옅어진다 (돌아올 때, 결과)
 *  - sweep: 메뉴 색 물감이 옆으로 쓸고 지나간다 (아래 메뉴를 옮길 때)
 * 모든 화면 위에 덮개 하나를 두고, 덮개가 화면을 다 가렸을 때 실제로 경로를 바꾼다.
 */
import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Paint, TabColor } from '@/constants/paint';
import { blob, rng } from './rough';

type Kind = 'brush' | 'bloom' | 'sweep';
type GoOpts = { kind?: Kind; x?: number; y?: number; replace?: boolean; color?: string; dir?: 1 | -1 };
type TabKey = keyof typeof TabColor;
const TAB_ORDER: TabKey[] = ['home', 'learn', 'translator', 'mypage'];

type Nav = {
  go: (href: Href, opts?: GoOpts) => Promise<void>;
  back: (opts?: GoOpts) => Promise<void>;
  tab: (from: TabKey, to: TabKey) => Promise<void>;
  /** 경로는 그대로 두고 덮개만 (같은 화면 안에서 장면이 바뀔 때) */
  cover: (mid: () => void, opts?: GoOpts) => Promise<void>;
};
const Ctx = createContext<Nav | null>(null);

export function usePaintNav(): Nav {
  const v = useContext(Ctx);
  const router = useRouter();
  // 공급자 밖(테스트 화면 등)에서도 깨지지 않게 그냥 이동한다
  return v ?? {
    go: async (h, o) => (o?.replace ? router.replace(h) : router.push(h)),
    back: async () => router.back(),
    tab: async (_f, t) => router.replace(`/${t}` as Href),
    cover: async (mid) => mid(),
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const tween = (dur: number, fn: (t: number) => void) =>
  new Promise<void>((res) => {
    const t0 = Date.now();
    const step = () => {
      const t = Math.min((Date.now() - t0) / dur, 1);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Layer = { d: string; fill?: string; stroke?: string; sw?: number; dash?: string; offset?: number; opacity?: number };

export function PaintTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { width: W, height: H } = useWindowDimensions();
  const [layers, setLayers] = useState<Layer[]>([]);
  const busy = useRef(false);
  const tick = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const run = useCallback(
    async (mid: () => void, o: GoOpts = {}) => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (reduce) {
          mid();
          return;
        }
        const kind = o.kind ?? 'bloom';
        if (kind === 'brush') {
          const sw = H * 0.42;
          const L = (W + sw * 2) * 1.12;
          const ys = [H * 0.18, H * 0.5, H * 0.82];
          const ds = ys.map((y, i) => {
            const a = i % 2 ? W + sw : -sw, b = i % 2 ? -sw : W + sw;
            return `M${a} ${y + (i % 2 ? -20 : 20)} C ${W * 0.3} ${y - 40}, ${W * 0.7} ${y + 40}, ${b} ${y + (i % 2 ? 20 : -20)}`;
          });
          const color = o.color ?? Paint.yellow;
          const frame = (offs: number[]) =>
            setLayers(ds.map((d, i) => ({ d, stroke: i === 1 ? color : Paint.yellowSoft, sw, dash: `${L} ${L}`, offset: offs[i] })));
          const offs = [L, L, L];
          await tween(620, (t) => {
            for (let i = 0; i < 3; i++) offs[i] = L * (1 - ease(Math.min(1, Math.max(0, (t * 620 - i * 110) / 420))));
            frame(offs);
          });
          mid();
          tick();
          await wait(160);
          await tween(680, (t) => {
            for (let i = 0; i < 3; i++) offs[i] = -L * ease(Math.min(1, Math.max(0, (t * 680 - i * 110) / 460)));
            frame(offs);
          });
        } else if (kind === 'sweep') {
          const dir = o.dir ?? 1;
          const color = o.color ?? Paint.yellow;
          const R = rng(11);
          const jag = Array.from({ length: 14 }, () => (R() - 0.5) * 36);
          const band = W * 1.35;
          const shape = (left: number) => {
            const pts: string[] = [];
            for (let i = 0; i <= 13; i++) pts.push(`${(left + jag[i]).toFixed(1)} ${((i / 13) * (H + 80) - 40).toFixed(1)}`);
            for (let i = 13; i >= 0; i--) pts.push(`${(left + band - jag[13 - i]).toFixed(1)} ${((i / 13) * (H + 80) - 40).toFixed(1)}`);
            return 'M' + pts.join(' L') + 'Z';
          };
          const pos = (k: number) => (dir > 0 ? W + 40 - k * (W + 40 + band - W) : -band - 40 + k * (band + 40));
          const pos2 = (k: number) => (dir > 0 ? -(band - W) - k * (W + 60) : 0 + k * (W + 60));
          await tween(420, (t) => setLayers([{ d: shape(pos(ease(t))), fill: color, opacity: 0.95 }]));
          mid();
          tick();
          await wait(140);
          await tween(460, (t) => setLayers([{ d: shape(pos2(ease(t))), fill: color, opacity: 0.95 }]));
        } else {
          const x = o.x ?? W / 2, y = o.y ?? H / 2;
          const Rmax = Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) * 1.2;
          const color = o.color ?? Paint.yellow;
          await tween(560, (t) => {
            const r = ease(t) * Rmax, r2 = ease(Math.max(0, t - 0.15) / 0.85) * Rmax * 0.7;
            setLayers([
              { d: blob(x, y, r + 1, r + 1, 4, 0.12, 12), fill: color },
              { d: blob(x, y, r2 + 1, r2 + 1, 9, 0.14, 10), fill: Paint.yellowSoft },
            ]);
          });
          mid();
          tick();
          await wait(160);
          await tween(520, (t) =>
            setLayers((ls) => ls.map((l) => ({ ...l, opacity: 1 - t }))),
          );
        }
      } finally {
        setLayers([]);
        busy.current = false;
      }
    },
    [W, H, reduce],
  );

  const nav = useMemo<Nav>(
    () => ({
      go: (href, o) => run(() => (o?.replace ? router.replace(href) : router.push(href)), { kind: 'brush', ...o }),
      back: (o) => run(() => (router.canGoBack() ? router.back() : router.replace('/home')), { kind: 'bloom', ...o }),
      tab: (from, to) =>
        run(() => router.replace(`/${to}` as Href), {
          kind: 'sweep',
          color: TabColor[to],
          dir: TAB_ORDER.indexOf(to) > TAB_ORDER.indexOf(from) ? 1 : -1,
        }),
      cover: (mid, o) => run(mid, o),
    }),
    [run, router],
  );

  return (
    <Ctx.Provider value={nav}>
      <View style={{ flex: 1 }}>
        {children}
        {layers.length > 0 && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width={W} height={H}>
              {layers.map((l, i) => (
                <Path
                  key={i}
                  d={l.d}
                  fill={l.fill ?? 'none'}
                  stroke={l.stroke}
                  strokeWidth={l.sw}
                  strokeLinecap="round"
                  strokeDasharray={l.dash}
                  strokeDashoffset={l.offset}
                  opacity={l.opacity ?? 1}
                />
              ))}
            </Svg>
          </View>
        )}
      </View>
    </Ctx.Provider>
  );
}
