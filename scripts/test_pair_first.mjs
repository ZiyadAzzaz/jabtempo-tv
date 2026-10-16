// Actual local relay delivery with synthetic browser failure injection; no physical accuracy evidence.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import {BridgeClient} from '../packages/tv-pose-bridge/src/client.js';
import {startDevServer} from './dev_server.mjs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
process.env.PLAYWRIGHT_BROWSERS_PATH??=path.join(process.env.CONDA_PREFIX,'playwright-browsers');
const {chromium,webkit}=await import('playwright');
const report={v:1,status:'FAIL',setup:'desktop Chromium/WebKit + isolated per-engine local relay + injected camera/worker failures',physicalDeviceVerified:false,sensorAccuracyVerified:false,checks:[],errors:[]};
let browser,tv,currentPage,relay;
const until=async(fn,label)=>{const end=Date.now()+10000;while(!fn()){assert(Date.now()<end,`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,40));}};
try{
 for(const engine of [chromium,webkit]){
  relay=await startDevServer({host:'127.0.0.1',port:0});
  let code;const messages=[];let peer=false;
  tv=new BridgeClient({url:relay.url,role:'tv',WebSocketImpl:WebSocket,onControl:m=>{if(m.action==='created')code=m.pairCode;if(m.action==='peer')peer=m.state==='joined';},onMessage:m=>messages.push(m)}).connect();await until(()=>code,'TV code');
  browser=await engine.launch(engine===chromium?{channel:'chromium',headless:true}:{headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];currentPage=page;page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===relay.baseUrl?route.continue():route.abort());
  await page.addInitScript(()=>{
   window.__cameraCalls=0;window.__cameraMode='deny';window.__stoppedTracks=0;
   // Desktop WebKit may not expose media APIs on its localhost target. Inject only mocked capabilities: never real media.
   if(!window.isSecureContext)Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
   if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});
   if(!window.createImageBitmap)window.createImageBitmap=async()=>{throw Error('Unexpected image capture in failure regression');};
   navigator.mediaDevices.getUserMedia=async()=>{window.__cameraCalls++;if(window.__cameraMode==='deny')throw new DOMException('Synthetic denied permission','NotAllowedError');const tracks=[{stop(){window.__stoppedTracks++;},onended:null}];return {getTracks:()=>tracks,getVideoTracks:()=>tracks};};
   const OriginalWorker=window.Worker;window.Worker=function(url,options){if(String(url).endsWith('/pose-worker.js')){const fake={postMessage(){setTimeout(()=>fake.onmessage?.({data:{type:'error',message:'Synthetic worker initialization failure'}}),30);},terminate(){}};return fake;}return new OriginalWorker(url,options);};
  });
  await page.goto(relay.baseUrl+'/phone');
  await page.locator('#code').fill('12');await page.locator('#connect').click();assert.match(await page.locator('#pair-status').innerText(),/four-digit/);
  const wrong=String((Number(code)+1)%10000).padStart(4,'0');await page.locator('#code').fill(wrong);await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#pair-status').textContent.includes('invalid or expired'));
  await page.locator('#code').fill(code);await page.locator('#connect').click();await until(()=>peer,'pair-first peer');await page.waitForFunction(()=>document.querySelector('#pair-status').textContent.includes('TV connected'));
  assert.equal(await page.evaluate(()=>window.__cameraCalls),0);assert(await page.locator('#video').evaluate(video=>video.srcObject===null));
  const pauseButton=page.locator('[data-command="pause"]');await pauseButton.click();await until(()=>messages.some(m=>m.type==='voice'&&m.command==='pause'),'command without camera');
  assert.match(await page.locator('#voice-status').innerText(),/do not move TV menu focus/);
  await page.locator('#consent').check();await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Camera setup failed'));
  assert.match(await page.locator('#pair-status').innerText(),/TV connected/);await page.locator('[data-command="harder"]').click();await until(()=>messages.some(m=>m.type==='voice'&&m.command==='harder'),'camera failure fallback');
  await page.evaluate(()=>{window.__cameraMode='worker-error';const video=document.querySelector('#video');let stream=null;Object.defineProperty(video,'srcObject',{configurable:true,get:()=>stream,set:value=>{stream=value;}});Object.defineProperty(video,'videoWidth',{configurable:true,get:()=>640});Object.defineProperty(video,'videoHeight',{configurable:true,get:()=>480});video.play=async()=>{};});
  await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Synthetic worker initialization failure'));
  assert(await page.locator('#video').evaluate(video=>video.srcObject===null));assert((await page.evaluate(()=>window.__stoppedTracks))>0);
  await page.locator('[data-command="easier"]').click();await until(()=>messages.some(m=>m.type==='voice'&&m.command==='easier'),'worker failure fallback');
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
  await page.locator('#stop').click();await until(()=>!peer,'Stop disconnects controller');await pauseButton.click();assert.match(await page.locator('#pair-status').innerText(),/Connect to TV first/);
  // Pair-only pagehide also closes the connection without opening a camera.
  await page.locator('#connect').click();await until(()=>peer,'reconnect pair-only');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await until(()=>!peer,'pagehide disconnects');
  assert.deepEqual(errors,[]);report.checks.push({engine:engine.name(),version:browser.version(),pairWithoutCamera:true,invalidCodeFeedback:true,commandsBeforeCamera:true,cameraFailureFallback:true,workerFailureFallback:true,stopDisconnects:true,pagehideDisconnects:true,mediaCalls:await page.evaluate(()=>window.__cameraCalls),physicalAccuracyClaim:false,mediaCapabilities:'mocked for failure-path regression; not browser camera support evidence'});
  await browser.close();browser=undefined;tv.close();tv=undefined;await relay.close();relay=undefined;
 }
 report.status='PASS';
}catch(error){report.errors.push(error.message);if(currentPage)report.failureUI={pair:await currentPage.locator('#pair-status').innerText(),camera:await currentPage.locator('#status').innerText()};process.exitCode=1;}
finally{await browser?.close();tv?.close();await relay?.close();await mkdir('results/controller',{recursive:true});await writeFile('results/controller/pair-first.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
