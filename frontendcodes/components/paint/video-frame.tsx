/**
 * 수어 영상 액자 (색칠 마을).
 * 영상이 나무 · 종이 액자 안에 걸려 있다. 펜 테두리 두 줄, 액자에 번진 물감, 모서리 테이프와 압정.
 * 아래 액자 틀에는 펜으로 그린 재생 · 멈춤 · 다시 보기 · 느리게 단추가 있다 (기본 재생 단추 대신).
 */
import { useEvent } from 'expo';
import { VideoView, type VideoPlayer } from 'expo-video';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Paint, Size } from '@/constants/paint';
import { PressSquish, RoughBox, StoryText, useBoil } from './paint-ui';
import { blob, jitterPath, rng, roughLine, roughRect } from './rough';

// 액자 틀 두께 · 아래 단추 줄 높이
const PAD = 16;
const CTRL_H = 46;
const GAP = 8;

type Props = {
  /** 영상이 없으면 null. 그때는 fallback을 같은 액자에 넣는다 */
  player: VideoPlayer | null;
  /** 다시 보기 (처음부터 재생) */
  onReplay: () => void;
  fallback?: ReactNode;
  seed?: number;
  /** 맞혔을 때 액자에 노란 물감이 번진다 */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function VideoFrame({ player, onReplay, fallback, seed = 1, glow, style }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  const hasControls = !!player;
  const matBottom = size.h - PAD - (hasControls ? CTRL_H + GAP : 0);
  return (
    <View style={[styles.frame, style]} onLayout={onLayout}>
      {size.w > 0 && <FrameBack w={size.w} h={size.h} seed={seed} glow={!!glow} />}
      {player ? (
        <>
          {/* 영상 칸은 따로 둬서 선이 떨릴 때마다 영상이 다시 그려지지 않게 */}
          <VideoMat player={player} />
          <VideoControls player={player} onReplay={onReplay} />
        </>
      ) : (
        <View style={[styles.mat, styles.emptyMat]}>{fallback}</View>
      )}
      {size.w > 0 && <FrameFront w={size.w} h={size.h} matBottom={matBottom} seed={seed} />}
    </View>
  );
}

const VideoMat = memo(function VideoMat({ player }: { player: VideoPlayer }) {
  return (
    <View style={styles.mat}>
      <VideoView style={styles.video} player={player} nativeControls={false} contentFit="cover" />
    </View>
  );
});

/* ── 액자 뒤판: 나무 바탕, 물감, 바깥 펜 테두리 두 줄, 나뭇결 ── */
function FrameBack({ w, h, seed, glow }: { w: number; h: number; seed: number; glow: boolean }) {
  const t = useBoil();
  const s = seed + t * 0.37;
  const art = useMemo(() => {
    const outer = roughRect(w, h, { seed: s, inset: 3, r: 10, amp: 1.4 });
    const outer2 = roughRect(w, h, { seed: s + 11, inset: 7, r: 8, amp: 1.2 });
    const wash = blob(w / 2, h / 2, w / 2 - 8, h / 2 - 7, seed + 5, 0.06, 14);
    const wash2 = blob(w * 0.35, h * 0.7, w * 0.3, h * 0.25, seed + 8, 0.14, 10);
    // 나뭇결: 위 틀과 양옆 틀에 짧은 선 몇 개
    const R = rng(seed + 2);
    const grain: string[] = [];
    for (let i = 0; i < 3; i++) {
      const x = 24 + R() * (w - 90);
      grain.push(roughLine(x, 11 + R() * 3, x + 30 + R() * 30, 11 + R() * 3, seed + i + t, 0.8));
    }
    for (const x of [10, w - 11]) {
      const y = 30 + R() * (h - 110);
      grain.push(roughLine(x, y, x + (R() - 0.5) * 2, y + 26 + R() * 20, seed + x + t, 0.6));
    }
    return { outer, outer2, wash, wash2, grain };
  }, [w, h, s, seed, t]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        <Path d={art.outer} fill={Paint.paperDeep} stroke="none" />
        <Path d={art.wash} fill={glow ? Paint.yellowSoft : Paint.maple} opacity={glow ? 0.9 : 0.28} />
        <Path d={art.wash2} fill={glow ? Paint.yellow : Paint.maple} opacity={glow ? 0.35 : 0.18} />
        {art.grain.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={Paint.hair} strokeWidth={1} strokeLinecap="round" opacity={0.35} />
        ))}
        <Path d={art.outer} fill="none" stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <Path d={art.outer2} fill="none" stroke={Paint.ink} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
      </Svg>
    </View>
  );
}

/* ── 액자 앞판: 영상 칸 테두리, 위 모서리 테이프, 아래 모서리 압정 (영상 위에 얹힌다) ── */
function FrameFront({ w, h, matBottom, seed }: { w: number; h: number; matBottom: number; seed: number }) {
  const t = useBoil();
  const art = useMemo(() => {
    const mw = w - PAD * 2 + 4, mh = matBottom - PAD + 4;
    const inner = roughRect(mw, mh, { seed: seed + 3 + t * 0.37, inset: 0, r: 6, amp: 1 });
    const tape = jitterPath('M0 0 L34 0 L36 14 L2 14 Z', seed + 7 + t, 0.8);
    const tack = (cx: number, cy: number, k: number) => blob(cx, cy, 5, 5, seed + k + t, 0.12, 8);
    return { inner, tape, tackL: tack(PAD + 2, matBottom + 1, 1), tackR: tack(w - PAD - 2, matBottom + 1, 2) };
  }, [w, matBottom, seed, t]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        <G transform={`translate(${PAD - 2} ${PAD - 2})`}>
          <Path d={art.inner} fill="none" stroke={Paint.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </G>
        {/* 위 왼쪽 · 오른쪽 테이프 */}
        <G transform={`translate(${PAD - 14} ${PAD - 4}) rotate(-28)`}>
          <Path d={art.tape} fill={Paint.yellowSoft} opacity={0.85} stroke={Paint.ink} strokeWidth={1} strokeOpacity={0.55} />
        </G>
        <G transform={`translate(${w - PAD - 16} ${PAD - 20}) rotate(28)`}>
          <Path d={art.tape} fill={Paint.sky} opacity={0.8} stroke={Paint.ink} strokeWidth={1} strokeOpacity={0.55} />
        </G>
        {/* 아래 모서리 압정 */}
        {[art.tackL, art.tackR].map((d, i) => (
          <G key={i}>
            <Path d={d} fill={Paint.coral} stroke={Paint.ink} strokeWidth={1.4} />
            <Path d={jitterPath(`M${i ? w - PAD - 4 : PAD} ${matBottom - 1} l2 -1`, seed + i, 0.3)} stroke={Paint.card} strokeWidth={1.4} strokeLinecap="round" />
          </G>
        ))}
      </Svg>
    </View>
  );
}

/* ── 펜으로 그린 단추 그림 ── */
const CTRL_ICONS = {
  play: 'M11 7 L23 15 L11 23 Z',
  pause: 'M11 7 V23 M19 7 V23',
  replay: 'M21 9 C17 5 9 6 7 12 C5 18 10 24 16 23 C20 22 23 19 23 15 M21 4 L21 10 L15 10',
} as const;

function CtrlIcon({ name, boil, fill = 'none' }: { name: keyof typeof CTRL_ICONS; boil?: boolean; fill?: string }) {
  const t = useBoil(!!boil);
  const d = useMemo(() => jitterPath(CTRL_ICONS[name], 5 + t, 0.5), [name, t]);
  // View로 감싸야 웹에서 상자의 물감 층에 가려지지 않는다
  return (
    <View style={{ width: 24, height: 24 }}>
      <Svg width={24} height={24} viewBox="0 0 30 30">
        <Path d={d} fill={fill} stroke={Paint.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/* ── 아래 틀의 단추 줄: 다시 보기 · 재생/멈춤 · 느리게 ── */
function VideoControls({ player, onReplay }: { player: VideoPlayer; onReplay: () => void }) {
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [rate, setRate] = useState(player.playbackRate || 1);
  const slow = rate < 1;

  function togglePlay() {
    try {
      if (isPlaying) player.pause();
      else player.play();
    } catch {
      // 영상이 아직 준비되지 않았으면 그냥 둔다
    }
  }
  function toggleRate() {
    const next = slow ? 1 : 0.5;
    try {
      player.playbackRate = next;
      setRate(next);
    } catch {
      // 속도를 못 바꾸는 기기면 그대로
    }
  }

  return (
    <View style={styles.controls}>
      <PressSquish onPress={onReplay} accessibilityLabel="다시 보기">
        {(pressed) => (
          <RoughBox seed={31} radius={22} boil={pressed} fill={Paint.card} strokeWidth={1.8} style={styles.btn}>
            <CtrlIcon name="replay" boil={pressed} />
          </RoughBox>
        )}
      </PressSquish>
      <PressSquish onPress={togglePlay} accessibilityLabel={isPlaying ? '멈춤' : '재생'}>
        {(pressed) => (
          <RoughBox seed={33} radius={22} boil={pressed} fill={Paint.card} wash={Paint.yellow} strokeWidth={2} style={[styles.btn, styles.btnMain]}>
            <CtrlIcon name={isPlaying ? 'pause' : 'play'} boil={pressed} fill={isPlaying ? 'none' : Paint.card} />
          </RoughBox>
        )}
      </PressSquish>
      <PressSquish onPress={toggleRate} accessibilityLabel={slow ? '보통 빠르기' : '느리게'}>
        {(pressed) => (
          <RoughBox seed={35} radius={22} boil={pressed} fill={Paint.card} wash={slow ? Paint.leaf : undefined} washOpacity={0.7} strokeWidth={1.8} style={[styles.btn, styles.btnWide]}>
            <StoryText size={Size.body} style={styles.rateText}>{slow ? '0.5×' : '1×'}</StoryText>
          </RoughBox>
        )}
      </PressSquish>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 340, padding: PAD },
  mat: { flex: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: Paint.ink },
  emptyMat: { backgroundColor: Paint.card, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  video: { width: '100%', height: '100%' },
  controls: { height: CTRL_H, marginTop: GAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btnMain: { width: 52 },
  btnWide: { width: 58 },
  rateText: { lineHeight: Size.body * 1.2 },
});
