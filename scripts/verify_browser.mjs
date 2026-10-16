// Isolated installed Edge QA fallback. Camera/microphone are never requested.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const dir=resolve('.cache/edge-check-'+Date.now());mkdirSync(dir,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless','--disable-gpu','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9227',`--user-data-dir=${dir}`,'http://localhost:8787/dev-check'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
  let targets;
  for(let i=0;i<40;i++){try{targets=await(await fetch('http://127.0.0.1:9227/json')).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(250);}
  const target=targets?.find(t=>t.type==='page');assert.ok(target,'Isolated Edge debug endpoint');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  let seq=0;const pending=new Map();ws.on('message',wire=>{const m=JSON.parse(String(wire));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(JSON.stringify(m.error))):p?.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
  await call('Page.enable');await call('Runtime.enable');await call('Page.bringToFront');await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  let initialization='';for(let i=0;i<80;i++){initialization=await evaluate("document.getElementById('result')?.textContent ?? ''");if(/^(PASS|FAIL)/.test(initialization))break;await sleep(500);}
  assert.match(initialization,/^PASS:/,initialization||'No worker initialization result');
  await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://localhost:8787/dev-tv'});for(let i=0;i<40;i++){if(await evaluate("!!document.querySelector('button[data-action=play]')"))break;await sleep(100);}
  assert.equal(await evaluate("document.activeElement?.getAttribute('data-action')"),'play');
  mkdirSync('results/dev_preview',{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('results/dev_preview/home.png',Buffer.from(shot.data,'base64'));
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});await sleep(200);};
  await key('Enter','Enter',13);assert.ok(await evaluate("!!document.getElementById('code')"),'Enter opens Pair');
  await sleep(2500);assert.match(await evaluate("document.getElementById('code').textContent"),/^\d{4}$/,'Live relay produced a code');assert.match(await evaluate("document.getElementById('connection').textContent"),/connected/,'Relay stays connected through clock controls');
  await key('Escape','Escape',27);assert.ok(await evaluate("!!document.querySelector('button[data-action=play]')"),'Back returns Home');
  await key('ArrowRight','ArrowRight',39);assert.equal(await evaluate("document.activeElement?.getAttribute('data-action')"),'two players');
  await call('Page.navigate',{url:'http://localhost:8787/dev-cam'});await sleep(500);assert.equal(await evaluate("document.getElementById('video').srcObject"),null,'Camera stays off');
  const report={measuredSetup:'installed-Edge-headless-localhost',createdAt:new Date().toISOString(),workerInitialization:initialization,checks:['home1920x1080 screenshot','initial focus Play','Enter opens Pair','Escape returns Home','ArrowRight selects Two players','camera page does not activate camera'],cameraOpened:false,microphoneOpened:false,fireTvRun:false};
  writeFileSync('results/browser_check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await call('Browser.close').catch(()=>{});
}finally{ws?.close();edge.kill();}
