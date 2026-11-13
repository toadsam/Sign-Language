export type RenderSample = { time: number; frame: number; cpuMs: number };
function p95(values:number[]):number {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:0;
}
export function summarizeCadence(timestamps:number[],durationMs:number,targetFps:number) {
  const gaps=timestamps.slice(1).map((time,i)=>time-timestamps[i]).filter(gap=>Number.isFinite(gap)&&gap>0);
  const budgetMs=1000/targetFps;
  return {
    samples:timestamps.length,callbacksPerSecond:durationMs>0?timestamps.length/(durationMs/1000):0,
    meanGapMs:gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:0,
    p95GapMs:p95(gaps),maxGapMs:gaps.length?Math.max(...gaps):0,
    delayedIntervals:gaps.filter(gap=>gap>budgetMs*1.5).length,
    delayThresholdMs:budgetMs*1.5,
    observedSpanMs:timestamps.length>1?timestamps[timestamps.length-1]-timestamps[0]:0,
  };
}
export function summarizeRendering(samples: RenderSample[], durationMs: number,targetFps=30) {
  const times=samples.map(s=>s.cpuMs);
  const updates:number[]=[];let lastFrame:number|undefined;
  for(const sample of samples){if(sample.frame!==lastFrame)updates.push(sample.time);lastFrame=sample.frame;}
  const cadence=summarizeCadence(updates,durationMs,targetFps);
  return {
    drawCalls:samples.length,frameUpdates:updates.length,
    updatesPerSecond:durationMs>0?updates.length/(durationMs/1000):0,
    meanCpuMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:0,
    p95CpuMs:p95(times),updateCadence:cadence,
    samplingStatus:updates.length<2?'insufficient':cadence.observedSpanMs<durationMs*.8?'partial':'recorded',
  };
}
