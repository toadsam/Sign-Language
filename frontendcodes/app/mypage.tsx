﻿import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '@/context/auth-context';
import { Fonts } from '@/constants/theme';
import { DAILY_GOAL_TARGET, getConsecutiveGoalDays, normalizeDailySolvedCounts } from '@/lib/daily-goal';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';
import { fetchTopWrongWords, TopWrongWordItem } from '@/lib/api/top-wrong-words';
import { getBaseUrl } from '@/lib/api/base-url';

const PRIMARY = '#1f80e3';
const ACCENT = '#7c6cf2';
const FONT = Fonts.rounded;

export default function MyPageScreen() {
  const apiBaseUrl = getBaseUrl();
  const router = useRouter();
  const { user, isGuest, signOut, updateUser } = useAuth();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [topWrongWords, setTopWrongWords] = useState<TopWrongWordItem[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [displayGoalStreakDays, setDisplayGoalStreakDays] = useState(0);
  const [displayAccuracy, setDisplayAccuracy] = useState(0);
  const profileReveal = useRef(new Animated.Value(0)).current;
  const statReveal = useRef(new Animated.Value(0)).current;
  const topWordRevealAnims = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;
  const uploadSpin = useRef(new Animated.Value(0)).current;
  const wrongNoteMenuScale = useRef(new Animated.Value(1)).current;
  const bookmarkMenuScale = useRef(new Animated.Value(1)).current;
  const wrongNoteChevron = useRef(new Animated.Value(0)).current;
  const bookmarkChevron = useRef(new Animated.Value(0)).current;
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
  const uploadRotate = uploadSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
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

  const loadUserInfo = useCallback(async () => {
    if (!user?.id) {
      setUserInfo(null);
      setTopWrongWords([]);
      return;
    }
    try {
      const [data, topWords] = await Promise.all([
        fetchUserInfo(user.id),
        fetchTopWrongWords(user.id).catch(() => []),
      ]);
      setUserInfo(data);
      setTopWrongWords(topWords);
    } catch {
      setUserInfo(null);
      setTopWrongWords([]);
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

  const handleProfileImageEdit = async () => {
    if (!user?.id) {
      Alert.alert('오류', '로그인이 필요합니다.');
      return;
    }

    try {
      // 권한 요청
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '갤러리 접근 권한이 필요합니다.');
        return;
      }

      // 이미지 선택
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploadingImage(true);
        const asset = result.assets[0];

        // base64 이미지 데이터 생성
        const base64Image = `data:image/jpeg;base64,${asset.base64}`;

        // 백엔드에 프로필 이미지 업데이트 요청
        const response = await fetch(`${apiBaseUrl}/api/users/${user.id}/profile-image`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileImageUrl: base64Image }),
        });

        if (response.ok) {
          // AuthContext 업데이트
          await updateUser({ picture: base64Image });

          // UserInfo 새로고침
          await loadUserInfo();

          Alert.alert('성공', '프로필 이미지가 업데이트되었습니다.');
        } else {
          Alert.alert('오류', '프로필 이미지 업데이트에 실패했습니다.');
        }
      }
    } catch (error) {
      console.error('프로필 이미지 업데이트 에러:', error);
      Alert.alert('오류', '이미지 업로드 중 문제가 발생했습니다.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const correct = userInfo?.correctQuestionNum ?? 0;
  const total = userInfo?.totalQuestionNum ?? 0;
  const incorrect = Math.max(total - correct, 0);
  const accuracy = total === 0 ? 0 : Math.floor((correct / total) * 100);
  const dailySolvedCounts = normalizeDailySolvedCounts(
    (userInfo?.dailySolvedCounts ?? null) as Record<string, unknown> | null
  );
  const goalStreakDays = getConsecutiveGoalDays(dailySolvedCounts, DAILY_GOAL_TARGET);

  useEffect(() => {
    Animated.stagger(90, [
      Animated.timing(profileReveal, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(statReveal, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [profileReveal, statReveal]);

  useEffect(() => {
    const timer = animateNumber(goalStreakDays, setDisplayGoalStreakDays);
    return () => clearInterval(timer);
  }, [goalStreakDays]);

  useEffect(() => {
    const timer = animateNumber(accuracy, setDisplayAccuracy);
    return () => clearInterval(timer);
  }, [accuracy]);

  useEffect(() => {
    topWordRevealAnims.forEach((anim) => anim.setValue(0));
    Animated.stagger(
      65,
      topWordRevealAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      )
    ).start();
  }, [topWrongWords, topWordRevealAnims]);

  useEffect(() => {
    if (!isUploadingImage) {
      uploadSpin.stopAnimation();
      uploadSpin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(uploadSpin, {
        toValue: 1,
        duration: 850,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isUploadingImage, uploadSpin]);

  function topWordAppearStyle(index: number) {
    return {
      opacity: topWordRevealAnims[index],
      transform: [
        {
          translateY: topWordRevealAnims[index].interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    };
  }

  function animateMenuPress(scale: Animated.Value, chevron: Animated.Value, active: boolean) {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: active ? 0.98 : 1,
        tension: 180,
        friction: 12,
        useNativeDriver: false,
      }),
      Animated.spring(chevron, {
        toValue: active ? 1 : 0,
        tension: 180,
        friction: 12,
        useNativeDriver: false,
      }),
    ]).start();
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
    const topOverscroll = Math.max(0, -contentOffset.y);
    setTopStretchValue(Math.min(topOverscroll, 220));
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
        <View style={styles.header}>
          <Pressable style={styles.headerIcon} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.headerTitle}>마이페이지</Text>
          <View style={styles.headerIcon} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
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
          <Animated.View
            style={[
              styles.profileCard,
              {
                opacity: profileReveal,
                transform: [
                  {
                    translateY: profileReveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                ],
              },
            ]}>
            <View style={styles.avatarWrap}>
              <Image
                source={{
                  uri:
                    (userInfo as any)?.profileImageUrl ||
                    user?.picture ||
                    'https://lh3.googleusercontent.com/aida-public/AB6AXuA9xzg_QHvuUbnQVvId25kc3DxT6xgZYv7hdXVPBleZEWUHktwcMlvQG1wx-vXuT53_Ah-AQVmTIBVym4_hT8xWPSd9Fp9rCWpXdIQWWr4REC3xvNLAjTBVl8BvaBCZCW1WZwNkrA8zFK28kgB3birhCN3AX21RhyN83PJDnB3HbWsnyYI8ZfOJHO7DL3LhPpwUIZoxWLeddmWQP9xoPrqcGe2WLR9OI25acRea0Px0vbWqG8RvtJow0X1bCQXGv6hckv7Zn9rsyA',
                }}
                contentFit="cover"
                style={styles.avatar}
              />
              <Pressable
                style={styles.editBadge}
                onPress={handleProfileImageEdit}
                disabled={isUploadingImage || isGuest}
              >
                <Animated.View style={isUploadingImage ? { transform: [{ rotate: uploadRotate }] } : undefined}>
                  <Ionicons
                    name={isUploadingImage ? "sync" : "create"}
                    size={13}
                    color="#fff"
                  />
                </Animated.View>
              </Pressable>
            </View>
            <Text style={styles.name}>{user?.name ?? (isGuest ? '비회원' : '사용자')}</Text>
            <Text style={styles.subtitle}>
              {isGuest ? '비회원으로 이용 중' : user?.email ?? 'Google 계정 연동됨'}
            </Text>
            <View style={styles.profileStatsRow}>
              <View style={styles.profileStatItem}>
                <Text style={styles.profileStatValue}>{total}</Text>
                <Text style={styles.profileStatLabel}>학습문제</Text>
              </View>
              <View style={styles.profileDivider} />
              <View style={styles.profileStatItem}>
                <Text style={styles.profileStatValue}>{correct}</Text>
                <Text style={styles.profileStatLabel}>정답수</Text>
              </View>
              <View style={styles.profileDivider} />
              <View style={styles.profileStatItem}>
                <Text style={styles.profileStatValue}>{incorrect}</Text>
                <Text style={styles.profileStatLabel}>오답수</Text>
              </View>
            </View>
          </Animated.View>

          <Text style={styles.sectionTitle}>나의 학습 통계</Text>
          <Animated.View
            style={[
              styles.statsRow,
              {
                opacity: statReveal,
                transform: [
                  {
                    translateY: statReveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              },
            ]}>
            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <View style={[styles.statIconWrap, { backgroundColor: '#fff7ed' }]}>
                  <Ionicons name="flame" size={18} color="#f97316" />
                </View>
                <Text style={styles.statLabel}>연속 목표 달성</Text>
              </View>
              <Text style={styles.statValue}>
                {displayGoalStreakDays}
                <Text style={styles.statUnit}>일</Text>
              </Text>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <View style={[styles.statIconWrap, { backgroundColor: '#eff6ff' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />
                </View>
                <Text style={styles.statLabel}>평균 정확도</Text>
              </View>
              <Text style={styles.statValue}>
                {displayAccuracy}
                <Text style={styles.statUnit}>%</Text>
              </Text>
            </View>
          </Animated.View>

          <Text style={styles.sectionTitle}>자주 틀린 단어 TOP 5</Text>
          <View style={styles.topWordsWrap}>
            {topWrongWords.length === 0 ? (
              <Text style={styles.emptyTopWordsText}>아직 오답 데이터가 충분하지 않습니다.</Text>
            ) : (
              topWrongWords.map((item, index) => (
                <Animated.View key={item.quizId} style={[styles.topWordItem, topWordAppearStyle(index)]}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.topWordText}>{item.word || '단어 정보 없음'}</Text>
                  <Text style={styles.topWordCount}>{item.wrongCount}회</Text>
                </Animated.View>
              ))
            )}
          </View>

          <Text style={styles.sectionTitle}>학습 관리</Text>
          <View style={styles.menuWrap}>
            <Animated.View style={{ transform: [{ scale: wrongNoteMenuScale }] }}>
              <Pressable
                style={styles.menuItem}
                onPress={() => router.push('/wrongnote')}
                onPressIn={() => animateMenuPress(wrongNoteMenuScale, wrongNoteChevron, true)}
                onPressOut={() => animateMenuPress(wrongNoteMenuScale, wrongNoteChevron, false)}>
                <View style={styles.menuLeft}>
                  <View style={[styles.menuIconWrap, { backgroundColor: '#fef2f2' }]}>
                    <Ionicons name="alert-circle" size={19} color="#ef4444" />
                  </View>
                  <Text style={styles.menuText}>오답 노트 (단어장)</Text>
                </View>
                <Animated.View
                  style={{
                    transform: [
                      {
                        translateX: wrongNoteChevron.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 4],
                        }),
                      },
                    ],
                  }}>
                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </Animated.View>
              </Pressable>
            </Animated.View>

            <Animated.View style={{ transform: [{ scale: bookmarkMenuScale }] }}>
              <Pressable
                style={styles.menuItem}
                onPress={() => router.push('/bookmark')}
                onPressIn={() => animateMenuPress(bookmarkMenuScale, bookmarkChevron, true)}
                onPressOut={() => animateMenuPress(bookmarkMenuScale, bookmarkChevron, false)}>
                <View style={styles.menuLeft}>
                  <View style={[styles.menuIconWrap, { backgroundColor: '#fffbeb' }]}>
                    <Ionicons name="bookmark" size={18} color="#f59e0b" />
                  </View>
                  <Text style={styles.menuText}>북마크</Text>
                </View>
                <Animated.View
                  style={{
                    transform: [
                      {
                        translateX: bookmarkChevron.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 4],
                        }),
                      },
                    ],
                  }}>
                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </Animated.View>
              </Pressable>
            </Animated.View>
          </View>

          <Pressable
            style={styles.logoutBtn}
            onPress={async () => {
              await signOut();
              router.replace('/login' as any);
            }}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>
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
          <Pressable style={styles.navItem}>
            <View style={[styles.navIconBubble, styles.navIconBubbleActive]}>
              <Ionicons name="person" size={18} color={PRIMARY} />
            </View>
            <Text style={[styles.navText, styles.navTextActive]}>마이페이지</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function animateNumber(target: number, setValue: (value: number) => void) {
  const duration = 620;
  const startedAt = Date.now();
  const from = 0;

  setValue(from);
  const timer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    setValue(Math.round(from + (target - from) * eased));
    if (progress >= 1) {
      clearInterval(timer);
      setValue(target);
    }
  }, 16);

  return timer;
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
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerIcon: {
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
  headerTitle: {
    fontFamily: FONT,
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 108,
  },
  profileCard: {
    marginTop: 8,
    marginBottom: 14,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
    shadowColor: '#d5d7ec',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#fff',
  },
  editBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  name: {
    fontFamily: FONT,
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    fontFamily: FONT,
    marginTop: 2,
    fontSize: 14,
    color: '#5b7ca0',
    fontWeight: '600',
  },
  profileStatsRow: {
    marginTop: 18,
    width: '100%',
    borderRadius: 22,
    backgroundColor: '#f8f9ff',
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  profileStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  profileStatValue: {
    fontFamily: FONT,
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },
  profileStatLabel: {
    fontFamily: FONT,
    marginTop: 3,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  profileDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#e5e7eb',
  },
  sectionTitle: {
    fontFamily: FONT,
    marginTop: 20,
    marginBottom: 10,
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 16,
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  statIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d8daee',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statLabel: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 40,
    color: '#111827',
    fontWeight: '800',
    lineHeight: 50,
  },
  statUnit: {
    fontFamily: FONT,
    fontSize: 24,
    color: '#6b7280',
    fontWeight: '700',
  },
  topWordsWrap: {
    borderRadius: 24,
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 8,
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  topWordItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 13,
  },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '800',
  },
  topWordText: {
    fontFamily: FONT,
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '700',
  },
  topWordCount: {
    fontFamily: FONT,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f0edff',
    fontSize: 13,
    color: ACCENT,
    fontWeight: '700',
  },
  emptyTopWordsText: {
    fontFamily: FONT,
    paddingVertical: 12,
    textAlign: 'center',
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '600',
  },
  menuWrap: {
    borderRadius: 24,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    shadowColor: '#d8daee',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  menuItem: {
    backgroundColor: '#fff',
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d8daee',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  menuText: {
    fontFamily: FONT,
    fontSize: 16,
    color: '#111827',
    fontWeight: '700',
  },
  logoutBtn: {
    marginTop: 18,
    alignItems: 'center',
    paddingVertical: 10,
  },
  logoutText: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    textDecorationLine: 'underline',
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
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
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
