import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Clip = {
  word: string;
  id: number;
  file: string;
  url: string;
};

type SimplificationMetadata = {
  question: boolean;
  negative: boolean;
  tense: string;
};

type TranslateResponse = {
  input: string;
  simplifiedSentence: string;
  normalizedTokens: string[];
  appliedRules: string[];
  metadata: SimplificationMetadata;
  clips: Clip[];
  unknown: string[];
};

const BACKEND_BASE_URL = 'http://localhost:8080';

const SAMPLES = [
  '화장실 어디 있어?',
  '지하철역은 어디야?',
  '내일 공항에 가요',
  '화장실이 없어요?',
  '오늘 출발했어요',
  '왼쪽으로 가서 횡단보도 건너요',
];

export default function TestScreen() {
  const [text, setText] = useState(SAMPLES[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [statusByUrl, setStatusByUrl] = useState<Record<string, 'OK' | 'FAIL'>>({});

  const unknownTokens = useMemo(() => result?.unknown ?? [], [result]);
  const normalizedTokens = useMemo(() => result?.normalizedTokens ?? [], [result]);
  const clips = useMemo(() => result?.clips ?? [], [result]);
  const appliedRules = useMemo(() => result?.appliedRules ?? [], [result]);
  const metadata = result?.metadata;

  const checkClipStatus = async (relativeUrl: string): Promise<'OK' | 'FAIL'> => {
    const fullUrl = `${BACKEND_BASE_URL}${relativeUrl}`;
    try {
      const head = await fetch(fullUrl, { method: 'HEAD' });
      if (head.ok) {
        return 'OK';
      }
    } catch {
      // ignored
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
    if (!target) {
      return;
    }

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
        setError(`/translate 호출 실패: ${response.status}`);
        setResult(null);
        return;
      }

      const data = (await response.json()) as TranslateResponse;
      setResult(data);

      const nextStatuses: Record<string, 'OK' | 'FAIL'> = {};
      for (const clip of data.clips) {
        nextStatuses[clip.url] = await checkClipStatus(clip.url);
      }
      setStatusByUrl(nextStatuses);
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 중 오류가 발생했습니다.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>/test 수어 문장 변환 테스트</Text>
        <Text style={styles.caption}>{'원문 -> 수어 직전 문장 -> /translate 매핑 흐름 검증'}</Text>

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
          <Text style={styles.sectionTitle}>Simplified Sentence</Text>
          <Text style={styles.sentenceText}>{result?.simplifiedSentence || '없음'}</Text>
        </View>

        <Section title="Applied Rules" tokens={appliedRules} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Metadata</Text>
          {metadata ? (
            <View style={styles.metaWrap}>
              <Text style={styles.metaText}>question: {metadata.question ? 'true' : 'false'}</Text>
              <Text style={styles.metaText}>negative: {metadata.negative ? 'true' : 'false'}</Text>
              <Text style={styles.metaText}>tense: {metadata.tense}</Text>
            </View>
          ) : (
            <Text style={styles.empty}>없음</Text>
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
                  {statusByUrl[clip.url] ? ` ${statusByUrl[clip.url]}` : ' 확인중...'}
                </Text>
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
    marginBottom: 4,
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
  sentenceText: {
    color: '#1e2b3a',
    lineHeight: 22,
  },
  sectionTitle: {
    fontWeight: '700',
    color: '#1e2b3a',
  },
  metaWrap: {
    gap: 4,
  },
  metaText: {
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

