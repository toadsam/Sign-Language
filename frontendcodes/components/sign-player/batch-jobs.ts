/**
 * 평가 영상 일괄 녹화: 고른 파일들에서 녹화할 목록을 만든다.
 * 입력은 viewer/seunghyeok/evaluation/export_motion_json.py 출력과 같은 모양 `<조건>/sentence-NN.json` (계약 ⑤).
 * private/ · README 같은 다른 파일은 건너뛴다. 출력 이름은 prepare_videos.py 입력과 같은 `<조건>/sentence-NN.<확장자>`.
 */
import { decodeMotion, type DecodedMotion } from './motion';

export const KNOWN_CONDITIONS = ['B1', 'B2', 'Ours-H', 'Ours-HF'] as const;
export type BatchJob = { condition: string; sentence: number; source: string; motion: DecodedMotion };
export type BatchPlan = { jobs: BatchJob[]; skipped: string[]; problems: string[] };

/** "out/B1/sentence-03.json" → { condition: 'B1', sentence: 3 }. 해당 없으면 null */
export function parseJobPath(path: string): { condition: string; sentence: number } | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const condition = parts[parts.length - 2];
  const m = /^sentence-(\d{2})\.json$/i.exec(parts[parts.length - 1]);
  if (!m || !(KNOWN_CONDITIONS as readonly string[]).includes(condition)) return null;
  const sentence = Number(m[1]);
  return sentence >= 1 ? { condition, sentence } : null;
}

/** files: 상대 경로와 글. 정렬은 문장 번호 → 조건 순서 */
export function planJobs(files: { path: string; text: string }[]): BatchPlan {
  const jobs: BatchJob[] = [], skipped: string[] = [], problems: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const id = parseJobPath(f.path);
    if (!id) { skipped.push(f.path); continue; }
    const key = `${id.condition}/${id.sentence}`;
    if (seen.has(key)) { problems.push(`${f.path}: ${id.condition} 문장 ${String(id.sentence).padStart(2, '0')}이 두 번 있습니다.`); continue; }
    seen.add(key);
    let motion: DecodedMotion;
    try { motion = decodeMotion(JSON.parse(f.text)); }
    catch (e) { problems.push(`${f.path}: ${e instanceof Error ? e.message : '읽지 못했습니다.'}`); continue; }
    if (motion.response.frames < 1) { problems.push(`${f.path}: 재생할 프레임이 없습니다.`); continue; }
    jobs.push({ condition: id.condition, sentence: id.sentence, source: f.path, motion });
  }
  const order = (c: string) => (KNOWN_CONDITIONS as readonly string[]).indexOf(c);
  jobs.sort((a, b) => a.sentence - b.sentence || order(a.condition) - order(b.condition));
  // 조건마다 같은 문장 번호가 있어야 평가에서 짝이 맞는다
  const conditions = [...new Set(jobs.map((j) => j.condition))];
  const sentences = [...new Set(jobs.map((j) => j.sentence))];
  for (const c of conditions) for (const s of sentences)
    if (!jobs.some((j) => j.condition === c && j.sentence === s)) problems.push(`${c}: 문장 ${String(s).padStart(2, '0')}이 없습니다.`);
  return { jobs, skipped, problems };
}

/** ZIP 안의 이름 */
export function outputName(job: Pick<BatchJob, 'condition' | 'sentence'>, extension: string) {
  return `${job.condition}/sentence-${String(job.sentence).padStart(2, '0')}.${extension}`;
}
