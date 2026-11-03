import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Mascot, MascotMood } from '@/components/mascot';
import { useAuth } from '@/context/auth-context';
import { Palette, Radius, Shadow, Space, Type } from '@/constants/design';
import {
  DAILY_GOAL_TARGET,
  getGoalPercent,
  getTodaySolvedCount,
  normalizeDailySolvedCounts,
} from '@/lib/daily-goal';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const HOME_CARD_ANIMATION_COUNT = 3;

// 마스코트를 누를 때마다 차례로 나오는 반응
const MASCOT_TAP_REACTIONS: { mood: MascotMood; line: string }[] = [
  { mood: 'correct', line: '히히, 간지러워요!' },
  { mood: 'thinking', line: '오늘은 어떤 단어를 배워 볼까요?' },
  { mood: 'hello', line: '손가락 다섯 개, 다 보이죠?' },
  { mood: 'cheer', line: '같이 하면 금방이에요!' },
];

type ChartPoint = {
  dateKey: string;
  dayLabel: string;
  solvedCount: number;
};

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRecent7DaysChart(counts: Record<string, number>): ChartPoint[] {
  const today = new Date();
  const points: ChartPoint[] = [];

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - dayOffset);
    const dateKey = toLocalDateKey(date);
    points.push({
      dateKey,
      dayLabel: WEEKDAY_LABELS[date.getDay()],
      solvedCount: counts[dateKey] ?? 0,
    });
  }

  return points;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const nickname = user?.name?.trim() || '사용자';
  const profileImageUri = user?.picture?.trim();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  const loadUserInfo = useCallback(async () => {
    if (!user?.id) {
      setUserInfo(null);
      return;
    }
    try {
      const info = await fetchUserInfo(user.id);
      setUserInfo(info);
    } catch {
      setUserInfo(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadUserInfo();
  }, [loadUserInfo]);

  useFocusEffect(
    useCallback(() => {
      void loadUserInfo();
    }, [loadUserInfo])
  );

  const dailySolvedCounts = useMemo(
    () => normalizeDailySolvedCounts((userInfo?.dailySolvedCounts ?? null) as Record<string, unknown> | null),
    [userInfo?.dailySolvedCounts]
  );
  const solvedToday = getTodaySolvedCount(dailySolvedCounts);
  const goalPercent = getGoalPercent(solvedToday, DAILY_GOAL_TARGET);
  const weeklyChartData = useMemo(() => buildRecent7DaysChart(dailySolvedCounts), [dailySolvedCounts]);
  const maxWeeklySolved = useMemo(
    () => Math.max(...weeklyChartData.map((point) => point.solvedCount), 1),
    [weeklyChartData]
  );
  const remainingToday = Math.max(DAILY_GOAL_TARGET - solvedToday, 0);
  const [mascotReaction, setMascotReaction] = useState<{ mood: MascotMood; line: string } | null>(null);
  const [mascotTapCount, setMascotTapCount] = useState(0);
  const mascotReactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseMood: MascotMood = solvedToday === 0 ? 'hello' : remainingToday > 0 ? 'cheer' : 'celebrate';
  const baseLine =
    solvedToday === 0
      ? `${nickname}님, 오늘 첫 퀴즈 같이 풀어 볼까요?`
      : remainingToday > 0
        ? `좋아요! ${remainingToday}문제만 더 풀면 목표 달성!`
        : '오늘 목표 달성! 정말 멋져요';

  useEffect(
    () => () => {
      if (mascotReactionTimerRef.current) clearTimeout(mascotReactionTimerRef.current);
    },
    []
  );
  const weeklyTotal = useMemo(
    () => weeklyChartData.reduce((sum, point) => sum + point.solvedCount, 0),
    [weeklyChartData]
  );
  const goalProgressAnim = useRef(new Animated.Value(0)).current;
  const weeklyRevealAnims = useRef(Array.from({ length: 7 }, () => new Animated.Value(0))).current;
  const challengeButtonScale = useRef(new Animated.Value(1)).current;
  const quickActionScales = useRef(Array.from({ length: 4 }, () => new Animated.Value(1))).current;
  const homeCardAnims = useRef(
    Array.from({ length: HOME_CARD_ANIMATION_COUNT }, () => new Animated.Value(0))
  ).current;
  const topStretch = useRef(new Animated.Value(0)).current;
  const topStretchValueRef = useRef(0);
  const isTopStretchingRef = useRef(false);
  const bottomStretch = useRef(new Animated.Value(0)).current;
  const bottomStretchValueRef = useRef(0);
  const isBottomStretchingRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const stretchTouchStartYRef = useRef<number | null>(null);
  const wheelReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goalFillWidth = goalProgressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });
  const topStretchHeight = topStretch.interpolate({
    inputRange: [0, 220],
    outputRange: [0, 220],
    extrapolate: 'clamp',
  });
  const bottomStretchHeight = bottomStretch.interpolate({
    inputRange: [0, 220],
    outputRange: [0, 220],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    Animated.timing(goalProgressAnim, {
      toValue: goalPercent,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [goalPercent, goalProgressAnim]);

  useEffect(() => {
    weeklyRevealAnims.forEach((anim) => anim.setValue(0));
    Animated.stagger(
      70,
      weeklyRevealAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      )
    ).start();
  }, [weeklyChartData, weeklyRevealAnims]);

  useFocusEffect(
    useCallback(() => {
      homeCardAnims.forEach((anim) => anim.setValue(0));
      Animated.stagger(
        80,
        homeCardAnims.map((anim) =>
          Animated.timing(anim, {
            toValue: 1,
            duration: 460,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        )
      ).start();
    }, [homeCardAnims])
  );

  function getHomeCardEnterStyle(index: number) {
    const anim = homeCardAnims[index] ?? homeCardAnims[0];
    return {
      opacity: anim,
      transform: [
        {
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [20, 0],
          }),
        },
        {
          scale: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.98, 1],
          }),
        },
      ],
    };
  }

  function animatePressScale(scale: Animated.Value, active: boolean) {
    Animated.spring(scale, {
      toValue: active ? 0.97 : 1,
      tension: 180,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }

  function handleScrollStretch(event: any) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetricsRef.current = {
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: contentOffset.y,
    };
    if (isTopStretchingRef.current || isBottomStretchingRef.current) {
      return;
    }
    setTopStretchValue(Math.min(Math.max(0, -contentOffset.y), 220));
    const overscroll = Math.max(0, contentOffset.y + layoutMeasurement.height - contentSize.height);
    setBottomStretchValue(Math.min(overscroll, 220));
  }

  function setTopStretchValue(value: number) {
    const next = Math.max(0, Math.min(value, 220));
    topStretchValueRef.current = next;
    topStretch.setValue(next);
  }

  function setBottomStretchValue(value: number) {
    const next = Math.max(0, Math.min(value, 220));
    bottomStretchValueRef.current = next;
    bottomStretch.setValue(next);
  }

  function scrollToStretchEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }

  function isScrollAtBottom() {
    const { contentHeight, viewportHeight, offsetY } = scrollMetricsRef.current;
    return contentHeight <= viewportHeight || offsetY + viewportHeight >= contentHeight - 2;
  }

  function isScrollAtTop() {
    return scrollMetricsRef.current.offsetY <= 2;
  }

  function handleStretchTouchStart(event: any) {
    stretchTouchStartYRef.current = event.nativeEvent.pageY ?? null;
  }

  function handleStretchTouchMove(event: any) {
    if (stretchTouchStartYRef.current == null) return;
    const currentY = event.nativeEvent.pageY ?? stretchTouchStartYRef.current;
    const topPullDistance = Math.max(0, currentY - stretchTouchStartYRef.current);
    if (isScrollAtTop() && topPullDistance > 0) {
      isTopStretchingRef.current = true;
      setTopStretchValue(topPullDistance * 0.95);
      return;
    }
    const bottomPullDistance = Math.max(0, stretchTouchStartYRef.current - currentY);
    if (isScrollAtBottom() && bottomPullDistance > 0) {
      isBottomStretchingRef.current = true;
      setBottomStretchValue(bottomPullDistance * 0.95);
      scrollToStretchEnd();
    }
  }

  function handleStretchWheel(event: any) {
    const deltaY = event.nativeEvent?.deltaY ?? event.deltaY ?? 0;
    if (deltaY < 0 && isScrollAtTop()) {
      isTopStretchingRef.current = true;
      setTopStretchValue(topStretchValueRef.current + Math.abs(deltaY) * 0.62);
    } else if (deltaY > 0 && isScrollAtBottom()) {
      isBottomStretchingRef.current = true;
      setBottomStretchValue(bottomStretchValueRef.current + deltaY * 0.62);
      scrollToStretchEnd();
    } else {
      return;
    }
    if (wheelReleaseTimerRef.current) {
      clearTimeout(wheelReleaseTimerRef.current);
    }
    wheelReleaseTimerRef.current = setTimeout(releaseScrollStretch, 120);
  }

  function releaseScrollStretch() {
    topStretchValueRef.current = 0;
    bottomStretchValueRef.current = 0;
    Animated.parallel([
      Animated.spring(topStretch, {
        toValue: 0,
        tension: 120,
        friction: 12,
        useNativeDriver: false,
      }),
      Animated.spring(bottomStretch, {
        toValue: 0,
        tension: 120,
        friction: 12,
        useNativeDriver: false,
      }),
    ]).start(() => {
      isTopStretchingRef.current = false;
      isBottomStretchingRef.current = false;
    });
  }

  function handleMascotPress() {
    const next = mascotTapCount + 1;
    setMascotTapCount(next);
    setMascotReaction(MASCOT_TAP_REACTIONS[next % MASCOT_TAP_REACTIONS.length]);
    if (mascotReactionTimerRef.current) {
      clearTimeout(mascotReactionTimerRef.current);
    }
    mascotReactionTimerRef.current = setTimeout(() => setMascotReaction(null), 2200);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleScrollStretch}
          onTouchStart={handleStretchTouchStart}
          onTouchMove={handleStretchTouchMove}
          onTouchEnd={releaseScrollStretch}
          {...({ onWheel: handleStretchWheel } as any)}
          onScrollEndDrag={releaseScrollStretch}
          onMomentumScrollEnd={releaseScrollStretch}
          scrollEventThrottle={16}>
          <Animated.View pointerEvents="none" style={[styles.bottomStretch, styles.topStretch, { height: topStretchHeight }]}>
            <View style={styles.topStretchHandle} />
          </Animated.View>
          <View style={styles.header}>
            <View style={styles.profileWrap}>
              {profileImageUri ? (
                <Image source={{ uri: profileImageUri }} style={styles.profileImage} />
              ) : (
                <View style={[styles.profileImage, styles.profileFallback]}>
                  <Text style={styles.profileInitial}>{nickname.slice(0, 1)}</Text>
                </View>
              )}
              <View>
                <Text style={styles.greetingSmall}>안녕하세요</Text>
                <Text style={styles.profileName}>{nickname}님</Text>
              </View>
            </View>
            <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="알림">
              <Ionicons name="notifications" size={20} color={Palette.ink} />
            </Pressable>
          </View>

          <Animated.View style={[styles.heroCard, getHomeCardEnterStyle(0)]}>
            <View style={[styles.heroBlob, styles.heroBlobA]} />
            <View style={[styles.heroBlob, styles.heroBlobB]} />
            <View style={styles.heroTop}>
              <Mascot mood={mascotReaction?.mood ?? baseMood} size={128} interactive onPress={handleMascotPress} />
              <View style={styles.bubble}>
                <View style={styles.bubbleTail} />
                <Text style={styles.bubbleText}>{mascotReaction?.line ?? baseLine}</Text>
              </View>
            </View>

            <View style={styles.goalRow}>
              <Text style={styles.goalTitle}>오늘의 목표</Text>
              <Text style={styles.goalCount}>
                {solvedToday}
                <Text style={styles.goalCountTotal}> / {DAILY_GOAL_TARGET}문제</Text>
              </Text>
            </View>
            <View
              style={styles.progressTrack}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="오늘의 목표 진행률"
              accessibilityValue={{ min: 0, max: 100, now: goalPercent }}>
              <Animated.View style={[styles.progressFill, { width: goalFillWidth }]}>
                <View style={styles.progressShine} />
              </Animated.View>
            </View>
            <View style={styles.goalDots}>
              {Array.from({ length: DAILY_GOAL_TARGET }, (_, index) => (
                <View key={index} style={[styles.goalDot, index < solvedToday && styles.goalDotDone]}>
                  {index < solvedToday && <Ionicons name="checkmark" size={12} color={Palette.ink} />}
                </View>
              ))}
            </View>

            <Animated.View style={{ transform: [{ scale: challengeButtonScale }] }}>
              <Pressable
                style={styles.heroButton}
                onPress={() => router.push('/quiz')}
                onPressIn={() => animatePressScale(challengeButtonScale, true)}
                onPressOut={() => animatePressScale(challengeButtonScale, false)}
                accessibilityRole="button">
                <Text style={styles.heroButtonText}>{remainingToday > 0 ? '오늘의 퀴즈 풀기' : '한 판 더 하기'}</Text>
                <View style={styles.heroButtonIcon}>
                  <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                </View>
              </Pressable>
            </Animated.View>
          </Animated.View>

          <Animated.View style={[styles.quickWrap, getHomeCardEnterStyle(1)]}>
            <Text style={styles.sectionTitle}>무엇을 해 볼까요?</Text>
            <View style={styles.quickGrid}>
              {QUICK_ACTIONS.map((action, index) => (
                <Animated.View
                  key={action.route}
                  style={[styles.quickTileWrap, { transform: [{ scale: quickActionScales[index] }] }]}>
                  <Pressable
                    style={[styles.quickTile, { backgroundColor: action.soft }]}
                    onPress={() => router.push(action.route as any)}
                    onPressIn={() => animatePressScale(quickActionScales[index], true)}
                    onPressOut={() => animatePressScale(quickActionScales[index], false)}
                    accessibilityRole="button"
                    accessibilityLabel={`${action.title}, ${action.desc}`}>
                    <View style={[styles.quickTileIcon, { backgroundColor: action.color }]}>
                      {action.icon}
                    </View>
                    <Text style={styles.quickTileText}>{action.title}</Text>
                    <Text style={styles.quickTileDesc}>{action.desc}</Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          </Animated.View>

          <Animated.View style={[styles.weeklyCard, getHomeCardEnterStyle(2)]}>
            <View style={styles.weeklyHeader}>
              <Text style={styles.sectionTitleInCard}>최근 7일 기록</Text>
              <View style={styles.weeklyBadge}>
                <Ionicons name="flame" size={13} color={Palette.warning} />
                <Text style={styles.weeklyBadgeText}>총 {weeklyTotal}문제</Text>
              </View>
            </View>
            <View style={styles.weeklyBarsRow}>
              {weeklyChartData.map((point, index) => {
                const barHeight = Math.max((point.solvedCount / maxWeeklySolved) * 80, 6);
                const isToday = index === weeklyChartData.length - 1;
                const reachedGoal = point.solvedCount >= DAILY_GOAL_TARGET;
                return (
                  <View
                    key={point.dateKey}
                    style={styles.weeklyBarItem}
                    accessible
                    accessibilityLabel={`${point.dayLabel}요일 ${point.solvedCount}문제`}>
                    <Text style={[styles.weeklyValue, isToday && styles.weeklyValueToday]}>{point.solvedCount}</Text>
                    <View style={styles.weeklyTrack}>
                      <Animated.View
                        style={[
                          styles.weeklyFill,
                          isToday && styles.weeklyFillToday,
                          {
                            height: weeklyRevealAnims[index].interpolate({
                              inputRange: [0, 1],
                              outputRange: [6, barHeight],
                            }),
                            opacity: weeklyRevealAnims[index],
                          },
                        ]}
                      />
                    </View>
                    <View style={[styles.weeklyLabelWrap, isToday && styles.weeklyLabelToday]}>
                      <Text style={[styles.weeklyLabel, isToday && styles.weeklyLabelTodayText]}>{point.dayLabel}</Text>
                    </View>
                    {reachedGoal && <Ionicons name="star" size={11} color="#fbbf24" style={styles.weeklyStar} />}
                  </View>
                );
              })}
            </View>
            {weeklyTotal === 0 && (
              <View style={styles.weeklyEmpty}>
                <Mascot mood="sleepy" size={56} />
                <Text style={styles.weeklyEmptyText}>아직 기록이 없어요. 첫 문제를 풀면 막대가 자라요!</Text>
              </View>
            )}
          </Animated.View>

          <Animated.View pointerEvents="none" style={[styles.bottomStretch, { height: bottomStretchHeight }]}>
            <View style={styles.bottomStretchHandle} />
          </Animated.View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} accessibilityRole="tab" accessibilityState={{ selected: true }}>
            <View style={[styles.navIconBubble, styles.navIconBubbleActive]}>
              <Ionicons name="home" size={18} color={Palette.primaryDeep} />
            </View>
            <Text style={[styles.navText, styles.navTextActive]}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')} accessibilityRole="tab">
            <View style={styles.navIconBubble}>
              <Ionicons name="school-outline" size={18} color={Palette.muted} />
            </View>
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/translator')} accessibilityRole="tab">
            <View style={styles.navIconBubble}>
              <MaterialCommunityIcons name="sign-language" size={18} color={Palette.muted} />
            </View>
            <Text style={styles.navText}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')} accessibilityRole="tab">
            <View style={styles.navIconBubble}>
              <Ionicons name="person-outline" size={18} color={Palette.muted} />
            </View>
            <Text style={styles.navText}>마이페이지</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const QUICK_ACTIONS = [
  {
    route: '/translator',
    title: '수어 통역',
    desc: '문장을 수어로',
    color: Palette.info,
    soft: Palette.infoSoft,
    icon: <MaterialCommunityIcons name="sign-language" size={22} color="#ffffff" />,
  },
  {
    route: '/learn',
    title: '학습하기',
    desc: '단어 하나씩',
    color: Palette.success,
    soft: Palette.successSoft,
    icon: <Ionicons name="school" size={22} color="#ffffff" />,
  },
  {
    route: '/quiz',
    title: '퀴즈',
    desc: '실력 확인',
    color: Palette.warning,
    soft: Palette.warningSoft,
    icon: <Ionicons name="help-circle" size={22} color="#ffffff" />,
  },
  {
    route: '/wrongnote',
    title: '오답노트',
    desc: '틀린 것 다시',
    color: Palette.danger,
    soft: Palette.dangerSoft,
    icon: <Ionicons name="book" size={20} color="#ffffff" />,
  },
];

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.bg,
  },
  root: {
    flex: 1,
    backgroundColor: Palette.bg,
  },
  scrollContent: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: 104,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  profileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Palette.surface,
  },
  profileFallback: {
    backgroundColor: Palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontFamily: Type.family,
    fontSize: Type.bodyStrong,
    fontWeight: '800',
    color: Palette.primaryDeep,
  },
  greetingSmall: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    fontWeight: '700',
    color: Palette.muted,
  },
  profileName: {
    fontFamily: Type.family,
    fontSize: Type.title,
    fontWeight: '800',
    color: Palette.ink,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.soft,
  },
  heroCard: {
    marginTop: Space.xl,
    padding: Space.xl,
    borderRadius: Radius.xl,
    backgroundColor: Palette.primarySoft,
    overflow: 'hidden',
    ...Shadow.card,
  },
  heroBlob: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: Palette.primary,
  },
  heroBlobA: {
    width: 180,
    height: 180,
    right: -50,
    top: -60,
    opacity: 0.35,
  },
  heroBlobB: {
    width: 110,
    height: 110,
    left: -30,
    bottom: 40,
    opacity: 0.25,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  bubble: {
    flex: 1,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.surface,
  },
  bubbleTail: {
    position: 'absolute',
    left: -6,
    top: '50%',
    marginTop: -6,
    width: 14,
    height: 14,
    backgroundColor: Palette.surface,
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: {
    fontFamily: Type.family,
    fontSize: Type.body,
    lineHeight: 21,
    fontWeight: '800',
    color: Palette.ink,
  },
  goalRow: {
    marginTop: Space.lg,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  goalTitle: {
    fontFamily: Type.family,
    fontSize: Type.bodyStrong,
    fontWeight: '800',
    color: Palette.ink,
  },
  goalCount: {
    fontFamily: Type.family,
    fontSize: Type.heading,
    fontWeight: '900',
    color: Palette.ink,
  },
  goalCountTotal: {
    fontSize: Type.body,
    fontWeight: '700',
    color: Palette.inkSoft,
  },
  progressTrack: {
    marginTop: Space.sm,
    height: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Palette.primaryWarm,
  },
  progressShine: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 3,
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  goalDots: {
    marginTop: Space.md,
    flexDirection: 'row',
    gap: Space.sm,
  },
  goalDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#e8cf98',
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalDotDone: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  heroButton: {
    marginTop: Space.xl,
    height: 56,
    borderRadius: Radius.pill,
    paddingLeft: Space.xxl,
    paddingRight: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Palette.primary,
    ...Shadow.soft,
  },
  heroButtonText: {
    fontFamily: Type.family,
    color: Palette.ink,
    fontSize: Type.bodyStrong + 1,
    fontWeight: '900',
  },
  heroButtonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickWrap: {
    marginTop: Space.xxl,
  },
  sectionTitle: {
    fontFamily: Type.family,
    fontSize: Type.title,
    fontWeight: '800',
    color: Palette.ink,
    marginBottom: Space.md,
  },
  sectionTitleInCard: {
    fontFamily: Type.family,
    fontSize: Type.bodyStrong + 1,
    fontWeight: '800',
    color: Palette.ink,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
  },
  quickTileWrap: {
    width: '47%',
    flexGrow: 1,
  },
  quickTile: {
    minHeight: 112,
    padding: Space.lg,
    borderRadius: Radius.lg,
  },
  quickTileIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.soft,
  },
  quickTileText: {
    fontFamily: Type.family,
    marginTop: Space.md,
    color: Palette.ink,
    fontSize: Type.bodyStrong,
    fontWeight: '800',
  },
  quickTileDesc: {
    fontFamily: Type.family,
    marginTop: 2,
    color: Palette.inkSoft,
    fontSize: Type.caption + 1,
    fontWeight: '600',
  },
  weeklyCard: {
    marginTop: Space.xxl,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xl,
    paddingBottom: Space.lg,
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
    ...Shadow.card,
  },
  weeklyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  weeklyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Palette.warningSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  weeklyBadgeText: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    color: '#92400e',
    fontWeight: '800',
  },
  weeklyBarsRow: {
    marginTop: Space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  weeklyBarItem: {
    width: 36,
    alignItems: 'center',
  },
  weeklyValue: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    color: Palette.muted,
    fontWeight: '700',
    marginBottom: 4,
  },
  weeklyValueToday: {
    color: Palette.primaryDeep,
    fontWeight: '900',
  },
  weeklyTrack: {
    width: 20,
    height: 84,
    borderRadius: Radius.sm,
    backgroundColor: '#fbf3e1',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weeklyFill: {
    width: '100%',
    borderRadius: Radius.sm,
    backgroundColor: '#ffe08a',
  },
  weeklyFillToday: {
    backgroundColor: Palette.primary,
  },
  weeklyLabelWrap: {
    marginTop: 6,
    width: 26,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weeklyLabelToday: {
    backgroundColor: Palette.primary,
  },
  weeklyLabel: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    color: Palette.muted,
    fontWeight: '700',
  },
  weeklyLabelTodayText: {
    color: Palette.ink,
  },
  weeklyStar: {
    position: 'absolute',
    top: -2,
  },
  weeklyEmpty: {
    marginTop: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  weeklyEmptyText: {
    flex: 1,
    fontFamily: Type.family,
    fontSize: Type.caption + 1,
    lineHeight: 19,
    color: Palette.inkSoft,
    fontWeight: '700',
  },
  bottomStretch: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  topStretch: {
    justifyContent: 'flex-start',
  },
  topStretchHandle: {
    width: 42,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Palette.line,
    marginTop: 10,
  },
  bottomStretchHandle: {
    width: 42,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Palette.line,
    marginBottom: 10,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Palette.surface,
    borderTopWidth: 1,
    borderTopColor: Palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 70,
    paddingBottom: 4,
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: Radius.md,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 64,
    minHeight: 48,
  },
  navIconBubble: {
    width: 36,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBubbleActive: {
    backgroundColor: Palette.primarySoft,
  },
  navText: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    color: Palette.muted,
    fontWeight: '700',
  },
  navTextActive: {
    color: Palette.primaryDeep,
  },
});
