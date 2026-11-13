/**
 * 하늘 시간대: 마을 그림만이 아니라 앱 전체 종이가 이 시간대를 따라간다.
 * 발표·확인용으로 시각을 고정할 수 있다 (홈의 ?hour= 가 여기에 시각을 넣는다).
 */
import { useEffect, useState } from 'react';

export type SkyPhase = 'morning' | 'day' | 'evening' | 'night';

export function skyOf(hour: number): SkyPhase {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

let override: number | undefined;
const listeners = new Set<() => void>();

/** 시각을 고정한다. undefined면 실제 시각으로 돌아간다 */
export function setSkyHour(hour: number | undefined) {
  if (hour === override) return;
  override = hour;
  listeners.forEach((fn) => fn());
}

export function currentSkyPhase(): SkyPhase {
  return skyOf(override ?? new Date().getHours());
}

/** 지금 시간대. 고정 시각이 바뀌거나 시간이 흘러 시간대가 바뀌면 다시 그린다 */
export function useSkyPhase(): SkyPhase {
  const [phase, setPhase] = useState(currentSkyPhase);
  useEffect(() => {
    const update = () => setPhase(currentSkyPhase());
    listeners.add(update);
    update();
    const id = setInterval(update, 60_000);
    return () => {
      listeners.delete(update);
      clearInterval(id);
    };
  }, []);
  return phase;
}
