/**
 * 홈 (마을).
 * 학습 단원 하나가 마을 건물 하나다. 퀴즈를 QUIZZES_PER_CELL 문제 풀 때마다 건물 하나가 물감으로 칠해진다.
 * 퀴즈를 풀고 돌아왔을 때 새로 칠할 곳이 생겼으면, 그 건물에 물감이 번지는 모습을 보여 준다.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Bee } from '@/components/paint/bee';
import { PaintConfetti } from '@/components/paint/effects';
import { BodyText, PaintButton, PaintTabBar, PaperScreen, RoughBox, StoryText, Wash } from '@/components/paint/paint-ui';
import { FirstStory, hasSeenFirstStory } from '@/components/paint/first-story';
import { PaintToast } from '@/components/paint/toast';
import { usePaintNav } from '@/components/paint/transition';
import { skyOf, Village, type SkyPhase } from '@/components/paint/village';
import { Font, Paint, Size } from '@/constants/paint';
import { useAuth } from '@/context/auth-context';
import {
  DAILY_GOAL_TARGET,
  getConsecutiveGoalDays,
  getGoalPercent,
  getTodaySolvedCount,
  normalizeDailySolvedCounts,
} from '@/lib/daily-goal';
import { getCompletedCells, LEARNING_UNITS, QUIZZES_PER_CELL } from '@/lib/learning-units';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';
import { feel } from '@/lib/feel';
import { setSkyHour } from '@/lib/sky';

// 꿀짓이를 누를 때마다 차례로 나오는 말
const BEE_LINES = ['히히, 간지러워요!', '오늘은 어떤 표현을 배워 볼까요?', '손가락 다섯 개, 다 보이죠?', '같이 하면 금방이에요!'];

// 시각마다 마을 위에 한 줄 인사
const GREETING: Record<SkyPhase, string> = {
  morning: '좋은 아침이에요. 마을에 아침 햇살이 들어요',
  day: '햇볕 좋은 오후, 마을이 반짝여요',
  evening: '노을이 마을을 물들이고 있어요',
  night: '밤에는 칠한 집에만 불이 켜져요',
};

// 마지막으로 본 칠한 칸 수 · 오늘 푼 수. 퀴즈에서 돌아왔을 때 새로 칠할 곳과 목표 달성을 알아내려고 기억해 둔다
let lastSeenCells: number | null = null;
let lastSeenSolved: number | null = null;

/* ── 당겨서 새로고침: 위에서 물감 한 방울이 떨어져 톡 퍼진다 ── */
function RefreshDrop({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active || reduce) {
      p.value = 0;
      return;
    }
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }), -1);
  }, [active, reduce, p]);
  const dropSt = useAnimatedStyle(() => ({
    opacity: p.value < 0.7 ? 1 : 0,
    transform: [{ translateY: -20 + Math.min(p.value / 0.7, 1) * 56 }, { rotate: '-45deg' }],
  }));
  const splatSt = useAnimatedStyle(() => {
    const k = p.value < 0.7 ? 0 : (p.value - 0.7) / 0.3;
    return { opacity: k > 0 ? 1 - k * 0.8 : 0, transform: [{ scaleX: 0.3 + k * 1.4 }, { scaleY: 0.3 + k * 0.5 }] };
  });
  if (!active) return null;
  return (
    <View pointerEvents="none" style={styles.refresh}>
      <Animated.View style={[styles.refreshDrop, dropSt]} />
      <Animated.View style={[styles.refreshSplat, splatSt]} />
    </View>
  );
}

/* ── 오늘 목표 달성 축하 ── */
function GoalCelebration({ visible, streak, onClose }: { visible: boolean; streak: number; onClose: () => void }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!visible) return;
    feel.celebrate();
    s.value = reduce ? 1 : withSequence(withTiming(0, { duration: 1 }), withSpring(1, { damping: 9, stiffness: 140 }));
    if (reduce) {
      setShown(streak);
      return;
    }
    setShown(0);
    let raf = 0;
    const t0 = Date.now() + 400;
    const step = () => {
      const t = Math.max(0, Math.min(1, (Date.now() - t0) / 900));
      setShown(Math.round(streak * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visible, streak, reduce, s]);
  const st = useAnimatedStyle(() => ({
    opacity: Math.min(s.value * 1.5, 1),
    transform: [{ scale: 0.6 + s.value * 0.4 }, { rotate: `${(1 - s.value) * -8}deg` }],
  }));
  if (!visible) return null;
  return (
    <View style={styles.celebrateBack}>
      {/* 바깥을 눌러도 닫힌다. 버튼 안에 버튼이 들어가지 않게 카드와 형제로 둔다 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="축하 창 닫기" />
      <PaintConfetti trigger={1} count={40} />
      <Animated.View style={st} accessibilityLiveRegion="assertive">
        <RoughBox seed={77} wash={Paint.yellowSoft} style={styles.celebrateCard}>
          <Bee size={86} />
          <StoryText size={Size.display}>오늘 목표 완료!</StoryText>
          <BodyText soft style={{ textAlign: 'center' }}>물방울 다섯 개가 가득 찼어요</BodyText>
          <View style={styles.streakBig}>
            <StoryText size={52} style={{ lineHeight: 60 }}>{shown}</StoryText>
            <StoryText size={Size.title}>일 연속</StoryText>
          </View>
          <PaintButton label="좋아요" onPress={onClose} seed={78} style={{ alignSelf: 'stretch' }} />
        </RoughBox>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const nav = usePaintNav();
  const { user } = useAuth();
  const nickname = user?.name?.trim() || '';
  // 발표·확인용: /home?hour=21 은 밤 마을, ?month=1 은 겨울 마을, ?cells=5 는 칠한 곳 5개, ?demo=goal 은 목표 달성 축하, ?demo=paint 는 칠하는 장면, ?demo=intro 는 첫 실행 이야기
  const params = useLocalSearchParams<{ hour?: string; demo?: string; cells?: string; month?: string }>();
  const monthParam = params.month && !Number.isNaN(Number(params.month)) ? Number(params.month) : undefined;
  const hourParam = params.hour !== undefined && params.hour !== '' && !Number.isNaN(Number(params.hour)) ? Number(params.hour) : undefined;
  const phase = skyOf(hourParam ?? new Date().getHours());
  // 확인용 시각을 앱 전체 종이에도 적용한다 (다른 화면으로 가도 같은 하늘)
  useEffect(() => {
    if (hourParam !== undefined) setSkyHour(hourParam);
  }, [hourParam]);
  // 처음 한 번만: 꿀짓이가 빈 종이에 마을 밑그림을 그려 주는 이야기 (?demo=intro 로 다시 보기)
  const [showStory, setShowStory] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasSeenFirstStory().then((seen) => {
      if (alive && !seen) setShowStory(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const loadUserInfoRef = useRef<() => Promise<void>>(async () => {});
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    feel.tap();
    const t0 = Date.now();
    await loadUserInfoRef.current();
    // 물방울이 한 번은 떨어지게
    setTimeout(() => setRefreshing(false), Math.max(0, 900 - (Date.now() - t0)));
  }, []);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadUserInfo = useCallback(async () => {
    if (!user?.id) {
      setUserInfo(null);
      setLoaded(true);
      return;
    }
    try {
      setUserInfo(await fetchUserInfo(user.id));
    } catch {
      setUserInfo(null);
    } finally {
      setLoaded(true);
    }
  }, [user?.id]);

  loadUserInfoRef.current = loadUserInfo;
  useEffect(() => {
    void loadUserInfo();
  }, [loadUserInfo]);

  useFocusEffect(
    useCallback(() => {
      void loadUserInfo();
    }, [loadUserInfo]),
  );

  const dailySolvedCounts = useMemo(
    () => normalizeDailySolvedCounts((userInfo?.dailySolvedCounts ?? null) as Record<string, unknown> | null),
    [userInfo?.dailySolvedCounts],
  );
  const solvedToday = getTodaySolvedCount(dailySolvedCounts);
  const goalPercent = getGoalPercent(solvedToday, DAILY_GOAL_TARGET);
  const remainingToday = Math.max(DAILY_GOAL_TARGET - solvedToday, 0);
  const streakDays = getConsecutiveGoalDays(dailySolvedCounts);
  const totalSolved = useMemo(() => Object.values(dailySolvedCounts).reduce((sum, c) => sum + c, 0), [dailySolvedCounts]);
  const cellsParam = Number(params.cells);
  const completedCells = params.cells && !Number.isNaN(cellsParam) ? cellsParam : getCompletedCells(totalSolved);
  const titles = LEARNING_UNITS.map((u) => u.title);
  const allDone = completedCells >= titles.length;
  const currentTitle = titles[Math.min(completedCells, titles.length - 1)];
  const drops = Math.round(goalPercent / 20); // 오늘 목표를 물방울 5개로

  // 새로 칠할 곳: 지난번보다 칠한 칸이 늘었으면 그 칸
  const [paintIndex, setPaintIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ title: string; sub?: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((title: string, sub?: string) => {
    setToast({ title, sub });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (!loaded) return;
    if (lastSeenCells !== null && completedCells > lastSeenCells) {
      const idx = completedCells - 1;
      setPaintIndex(idx);
      const t = setTimeout(() => {
        showToast(`${titles[idx]}에 색이 칠해졌어요`, completedCells < titles.length ? `다음은 ${titles[completedCells]}이에요` : '마을을 다 칠했어요');
        setPaintIndex(null);
      }, 2200);
      lastSeenCells = completedCells;
      return () => clearTimeout(t);
    }
    lastSeenCells = completedCells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, completedCells]);

  // 오늘 목표를 막 채웠으면 축하 (마을이 칠해지는 중이면 그게 끝난 뒤에)
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const prev = lastSeenSolved;
    lastSeenSolved = solvedToday;
    if (prev === null || prev >= DAILY_GOAL_TARGET || solvedToday < DAILY_GOAL_TARGET) return;
    const t = setTimeout(() => setCelebrate(true), paintIndex !== null ? 3400 : 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, solvedToday]);

  // 발표·확인용 장면
  useEffect(() => {
    if (params.demo === 'goal') setCelebrate(true);
    if (params.demo === 'intro') setShowStory(true);
    if (params.demo === 'paint') {
      const idx = Math.min(Math.max(completedCells, 1), titles.length) - 1;
      setPaintIndex(idx);
      const t = setTimeout(() => setPaintIndex(null), 2600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.demo]);

  const [beeTap, setBeeTap] = useState<number | null>(null);
  const beeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBee = () => {
    setBeeTap((n) => ((n ?? -1) + 1) % BEE_LINES.length);
    if (beeTimer.current) clearTimeout(beeTimer.current);
    beeTimer.current = setTimeout(() => setBeeTap(null), 2200);
  };
  const beeLine =
    beeTap !== null
      ? BEE_LINES[beeTap]
      : solvedToday === 0
        ? phase === 'night'
          ? `${nickname ? nickname + '님, ' : ''}졸려도… 한 문제만 같이 풀고 잘까요?`
          : phase === 'morning'
            ? `좋은 아침! ${nickname ? nickname + '님, ' : ''}오늘 첫 퀴즈 같이 풀어 볼까요?`
            : `${nickname ? nickname + '님, ' : ''}오늘 첫 퀴즈 같이 풀어 볼까요?`
        : remainingToday > 0
          ? `${remainingToday}문제만 더 풀면 오늘 물방울이 가득 차요`
          : '오늘 물방울 가득! 정말 멋져요';

  const onPlace = (i: number, at: { x: number; y: number }) => {
    if (i > completedCells) {
      showToast(`${titles[i]}은(는) 아직 잠겨 있어요`, `${currentTitle}부터 칠해 볼까요?`);
      return;
    }
    // 지금은 단원별 퀴즈가 없어서 모두 같은 퀴즈로 들어간다
    void nav.go('/quiz', at);
  };

  return (
    <PaperScreen>
      <RefreshDrop active={refreshing} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" colors={['transparent']} progressBackgroundColor="transparent" />
        }
      >
        <View style={styles.head}>
          {/* 로고가 오면 이 칸에 넣는다 */}
          <RoughBox dashed stroke="rgba(46,38,32,.4)" fill="transparent" seed={4} style={styles.logo}>
            <StoryText size={Size.lead + 1}>수어지교</StoryText>
          </RoughBox>
          <View style={styles.drops} accessible accessibilityLabel={`오늘 목표 ${solvedToday}/${DAILY_GOAL_TARGET}, 연속 ${streakDays}일`}>
            {Array.from({ length: 5 }, (_, i) => (
              <View key={i} style={[styles.drop, i < drops && styles.dropFull]} />
            ))}
            <BodyText soft size={Size.caption} style={{ marginLeft: 4 }}>연속 {streakDays}일</BodyText>
          </View>
        </View>

        <View style={styles.story}>
          <BodyText soft size={Size.small} style={{ marginBottom: 2 }}>{GREETING[phase]}</BodyText>
          <StoryText size={Size.heading}>
            {allDone ? (
              <>마을을 <StoryText size={Size.heading} style={styles.mark}>다</StoryText> 칠했어요</>
            ) : (
              <>
                오늘은 <StoryText size={Size.heading} style={styles.mark}>{currentTitle}</StoryText>에{'\n'}색을 칠할 차례예요
              </>
            )}
          </StoryText>
          <BodyText soft style={{ marginTop: 6 }}>
            퀴즈를 {QUIZZES_PER_CELL}문제 풀 때마다 마을에 물감이 번져요.{'\n'}건물을 눌러 들어가 보세요.
          </BodyText>
        </View>

        <View style={styles.village}>
          <Village
            titles={titles}
            completed={params.demo === 'paint' ? Math.max(completedCells, 1) : completedCells}
            paintIndex={paintIndex}
            hour={hourParam}
            month={monthParam}
            onPressPlace={onPlace}
          />
        </View>

        <Pressable onPress={onBee} accessibilityRole="button" accessibilityLabel="꿀짓이에게 말 걸기" style={styles.talkRow}>
          <Bee size={52} phase={phase} />
          <RoughBox seed={17} style={styles.bubble}>
            <BodyText>{beeLine}</BodyText>
          </RoughBox>
        </Pressable>

        <RoughBox seed={9} style={styles.today}>
          <View style={styles.todayTop}>
            <View style={styles.todayIcon}>
              <Wash color={Paint.yellowSoft} seed={5} />
              <BodyText style={{ fontFamily: Font.story, fontSize: Size.title }}>{solvedToday}</BodyText>
            </View>
            <View style={{ flex: 1 }}>
              <BodyText soft size={Size.small}>오늘의 퀴즈 · {solvedToday}/{DAILY_GOAL_TARGET}</BodyText>
              <StoryText size={Size.title}>{remainingToday > 0 ? `${remainingToday}문제 남았어요` : '오늘 목표를 채웠어요'}</StoryText>
            </View>
          </View>
          <PaintButton
            label={remainingToday > 0 ? '오늘의 퀴즈 풀기' : '한 판 더 하기'}
            onPress={(at) => void nav.go('/quiz', at)}
            seed={23}
          />
        </RoughBox>

        <PaintButton variant="ghost" small label="오답 노트 보기" onPress={(at) => void nav.go('/wrongnote', { kind: 'bloom', ...at })} seed={27} style={{ marginTop: 10 }} />
      </ScrollView>

      <PaintToast visible={!!toast} title={toast?.title ?? ''} sub={toast?.sub} />
      <PaintTabBar current="home" />
      <FirstStory visible={showStory} onDone={() => setShowStory(false)} nickname={nickname} />
      <GoalCelebration visible={celebrate} streak={Math.max(streakDays, 1)} onClose={() => setCelebrate(false)} />
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 },
  logo: { height: 40, paddingHorizontal: 14, justifyContent: 'center' },
  drops: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  drop: { width: 14, height: 14, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomRightRadius: 7, borderWidth: 1.5, borderColor: Paint.ink, transform: [{ rotate: '-45deg' }] },
  dropFull: { backgroundColor: Paint.yellow },
  story: { paddingHorizontal: 22, paddingTop: 18 },
  mark: { backgroundColor: Paint.yellowSoft },
  village: { marginTop: 4 },
  talkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, marginTop: 2 },
  bubble: { flex: 1, paddingVertical: 10, paddingHorizontal: 14 },
  today: { marginHorizontal: 20, marginTop: 12, padding: 14, gap: 12 },
  todayTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  todayIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },

  refresh: { position: 'absolute', top: 8, left: 0, right: 0, height: 70, alignItems: 'center', zIndex: 30 },
  refreshDrop: { position: 'absolute', top: 6, width: 18, height: 18, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomRightRadius: 9, borderWidth: 1.8, borderColor: Paint.ink, backgroundColor: Paint.yellow },
  refreshSplat: { position: 'absolute', top: 52, width: 40, height: 14, borderRadius: 10, backgroundColor: Paint.yellow, borderWidth: 1.5, borderColor: Paint.ink },

  celebrateBack: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(46,38,32,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 90, elevation: 90, padding: 28 },
  celebrateCard: { alignItems: 'center', gap: 6, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 18, minWidth: 280 },
  streakBig: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 6 },
});
