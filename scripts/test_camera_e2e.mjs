/** Actual file-backed capture + CPU/WASM MediaPipe + production detector/relay.
 * Blank fixture is a negative regression, never evidence of human accuracy.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import WebSocket from 'ws';
import {startDevServer} from './dev_server.mjs';
import {BridgeClient} from '../packages/tv-pose-bridge/src/client.js';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=join(process.env.CONDA_PREFIX,'playwright-browsers');
const {chromium,devices}=await import('playwright');
const root=resolve('.'),fixture=resolve(process.argv[2]??'local_private/fixtures/empty-scene.y4m');
const privateRoot=resolve('local_private');
if(!existsSync(fixture)){
  assert.equal(process.argv[2],undefined,'Supply an existing private fixture.');
  const prepared=spawnSync('python',['scripts/prepare_camera_fixture.py'],{stdio:'inherit'});
  assert.equal(prepared.status,0,'Fixture preparation failed.');
}
const rel=relative(realpathSync(privateRoot),realpathSync(fixture));
assert(!rel.startsWith('..')&&!isAbsolute(rel),'Fixture must stay under local_private/.');
assert(fixture.endsWith('.y4m'),'Use a Y4M fixture.');
const manifest=JSON.parse(readFileSync(fixture.replace(/\.y4m$/,'.manifest.json'),'utf8'));
assert.equal(manifest.localOnly,true);
assert.equal(manifest.sha256,createHash('sha256').update(readFileSync(fixture)).digest('hex'),'Fixture checksum differs.');
if(!manifest.synthetic){
  const consentPath=realpathSync(resolve(manifest.sourceConsentManifest??''));
  assert(!relative(realpathSync(privateRoot),consentPath).startsWith('..'),'Consent stays private.');
  const consent=JSON.parse(readFileSync(consentPath,'utf8'));
  assert.equal(consent.consent?.localVideoTesting,true,'Human replay requires local-video consent.');
}
const built=spawnSync(process.execPath,['scripts/build_web.mjs'],{stdio:'inherit'});
assert.equal(built.status,0,'Build failed.');
const report={v:1,status:'FAIL',measuredSetup:'dev-cam',fixtureKind:manifest.fixtureKind,fixtureSha256:manifest.sha256,
  synthetic:manifest.synthetic,gatePass:false,phonePerformance:false,delegate:'CPU/WASM',counts:{},notes:[],browserErrors:[]};
let relay,browser,tv;
try{
  // Isolated loopback only: no firewall/certificate modifications or personal profile.
  assert(!process.env.JABTEMPO_TLS_PFX,'Run the isolated lab without LAN TLS environment variables.');
  relay=await startDevServer({root,host:'127.0.0.1',port:0});
  const counts=report.counts;let pairCode,peerId;
  tv=new BridgeClient({url:relay.url,role:'tv',WebSocketImpl:WebSocket,onControl(m){if(m.action==='created')pairCode=m.pairCode;if(m.action==='peer'&&m.state==='joined')peerId=m.peerId;},onMessage(m,id){peerId=id??peerId;counts[m.type]=(counts[m.type]??0)+1;if(m.type==='quality')report.lastQuality={framing:m.framing,issues:m.issues};}}).connect();
  const until=async(predicate,label,ms=30000)=>{const deadline=Date.now()+ms;while(!predicate()){assert(Date.now()<deadline,`Timed out: ${label}`);await new Promise(r=>setTimeout(r,100));}};
  await until(()=>pairCode,'TV pairing code');
  browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,args:[
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${fixture}`]});
  report.browserVersion=browser.version();
  const context=await browser.newContext({...devices['Pixel 5'],serviceWorkers:'block',permissions:['camera']});
  let blockedRequests=0;
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===relay.baseUrl)return route.continue();blockedRequests++;return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message));
  await page.goto(`${relay.baseUrl}/dev-cam`);
  assert(await page.evaluate(()=>isSecureContext),'Loopback must be a secure context.');
  assert(await page.locator('#video').evaluate(v=>v.srcObject===null),'Camera must start off.');
  await page.locator('#start').click();
  assert.match(await page.locator('#status').innerText(),/consent/i);
  assert(await page.locator('#video').evaluate(v=>v.srcObject===null),'No capture before consent.');
  await page.locator('#code').fill(pairCode);await page.locator('#consent').check();await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#stats').textContent.includes('inference fps'),{},{timeout:60000});
  await page.evaluate(()=>{globalThis.labTracks=Array.from(document.querySelector('#video').srcObject.getTracks());});
  report.tracks=await page.evaluate(()=>globalThis.labTracks.map(t=>({kind:t.kind,fileBacked:t.label.endsWith('.y4m')})));
  assert.equal(report.tracks.length,1,'No microphone capture.');
  assert.equal(report.tracks[0].kind,'video');
  assert.equal(report.tracks[0].fileBacked,true,'Only the approved file-backed fake camera is allowed.');
  await until(()=>counts.quality>=3,'three actual inference quality packets',60000);
  // Exercise real camera-side clock response through the same relay.
  assert(peerId,'Authenticated paired phone peer');
  tv.send({v:1,type:'ping',t0:performance.now()},peerId);
  await until(()=>counts.pong>0,'phone clock response');
  report.inferenceDisplay=await page.locator('#stats').innerText();
  if(manifest.synthetic){
    assert.equal(manifest.fixtureKind,'synthetic-empty-scene-negative');
    assert.equal(report.lastQuality.framing,0);assert(report.lastQuality.issues.includes('tracking lost'));
    assert.equal(counts.event??0,0,'Empty scene must produce no punches.');
    report.notes.push('Negative fixture exercised actual capture, model inference, tracking-loss output, protocol and TV receiver. Human punch/guard video regression is pending consented clips.');
  }else{
    await until(()=>counts.frame>0,'human keypoint frames',60000);
    if(manifest.expected.minimumPunchEvents>0)await until(()=>counts.event>=manifest.expected.minimumPunchEvents,'reviewed minimum punch count',60000);
    if(manifest.expected.maximumPunchEvents===0){await page.waitForTimeout(5000);assert.equal(counts.event??0,0,'Reviewed negative-motion snippet must produce no punches.');}
    report.notes.push('Consented recorded-human regression; never physical-phone performance or accuracy.');
  }
  if(manifest.synthetic){mkdirSync('results/dev_preview',{recursive:true});await page.screenshot({path:'results/dev_preview/camera-lab.png',fullPage:true});}
  // Guided recorder is present, and separate evaluation consent is enforced.
  await page.locator('#lab-record-start').click();
  assert.match(await page.locator('#lab-record-status').innerText(),/consent/i);
  await page.locator('#stop').click();
  assert(await page.evaluate(()=>document.querySelector('#video').srcObject===null&&globalThis.labTracks.every(t=>t.readyState==='ended')),'Stop must release every media track.');
  const afterStop=counts.quality;await page.waitForTimeout(1200);assert.equal(counts.quality,afterStop,'No capture packets after Stop.');
  assert.deepEqual(report.browserErrors,[]);report.blockedExternalRequests=blockedRequests;
  report.status='PASS';report.notes.push('Pixel 5 viewport emulation does not emulate phone CPU, sensors or thermal limits.');
}catch(error){report.error=error.message;process.exitCode=1;}
finally{tv?.close();await browser?.close();await relay?.close();mkdirSync('results',{recursive:true});writeFileSync('results/camera_lab.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
