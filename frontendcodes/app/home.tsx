import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ChunkyButton } from '@/components/chunky-button';
import { HoneycombMap } from '@/components/honeycomb';
import { Mascot, MascotMood } from '@/components/mascot';
import { useAuth } from '@/context/auth-context';
import { Palette, Radius, Space, Type } from '@/constants/design';
import {
  DAILY_GOAL_TARGET,
  getConsecutiveGoalDays,
  getGoalPercent,
  getTodaySolvedCount,
  normalizeDailySolvedCounts,
} from '@/lib/daily-goal';
import { getCompletedCells, LEARNING_UNITS, QUIZZES_PER_CELL } from '@/lib/learning-units';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';

const HOME_CARD_ANIMATION_COUNT = 3;

// 마스코트를 누를 때마다 차례로 나오는 반응
const MASCOT_TAP_REACTIONS: { mood: MascotMood; line: string }[] = [
  { mood: 'correct', line: '히히, 간지러워요!' },
  { mood: 'thinking', line: '오늘은 어떤 단어를 배워 볼까요?' },
  { mood: 'hello', line: '손가락 다섯 개, 다 보이죠?' },
  { mood: 'cheer', line: '같이 하면 금방이에요!' },
];

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
  const remainingToday = Math.max(DAILY_GOAL_TARGET - solvedToday, 0);
  const streakDays = getConsecutiveGoalDays(dailySolvedCounts);
  const totalSolved = useMemo(
    () => Object.values(dailySolvedCounts).reduce((sum, count) => sum + count, 0),
    [dailySolvedCounts]
  );
  const completedCells = getCompletedCells(totalSolved);
  const [mascotReaction, setMascotReaction] = useState<{ mood: MascotMood; line: string } | null>(null);
  const [mascotTapCount, setMascotTapCount] = useState(0);
  const mascotReactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseMood: MascotMood = solvedToday === 0 ? 'hello' : remainingToday > 0 ? 'cheer' : 'celebrate';
  const baseLine =
    solvedToday === 0
      ? `${nickname}님, 오늘 첫 퀴즈 같이 풀어 볼까요?`
      : remainingToday > 0
        ? `좋아요! ${remainingToday}문제만 더 풀면 꿀단지가 가득 차요!`
        : '오늘 꿀단지 가득! 정말 멋져요';

  useEffect(
    () => () => {
      if (mascotReactionTimerRef.current) clearTimeout(mascotReactionTimerRef.current);
    },
    []
  );
  const goalProgressAnim = useRef(new Animated.Value(0)).current;
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

  useFocusEffect(
    useCallback(() => {
      homeCardAnims.forEach((anim) => anim.setValue(0));
      Animated.stagger(
        90,
        homeCardAnims.map((anim) =>
          Animated.spring(anim, {
            toValue: 1,
            tension: 120,
            friction: 9,
            useNativeDriver: true,
          })
        )
      ).start();
    }, [homeCardAnims])
  );

  function getHomeCardEnterStyle(index: number) {
    const anim = homeCardAnims[index] ?? homeCardAnims[0];
    return {
      opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' as const }),
      transform: [
        {
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [28, 0],
          }),
        },
        {
          scale: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ],
    };
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
              <Text style={styles.profileName}>{nickname}님</Text>
            </View>
            <View style={styles.statusRow}>
              <View style={styles.statusChip} accessible accessibilityLabel={`연속 ${streakDays}일`}>
                <Ionicons name="flame" size={16} color={Palette.primaryWarm} />
                <Text style={styles.statusText}>{streakDays}</Text>
              </View>
              <View style={styles.statusChip} accessible accessibilityLabel={`모은 꿀방울 ${totalSolved}개`}>
                <Ionicons name="water" size={16} color={Palette.mascotLine} />
                <Text style={styles.statusText}>{totalSolved}</Text>
              </View>
            </View>
          </View>

          <Animated.View style={[styles.heroCard, getHomeCardEnterStyle(0)]}>
            <View style={styles.heroTop}>
              <Mascot mood={mascotReaction?.mood ?? baseMood} size={112} interactive onPress={handleMascotPress} />
              <View style={styles.bubble}>
                <View style={styles.bubbleTail} />
                <Text style={styles.bubbleText}>{mascotReaction?.line ?? baseLine}</Text>
              </View>
            </View>

            <View style={styles.goalRow}>
              <View style={styles.goalLabel}>
                <MaterialCommunityIcons name="beehive-outline" size={18} color={Palette.primaryDeep} />
                <Text style={styles.goalTitle}>오늘의 꿀단지</Text>
              </View>
              <Text style={styles.goalCount}>
                {solvedToday}
                <Text style={styles.goalCountTotal}> / {DAILY_GOAL_TARGET}</Text>
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

            <ChunkyButton
              label={remainingToday > 0 ? '오늘의 퀴즈 풀기' : '한 판 더 하기'}
              onPress={() => router.push('/quiz')}
              style={styles.heroButton}
              right={<Ionicons name="arrow-forward" size={20} color={Palette.ink} />}
            />
          </Animated.View>

          <Animated.View style={[styles.mapCard, getHomeCardEnterStyle(1)]}>
            <View style={styles.mapHeader}>
              <Text style={styles.sectionTitle}>벌집 지도</Text>
              <Text style={styles.mapCount}>
                {completedCells} / {LEARNING_UNITS.length}칸
              </Text>
            </View>
            <Text style={styles.mapCaption}>퀴즈 {QUIZZES_PER_CELL}문제마다 벌집 한 칸이 꿀로 차요</Text>
            <HoneycombMap units={LEARNING_UNITS} completed={completedCells} onPressUnit={() => router.push('/learn')} />
          </Animated.View>

          <Animated.View style={[styles.shortcutRow, getHomeCardEnterStyle(2)]}>
            <ChunkyButton
              label="수어 통역"
              onPress={() => router.push('/translator')}
              color={Palette.surface}
              edge={Palette.line}
              borderColor={Palette.line}
              height={60}
              style={styles.shortcut}
              left={<MaterialCommunityIcons name="sign-language" size={22} color={Palette.info} />}
            />
            <ChunkyButton
              label="오답노트"
              onPress={() => router.push('/wrongnote')}
              color={Palette.surface}
              edge={Palette.line}
              borderColor={Palette.line}
              height={60}
              style={styles.shortcut}
              left={<Ionicons name="book" size={20} color={Palette.danger} />}
            />
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

// 카드는 흐린 그림자 대신 또렷한 테두리와 아래 두께로 입체감을 낸다.
const CARD_EDGE = {
  borderWidth: 2,
  borderColor: Palette.line,
  borderBottomWidth: 6,
  borderBottomColor: '#ecd9ae',
};

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
    gap: Space.sm,
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  profileName: {
    fontFamily: Type.family,
    fontSize: Type.title - 2,
    fontWeight: '900',
    color: Palette.ink,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 2,
    borderColor: Palette.line,
  },
  statusText: {
    fontFamily: Type.family,
    fontSize: Type.body,
    fontWeight: '900',
    color: Palette.ink,
  },
  heroCard: {
    marginTop: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
    ...CARD_EDGE,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  bubble: {
    flex: 1,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.primarySoft,
  },
  bubbleTail: {
    position: 'absolute',
    left: -6,
    top: '50%',
    marginTop: -6,
    width: 14,
    height: 14,
    backgroundColor: Palette.primarySoft,
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
    marginTop: Space.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  goalLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  goalTitle: {
    fontFamily: Type.family,
    fontSize: Type.bodyStrong,
    fontWeight: '900',
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
    color: Palette.muted,
  },
  progressTrack: {
    marginTop: Space.sm,
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: '#f6edd8',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
  },
  progressShine: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 4,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  heroButton: {
    marginTop: Space.lg,
  },
  mapCard: {
    marginTop: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    paddingBottom: Space.md,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
    ...CARD_EDGE,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: Type.family,
    fontSize: Type.title,
    fontWeight: '900',
    color: Palette.ink,
  },
  mapCount: {
    fontFamily: Type.family,
    fontSize: Type.body,
    fontWeight: '900',
    color: Palette.primaryDeep,
  },
  mapCaption: {
    marginTop: 2,
    marginBottom: Space.md,
    fontFamily: Type.family,
    fontSize: Type.caption + 1,
    fontWeight: '700',
    color: Palette.muted,
  },
  shortcutRow: {
    marginTop: Space.xl,
    flexDirection: 'row',
    gap: Space.md,
  },
  shortcut: {
    flex: 1,
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
    borderTopWidth: 2,
    borderTopColor: Palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 70,
    paddingBottom: 4,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 64,
    minHeight: 48,
  },
  navIconBubble: {
    width: 40,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBubbleActive: {
    backgroundColor: Palette.primarySoft,
    borderWidth: 2,
    borderColor: Palette.primary,
  },
  navText: {
    fontFamily: Type.family,
    fontSize: Type.caption,
    color: Palette.muted,
    fontWeight: '700',
  },
  navTextActive: {
    color: Palette.primaryDeep,
    fontWeight: '900',
  },
});
