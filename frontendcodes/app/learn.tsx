import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#1f80e3';

type CourseCardProps = {
  title: string;
  description: string;
  percent: number;
  level: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  lightBg: string;
  onPress?: () => void;
};

function CourseCard({
  title,
  description,
  percent,
  level,
  icon,
  color,
  lightBg,
  onPress,
}: CourseCardProps) {
  return (
    <Pressable style={styles.courseCard} onPress={onPress}>
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
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.progressText}>{percent}%</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function LearnScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerSub}>수어지교 학습</Text>
              <Text style={styles.headerTitle}>카테고리 선택</Text>
            </View>
            <Pressable style={styles.settingsButton}>
              <Ionicons name="settings" size={18} color="#64748b" />
            </Pressable>
          </View>

          <View style={styles.goalCard}>
            <View style={styles.goalRow}>
              <Text style={styles.goalTitle}>오늘의 목표</Text>
              <Text style={styles.goalPercent}>60%</Text>
            </View>
            <View style={styles.goalTrack}>
              <View style={styles.goalFill} />
            </View>
            <Text style={styles.goalDesc}>오늘의 퀴즈 5개 중 3개 완료</Text>
          </View>

          <Text style={styles.sectionTitle}>학습 과정</Text>

          <CourseCard
            title="기초 단어"
            description="숫자, 가족, 인사 등 기본적인 단어를 배워보세요."
            percent={80}
            level="Level 1"
            icon="school"
            color="#3b82f6"
            lightBg="#eff6ff"
            onPress={() => router.push('/quiz')}
          />
          <CourseCard
            title="일상 회화"
            description="일상 생활에서 자주 쓰이는 문장을 익혀보세요."
            percent={30}
            level="Level 2"
            icon="forum-outline"
            color="#a855f7"
            lightBg="#f5f3ff"
          />
          <CourseCard
            title="상황별 표현"
            description="병원, 은행, 식당 등 다양한 장소에서의 표현."
            percent={5}
            level="Level 3"
            icon="storefront-outline"
            color="#f97316"
            lightBg="#fff7ed"
          />

          <View style={styles.lockedCard}>
            <View style={styles.lockIconWrap}>
              <Ionicons name="lock-closed" size={18} color="#94a3b8" />
            </View>
            <View>
              <Text style={styles.lockTitle}>고급 표현</Text>
              <Text style={styles.lockDesc}>이전 단계를 완료하여 잠금 해제하세요.</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => router.push('/home')}>
            <Ionicons name="home-outline" size={18} color="#94a3b8" />
            <Text style={styles.navText}>홈</Text>
          </Pressable>
          <Pressable style={styles.navItem}>
            <Ionicons name="school" size={18} color={PRIMARY} />
            <Text style={[styles.navText, styles.navTextActive]}>학습하기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/translator')}>
            <MaterialCommunityIcons name="sign-language" size={18} color="#94a3b8" />
            <Text style={styles.navText}>통역기</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/mypage')}>
            <Ionicons name="person-outline" size={18} color="#94a3b8" />
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
    backgroundColor: '#f6f7f8',
  },
  root: {
    flex: 1,
    backgroundColor: '#f6f7f8',
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 98,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  headerSub: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3,
  },
  headerTitle: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '800',
  },
  settingsButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  goalCard: {
    marginTop: 12,
    borderRadius: 28,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 20,
    paddingVertical: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalTitle: {
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '800',
  },
  goalPercent: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '700',
  },
  goalTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#dbe4ef',
    overflow: 'hidden',
  },
  goalFill: {
    width: '60%',
    height: '100%',
    backgroundColor: PRIMARY,
    borderRadius: 999,
  },
  goalDesc: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 10,
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  courseCard: {
    marginBottom: 12,
    borderRadius: 28,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 18,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  courseIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
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
    fontSize: 15,
    fontWeight: '800',
    color: '#1f2937',
  },
  levelBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '700',
  },
  courseDesc: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
    marginRight: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '700',
  },
  lockedCard: {
    marginTop: 4,
    borderRadius: 28,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
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
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
  },
  lockDesc: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
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
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 58,
  },
  navText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  navTextActive: {
    color: PRIMARY,
  },
});

