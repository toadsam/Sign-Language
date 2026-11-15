/**
 * 표현 탭: 오늘 목표, 추천 코스, 학습 과정 목록.
 * 스케치북처럼 꾸몄다. 위쪽 칩을 바꾸면 스케치북 장이 넘어가고,
 * 과정 카드를 누르면 카드가 뒤집혀 손 모양 그림과 설명이 나온다.
 * 카드의 '시작' 단추를 누르면 붓 전환으로 퀴즈에 들어간다.
 */
import { useFocusEffect } from '@react-navigation/native';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { EmptyState } from '@/components/paint/empty-state';
import { HandSketch, LearnChips, LearnHeader, PaintProgress, Swatch } from '@/components/paint/learn-parts';
import { BodyText, PaintTabBar, PaperScreen, RoughBox, StoryText, Wash } from '@/components/paint/paint-ui';
import { PenLoader } from '@/components/paint/pen-loader';
import { FlipCard, SketchbookPage } from '@/components/paint/sketchbook';
import { usePaintNav } from '@/components/paint/transition';
import { Paint, Size } from '@/constants/paint';
import { useAuth } from '@/context/auth-context';
import { feel } from '@/lib/feel';
import { DAILY_GOAL_TARGET, getGoalPercent, getTodaySolvedCount, normalizeDailySolvedCounts } from '@/lib/daily-goal';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';

type Filter = 'all' | 'learn' | 'review';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'learn', label: '배우기' },
  { key: 'review', label: '복습' },
];

type Course = {
  key: string;
  title: string;
  description: string;
  level: string;
  color: string;
  kind: Exclude<Filter, 'all'>;
  /** 없으면 아직 들어갈 수 없는 과정 */
  href?: Href;
  locked?: boolean;
};

const BASIC_QUIZ: Href = { pathname: '/quiz', params: { title: '기초 단어', category: 'basic' } };

const COURSES: Course[] = [
  { key: 'basic', title: '기초 단어', description: '숫자, 가족, 인사 등 기본적인 단어를 배워보세요.', level: '1단계', color: Paint.yellow, kind: 'learn', href: BASIC_QUIZ },
  { key: 'wrong', title: '오답 복습 퀴즈', description: '내가 틀린 문제들만 모아 다시 풀어보세요.', level: '복습', color: Paint.coral, kind: 'review', href: { pathname: '/quiz', params: { mode: 'wrong', title: '오답 복습 퀴즈' } } },
  { key: 'daily', title: '일상 회화', description: '일상 생활에서 자주 쓰이는 문장을 익혀보세요.', level: '2단계', color: Paint.sky, kind: 'learn', href: { pathname: '/quiz', params: { title: '일상 회화', category: 'daily' } } },
  // 예전 화면에서도 누를 곳이 없던 과정
  { key: 'place', title: '상황별 표현', description: '병원, 은행, 식당 등 다양한 장소에서의 표현.', level: '3단계', color: Paint.mint, kind: 'learn' },
  { key: 'adv', title: '고급 표현', description: '이전 단계를 완료하여 잠금 해제하세요.', level: '잠김', color: Paint.leaf, kind: 'learn', locked: true },
];

export default function LearnScreen() {
  const nav = usePaintNav();
  const { user } = useAuth();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // 처음 한 번 불러오기가 끝났는지 (그 전에는 목표 칸에 펜 그림을 띄운다)
  const [loaded, setLoaded] = useState(false);

  const loadUserInfo = useCallback(async () => {
    if (!user?.id) {
      setUserInfo(null);
      setLoaded(true);
      return;
    }
    try {
      const info = await fetchUserInfo(user.id);
      setUserInfo(info);
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
    }, [loadUserInfo])
  );

  const dailySolvedCounts = useMemo(
    () => normalizeDailySolvedCounts((userInfo?.dailySolvedCounts ?? null) as Record<string, unknown> | null),
    [userInfo?.dailySolvedCounts]
  );
  const solvedToday = getTodaySolvedCount(dailySolvedCounts);
  const goalPercent = getGoalPercent(solvedToday, DAILY_GOAL_TARGET);
  const left = Math.max(DAILY_GOAL_TARGET - solvedToday, 0);

  const courses = COURSES.filter((c) => filter === 'all' || c.kind === filter);
  const showToday = filter !== 'review';

  return (
    <PaperScreen>
      <View style={{ flex: 1 }}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <LearnHeader title="표현 모음" sub={`오늘 퀴즈 ${solvedToday}/${DAILY_GOAL_TARGET}개 · 목표 ${goalPercent}%`} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(70).duration(320)} style={{ marginTop: 10 }}>
          <LearnChips items={FILTERS} value={filter} onChange={setFilter} label="과정 고르기" />
        </Animated.View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <SketchbookPage pageKey={filter} seed={95} style={styles.book}>
          {showToday && (
            <>
              <StoryText size={Size.lead} style={styles.sub}>오늘의 추천</StoryText>
              <View style={styles.greet}>
                <Animated.View entering={FadeInDown.delay(140).duration(320)} style={{ flex: 1 }}>
                  <Pressable
                    onPress={(e) => nav.go(BASIC_QUIZ, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                    accessibilityRole="button"
                    accessibilityLabel={`추천 코스 기초 단어 시작하기. 오늘 목표까지 ${left}문제`}
                    style={({ pressed }) => ({ transform: pressed ? [{ rotate: '-1.2deg' }, { scale: 0.97 }] : [] })}
                  >
                    <RoughBox seed={61} style={styles.gcard}>
                      <View style={styles.gblob}><Wash color={Paint.yellow} opacity={0.8} seed={63} /></View>
                      <BodyText soft size={Size.caption}>추천 코스</BodyText>
                      <View>
                        <StoryText size={Size.lead}>기초 단어{'\n'}시작하기</StoryText>
                        <BodyText soft size={Size.caption}>목표까지 {left}문제</BodyText>
                      </View>
                    </RoughBox>
                  </Pressable>
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(210).duration(320)} style={{ flex: 1 }}>
                  <RoughBox seed={62} style={styles.gcard}>
                    <View style={styles.gblob}><Wash color={Paint.leaf} opacity={0.8} seed={64} /></View>
                    <BodyText soft size={Size.caption}>오늘의 목표</BodyText>
                    {!loaded ? (
                      <PenLoader size={56} label="목표를 불러오는 중" style={{ alignSelf: 'flex-start' }} />
                    ) : (
                      <View style={{ gap: 6 }}>
                        <StoryText size={Size.title}>{goalPercent}%</StoryText>
                        <PaintProgress percent={goalPercent} label={`오늘의 목표 ${goalPercent}퍼센트`} />
                        <BodyText soft size={Size.caption}>{DAILY_GOAL_TARGET}개 중 {solvedToday}개 완료</BodyText>
                      </View>
                    )}
                  </RoughBox>
                </Animated.View>
              </View>
            </>
          )}

          <StoryText size={Size.lead} style={styles.sub}>학습 과정</StoryText>
          {courses.length === 0 ? (
            <EmptyState kind="no-quiz" compact />
          ) : (
            <View style={styles.places}>
              {courses.map((c, i) => (
                <Animated.View key={c.key} entering={FadeInDown.delay(260 + i * 70).duration(320)}>
                  <CourseCard course={c} index={i} onGo={(href, p) => nav.go(href, p)} />
                </Animated.View>
              ))}
            </View>
          )}
          </SketchbookPage>
        </ScrollView>
      </View>
      <PaintTabBar current="learn" />
    </PaperScreen>
  );
}

function CourseCard({ course, index, onGo }: { course: Course; index: number; onGo: (href: Href, p: { x: number; y: number }) => void }) {
  const reduce = useReducedMotion();
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${shake.value}deg` }] }));
  const [flipped, setFlipped] = useState(false);
  const ready = !!course.href && !course.locked;
  const note = course.locked ? '아직 잠겨 있어요' : ready ? course.description : `${course.description} (준비 중)`;
  const stroke = ready ? Paint.ink : 'rgba(46,38,32,0.45)';

  // 카드 몸통: 누르면 뒤집힌다. 잠긴 곳은 뒤집히면서 살짝 흔들린다
  function onFlip() {
    feel.tap();
    setFlipped((f) => !f);
    if (!ready && !reduce) shake.value = withSequence(withTiming(-3, { duration: 80 }), withTiming(3, { duration: 110 }), withTiming(-2, { duration: 90 }), withTiming(0, { duration: 80 }));
  }

  // '시작' 단추: 붓 전환으로 퀴즈에 들어간다 (앞면 · 뒷면 둘 다 있다)
  function goButton() {
    if (!ready || !course.href) return null;
    const href = course.href;
    return (
      <Pressable
        onPress={(e) => onGo(href, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        accessibilityRole="button"
        accessibilityLabel={`${course.title} 시작하기`}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
        style={({ pressed }) => [styles.go, { transform: pressed ? [{ rotate: '-3deg' }, { scale: 0.95 }] : [] }]}
      >
        <StoryText size={14}>시작</StoryText>
      </Pressable>
    );
  }

  const front = (
    <RoughBox seed={70 + index} dashed={!ready} stroke={stroke} fill={ready ? Paint.card : 'transparent'} style={styles.pcard}>
      <Pressable
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityLabel={`${course.title}, ${course.level}. ${note}`}
        accessibilityHint="카드를 뒤집어 손 모양과 설명을 봐요"
        accessibilityState={{ expanded: false }}
        style={({ pressed }) => [styles.body, { transform: pressed ? [{ scale: 0.98 }] : [] }]}
      >
        <Swatch color={course.color} locked={!ready} seed={80 + index} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StoryText size={Size.lead} style={!ready ? { color: Paint.inkSoft } : undefined}>{course.title}</StoryText>
            <BodyText soft size={Size.caption}>{course.level}</BodyText>
          </View>
          <BodyText soft size={Size.small} numberOfLines={1}>{note}</BodyText>
        </View>
      </Pressable>
      {goButton()}
    </RoughBox>
  );

  const back = (
    <RoughBox seed={170 + index} dashed={!ready} stroke={stroke} fill={Paint.paperDeep} style={[styles.pcard, styles.pback]}>
      <Pressable
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityLabel={`${course.title} 뒷면. ${course.description}${ready ? '' : course.locked ? '. 아직 잠겨 있어요' : '. 준비 중이에요'}`}
        accessibilityHint="다시 누르면 앞면으로 돌아가요"
        accessibilityState={{ expanded: true }}
        style={styles.body}
      >
        <HandSketch seed={index} color={course.color} size={60} boil={flipped} />
        <View style={{ flex: 1, gap: 1 }}>
          <StoryText size={Size.small} style={{ color: Paint.inkSoft }}>{course.title}</StoryText>
          <BodyText size={Size.caption} numberOfLines={3}>{course.description}</BodyText>
          {!ready ? <BodyText soft size={Size.caption}>{course.locked ? '아직 잠겨 있어요' : '준비 중이에요'}</BodyText> : null}
        </View>
      </Pressable>
      {goButton()}
    </RoughBox>
  );

  return (
    <Animated.View style={shakeStyle}>
      <FlipCard flipped={flipped} front={front} back={back} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  book: { marginHorizontal: 14, marginTop: 22 },
  sub: { paddingHorizontal: 6, marginTop: 6, marginBottom: 10 },
  greet: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  gcard: { minHeight: 132, padding: 14, justifyContent: 'space-between', overflow: 'hidden' },
  gblob: { position: 'absolute', right: 10, top: 10, width: 30, height: 30 },
  places: { gap: 10 },
  pcard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 8, paddingRight: 12 },
  pback: { flex: 1 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64 },
  go: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: Paint.yellowSoft },
});
