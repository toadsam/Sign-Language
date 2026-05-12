import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BookOpenTextIcon } from 'phosphor-react-native/lib/module/icons/BookOpenText';
import { useAuth } from '@/context/auth-context';
import { Fonts } from '@/constants/theme';
import {
  DAILY_GOAL_TARGET,
  getGoalPercent,
  getTodaySolvedCount,
  normalizeDailySolvedCounts,
} from '@/lib/daily-goal';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';

const PRIMARY = '#1f80e3';
const ACCENT = '#7c6cf2';
const FONT = Fonts.rounded;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const HOME_CARD_ANIMATION_COUNT = 4;

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
              <Image
                source={
                  profileImageUri
                    ? { uri: profileImageUri }
                    : { uri: 'https://cdn-icons-png.flaticon.com/512/149/149071.png' }
                }
                style={styles.profileImage}
              />
              <Text style={styles.profileName}>{nickname}</Text>
            </View>
            <Pressable style={styles.iconButton}>
              <Ionicons name="notifications" size={20} color="#111827" />
            </Pressable>
          </View>

          <View style={styles.intro}>
            <Text style={styles.greeting}>안녕하세요, {nickname}님</Text>
            <Text style={styles.greetingSub}>수어 학습을 응원합니다!</Text>
          </View>

          <Animated.View style={[styles.goalCard, getHomeCardEnterStyle(0)]}>
            <View style={styles.goalRow}>
              <Text style={styles.goalTitle}>오늘의 목표</Text>
              <Text style={styles.goalPercent}>{goalPercent}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: goalFillWidth }]} />
            </View>
            <Text style={styles.goalDesc}>
              오늘의 퀴즈 {DAILY_GOAL_TARGET}개 중 {solvedToday}개 완료
            </Text>
          </Animated.View>

          <Animated.View style={[styles.challengeCard, getHomeCardEnterStyle(1)]}>
            <View style={styles.challengeHero}>
              <View style={styles.challengeHeroText}>
                <View style={styles.challengeBadge}>
                  <Ionicons name="sparkles" size={12} color="#ffffff" />
                  <Text style={styles.challengeBadgeText}>오늘의 챌린지</Text>
                </View>
                <Text style={styles.challengeHeroTitle}>오늘의 퀴즈 풀기</Text>
                <Text style={styles.challengeHeroSub}>
                  {remainingToday > 0 ? `${remainingToday}문제만 더 풀면 목표 달성` : '오늘 목표를 완료했어요'}
                </Text>
              </View>
              <View style={styles.challengeIconPanel}>
                <BookOpenTextIcon size={42} color={PRIMARY} weight="duotone" duotoneOpacity={0.28} />
                <View style={styles.challengeIconDot} />
              </View>
            </View>

            <View style={styles.challengeBody}>
              <View style={styles.challengeMetaRow}>
                <View style={styles.challengeMetaPill}>
                  <Ionicons name="help-circle" size={14} color={PRIMARY} />
                  <Text style={styles.challengeMetaText}>{DAILY_GOAL_TARGET}문제</Text>
                </View>
                <View style={styles.challengeMetaPill}>
                  <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                  <Text style={styles.challengeMetaText}>{solvedToday}개 완료</Text>
                </View>
                <View style={styles.challengeMetaPill}>
                  <Ionicons name="time-outline" size={14} color="#64748b" />
                  <Text style={styles.challengeMetaText}>약 3분</Text>
                </View>
              </View>
              <Animated.View style={{ transform: [{ scale: challengeButtonScale }] }}>
                <Pressable
                  style={styles.challengeButton}
                  onPress={() => router.push('/quiz')}
                  onPressIn={() => animatePressScale(challengeButtonScale, true)}
                  onPressOut={() => animatePressScale(challengeButtonScale, false)}>
                  <Text style={styles.challengeButtonText}>퀴즈 시작하기</Text>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </Pressable>
              </Animated.View>
            </View>
          </Animated.View>

          <Animated.View style={[styles.weeklyCard, getHomeCardEnterStyle(2)]}>
            <View style={styles.weeklyHeader}>
              <Text style={styles.weeklyTitle}>최근 7일 풀이 그래프</Text>
              <View style={styles.weeklyBadge}>
                <Text style={styles.weeklyBadgeText}>총 {weeklyTotal}문제</Text>
              </View>
            </View>
            <View style={styles.weeklyBarsRow}>
              {weeklyChartData.map((point, index) => {
                const barHeight = Math.max((point.solvedCount / maxWeeklySolved) * 80, 6);
                return (
                  <View key={point.dateKey} style={styles.weeklyBarItem}>
                    <Text style={styles.weeklyValue}>{point.solvedCount}</Text>
                    <View style={styles.weeklyTrack}>
                      <Animated.View
                        style={[
                          styles.weeklyFill,
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
                    <Text style={styles.weeklyLabel}>{point.dayLabel}</Text>
                  </View>
                );
              })}
            </View>
          </Animated.View>

          <Animated.View style={[styles.quickWrap, getHomeCardEnterStyle(3)]}>
            <Text style={styles.quickTitle}>빠른 메뉴</Text>
            <View style={styles.quickGrid}>
              <Animated.View style={[styles.quickTileWrap, { transform: [{ scale: quickActionScales[0] }] }]}>
                <Pressable
                  style={styles.quickTile}
                  onPress={() => router.push('/translator')}
                  onPressIn={() => animatePressScale(quickActionScales[0], true)}
                  onPressOut={() => animatePressScale(quickActionScales[0], false)}>
                  <View style={[styles.quickTileIcon, { backgroundColor: '#e8f2ff' }]}>
                    <MaterialCommunityIcons name="sign-language" size={21} color={PRIMARY} />
                  </View>
                  <Text style={styles.quickTileText}>수어 통역</Text>
                </Pressable>
              </Animated.View>
              <Animated.View style={[styles.quickTileWrap, { transform: [{ scale: quickActionScales[1] }] }]}>
                <Pressable
                  style={styles.quickTile}
                  onPress={() => router.push('/learn')}
                  onPressIn={() => animatePressScale(quickActionScales[1], true)}
                  onPressOut={() => animatePressScale(quickActionScales[1], false)}>
                  <View style={[styles.quickTileIcon, { backgroundColor: '#effdf5' }]}>
                    <Ionicons name="school" size={21} color="#22c55e" />
                  </View>
                  <Text style={styles.quickTileText}>학습하기</Text>
                </Pressable>
              </Animated.View>
              <Animated.View style={[styles.quickTileWrap, { transform: [{ scale: quickActionScales[2] }] }]}>
                <Pressable
                  style={styles.quickTile}
                  onPress={() => router.push('/quiz')}
                  onPressIn={() => animatePressScale(quickActionScales[2], true)}
                  onPressOut={() => animatePressScale(quickActionScales[2], false)}>
                  <View style={[styles.quickTileIcon, { backgroundColor: '#fff7df' }]}>
                    <Ionicons name="help-circle" size={21} color="#f59e0b" />
                  </View>
                  <Text style={styles.quickTileText}>퀴즈</Text>
                </Pressable>
              </Animated.View>
              <Animated.View style={[styles.quickTileWrap, { transform: [{ scale: quickActionScales[3] }] }]}>
                <Pressable
                  style={styles.quickTile}
                  onPress={() => router.push('/wrongnote')}
                  onPressIn={() => animatePressScale(quickActionScales[3], true)}
                  onPressOut={() => animatePressScale(quickActionScales[3], false)}>
                  <View style={[styles.quickTileIcon, { backgroundColor: '#fff1f2' }]}>
                    <Ionicons name="book" size={21} color="#ef4444" />
                  </View>
                  <Text style={styles.quickTileText}>오답노트</Text>
                </Pressable>
              </Animated.View>
            </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.bottomStretch, { height: bottomStretchHeight }]}>
            <View style={styles.bottomStretchHandle} />
          </Animated.View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem}>
            <View style={[styles.navIconBubble, styles.navIconBubbleActive]}>
              <Ionicons name="home" size={18} color={PRIMARY} />
            </View>
            <Text style={[styles.navText, styles.navTextActive]}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/learn')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="school-outline" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/translator')}>
            <View style={styles.navIconBubble}>
              <MaterialCommunityIcons name="sign-language" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="person-outline" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>마이페이지</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8f7ff',
  },
  root: {
    flex: 1,
    backgroundColor: '#f8f7ff',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
    gap: 10,
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileName: {
    fontFamily: FONT,
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d7d9ef',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  intro: {
    marginTop: 14,
  },
  greeting: {
    fontFamily: FONT,
    fontSize: 21,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 29,
  },
  greetingSub: {
    fontFamily: FONT,
    marginTop: 3,
    fontSize: 15,
    color: '#5a7da1',
    fontWeight: '500',
  },
  goalCard: {
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#d8daee',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalTitle: {
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  goalPercent: {
    fontFamily: FONT,
    fontSize: 16,
    color: PRIMARY,
    fontWeight: '700',
  },
  progressTrack: {
    marginTop: 13,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#eef1f7',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '60%',
    borderRadius: 999,
    backgroundColor: PRIMARY,
  },
  goalDesc: {
    fontFamily: FONT,
    marginTop: 8,
    color: '#5a7da1',
    fontSize: 14,
    fontWeight: '500',
  },
  weeklyCard: {
    marginTop: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  weeklyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  weeklyTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  weeklyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f0edff',
  },
  weeklyBadgeText: {
    fontFamily: FONT,
    fontSize: 11,
    color: ACCENT,
    fontWeight: '800',
  },
  weeklyBarsRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  weeklyBarItem: {
    width: 36,
    alignItems: 'center',
  },
  weeklyValue: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 4,
  },
  weeklyTrack: {
    width: 18,
    height: 84,
    borderRadius: 12,
    backgroundColor: '#f0f1f5',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weeklyFill: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  weeklyLabel: {
    fontFamily: FONT,
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  challengeCard: {
    marginTop: 22,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    shadowColor: '#d5d7ec',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  challengeHero: {
    minHeight: 150,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#f1f6ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  challengeHeroText: {
    flex: 1,
  },
  challengeBadge: {
    backgroundColor: ACCENT,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  challengeBadgeText: {
    fontFamily: FONT,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  challengeHeroTitle: {
    fontFamily: FONT,
    marginTop: 14,
    color: '#111827',
    fontSize: 25,
    fontWeight: '900',
  },
  challengeHeroSub: {
    fontFamily: FONT,
    marginTop: 5,
    color: '#5a7da1',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  challengeIconPanel: {
    width: 82,
    height: 82,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#c6d8f5',
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  challengeIconDot: {
    position: 'absolute',
    right: 16,
    top: 15,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#facc15',
  },
  challengeBody: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  challengeMetaRow: {
    marginBottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  challengeMetaPill: {
    minHeight: 30,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: '#f7f8fc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  challengeMetaText: {
    fontFamily: FONT,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  challengeButton: {
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  challengeButtonText: {
    fontFamily: FONT,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  quickWrap: {
    marginTop: 24,
  },
  quickTitle: {
    fontFamily: FONT,
    fontSize: 21,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  quickGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 18,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  quickTileWrap: {
    flex: 1,
  },
  quickTile: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTileIcon: {
    width: 50,
    height: 50,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d8daee',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  quickTileText: {
    fontFamily: FONT,
    marginTop: 9,
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
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
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    opacity: 0.7,
    marginTop: 10,
  },
  bottomStretchHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    opacity: 0.7,
    marginBottom: 10,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 70,
    paddingBottom: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 58,
  },
  navIconBubble: {
    width: 30,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBubbleActive: {
    backgroundColor: '#e8f2ff',
  },
  navText: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  navTextActive: {
    color: PRIMARY,
  },
});
