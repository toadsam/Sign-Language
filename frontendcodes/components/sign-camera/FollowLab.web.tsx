/**
 * 따라 하기 채점을 따로 해 보는 작업실 화면 (웹).
 * 친구 동작을 고르고(점검용 합성 동작, 또는 문장을 보내 받은 AI 동작) FollowAlong 으로 따라 한다.
 * 통역 화면에 붙이기 전에 채점만 떼어 보려는 것이다.
 */
import { useMemo, useState } from 'react';

import demo from '@/components/sign-player/demo-motion.json';
import { decodeMotion } from '@/components/sign-player/motion';
import { requestMotion, type Motion } from '@/lib/api/generate';

import FollowAlong from './FollowAlong.web';

const CARD = '#FFFDF6';
const INK = '#2E2620';
const SOFT = '#6B5D4F';
const button = { background: CARD, color: INK, border: `1.5px solid ${INK}`, borderRadius: 10, padding: '8px 14px', font: 'inherit', cursor: 'pointer' } as const;

function demoMotion(): Motion {
  const { response, positions } = decodeMotion(demo);
  return { fps: response.fps, frames: response.frames, data: positions, segments: response.segments, source: response.source };
}

/** genEndpoint 는 개발용 주소 바꾸기 (?gen=…). 통역 화면과 같은 규칙이고 localhost 에서만 받는다 */
export default function FollowLab({ genEndpoint }: { genEndpoint?: string }) {
  const sample = useMemo(demoMotion, []);
  const [reference, setReference] = useState<{ motion: Motion; label: string }>({ motion: sample, label: '점검용 합성 동작 (수어가 아닙니다)' });
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  const ask = async () => {
    const sentence = text.trim();
    if (!sentence || loading) return;
    setLoading(true);
    setNote('');
    const result = await requestMotion(sentence, { devEndpoint: genEndpoint });
    setLoading(false);
    if (result.kind === 'motion') {
      setReference({ motion: result.motion, label: `「${sentence}」 · AI가 만든 동작` });
      setNote(result.unknown.length ? `못 그린 낱말: ${result.unknown.join(', ')}` : '');
    } else if (result.kind === 'empty') setNote(`그릴 수 있는 낱말이 없어요${result.unknown.length ? ` (${result.unknown.join(', ')})` : ''}.`);
    else if (result.kind === 'error') setNote(`친구 동작을 받지 못했어요. ${result.message}`);
    else setNote('AI 동작 받기가 꺼져 있어요.');
  };

  const seconds = (reference.motion.frames / (reference.motion.fps || 30)).toFixed(1);
  return (
    <section style={{ fontFamily: 'system-ui, sans-serif', color: INK, background: '#FBF5E6', padding: 20, borderRadius: 16, border: `1.5px solid ${INK}` }}>
      <p style={{ marginTop: 0, color: SOFT, lineHeight: 1.6 }}>
        친구 동작을 정하고 카메라로 따라 하면, 손의 자리와 손가락 모양을 견주어 점수와 고칠 곳을 알려 줍니다. 영상은 저장하거나 보내지 않습니다.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label htmlFor="follow-text">문장으로 친구 동작 받기</label>
        <input id="follow-text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} placeholder="예: 저는 학교에 갑니다." maxLength={200} style={{ flex: '1 1 220px', minWidth: 0, padding: '8px 10px', border: `1.5px solid ${INK}`, borderRadius: 10, font: 'inherit', background: CARD }} />
        <button style={button} disabled={loading || !text.trim()} onClick={() => void ask()}>{loading ? '받는 중…' : '받기'}</button>
        <button style={button} disabled={loading} onClick={() => { setReference({ motion: sample, label: '점검용 합성 동작 (수어가 아닙니다)' }); setNote(''); }}>점검용 동작으로</button>
      </div>
      <p role="status" style={{ margin: '10px 0 14px' }}>
        지금 친구 동작: <b>{reference.label}</b> · {seconds}초 · 낱말 구간 {reference.motion.segments.length}개
        {note ? <span style={{ color: '#9E2E1C' }}> · {note}</span> : null}
      </p>
      <FollowAlong reference={reference.motion} devGen={genEndpoint} />
    </section>
  );
}
