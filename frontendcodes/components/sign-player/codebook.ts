import { decodeMotion } from './motion';
import type { DecodedMotion } from './motion';

export type CodebookEntry = { token: number; motion: DecodedMotion };
// Local import envelope; replace this adapter when the team's export format is fixed.
export function decodeCodebook(value: unknown): CodebookEntry[] {
  if (!value || typeof value !== 'object') throw new Error('코드북 객체가 필요합니다.');
  const book = value as { version?: unknown; entries?: unknown };
  if (book.version !== 1 || !Array.isArray(book.entries) || book.entries.length < 1 || book.entries.length > 1024)
    throw new Error('version: 1과 1~1024개의 entries가 필요합니다.');
  const seen = new Set<number>();
  return book.entries.map((entry: unknown, i: number) => {
    if (!entry || typeof entry !== 'object') throw new Error(`${i+1}번째 항목이 올바르지 않습니다.`);
    const row = entry as { token: number; motion: unknown };
    if (!Number.isSafeInteger(row.token) || row.token < 0 || seen.has(row.token)) throw new Error(`${i+1}번째 토큰 번호가 올바르지 않거나 중복됩니다.`);
    seen.add(row.token);
    const motion = decodeMotion(row.motion);
    if (motion.response.frames !== 4) throw new Error(`토큰 ${row.token}: 정확히 4프레임이 필요합니다.`);
    if (motion.response.tokens.length !== 1 || motion.response.tokens[0] !== row.token) throw new Error(`토큰 ${row.token}: motion.tokens에 같은 토큰 하나가 필요합니다.`);
    return { token: row.token, motion };
  }).sort((a,b)=>a.token-b.token);
}
export function codebookFrame(seconds: number, fps: number): number {
  return Math.floor(Math.max(0, seconds) * fps + 1e-8) % 4;
}
