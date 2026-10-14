export type RenderSample = { time: number; frame: number; cpuMs: number };
export function summarizeRendering(samples: RenderSample[], durationMs: number) {
  const times = samples.map(s=>s.cpuMs).sort((a,b)=>a-b);
  let updates=0, lastFrame:number|undefined;
  for(const sample of samples){if(sample.frame!==lastFrame)updates++;lastFrame=sample.frame;}
  return {
    drawCalls:samples.length, frameUpdates:updates,
    updatesPerSecond:durationMs>0?updates/(durationMs/1000):0,
    meanCpuMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:0,
    p95CpuMs:times.length?times[Math.ceil(times.length*.95)-1]:0,
  };
}
