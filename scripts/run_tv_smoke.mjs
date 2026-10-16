/** Nine native screens; D-pad only. Synthetic protocol inputs test UI, never accuracy. */
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import WebSocket from 'ws';
import {adbPath} from '../tools/mobile-mcp/device-guard.mjs';
import {BridgeClient} from '../packages/tv-pose-bridge/src/client.js';
import {startDevServer} from './dev_server.mjs';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
const report={v:1,status:'PENDING',setup:'Android TV emulator + synthetic protocol phone',gatePass:false,checks:[],visualReview:'PENDING'};
let relay,phone,timer;const output='results/ui_smoke';mkdirSync(output,{recursive:true});
try{
  const path=adbPath(),serial=process.env.JABTEMPO_TV_SERIAL;
  if(!serial||!/^emulator-\d+$/.test(serial))throw Error('Set JABTEMPO_TV_SERIAL to the running TV emulator. Physical phones are excluded.');
  const adb=async(args,binary=false)=>(await exec(path,['-s',serial,...args],{encoding:binary?'buffer':'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024*1024})).stdout;
  if((await adb(['get-state'])).trim()!=='device')throw Error('TV emulator is not authorized/running.');
  report.status='FAIL'; // From here a real emulator run was attempted; errors are failures.
  const foreground=async()=>{const text=await adb(['shell','dumpsys','window']);if(!text.split('\n').some(line=>/mCurrentFocus=/.test(line)&&line.includes('org.jabtempo.tv/')))throw Error('JabTempo TV is not foreground; capture/navigation refused.');};
  const key=async(name)=>{await foreground();await adb(['shell','input','keyevent',`KEYCODE_${name}`]);await pause(350);};
  const xml=async()=>{await foreground();const dumped=await adb(['shell','uiautomator','dump','/sdcard/jabtempo-smoke.xml']);if(!dumped.includes('dumped to:'))throw Error(`Fresh UI dump unavailable: ${dumped.trim()}`);return adb(['exec-out','cat','/sdcard/jabtempo-smoke.xml']);};
  const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>');
  const nodes=text=>Array.from(text.matchAll(/<node\b([^>]+)>/g),m=>Object.fromEntries(Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g),a=>[a[1],decode(a[2])])));
  const center=node=>{const n=node.bounds?.match(/\d+/g)?.map(Number);if(!n||n.length!==4)throw Error('Missing focus bounds.');return [(n[0]+n[2])/2,(n[1]+n[3])/2];};
  const select=async(label)=>{
    const visited=new Set();
    for(let i=0;i<24;i++){
      const all=nodes(await xml()),target=all.find(n=>n['content-desc']===label||n.text===label);
      if(!target)throw Error(`Missing button: ${label}`);
      const focused=all.find(n=>n.focused==='true');
      if(focused&&(focused['content-desc']===label||focused.text===label)){await key('DPAD_CENTER');return;}
      if(!focused){await key('DPAD_DOWN');continue;}
      const [tx,ty]=center(target),[fx,fy]=center(focused),dx=tx-fx,dy=ty-fy;
      // Move between rows before moving across one: nearest-axis selection can
      // bounce horizontally between two buttons above a diagonally placed target.
      const targetBounds=target.bounds.match(/\d+/g).map(Number),focusBounds=focused.bounds.match(/\d+/g).map(Number);
      const rowsOverlap=targetBounds[1]<focusBounds[3]&&focusBounds[1]<targetBounds[3];
      const dir=!rowsOverlap?dy>0?'DPAD_DOWN':'DPAD_UP':dx>0?'DPAD_RIGHT':'DPAD_LEFT';
      const marker=`${focused.bounds}:${dir}`;if(visited.has(marker))throw Error(`Focus navigation cycle toward ${label}.`);visited.add(marker);await key(dir);
    }throw Error(`D-pad did not reach ${label}.`);
  };
  const capture=async(name,title)=>{
    const tree=await xml();writeFileSync(`${output}/${name}.xml`,tree);
    const bytes=await adb(['exec-out','screencap','-p'],true);
    if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot PNG.');
    writeFileSync(`${output}/${name}.png`,bytes);await foreground();
    const found=decode(tree).includes(title);report.checks.push({screen:name,title,found,screenshot:`${name}.png`});if(!found)throw Error(`Expected screen ${name} absent.`);return tree;
  };
  let relayUrl,PhoneWebSocket=WebSocket;
  if(process.env.JABTEMPO_NATIVE_SMOKE_RELAY_URL){
    const external=new URL(process.env.JABTEMPO_NATIVE_SMOKE_RELAY_URL);
    if(external.protocol==='https:')external.protocol='wss:';
    if(external.protocol!=='wss:'||external.username||external.password||external.hash)throw Error('External native smoke relay must be a trusted HTTPS/WSS URL without embedded credentials or fragment.');
    if(!process.env.JABTEMPO_NATIVE_SMOKE_CA)throw Error('Set JABTEMPO_NATIVE_SMOKE_CA to the public development CA PEM for the existing trusted relay.');
    const ca=readFileSync(process.env.JABTEMPO_NATIVE_SMOKE_CA);
    if(!ca.toString('utf8').includes('-----BEGIN CERTIFICATE-----')||ca.toString('utf8').includes('PRIVATE KEY'))throw Error('Native smoke CA must contain public certificate PEM only.');
    PhoneWebSocket=class extends WebSocket{constructor(url){super(url,{ca,rejectUnauthorized:true});}};
    relayUrl=external.href;
    report.relay={mode:'existing trusted HTTPS/WSS relay',certificateVerification:true,ownedByRunner:false};
  }else{
    if(process.env.JABTEMPO_TLS_PFX)throw Error('Unset LAN TLS variables for isolated emulator smoke, or set JABTEMPO_NATIVE_SMOKE_RELAY_URL and JABTEMPO_NATIVE_SMOKE_CA to use the trusted existing relay.');
    relay=await startDevServer({host:'127.0.0.1',port:8787});relayUrl=relay.url;
    report.relay={mode:'isolated localhost relay',ownedByRunner:true};
  }
  await adb(['shell','am','force-stop','org.jabtempo.tv']);
  const launched=await adb(['shell','am','start','-W','-n','org.jabtempo.tv/.MainActivity']);if(!launched.includes('Status: ok'))throw Error(`Native activity launch failed: ${launched.trim()}`);await pause(1500);
  const pid=(await adb(['shell','pidof','org.jabtempo.tv'])).trim();if(!/^\d+$/.test(pid))throw Error('TV app process missing.');
  const waitText=async(text,timeout=12000)=>{const deadline=Date.now()+timeout;let tree='';while(Date.now()<deadline){tree=await xml();if(decode(tree).includes(text))return tree;await pause(300);}writeFileSync(`${output}/wait-timeout.xml`,tree);throw Error(`Timed out waiting for: ${text}`);};
  const waitButton=async(label,timeout=12000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const tree=await xml();if(nodes(tree).some(node=>node['content-desc']===label||node.text===label))return tree;await pause(300);}throw Error(`Timed out waiting for button: ${label}`);};
  const started=new Date();
  // A fresh install opens the waiting hand tutorial; stored sessions can open Home.
  const initialTree=decode(await xml());
  if(initialTree.includes('Learn left and right.'))await key('BACK');
  else if(!initialTree.includes('Your moves. Your rhythm.')&&initialTree.includes('screen-Pair'))await key('BACK');
  await capture('Home','Your moves. Your rhythm.');await select('Family Challenge');await capture('Family','A little friendly competition.');await key('BACK');await select('Play');
  let pairTree=await capture('Pair','Bring your camera.'),code;
  for(let i=0;i<10&&!code;i++){code=nodes(pairTree).map(n=>n.text).find(t=>/^\d{4}$/.test(t??''));if(!code){await pause(500);pairTree=await xml();}}
  if(!code)throw Error('TV did not receive a pairing code from its laptop relay.');
  let paired=false;
  phone=new BridgeClient({url:relayUrl,role:'phone',WebSocketImpl:PhoneWebSocket,hello:{v:1,type:'hello',deviceId:'synthetic-tv-smoke',pairCode:code,players:1,model:'UI-simulator-no-human-data'},onState:s=>paired=s==='connected',onMessage:m=>{if(m.type==='ping'){const t1=performance.now();phone.send({v:1,type:'pong',t0:m.t0,t1,t2:performance.now()});}}}).connect();
  for(let i=0;i<30&&!paired;i++)await pause(100);if(!paired)throw Error('Synthetic phone pairing failed.');
  let inputHand,poseHand,poseUntil=0;
  const punch=hand=>phone.send({v:1,type:'event',t_peak:performance.now(),player:1,kind:hand==='left'?'jab':'cross',hand,extension:.9,conf:1});
  let syntheticHand='left';
  timer=setInterval(()=>{const t=performance.now();if(inputHand){if(inputHand==='alternate'){punch(syntheticHand);syntheticHand=syntheticHand==='left'?'right':'left';}else punch(inputHand);}phone.send({v:1,type:'quality',t,framing:1,light:.5,issues:[]});
    if(process.env.JABTEMPO_NATIVE_DEMO_PLAY==='1'){
      const active=t<poseUntil?poseHand:undefined;
      const points=Array.from({length:17},()=>[5000,5000,0]);
      for(const [i,x,y] of [[0,5000,1800],[5,6200,3600],[6,3800,3600],[7,7000,4700],[8,3000,4700],[9,7400,5700],[10,2600,5700],[11,5900,7200],[12,4100,7200]])points[i]=[x,y,9000];
      if(active==='left'){points[7]=[6500,3300,9000];points[9]=[6000,2200,9000];}
      if(active==='right'){points[8]=[3500,3300,9000];points[10]=[4000,2200,9000];}
      phone.send({v:1,type:'frame',t,players:[{id:1,kp:points.flat()}]});
    }
  },180);
  await pause(2500);await select('Practice left / right');await capture('HowToPlay','Learn left and right.');
  punch('right');await pause(300);await waitText('TRY YOUR LEFT HAND');
  punch('left');await waitText('TRY YOUR RIGHT HAND');
  punch('right');await waitText('BOTH HANDS READY');
  report.tutorial={wrongHandWaits:true,leftThenRight:true,source:'Synthetic protocol events; no physical hand accuracy claim'};
  await select('Calibrate both hands');await capture('Calibrate','Find your timing.');await select('Start calibration');
  // UIAutomator waits for idle; continuous native beat updates can delay a dump
  // past the LEFT→RIGHT transition. Alternating inputs let the app enforce its
  // own four-left/four-right order without timing the switch from an idle dump.
  inputHand='alternate';await pause(18000);inputHand=undefined;
  await waitText('LEFT 4/4 / RIGHT 4/4',12000);
  await waitText('Ready to play.');report.calibration={left:4,right:4,actualNativeAudioClock:true,syntheticInputs:true,alternatingProtocolInputs:true};
  await select('Start round');
  const roundCommandAt=performance.now();
  const demoPlay=process.env.JABTEMPO_NATIVE_DEMO_PLAY==='1';
  let recording;
  if(process.env.JABTEMPO_NATIVE_DEMO_RECORD==='1'){
    if(process.env.JABTEMPO_NATIVE_MISS_STRESS!=='1'&&!demoPlay)throw Error('Demo capture requires a timed round.');
    // Capture only the emulator round, never the pairing code or a phone camera.
    const remote=demoPlay?'/sdcard/jabtempo-simulated-player.mp4':'/sdcard/jabtempo-synthetic-preview.mp4';
    const child=spawn(path,['-s',serial,'shell','screenrecord','--size','1280x720','--bit-rate','6000000','--time-limit',demoPlay?'72':'34',remote],{windowsHide:true,stdio:'ignore'});
    recording={remote,done:new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>code===0?resolve():reject(Error(`ADB screenrecord exited ${code}`)));})};
  }
  await pause(1500);writeFileSync(`${output}/Round-live.png`,await adb(['exec-out','screencap','-p'],true));
  if(demoPlay){
    const {generateChart}=await import('../packages/game/src/index.ts');
    const chart=generateChart({seed:42,bpm:110,durationMs:60000,density:1,noteSpacing:1,progressive:true});
    const baseline=roundCommandAt;let sent=0,skipped=0;
    for(const [index,note] of chart.entries()){
      if(index%9===7){skipped++;continue;}
      for(const shift of [-100,100]){
        const due=baseline+note.timeMs+shift;
        if(due>performance.now())await pause(due-performance.now());
        poseHand=note.hand;poseUntil=performance.now()+400;punch(note.hand);sent++;
      }
      phone.send({v:1,type:'guard',t:performance.now(),player:1,state:'up',conf:1});
    }
    await waitText('Your next best round.',18000);
    report.simulatedPlay={source:'generated progressive chart',controller:'synthetic protocol events; no real camera or person',scheduledNotes:chart.length,eventsSent:sent,deliberateSkippedNotes:skipped,naturalRoundFinish:true};
    await capture('Summary','Your next best round.');
  }else if(process.env.JABTEMPO_NATIVE_MISS_STRESS==='1'){
    const captures=[];
    for(const seconds of [12,24]){
      await pause(12000);await foreground();
      const bytes=await adb(['exec-out','screencap','-p'],true);
      if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid sustained-miss screenshot PNG.');
      writeFileSync(`${output}/Round-misses-${seconds}s.png`,bytes);
      captures.push(bytes);
    }
    report.sustainedMisses={syntheticQualityNoPunches:true,elapsedSeconds:24,screenshots:['Round-misses-12s.png','Round-misses-24s.png'],visualReview:'PENDING'};
    if(captures[0].equals(captures[1]))throw Error('Native round display froze during sustained misses (identical captures 12 seconds apart).');
  }
  if(!demoPlay){await key('BACK');await waitText('Paused. Select Resume');await capture('Round','Meet the beat.');
  // XML idle waits can consume a three-second countdown, so capture it immediately.
  await select('Resume');const countdown=await adb(['exec-out','screencap','-p'],true);if(countdown.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid countdown PNG.');writeFileSync(`${output}/Resume-countdown.png`,countdown);
  await pause(3300);writeFileSync(`${output}/Round-resumed.png`,await adb(['exec-out','screencap','-p'],true));await key('BACK');await waitButton('Resume');
  report.recovery={backPauses:true,resumeReturnsToRound:'Visual review required',countdownScreenshot:'Resume-countdown.png',resumedScreenshot:'Round-resumed.png',countdownVisualReview:'PENDING'};
  await select('Finish round');await capture('Summary','Your next best round.');}
  if(recording){
    await recording.done;
    mkdirSync('local_private/demo',{recursive:true});
    const local=demoPlay?'local_private/demo/native_simulated_player_raw.mp4':'local_private/demo/native_synthetic_raw.mp4';
    await adb(['pull',recording.remote,local]);
    await adb(['shell','rm',recording.remote]);
    report.demoCapture={path:local,kind:'synthetic controller / real native emulator video',audio:false,submissionReady:false};
  }
  await key('BACK');await select('Daily challenge');await capture('Daily','A little rhythm. Every day.');
  await key('BACK');await select('Settings');await capture('Settings','Your pace. Your space.');
  // The app was restarted above, so its new PID scopes this run without a
  // host-timezone-dependent logcat timestamp (Android requires fractions too).
  const logs=await adb(['logcat','-d','--pid',pid,'-v','brief']);writeFileSync(`${output}/runtime.log`,logs);
  if(/FATAL EXCEPTION|ANR in|am_anr|Application Not Responding/.test(logs))throw Error('App crash/ANR found in runtime log.');
  if(!(await adb(['shell','pidof','org.jabtempo.tv'])).trim())throw Error('App exited.');
  if(new Set(report.checks.map(check=>check.screen)).size!==(demoPlay?8:9))throw Error('Native screens were not covered.');
  report.status='PASS';report.note=demoPlay?'Native emulator with synthetic pose/punch events; naturally finished round and scoped crash scan. No physical camera/person accuracy or latency claim.':'Nine screen assertions, D-pad navigation, waiting left/right tutorial, four-left/four-right native audio-clock calibration, Back-to-pause/resume, screenshots and scoped crash scan. Round intentionally ended early; physical perception/voice/latency gates remain false. Countdown screenshot requires visual review.';
}catch(error){report.reason=error.message;process.exitCode=report.status==='FAIL'?1:2;}
finally{clearInterval(timer);phone?.close();await relay?.close();writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');writeFileSync('results/tv_smoke_lab.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
