// Browser/layout and file-backed input regression. Never physical phone or human accuracy evidence.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import {BridgeClient} from '../packages/tv-pose-bridge/src/client.js';
import {startDevServer} from './dev_server.mjs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
for(const file of ['.cache/web/camera.js','.cache/models/voice-en.tar.gz','local_private/fixtures/empty-scene.y4m','local_private/voice-regression/tts001_rate0_cmd1_quiet.wav']){
  if(!existsSync(file)){console.log(`PENDING: missing ${file}. See README controller regression prerequisites.`);process.exit(2);}
}
await mkdir('results/controller',{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH??=path.join(process.env.CONDA_PREFIX,'playwright-browsers');
const {chromium,webkit}=await import('playwright');
const report={status:'FAIL',setup:'local desktop browser engines / simulated viewports / synthetic files',physicalDevicesVerified:false,humanVoiceAccuracyVerified:false,layouts:[],voice:null,errors:[]};
const server=await startDevServer({host:'127.0.0.1',port:0});
let browser,tv,voicePage;
try{
  for(const [engine,sizes] of [[chromium,[[390,844],[360,800],[768,1024],[1024,768]]],[webkit,[[390,844],[768,1024]]]]){
    browser=await engine.launch(engine===chromium?{channel:'chromium',headless:true,chromiumSandbox:true}:{headless:true});
    for(const [width,height] of sizes){
      const page=await browser.newPage({viewport:{width,height}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.baseUrl?r.continue():r.abort());
      await page.goto(server.baseUrl+'/phone');
      assert(await page.locator('#video').evaluate(v=>v.srcObject===null),'Camera must start off');
      assert.equal(await page.locator('[data-command]').count(),7);
      await page.locator('[data-command="pause"]').click();
      assert.match(await page.locator('#pair-status').innerText(),/Connect to TV first/);
      assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Controller horizontally overflows');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`results/controller/${engine.name()}-${width}x${height}.png`,fullPage:true});
      report.layouts.push({engine:engine.name(),version:browser.version(),width,height,status:'PASS',cameraStarted:false});
      if(engine===webkit&&width===390){
        await page.locator('#voice-enable').click();
        await page.waitForFunction(()=>!document.querySelector('#voice').disabled||document.querySelector('#voice-status').textContent.includes('unavailable:'),null,{timeout:100000});
        assert(!await page.locator('#voice').isDisabled(),await page.locator('#voice-status').innerText());
        report.webkitOfflineModel={status:'PASS',engine:'desktop WebKit',microphoneStarted:false,physicalSafariVerified:false};
      }
      await page.close();
    }
    await browser.close();browser=undefined;
  }
  let pairCode,peerId;const received=[];
  tv=new BridgeClient({url:server.url,role:'tv',WebSocketImpl:WebSocket,onControl:m=>{if(m.action==='created')pairCode=m.pairCode;if(m.action==='peer')peerId=m.peerId;},onMessage:m=>received.push(m)}).connect();
  const until=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;while(!fn()){assert(Date.now()<end,`Timed out: ${label}`);await new Promise(r=>setTimeout(r,100));}};
  await until(()=>pairCode,'pairing');
  browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${path.resolve('local_private/fixtures/empty-scene.y4m')}`,`--use-file-for-fake-audio-capture=${path.resolve('local_private/voice-regression/tts001_rate0_cmd1_quiet.wav')}`]});
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera','microphone']});
  await context.route('**/*',r=>new URL(r.request().url()).origin===server.baseUrl?r.continue():r.abort());
  const page=await context.newPage();voicePage=page;page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))console.log(`Voice browser ${message.type()}: ${message.text().slice(0,500)}`);});
  await page.goto(server.baseUrl+'/phone');await page.locator('#code').fill(pairCode);await page.locator('#consent').check();await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#stats').textContent.includes('inference fps'),null,{timeout:60000});
  await until(()=>peerId,'phone peer');
  await page.locator('[data-command="pause"]').click();await until(()=>received.some(m=>m.type==='voice'&&m.command==='pause'),'touch command');
  await page.locator('#voice-enable').click();
  await page.waitForFunction(()=>!document.querySelector('#voice').disabled||document.querySelector('#voice-status').textContent.includes('unavailable:'),null,{timeout:100000});
  assert(!await page.locator('#voice').isDisabled(),await page.locator('#voice-status').innerText());
  const before=received.filter(m=>m.type==='voice').length;
  const button=page.locator('#voice');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(4500);await page.mouse.up();
  await until(()=>received.filter(m=>m.type==='voice').length>before,'actual WASM speech command',20000);
  const voices=received.filter(m=>m.type==='voice');
  assert.equal(voices.at(-1).command,'pause');
  report.voice={status:'PASS',engine:'Vosk WASM restricted grammar',fixture:'installed Windows TTS pause / quiet',synthetic:true,command:voices.at(-1).command,confidence:voices.at(-1).conf,actualRecognitionExecuted:true,iPhoneVerified:false};
  await page.locator('#stop').click();assert(await page.locator('#video').evaluate(v=>v.srcObject===null));
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.errors.push(error.message);if(voicePage){report.voiceStatus=await voicePage.locator('#voice-status').innerText().catch(()=>null);await voicePage.screenshot({path:'results/controller/voice-failure.png',fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{await browser?.close();tv?.close();await server.close();await writeFile('results/controller/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
