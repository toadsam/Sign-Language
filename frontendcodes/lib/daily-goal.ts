export const DAILY_GOAL_TARGET = 10;

export function normalizeDailySolvedCounts(
  raw: Record<string, unknown> | null | undefined
): Record<string, number> {
  if (!raw) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) continue;
    result[key] = Math.floor(count);
  }
  return result;
}

export function getKstDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getTodaySolvedCount(counts: Record<string, number>): number {
  return counts[getKstDateKey()] ?? 0;
}

export function getGoalPercent(solvedCount: number, target = DAILY_GOAL_TARGET): number {
  if (target <= 0) return 0;
  return Math.min(Math.round((Math.max(solvedCount, 0) / target) * 100), 100);
}

function previousDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);
  return utcDate.toISOString().slice(0, 10);
}

export function getConsecutiveGoalDays(
  counts: Record<string, number>,
  target = DAILY_GOAL_TARGET
): number {
  let streak = 0;
  let cursor = getKstDateKey();

  while ((counts[cursor] ?? 0) >= target) {
    streak += 1;
    cursor = previousDateKey(cursor);
  }

  return streak;
}
