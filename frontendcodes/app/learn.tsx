import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ChalkboardTeacherIcon } from 'phosphor-react-native/lib/module/icons/ChalkboardTeacher';
import { useAuth } from '@/context/auth-context';
import { Fonts } from '@/constants/theme';
import { DAILY_GOAL_TARGET, getGoalPercent, getTodaySolvedCount, normalizeDailySolvedCounts } from '@/lib/daily-goal';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';

const PRIMARY = '#1f80e3';
const ACCENT = '#7c6cf2';
const FONT = Fonts.rounded;

type CourseCardProps = {
  title: string;
  description: string;
  level: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  lightBg: string;
  appearStyle?: any;
  onPress?: () => void;
};

function CourseCard({
  title,
  description,
  level,
  icon,
  color,
  lightBg,
  appearStyle,
  onPress,
}: CourseCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

  function press(active: boolean) {
    Animated.spring(scale, {
      toValue: active ? 0.97 : 1,
      tension: 180,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }

  return (
    <Animated.View style={appearStyle}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          style={styles.courseCard}
          onPress={onPress}
          onPressIn={() => press(true)}
          onPressOut={() => press(false)}>
          <View style={[styles.courseIconWrap, { backgroundColor: lightBg }]}>
            <MaterialCommunityIcons name={icon} size={20} color={color} />
          </View>
          <View style={styles.courseBody}>
            <View style={styles.courseHeadRow}>
              <Text style={styles.courseTitle}>{title}</Text>
              <View style={[styles.levelBadge, { backgroundColor: `${color}22` }]}>
                <Text style={[styles.levelText, { color }]}>{level}</Text>
              </View>
            </View>
            <Text style={styles.courseDesc} numberOfLines={1}>
              {description}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default function LearnScreen() {
  const router = useRouter();
  const { user } = useAuth();
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
  const goalProgressAnim = useRef(new Animated.Value(0)).current;
  const courseRevealAnims = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;
  const lockWiggle = useRef(new Animated.Value(0)).current;
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
  const lockRotate = lockWiggle.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-5deg', '5deg'],
  });

  useEffect(() => {
    Animated.timing(goalProgressAnim, {
      toValue: goalPercent,
      duration: 680,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [goalPercent, goalProgressAnim]);

  useEffect(() => {
    courseRevealAnims.forEach((anim) => anim.setValue(0));
    Animated.stagger(
      80,
      courseRevealAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      )
    ).start();
  }, [courseRevealAnims]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1700),
        Animated.timing(lockWiggle, {
          toValue: 1,
          duration: 80,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(lockWiggle, {
          toValue: -1,
          duration: 120,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(lockWiggle, {
          toValue: 0,
          duration: 80,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [lockWiggle]);

  function courseAppearStyle(index: number) {
    return {
      opacity: courseRevealAnims[index],
      transform: [
        {
          translateY: courseRevealAnims[index].interpolate({
            inputRange: [0, 1],
            outputRange: [16, 0],
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
            <View>
              <Text style={styles.headerSub}>수어지교 학습</Text>
              <Text style={styles.headerTitle}>카테고리 선택</Text>
            </View>
            <Pressable style={styles.settingsButton}>
              <Ionicons name="settings" size={18} color="#64748b" />
            </Pressable>
          </View>

          <View style={styles.recommendCard}>
            <View style={styles.recommendTextWrap}>
              <View style={styles.recommendBadge}>
                <Ionicons name="sparkles" size={12} color="#ffffff" />
                <Text style={styles.recommendBadgeText}>추천 코스</Text>
              </View>
              <Text style={styles.recommendTitle}>기초 단어 시작하기</Text>
              <Text style={styles.recommendDesc}>
                가볍게 풀며 오늘 목표까지 {Math.max(DAILY_GOAL_TARGET - solvedToday, 0)}문제 채워요.
              </Text>
            </View>
            <View style={styles.recommendIllustration}>
              <ChalkboardTeacherIcon size={42} color={PRIMARY} weight="duotone" duotoneOpacity={0.28} />
              <View style={styles.recommendIllustrationDot} />
            </View>
            <Pressable
              style={styles.recommendButton}
              onPress={() => router.push({ pathname: '/quiz', params: { title: '기초 단어', category: 'basic' } })}>
              <Ionicons name="play" size={15} color="#ffffff" />
            </Pressable>
          </View>

          <View style={styles.goalCard}>
            <View style={styles.goalRow}>
              <Text style={styles.goalTitle}>오늘의 목표</Text>
              <Text style={styles.goalPercent}>{goalPercent}%</Text>
            </View>
            <View style={styles.goalTrack}>
              <Animated.View style={[styles.goalFill, { width: goalFillWidth }]} />
            </View>
            <Text style={styles.goalDesc}>
              오늘의 퀴즈 {DAILY_GOAL_TARGET}개 중 {solvedToday}개 완료
            </Text>
          </View>

          <Text style={styles.sectionTitle}>학습 과정</Text>

          <CourseCard
            title="기초 단어"
            description="숫자, 가족, 인사 등 기본적인 단어를 배워보세요."
            level="Level 1"
            icon="school"
            color="#3b82f6"
            lightBg="#eff6ff"
            appearStyle={courseAppearStyle(0)}
            onPress={() => router.push({ pathname: '/quiz', params: { title: '기초 단어', category: 'basic' } })}
          />
          <CourseCard
            title="오답 복습 퀴즈"
            description="내가 틀린 문제들만 모아 다시 풀어보세요."
            level="Review"
            icon="refresh"
            color="#ef4444"
            lightBg="#fef2f2"
            appearStyle={courseAppearStyle(1)}
            onPress={() => router.push({ pathname: '/quiz', params: { mode: 'wrong', title: '오답 복습 퀴즈' } })}
          />
          <CourseCard
            title="일상 회화"
            description="일상 생활에서 자주 쓰이는 문장을 익혀보세요."
            level="Level 2"
            icon="forum-outline"
            color="#a855f7"
            lightBg="#f5f3ff"
            appearStyle={courseAppearStyle(2)}
            onPress={() => router.push({ pathname: '/quiz', params: { title: '일상 회화', category: 'daily' } })}
          />
          <CourseCard
            title="상황별 표현"
            description="병원, 은행, 식당 등 다양한 장소에서의 표현."
            level="Level 3"
            icon="storefront-outline"
            color="#f97316"
            lightBg="#fff7ed"
            appearStyle={courseAppearStyle(3)}
          />

          <Animated.View style={[styles.lockedCard, courseAppearStyle(4)]}>
            <View style={styles.lockIconWrap}>
              <Animated.View style={{ transform: [{ rotate: lockRotate }] }}>
                <Ionicons name="lock-closed" size={18} color="#94a3b8" />
              </Animated.View>
            </View>
            <View>
              <Text style={styles.lockTitle}>고급 표현</Text>
              <Text style={styles.lockDesc}>이전 단계를 완료하여 잠금 해제하세요.</Text>
            </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.bottomStretch, { height: bottomStretchHeight }]}>
            <View style={styles.bottomStretchHandle} />
          </Animated.View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/home')}>
            <View style={styles.navIconBubble}>
              <Ionicons name="home-outline" size={18} color="#94a3b8" />
            </View>
            <Text style={styles.navText}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
            <View style={[styles.navIconBubble, styles.navIconBubbleActive]}>
              <Ionicons name="school" size={18} color={PRIMARY} />
            </View>
            <Text style={[styles.navText, styles.navTextActive]}>학습하기</Text>
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
    paddingBottom: 98,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  headerSub: {
    fontFamily: FONT,
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3,
  },
  headerTitle: {
    fontFamily: FONT,
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '800',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#d7d9ef',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  recommendCard: {
    marginTop: 18,
    minHeight: 136,
    borderRadius: 28,
    backgroundColor: '#f1f6ff',
    paddingHorizontal: 20,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#d5d7ec',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  recommendTextWrap: {
    flex: 1,
    paddingRight: 14,
  },
  recommendBadge: {
    alignSelf: 'flex-start',
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recommendBadgeText: {
    fontFamily: FONT,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  recommendTitle: {
    fontFamily: FONT,
    marginTop: 14,
    color: '#111827',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
  },
  recommendDesc: {
    fontFamily: FONT,
    marginTop: 5,
    color: '#5a7da1',
    fontSize: 13,
    fontWeight: '700',
  },
  recommendIllustration: {
    width: 74,
    height: 74,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginRight: 10,
    shadowColor: '#c6d8f5',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  recommendIllustrationDot: {
    position: 'absolute',
    right: 13,
    top: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f472b6',
  },
  recommendButton: {
    width: 58,
    height: 58,
    borderRadius: 22,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  goalCard: {
    marginTop: 18,
    borderRadius: 24,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: '#d8daee',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalTitle: {
    fontFamily: FONT,
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '800',
  },
  goalPercent: {
    fontFamily: FONT,
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '700',
  },
  goalTrack: {
    marginTop: 12,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#eef1f7',
    overflow: 'hidden',
  },
  goalFill: {
    width: '60%',
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 999,
  },
  goalDesc: {
    fontFamily: FONT,
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  sectionTitle: {
    fontFamily: FONT,
    marginTop: 22,
    marginBottom: 10,
    color: '#1f2937',
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  courseCard: {
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  courseIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#d8daee',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  courseBody: {
    flex: 1,
  },
  courseHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  courseTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '800',
    color: '#1f2937',
  },
  levelBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  levelText: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
  },
  courseDesc: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
  },
  lockedCard: {
    marginTop: 4,
    borderRadius: 24,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 18,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  lockTitle: {
    fontFamily: FONT,
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
  },
  lockDesc: {
    fontFamily: FONT,
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
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

