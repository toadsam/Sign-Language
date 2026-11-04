/**
 * 홈 (마을).
 * 학습 단원 하나가 마을 건물 하나다. 퀴즈를 QUIZZES_PER_CELL 문제 풀 때마다 건물 하나가 물감으로 칠해진다.
 * 퀴즈를 풀고 돌아왔을 때 새로 칠할 곳이 생겼으면, 그 건물에 물감이 번지는 모습을 보여 준다.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Bee } from '@/components/paint/bee';
import { BodyText, PaintButton, PaintTabBar, PaperScreen, RoughBox, StoryText, Wash } from '@/components/paint/paint-ui';
import { PaintToast } from '@/components/paint/toast';
import { usePaintNav } from '@/components/paint/transition';
import { Village } from '@/components/paint/village';
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

// 꿀짓이를 누를 때마다 차례로 나오는 말
const BEE_LINES = ['히히, 간지러워요!', '오늘은 어떤 표현을 배워 볼까요?', '손가락 다섯 개, 다 보이죠?', '같이 하면 금방이에요!'];

// 마지막으로 본 칠한 칸 수. 퀴즈에서 돌아왔을 때 새로 칠할 곳을 알아내려고 기억해 둔다
let lastSeenCells: number | null = null;

export default function HomeScreen() {
  const nav = usePaintNav();
  const { user } = useAuth();
  const nickname = user?.name?.trim() || '';
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
  const completedCells = getCompletedCells(totalSolved);
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
        ? `${nickname ? nickname + '님, ' : ''}오늘 첫 퀴즈 같이 풀어 볼까요?`
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          <Village titles={titles} completed={completedCells} paintIndex={paintIndex} onPressPlace={onPlace} />
        </View>

        <Pressable onPress={onBee} accessibilityRole="button" accessibilityLabel="꿀짓이에게 말 걸기" style={styles.talkRow}>
          <Bee size={52} />
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
});
