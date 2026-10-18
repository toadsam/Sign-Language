import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chapters,guides} from '../src/content.js';
import {film,examples} from '../src/screenplay.js';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',root),'utf8'));
assert.equal(chapters.reduce((n,c)=>n+c.duration,0),750);
for(const file of catalog.files){assert.ok(guides[file.path],file.path);for(const fn of file.functions){
  assert.equal(fn.source,file.source.split('\n').slice(fn.line-1,fn.end).join('\n'));}}
for(const c of chapters)for(const f of c.files)assert.ok(catalog.files.some(x=>x.path===f),f);
for(const file of catalog.files){const e=examples[file.path];assert.ok(e,`Example: ${file.path}`);assert.equal(e[2].length,3);assert.equal(e[3].length,3);assert.ok(catalog.files.some(f=>f.path===e[4]));assert.ok(file.functions.some(f=>f.name===e[5]),`${file.path}:${e[5]}`);}
assert.equal(film.flat().length,28);
for(const shot of film.flat()){const f=catalog.files.find(f=>f.path===shot[3]);assert.ok(f.functions.some(fn=>fn.name===shot[4]),`${shot[3]}:${shot[4]}`);}

const browser=await chromium.launch({executablePath:process.env.STORY_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader']});
await mkdir(new URL('test-results/',root),{recursive:true});
const report=[];
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:360,height:800}]) {
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.STORY_URL||'http://127.0.0.1:5187');
    await page.locator('#scene canvas').waitFor();await page.waitForTimeout(1200);
    const pixelStats=()=>page.locator('#scene canvas').evaluate(canvas=>{
      const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);
      const data=ctx.getImageData(0,0,c.width,c.height).data;let bright=0,hash=0;
      for(let i=0;i<data.length;i+=16){if(data[i]+data[i+1]+data[i+2]>170)bright++;hash=(hash*31+data[i]+data[i+1]*3+data[i+2])>>>0;}
      return {bright,hash,width:c.width,height:c.height};
    });
    const first=await pixelStats();assert.ok(first.bright>100,JSON.stringify(first));
    await page.waitForTimeout(400);const second=await pixelStats();assert.notEqual(first.hash,second.hash,'idle scene moves');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
    await page.screenshot({path:fileURLToPath(new URL(`test-results/film-${viewport.width}.png`,root)),fullPage:true});
    await page.locator('#play').click();await page.waitForTimeout(1500);assert.ok(+await page.locator('#timeline').inputValue()>1);
    await page.locator('#play').click();const paused=await page.locator('#timeline').inputValue();await page.waitForTimeout(350);assert.equal(await page.locator('#timeline').inputValue(),paused);
    for(let i=0;i<7;i++){
      await page.locator(`[data-chapter="${i}"]`).click();assert.equal(await page.locator('#lesson-title').textContent(),chapters[i].title);
      await page.locator('#quiz [data-answer="0"]').click();assert.ok((await page.locator('#quiz-result').textContent()).startsWith('맞았어요'));
    }
    await page.locator('[data-chapter="2"]').click();
    await page.locator('#lab-range').fill('100');await page.locator('#lab-range').dispatchEvent('input');assert.match(await page.locator('#lab-result').textContent(),/추가 확인/);
    await page.locator('#lab-range').fill('101');await page.locator('#lab-range').dispatchEvent('input');assert.match(await page.locator('#lab-result').textContent(),/학습 보류/);
    await page.locator('[data-chapter="4"]').click();await page.locator('#lab-range').fill('90');await page.locator('#lab-range').dispatchEvent('input');assert.match(await page.locator('#lab-result').textContent(),/토큰 3/);
    await page.screenshot({path:fileURLToPath(new URL(`test-results/vq-${viewport.width}.png`,root)),fullPage:true});
    await page.locator('[data-view="code"]').click();await page.locator('#search').fill('quantize');assert.equal(await page.locator('#file-list [data-file]').count(),1);
    await page.locator('#file-list [data-file="vq/model.py"]').click();
    await page.locator('[data-function="MotionVQVAE.encode"]').click();assert.equal(await page.locator('.function-title').textContent(),'MotionVQVAE.encode');
    const line=await page.locator('[data-line]').first().getAttribute('data-line');await page.locator('[data-line]').first().click();assert.ok(await page.locator(`#line-${line}`).evaluate(el=>el.classList.contains('selected')));
    await page.screenshot({path:fileURLToPath(new URL(`test-results/code-${viewport.width}.png`,root)),fullPage:true});
    await page.locator('[data-depth="source"]').click();assert.ok(await page.locator('.source-line').count()>100);
    await page.locator('#search').fill('zzzz-no-file');assert.equal(await page.locator('.empty').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'code page overflow');
    await page.locator('[data-view="terms"]').click();assert.equal(await page.locator('.glossary dt').count(),10);
    assert.deepEqual(errors,[]);
    report.push({viewport,pixels:first,errors,checks:'chapters, playback, pause, quiz, threshold, nearest vector, search, function, source, line jump, glossary, overflow'});
    await page.close();
  }
  const reduced=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await reduced.goto(process.env.STORY_URL||'http://127.0.0.1:5187');await reduced.waitForTimeout(500);
  const a=await reduced.locator('canvas').evaluate(c=>c.toDataURL());await reduced.waitForTimeout(350);assert.equal(await reduced.locator('canvas').evaluate(c=>c.toDataURL()),a,'reduced motion idle is stationary');await reduced.close();
  await writeFile(new URL('test-results/report.json',root),JSON.stringify(report,null,2));
  console.log(JSON.stringify({files:catalog.files.length,functions:catalog.files.reduce((n,f)=>n+f.functions.length,0),viewports:report.length,passed:true},null,2));
}finally{await browser.close();}
