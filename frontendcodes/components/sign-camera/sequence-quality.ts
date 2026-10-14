import type { HandSequenceData } from './sequence-reader';

export function summarizeHandSequence(data:HandSequenceData){
  const count=data.timestampsMs.length;
  const gaps=data.timestampsMs.slice(1).map((time,index)=>({
    fromFrame:index,toFrame:index+1,startMs:data.timestampsMs[index],endMs:time,
    intervalMs:time-data.timestampsMs[index],
  }));
  const ordered=gaps.map(g=>g.intervalMs).sort((a,b)=>a-b);
  const middle=Math.floor(ordered.length/2);
  const medianMs=ordered.length ? (ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2) : null;
  const firstMs=data.timestampsMs[0],lastMs=data.timestampsMs[count-1];
  const hands=[0,1].map(side=>{
    let missing=0,start=-1,longest:{startFrame:number;endFrame:number;count:number}|null=null;
    for(let i=0;i<=count;i++){
      if(i<count&&data.masks[i][side]===0){missing++;if(start<0)start=i;}
      else if(start>=0){
        const run={startFrame:start,endFrame:i-1,count:i-start};
        if(!longest||run.count>longest.count)longest=run;
        start=-1;
      }
    }
    return {side:side===0?'Left':'Right',missing,missingPercent:missing/count*100,longestMissingRun:longest};
  });
  return {frames:count,firstMs,lastMs,initialWaitMs:firstMs,tailMs:data.durationMs-lastMs,
    observedSamplingHz:count>1?(count-1)*1000/(lastMs-firstMs):null,
    medianIntervalMs:medianMs,maxIntervalMs:ordered.length?ordered[ordered.length-1]:null,
    largestGaps:[...gaps].sort((a,b)=>b.intervalMs-a.intervalMs||a.fromFrame-b.fromFrame).slice(0,5),hands};
}
