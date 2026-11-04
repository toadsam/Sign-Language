import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAuth } from '@/context/auth-context';
import { Paint, Size } from '@/constants/paint';
import { DAILY_GOAL_TARGET, getConsecutiveGoalDays, normalizeDailySolvedCounts } from '@/lib/daily-goal';
import { getCompletedCells, LEARNING_UNITS } from '@/lib/learning-units';
import { fetchUserInfo, UserInfo } from '@/lib/api/users';
import { fetchTopWrongWords, TopWrongWordItem } from '@/lib/api/top-wrong-words';
import { getBaseUrl } from '@/lib/api/base-url';
import { MeAvatar, MeHeader, MeRow, StatBlob, WeekDrops, useCountUp } from '@/components/paint/me-parts';
import { BodyText, Mark, PaintButton, PaintIcon, PaintTabBar, PaperScreen, RoughBox, StoryText } from '@/components/paint/paint-ui';
import { usePaintNav } from '@/components/paint/transition';

// 차례로 살짝 올라오며 나타난다 (움직임 줄이기는 reanimated가 알아서 따른다)
const appear = (i: number) => FadeInDown.delay(i * 70).duration(320);

export default function MyPageScreen() {
  const apiBaseUrl = getBaseUrl();
  const nav = usePaintNav();
  const { user, isGuest, signOut, updateUser } = useAuth();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [topWrongWords, setTopWrongWords] = useState<TopWrongWordItem[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

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
  const paintedPlaces = getCompletedCells(total);
  const shownAccuracy = useCountUp(accuracy);

  const profileUri = (userInfo as any)?.profileImageUrl || user?.picture || null;
  const displayName = user?.name ?? (isGuest ? '게스트' : '사용자');
  const subLine = isGuest ? '로그인하면 칠한 마을이 저장돼요' : user?.email ?? 'Google 계정 연동됨';
  const canEditImage = !isGuest && !isUploadingImage;

  return (
    <PaperScreen>
      <MeHeader title="기록" onBack={(p) => void nav.back(p)} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 얼굴 + 이름 */}
        <Animated.View entering={appear(0)} style={styles.head}>
          <Pressable
            onPress={handleProfileImageEdit}
            disabled={!canEditImage}
            accessibilityRole="button"
            accessibilityLabel={isGuest ? '프로필 사진 (게스트는 바꿀 수 없어요)' : '프로필 사진 바꾸기'}
            accessibilityState={{ disabled: !canEditImage, busy: isUploadingImage }}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <MeAvatar uri={profileUri} />
            {!isGuest ? (
              <View style={styles.editBadge}>
                <PaintIcon name="mypage" size={16} />
              </View>
            ) : null}
          </Pressable>
          <View style={{ flex: 1 }}>
            <StoryText size={24}>{displayName}</StoryText>
            <BodyText soft size={14}>{isUploadingImage ? '사진을 올리는 중이에요' : subLine}</BodyText>
          </View>
        </Animated.View>

        {/* 물감 숫자 세 개 */}
        <Animated.View entering={appear(1)} style={styles.blobs}>
          <StatBlob value={paintedPlaces} unit={`/${LEARNING_UNITS.length}`} label="칠한 곳" color={Paint.yellow} seed={2} />
          <StatBlob value={correct} label="배운 표현" color={Paint.leaf} seed={5} />
          <StatBlob value={goalStreakDays} unit="일" label="이어서 배움" color={Paint.coral} seed={8} />
        </Animated.View>

        {/* 푼 문제 한 줄 요약 */}
        <Animated.View entering={appear(2)}>
          <BodyText soft size={Size.small} style={styles.summary}>
            푼 문제 {total} · 맞힘 {correct} · 틀림 {incorrect} · 정확도 <Mark>{shownAccuracy}%</Mark>
          </BodyText>
        </Animated.View>

        <Animated.View entering={appear(3)}>
          <StoryText size={Size.lead} style={styles.sub}>이번 주</StoryText>
          <WeekDrops counts={dailySolvedCounts} />
          <BodyText soft size={Size.caption} style={styles.weekNote}>
            하루 {DAILY_GOAL_TARGET}문제를 채우면 '이어서 배움'이 하루 늘어요
          </BodyText>
        </Animated.View>

        {/* 자주 틀린 단어 */}
        <Animated.View entering={appear(4)}>
          <StoryText size={Size.lead} style={styles.sub}>자주 틀린 단어</StoryText>
          <RoughBox seed={31} style={styles.box}>
            {topWrongWords.length === 0 ? (
              <BodyText soft style={styles.empty}>아직 틀린 단어가 모이지 않았어요</BodyText>
            ) : (
              topWrongWords.map((item, index) => (
                <MeRow
                  key={item.quizId}
                  first={index === 0}
                  label={`${index + 1}. ${item.word || '단어 정보 없음'}`}
                  right={
                    <BodyText size={Size.small} style={styles.count}>
                      <Mark color={Paint.wrongSoft}>{item.wrongCount}번 틀림</Mark>
                    </BodyText>
                  }
                />
              ))
            )}
          </RoughBox>
        </Animated.View>

        {/* 학습 관리 */}
        <Animated.View entering={appear(5)}>
          <StoryText size={Size.lead} style={styles.sub}>모아 둔 것</StoryText>
          <RoughBox seed={37} style={styles.box}>
            <MeRow first icon="note" label="오답 노트" onPress={(p) => void nav.go('/wrongnote', p)} />
            <MeRow icon="bookmark" label="북마크" onPress={(p) => void nav.go('/bookmark', p)} />
          </RoughBox>
        </Animated.View>

        <Animated.View entering={appear(6)} style={styles.logout}>
          <PaintButton
            variant="ghost"
            label="로그아웃"
            icon={<PaintIcon name="logout" size={22} />}
            onPress={async () => {
              await signOut();
              void nav.go('/login' as any, { replace: true, kind: 'bloom' });
            }}
          />
        </Animated.View>
      </ScrollView>

      <PaintTabBar current="mypage" />
    </PaperScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 22, paddingTop: 10 },
  editBadge: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Paint.ink,
    backgroundColor: Paint.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 22 },
  summary: { textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  sub: { paddingHorizontal: 22, marginTop: 22, marginBottom: 10 },
  weekNote: { textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  box: { marginHorizontal: 20, paddingHorizontal: 16, paddingVertical: 4 },
  empty: { paddingVertical: 16, textAlign: 'center' },
  count: { flexShrink: 0 },
  logout: { marginHorizontal: 20, marginTop: 22 },
});
