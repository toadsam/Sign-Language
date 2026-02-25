import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Clip = {
  word: string;
  id: number;
  file: string;
  url: string;
};

type TranslateResponse = {
  input: string;
  normalizedTokens: string[];
  clips: Clip[];
  unknown: string[];
};

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';

const SAMPLES = [
  '지금 가능해?',
  '지하철역 어디야',
  '택시 타고 공항 가요',
  '왼쪽으로 가서 횡단보도 건너',
  '화장실 어디 있어?',
];

export default function TestScreen() {
  const [text, setText] = useState(SAMPLES[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [statusByUrl, setStatusByUrl] = useState<Record<string, 'OK' | 'FAIL'>>({});
  const [playQueue, setPlayQueue] = useState<Clip[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);

  const normalizedTokens = useMemo(() => result?.normalizedTokens ?? [], [result]);
  const clips = useMemo(() => result?.clips ?? [], [result]);
  const unknownTokens = useMemo(() => result?.unknown ?? [], [result]);

  const checkClipStatus = async (relativeUrl: string): Promise<'OK' | 'FAIL'> => {
    const fullUrl = `${BACKEND_BASE_URL}${relativeUrl}`;

    try {
      const head = await fetch(fullUrl, { method: 'HEAD' });
      if (head.ok) return 'OK';
    } catch {
      // ignore
    }

    try {
      const get = await fetch(fullUrl, { method: 'GET' });
      return get.ok ? 'OK' : 'FAIL';
    } catch {
      return 'FAIL';
    }
  };

  const runTest = async (inputText?: string) => {
    const target = (inputText ?? text).trim();
    if (!target) return;

    setLoading(true);
    setError('');
    setStatusByUrl({});

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: target }),
      });

      if (!response.ok) {
        setResult(null);
        setError(`/translate 호출 실패: ${response.status}`);
        setPlayQueue([]);
        setActiveClipIndex(0);
        return;
      }

      const data = (await response.json()) as TranslateResponse;
      setResult(data);

      const statuses: Record<string, 'OK' | 'FAIL'> = {};
      for (const clip of data.clips) {
        statuses[clip.url] = await checkClipStatus(clip.url);
      }
      setStatusByUrl(statuses);
      const queue = data.clips.filter((clip) => statuses[clip.url] === 'OK');
      setPlayQueue(queue);
      setActiveClipIndex(0);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : '요청 중 오류가 발생했습니다.');
      setPlayQueue([]);
      setActiveClipIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const activeClip = playQueue[activeClipIndex] ?? null;
  const activeClipUrl = activeClip ? `${BACKEND_BASE_URL}${activeClip.url}` : '';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>/mapping 매핑 테스트</Text>
        <Text style={styles.caption}>AI-Hub 형태소 빈도 Top-300 사전 기준 검증 화면</Text>
        <Text style={styles.caption}>Frontend(8081) → Backend(8080) /translate + /clips 접근 검사</Text>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="문장을 입력하세요"
          placeholderTextColor="#7a8699"
          multiline
        />

        <Pressable style={styles.primaryButton} onPress={() => runTest()} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? '테스트 중...' : '번역/매핑 테스트'}</Text>
        </Pressable>

        <View style={styles.samples}>
          {SAMPLES.map((sample) => (
            <Pressable
              key={sample}
              style={styles.sampleButton}
              onPress={() => {
                setText(sample);
                runTest(sample);
              }}>
              <Text style={styles.sampleButtonText}>{sample}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Clip Player</Text>
          {!activeClipUrl ? (
            <Text style={styles.empty}>재생 가능한 클립이 없습니다.</Text>
          ) : Platform.OS === 'web' ? (
            <View style={styles.playerWrap}>
              <video
                key={activeClipUrl}
                src={activeClipUrl}
                controls
                autoPlay
                playsInline
                preload="metadata"
                onEnded={() => {
                  setActiveClipIndex((prev) => {
                    if (prev + 1 < playQueue.length) {
                      return prev + 1;
                    }
                    return prev;
                  });
                }}
                style={{ width: '100%', borderRadius: 10 }}
              />
              <Text style={styles.caption}>
                순차 재생: {activeClipIndex + 1}/{playQueue.length}
              </Text>
              <Text style={styles.clipUrl}>{activeClipUrl}</Text>
            </View>
          ) : (
            <Pressable style={styles.sampleButton} onPress={() => Linking.openURL(activeClipUrl)}>
              <Text style={styles.sampleButtonText}>클립 열기</Text>
            </Pressable>
          )}
        </View>

        <Section title="Normalized Tokens" tokens={normalizedTokens} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Matched Clips</Text>
          {clips.length === 0 ? (
            <Text style={styles.empty}>없음</Text>
          ) : (
            clips.map((clip) => (
              <View key={`${clip.word}-${clip.url}`} style={styles.clipItem}>
                <Text style={styles.clipText}>
                  {clip.word} | id:{clip.id} | {clip.file}
                </Text>
                <Text style={styles.clipUrl}>{clip.url}</Text>
                <Text style={statusByUrl[clip.url] === 'OK' ? styles.ok : styles.fail}>
                  {statusByUrl[clip.url] ? statusByUrl[clip.url] : '확인 중...'}
                </Text>
                {statusByUrl[clip.url] === 'OK' ? (
                  <Pressable
                    style={styles.playButton}
                    onPress={() => {
                      const indexInQueue = playQueue.findIndex((item) => item.url === clip.url);
                      if (indexInQueue >= 0) {
                        setActiveClipIndex(indexInQueue);
                        return;
                      }
                      setPlayQueue((prev) => [...prev, clip]);
                      setActiveClipIndex(playQueue.length);
                    }}>
                    <Text style={styles.playButtonText}>이 클립 재생</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>

        <Section title="Unknown Tokens" tokens={unknownTokens} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {tokens.length === 0 ? (
        <Text style={styles.empty}>없음</Text>
      ) : (
        <View style={styles.tokenWrap}>
          {tokens.map((token, idx) => (
            <View key={`${token}-${idx}`} style={styles.token}>
              <Text style={styles.tokenText}>{token}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f7fb',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1e2b3a',
  },
  caption: {
    color: '#5f6b7a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 10,
    minHeight: 88,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  samples: {
    gap: 8,
  },
  sampleButton: {
    backgroundColor: '#2f4858',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  sampleButtonText: {
    color: '#fff',
  },
  error: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  section: {
    borderWidth: 1,
    borderColor: '#d9e2ef',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    fontWeight: '700',
    color: '#1e2b3a',
  },
  empty: {
    color: '#5f6b7a',
  },
  tokenWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  token: {
    backgroundColor: '#eef3fb',
    borderWidth: 1,
    borderColor: '#d9e2ef',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tokenText: {
    color: '#1e2b3a',
  },
  clipItem: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  playerWrap: {
    gap: 8,
  },
  playButton: {
    marginTop: 6,
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  playButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  clipText: {
    color: '#1e2b3a',
    fontWeight: '600',
  },
  clipUrl: {
    color: '#0f766e',
  },
  ok: {
    color: '#166534',
    fontWeight: '700',
  },
  fail: {
    color: '#b91c1c',
    fontWeight: '700',
  },
});
