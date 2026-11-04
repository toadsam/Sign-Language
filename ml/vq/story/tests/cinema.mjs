import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {film,examples} from '../src/screenplay.js';
import {chapters} from '../src/content.js';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const starts=chapters.map((_,i)=>chapters.slice(0,i).reduce((s,c)=>s+c.duration,0));
const report=[];
try{
 for(const width of [1440,768,390]){
  const p=await browser.newPage({viewport:{width,height:960}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:5187');await p.locator('canvas').waitFor();
  for(let ch=0;ch<7;ch++)for(let sh=0;sh<4;sh++){
   const at=starts[ch]+chapters[ch].duration/4*(sh+.55);
   await p.locator('#timeline').fill(at.toFixed(1));await p.locator('#timeline').dispatchEvent('input');await p.waitForTimeout(100);
   assert.equal(await p.locator('#headline').textContent(),film[ch][sh][0]);
   const layout=await p.evaluate(()=>{const a=document.querySelector('.chapter-copy').getBoundingClientRect(),b=document.querySelector('#scene').getBoundingClientRect(),c=document.querySelector('.film-caption').getBoundingClientRect();return {top:b.top-a.bottom,bottom:c.top-b.bottom,overflow:document.documentElement.scrollWidth>innerWidth,height:b.height};});
   assert.ok(layout.top>=8&&layout.bottom>=8&&!layout.overflow&&layout.height>160,JSON.stringify({width,ch,sh,layout}));
   if((ch===1&&sh===2)||(ch===2&&sh===2)||(ch===4&&sh===1)){await p.waitForTimeout(650);await p.screenshot({path:`test-results/cinema-${width}-${ch}-${sh}.png`});}
  }
  await p.locator('#shot-code').click();assert.ok(await p.locator('.example-theater').isVisible());
  for(const [path,e] of Object.entries(examples)){
   await p.locator('#search').fill(path);await p.locator(`#file-list [data-file="${path}"]`).click();
   for(let step=0;step<3;step++){await p.locator(`[data-example-step="${step}"]`).click();assert.equal(await p.locator('.example-payload').textContent(),e[2][step]);}
  }
  await p.waitForTimeout(500);await p.screenshot({path:`test-results/examples-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);report.push({width,shots:28,examples:25,steps:75,errors});await p.close();
 }
 await writeFile('test-results/cinema-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
