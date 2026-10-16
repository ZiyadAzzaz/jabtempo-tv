import {BridgeClient} from '../../../packages/tv-pose-bridge/src/client.js';
import {ClockSync} from '../../../packages/tv-pose-bridge/src/clock.js';
import QRCode from 'qrcode';
import {DEFAULT_CONFIG} from '../../../packages/motion/src/detector.js';
import {BeatClock,generateChart,RoundJudge,calibrateInputLatency,planCoaching,CommandBus,AdaptiveDensity,type Judgment,type Action,type Note} from '../../../packages/game/src/index.js';
const app=document.getElementById('app')!;
let relayUrl=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/bridge`;
let screen='home',pairCode='----',bridgeState='connecting',quality='Waiting for camera',activePeer:string|undefined;
const peers=new Map<string,ClockSync>();
const relaySync=new ClockSync({maxSamples:1}),lastPeerSync=new Map<string,number>();
let lastRelaySync=-Infinity,skeletonCapture:number|undefined,collectLatency=false,reversedLatencySamples=0;
type LatencyRow={measuredSetup:'dev-cam';capture:number;inferenceEnd:number;send:number;relay:number;receipt:number;render?:number;tvMinusPhoneMs:number;tvMinusRelayMs:number;syncAgeMs:number;renderStage:string};
const pendingTrace=new Map<number,LatencyRow>(),latencyRows:LatencyRow[]=[];
function saveLatency(){if(!latencyRows.length){confirmation('No synchronized canvas samples captured. Enable collection in Settings, then play with a camera.');return;}const url=URL.createObjectURL(new Blob([latencyRows.map(r=>JSON.stringify({...r,reversedSamplesExcluded:reversedLatencySamples})).join('\n')+'\n'],{type:'application/x-ndjson'}));const link=document.createElement('a');link.href=url;link.download='latency_raw_dev-cam.jsonl';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);confirmation(`Saved ${latencyRows.length} dev-cam canvas samples; ${reversedLatencySamples} clock-reversed samples excluded. Display photon latency and device gates remain unverified.`);}
let client:BridgeClient,audio:AudioContext|undefined,source:AudioBufferSourceNode|undefined,clock:BeatClock|undefined,judge:RoundJudge|undefined,notes:Note[]=[];
let audioStart=0,bpm:90|110|130=110,density=1,inputOffset=0,paused=false,skeleton:number[]=[],feedback='Ready',calibration=false,calibrationSamples:{beatTvMs:number;peakPhoneMs:number}[]=[];
let pendingPeaks:{t:number;noteId?:string}[]=[],guardAttempts=0,guardSuccess=0,extensions:number[]=[],jabs=0,crosses=0,rounds=0;
let adaptive=new AdaptiveDensity(),frameWatermark=-Infinity,roundStartTv=0,calibrationOffset=0;
let audioLoadToken=0,audioLoadController:AbortController|undefined;
const eventIds=new Set<string>(),peerDevices=new Map<string,string>();
const offsetKey=(id:string)=>`jabtempo-calibration-v1:${id}`;
let calibrated=false;
function offsetText(){return calibrated?`${inputOffset>=0?'+':''}${Math.round(inputOffset)} ms`:'Not calibrated';}
function loadOffset(){const id=activePeer&&peerDevices.get(activePeer);inputOffset=0;calibrated=false;if(id)try{const raw=localStorage.getItem(offsetKey(id));if(raw!==null&&Number.isFinite(Number(raw))){inputOffset=Number(raw);calibrated=true;}}catch{}}
function saveOffset(){calibrated=true;const id=activePeer&&peerDevices.get(activePeer);if(id)try{localStorage.setItem(offsetKey(id),String(inputOffset));}catch{confirmation('Calibration kept for this session; storage unavailable.');}}
function recordJudgments(results:Judgment[]){for(const result of results){const change=adaptive.record(result.result==='Perfect'||result.result==='Good');if(change){density=change.density;feedback=`${change.announcement} applies next round.`;}}}
function pauseForSync(){if(screen==='round'||calibration){paused=true;judge?.pause();clock?.pause();void audio?.suspend();pendingPeaks=[];feedback='Camera disconnected or sync expired. Reconnect, then resume.';if(calibration){endAudio();calibrationSamples=[];calibrationUsed.clear();}}}
const calibrationUsed=new Set<number>();
let family=false,familyTurn=1,firstScore:number|undefined,seated=false,palette=false,captions=true,volume=.6;
const personalKey='jabtempo-personal-v1';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function button(text:string,action:string,secondary=false){return `<button data-action="${action}" class="${secondary?'secondary':''}">${text}</button>`;}
function go(next:string){endAudio();pendingTrace.clear();screen=next;render();}
function render(){
  let content='';
  if(screen==='home')content=`<div class="split"><div><span class="eyebrow">MOVE TO THE BEAT</span><h1>Find your rhythm.<br>Own your round.</h1><p>A phone camera. Your TV. A new way to play together.</p><div class="actions">${button('Play','play')}${button('Two players','two players',true)}</div></div><div class="card"><span class="pill">JAB + CROSS / 60 SECONDS</span><h2>Every beat is a move.</h2><p><span class="note-key">● JAB</span> · <span class="cross-key">◆ CROSS</span></p><p>Match the shape. Punch on the beat. Return to guard.</p></div></div><div class="actions">${button('Daily challenge','daily',true)}${button('Settings','settings',true)}${button('How to play','howto',true)}</div>`;
  if(screen==='pair')content=`<span class="eyebrow">01 / CONNECT</span><h1>Bring your camera.</h1><div class="split"><div class="card"><p>Open the local camera page, then enter</p><div class="code" id="code">${pairCode}</div><p id="connection">${escape(bridgeState)}</p><p>Code expires after five minutes.</p>${button('New code','renew',true)}</div><div><h2>Keep it local.</h2><p>Your video stays on your camera device. The TV sees keypoints and game events.</p><p><a href="/dev-cam" target="_blank" rel="noopener">Open local camera lab ↗</a></p><p>Phone access needs HTTPS and the approved Private LAN rule.</p><p id="pair-payload"></p></div></div><div class="actions">${button('Calibrate','calibrate')}${button('Home','home',true)}</div>`;
  if(screen==='calibrate')content=`<span class="eyebrow">02 / GET IN SYNC</span><h1>Eight beats. Find your timing.</h1><p id="quality">${escape(quality)}</p><p>Keep your head, shoulders, elbows and wrists in view. Choose your stance in the camera lab.</p><div class="stats"><div class="stat">Offset<strong id="offset">${offsetText()}</strong></div><div class="stat">Calibration<strong id="calibration-count">${calibrationSamples.length} / 8</strong></div></div><p id="feedback">Punch once on each beat after the four-beat count-in.</p><div class="actions">${button('Begin eight-beat test','cal-test')}${button('Start round','start')}${button('Back','pair',true)}</div>`;
  if(screen==='round')content=`<span class="eyebrow">${family?`FAMILY / PLAYER ${familyTurn}`:'YOUR ROUND'} / ${bpm} BPM</span><h1>Jab. Cross. Keep your rhythm.</h1><div class="stats"><div class="stat">Score<strong id="score">0</strong></div><div class="stat">Combo<strong id="combo">0</strong></div><div class="stat">Remaining<strong id="timer">60s</strong></div></div><canvas id="lane" width="1200" height="340" aria-label="Jab circle and cross diamond notes approach the hit line"></canvas><p id="feedback" role="status">Ready</p><div class="actions">${button('Pause / Resume','togglepause')}${button('Harder','harder',true)}${button('Easier','easier',true)}${button('End round','finish',true)}</div>`;
  if(screen==='summary'){
    const js=judge?.judgments??[],hits=js.filter(j=>j.result==='Perfect'||j.result==='Good');
    const timing=hits.length?hits.reduce((sum,j)=>sum+Math.abs(j.deltaMs!),0)/hits.length:undefined;
    const coaching=planCoaching({meanAbsTimingMs:timing,guardRecoveryPercent:guardAttempts?guardSuccess/guardAttempts*100:undefined,meanExtension:extensions.length?extensions.reduce((a,b)=>a+b)/extensions.length:undefined,jabs,crosses});
    content=`<span class="eyebrow">ROUND COMPLETE</span><h1>Your next beat starts here.</h1><div class="stats"><div class="stat">Score<strong>${judge?.score()??0}</strong></div><div class="stat">Accuracy<strong>${js.length?Math.round(hits.length/js.length*100)+'%':'—'}</strong></div><div class="stat">Mean timing error<strong>${timing===undefined?'—':Math.round(timing)+' ms'}</strong></div><div class="stat">Guard ≤600 ms<strong>${guardAttempts?Math.round(guardSuccess/guardAttempts*100)+'%':'—'}</strong></div></div><div class="card"><h2>${coaching?escape(coaching.focus):'Keep exploring'}</h2><p>${coaching?`${coaching.measured.toFixed(1)} ${coaching.unit} → target ${coaching.target} ${coaching.unit}. ${escape(coaching.drill)}`:'Complete a tracked round to unlock measured coaching.'}</p><p>${family&&firstScore!==undefined?`Player 1: ${firstScore} · Player 2: ${judge?.score()??0}`:''}</p></div><div class="actions">${button(family&&familyTurn===1?'Player 2 turn':'Next round','next round')}${button('Home','home',true)}</div>`;
  }
  if(screen==='howto')content=`<span class="eyebrow">HOW TO PLAY</span><h1>Move with the music.</h1><div class="card"><p>1. Pair your camera and frame your upper body.</p><p>2. Calibrate with eight punches on eight beats.</p><p>3. <span class="note-key">● JAB</span> uses your lead hand. <span class="cross-key">◆ CROSS</span> uses your rear hand.</p><p>4. Return both hands near your chin for the guard bonus.</p><p>Use arrows and Enter to navigate. Escape goes back. Space pauses a round. Voice commands: start, pause, resume, harder, easier, next round, two players.</p><p>Seated play uses the same upper-body inputs. Keep a clear space and choose comfortable movements.</p></div>${button('Home','home')}`;
  if(screen==='daily'){
    const stats=readPersonal();content=`<span class="eyebrow">DAILY CHALLENGE</span><h1>A little rhythm, every day.</h1><p>Today's chart uses a date seed. Personal results are stored only on this TV browser.</p><div class="stats"><div class="stat">Personal best<strong>${stats.best??'—'}</strong></div><div class="stat">Completed rounds<strong>${stats.rounds??0}</strong></div></div><div class="actions">${button('Play today','daily-play')}${button('Home','home',true)}</div>`;
  }
  if(screen==='settings')content=`<span class="eyebrow">MAKE IT YOURS</span><h1>Your pace. Your space.</h1><div class="actions">${button(`BPM: ${bpm}`,'bpm',true)}${button(`Density: ${density}`,'harder',true)}${button(`Seated: ${seated?'On':'Off'}`,'seated',true)}${button(`Palette: ${palette?'Alternative':'Standard'}`,'palette',true)}${button(`Captions: ${captions?'On':'Off'}`,'captions',true)}${button(`Volume: ${Math.round(volume*100)}%`,'volume',true)}${button('Reset calibration','reset-cal',true)}${button('Home','home')}</div>`;
  if(screen==='settings')content+=`<div class="actions">${button(`Latency collection: ${collectLatency?'On':'Off'}`,'latency-toggle',true)}${button('Save latency JSONL','latency-save',true)}</div><p>Optional dev-cam canvas timing; no image, voice or device identifier is saved.</p>`;
  if(screen==='summary')content+=`<div class="actions">${button('Save latency JSONL','latency-save',true)}</div>`;
  app.innerHTML=`<span class="preview-label">DEVELOPMENT BROWSER PREVIEW · FIRE TV RUN UNVERIFIED</span>${content}<p class="confirmation" id="confirmation" role="status"></p>`;
  app.querySelector<HTMLButtonElement>('button')?.focus();
  app.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>dispatch(b.dataset.action!));
  updateStatus();
}
function readPersonal(){try{return JSON.parse(localStorage.getItem(personalKey)??'{}');}catch{return {};}}
let daily=false;
function dispatch(action:string){
  if(action==='latency-save'){saveLatency();return;}
  if(action==='latency-toggle'){collectLatency=!collectLatency;pendingTrace.clear();render();return;}
  if(['start','pause','resume','harder','easier','next round','two players'].includes(action)){const result=bus.dispatch(action,'button',performance.now());confirmation(result.confirmation);return;}
  if(action==='togglepause'){dispatch(paused?'resume':'pause');return;}
  if(action==='play'||action==='daily-play'){family=false;daily=action==='daily-play';go('pair');return;}
  if(action==='renew'){client.renewPairing();return;}
  if(action==='cal-test'){void beginCalibration();return;}
  if(action==='finish'){finish();return;}
  if(action==='bpm'){bpm=bpm===90?110:bpm===110?130:90;}
  else if(action==='seated')seated=!seated;
  else if(action==='palette')palette=!palette;
  else if(action==='captions')captions=!captions;
  else if(action==='volume')volume=volume>=1?0:Math.min(1,volume+.2);
  else if(action==='reset-cal'){inputOffset=0;calibrated=false;const id=activePeer&&peerDevices.get(activePeer);if(id)try{localStorage.removeItem(offsetKey(id));}catch{}}
  else{go(action);return;}render();
}
function confirmation(text:string){const el=document.getElementById('confirmation');if(el)el.textContent=text;}
const bus=new CommandBus((action:Action)=>{
  if(action==='start'||action==='next round'){
    if(screen==='round'){feedback='A round is already playing. Finish it before starting another.';return;}
    if(action==='next round'&&screen!=='summary'){feedback='Finish a round before choosing the next round.';return;}
    if(action==='next round'&&family&&familyTurn===1){firstScore=judge?.score();familyTurn=2;}
    void beginRound();
  }else if(action==='two players'){family=true;familyTurn=1;firstScore=undefined;go('pair');}
  else if(action==='pause'&&screen==='round'){paused=true;pendingPeaks=[];judge?.pause();clock?.pause();void audio?.suspend();feedback='Paused. Resume when ready.';}
  else if(action==='resume'&&screen==='round'){if(!ready()){feedback='Wait for fresh camera clock sync before resuming.';return;}paused=false;judge?.resume();clock?.resume();roundStartTv=performance.now();frameWatermark=-Infinity;void audio?.resume();feedback='Keep your rhythm.';}
  else if(action==='harder'||action==='easier'){density=Math.max(1,Math.min(4,density+(action==='harder'?1:-1)));if(screen==='settings')render();else feedback=`Density ${density} applies next round.`;}
});
function updateStatus(){
  const connection=document.getElementById('connection');if(connection)connection.textContent=activePeer?'Camera connected ✓':`Waiting for camera · ${bridgeState}`;
  const code=document.getElementById('code');if(code)code.textContent=pairCode;
  const payload=document.getElementById('pair-payload');if(payload)payload.textContent=`Pair payload: ${JSON.stringify({relayUrl,pairCode})}`;
  let qr=document.getElementById('pair-qr') as HTMLCanvasElement|null;
  if(payload&&!qr){qr=document.createElement('canvas');qr.id='pair-qr';qr.width=qr.height=280;qr.setAttribute('aria-label','Pairing payload QR. Localhost is a camera lab address only.');payload.before(qr);}
  if(qr&&/^\d{4}$/.test(pairCode))void QRCode.toCanvas(qr,JSON.stringify({relayUrl,pairCode}),{width:280,margin:2}).catch(()=>confirmation('QR unavailable; use the four-digit code.'));
  if(payload&&['localhost','127.0.0.1','[::1]'].includes(location.hostname))payload.append(' · Camera lab only: phones need the laptop LAN HTTPS URL, not localhost.');
  const q=document.getElementById('quality');if(q)q.textContent=quality;
}
function ready(){return !!activePeer&&!!peers.get(activePeer)?.estimate(performance.now());}
async function playAudio():Promise<boolean>{
  endAudio();const token=audioLoadToken;audioLoadController=new AbortController();const controller=audioLoadController;
  const cancelled=()=>token!==audioLoadToken||controller.signal.aborted;
  audio??=new AudioContext();await audio.resume();if(cancelled())return false;
  try{
    const response=await fetch(`/assets/beats/${bpm}.wav`,{signal:controller.signal});if(cancelled())return false;
    if(!response.ok)throw new Error('Generate local beat assets first.');
    const bytes=await response.arrayBuffer();if(cancelled())return false;
    const buffer=await audio.decodeAudioData(bytes);if(cancelled())return false;
    if(!ready())throw new Error('Camera clock sync changed while loading audio. Reconnect before starting.');
    source=audio.createBufferSource();source.buffer=buffer;source.loop=true;const gain=audio.createGain();gain.gain.value=volume;source.connect(gain).connect(audio.destination);audioStart=audio.currentTime+.1;source.start(audioStart);
    // baseLatency is a different processing segment; unknown output latency is uncompensated.
    clock=new BeatClock(bpm,((audio as any).outputLatency??0)*1000);paused=false;
    return true;
  }catch(error){if(cancelled())return false;throw error;}
}
function endAudio(){audioLoadToken++;audioLoadController?.abort();audioLoadController=undefined;try{source?.stop();}catch{}source=undefined;calibration=false;}
function songTime(){return clock&&audio?clock.update(Math.max(0,(audio.currentTime-audioStart)*1000)):0;}
async function beginRound(){
  if(!calibrated){go('calibrate');confirmation('Complete the eight-beat calibration before starting.');return;}
  if(!ready()){confirmation('Pair a camera and wait for clock sync before starting.');return;}
  try{if(!await playAudio())return;screen='round';notes=generateChart({seed:daily?Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')):42+rounds,bpm,durationMs:60000,density});judge=new RoundJudge(notes);adaptive=new AdaptiveDensity(density);pendingPeaks=[];eventIds.clear();frameWatermark=-Infinity;roundStartTv=performance.now();guardAttempts=guardSuccess=jabs=crosses=0;extensions=[];feedback='Four-beat count-in. Get ready.';render();}catch(e){confirmation(String(e));}
}
async function beginCalibration(){
  if(!ready()){confirmation('Pair a camera and wait for clock sync.');return;}
  try{if(!await playAudio())return;calibration=true;calibrationOffset=-peers.get(activePeer!)!.estimate(performance.now())!.remoteMinusLocalMs;calibrationSamples=[];calibrationUsed.clear();roundStartTv=performance.now();eventIds.clear();feedback='Count in four beats, then punch on eight beats.';}catch(e){confirmation(String(e));}
}
function finish(){if(screen!=='round')return;judge?.resume();recordJudgments(judge?.advance(60161)??[]);rounds++;const personal=readPersonal();try{localStorage.setItem(personalKey,JSON.stringify({best:Math.max(personal.best??0,judge?.score()??0),rounds:(personal.rounds??0)+1,lastPlayed:new Date().toISOString().slice(0,10)}));}catch{}go('summary');}
client=new BridgeClient({url:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/bridge`,role:'tv',onState:(s:string)=>{
  bridgeState=s;
  if(s!=='connected'){audioLoadToken++;audioLoadController?.abort();pauseForSync();activePeer=undefined;peers.clear();relaySync.reset();lastRelaySync=-Infinity;lastPeerSync.clear();pendingTrace.clear();}
  else client.write({relay:1,action:'clock',t0:performance.now()});
  updateStatus();
},onControl:(m:any)=>{
  if(m.action==='clock'){
    const now=performance.now();try{if(relaySync.add({t0:m.t0,t1:m.t1,t2:m.t2,t3:now}))lastRelaySync=now;}catch{}return;
  }
  if(m.action==='trace'){
    if(!collectLatency||screen!=='round'||paused||m.peerId!==activePeer)return;
    const receipt=performance.now(),phone=peers.get(m.peerId)?.estimate(receipt),relay=relaySync.estimate(receipt);
    const syncAgeMs=Math.max(receipt-(lastPeerSync.get(m.peerId)??-Infinity),receipt-lastRelaySync);
    if(!phone||!relay||syncAgeMs>10000||![m.tCapturePhone,m.tInferenceEndPhone,m.tSendPhone,m.tRelay].every(Number.isFinite))return;
    if(m.tCapturePhone-phone.remoteMinusLocalMs<roundStartTv)return;
    pendingTrace.set(m.tCapturePhone,{measuredSetup:'dev-cam',capture:m.tCapturePhone,inferenceEnd:m.tInferenceEndPhone,send:m.tSendPhone,relay:m.tRelay,receipt,tvMinusPhoneMs:-phone.remoteMinusLocalMs,tvMinusRelayMs:-relay.remoteMinusLocalMs,syncAgeMs,renderStage:'canvas RAF draw submission; not display photons'});
    while(pendingTrace.size>5000)pendingTrace.delete(pendingTrace.keys().next().value!);
    return;
  }

  if(m.action==='created'||m.action==='pairing'){pairCode=m.pairCode;if(m.relayUrl)relayUrl=m.relayUrl;updateStatus();}
  if(m.action==='peer'){
    if(m.state==='joined'){
      // Reset even an existing peer after relay resume: its monotonic epoch may have changed.
      peers.set(m.peerId,new ClockSync({maxSamples:1}));lastPeerSync.delete(m.peerId);pendingTrace.clear();skeletonCapture=undefined;
      if(typeof m.deviceId==='string')peerDevices.set(m.peerId,m.deviceId);
      if(!activePeer){activePeer=m.peerId;loadOffset();}
      client.send({v:1,type:'ping',t0:performance.now()},m.peerId);
    }else{
      peers.delete(m.peerId);lastPeerSync.delete(m.peerId);pendingTrace.clear();
      if(activePeer===m.peerId){pauseForSync();activePeer=[...peers.keys()][0];loadOffset();if(activePeer){peers.get(activePeer)?.reset();client.send({v:1,type:'ping',t0:performance.now()},activePeer);}}
    }
    updateStatus();
  }
},onMessage:(m:any,peerId?:string)=>{
  if(!peerId)return;
  const now=performance.now(),sync=peers.get(peerId);
  if(m.type==='pong'){try{if(sync?.add({...m,t3:now}))lastPeerSync.set(peerId,now);}catch{}return;}
  if(peerId!==activePeer)return; // Family mode is explicitly turn-based: one camera lane.
  if(m.type==='quality'){quality=m.issues.length?m.issues.join(' ? '):'Upper body in frame ?';updateStatus();return;}
  const estimate=sync?.estimate(now);
  if(!estimate){pauseForSync();return;}
  if(m.type==='voice'){const result=bus.dispatch(m.command,'voice',now,m.conf);confirmation(result.confirmation);return;}
  if(paused)return;
  const currentSong=songTime();
  const toSong=(remote:number)=>currentSong+(remote-estimate.remoteMinusLocalMs-now);
  if(m.type==='frame'){
    skeleton=m.players[0]?.kp??[];skeletonCapture=m.t;
    const localCapture=m.t-estimate.remoteMinusLocalMs;
    if(screen==='round'&&localCapture>=roundStartTv){
      // A detector may emit a historical peak up to maxPunchMs after capture.
      // Ordered WS frames establish source progress, not network transit assumptions.
      frameWatermark=Math.max(frameWatermark,toSong(m.t)-DEFAULT_CONFIG.maxPunchMs-inputOffset);
      recordJudgments(judge?.advance(frameWatermark)??[]);
      pendingPeaks=pendingPeaks.filter(p=>localCapture-p.t<=600);
    }
    return;
  }
  if(m.type==='event'){
    const localPeak=m.t_peak-estimate.remoteMinusLocalMs;
    if(localPeak<roundStartTv||localPeak>now+estimate.rttMs)return;
    const eventId=`${peerId}:${m.player}:${m.t_peak}:${m.hand}`;
    if(eventIds.has(eventId))return;eventIds.add(eventId);
    const time=toSong(m.t_peak);
    if(calibration){
      const beatMs=60000/bpm,index=Math.round(time/beatMs);
      if(index>=4&&index<12&&!calibrationUsed.has(index)&&Math.abs(time-index*beatMs)<beatMs*.45){
        calibrationUsed.add(index);
        // Store the sample in the frozen calibration clock domain so later sync
        // changes cannot be subtracted from earlier samples with a different sign.
        calibrationSamples.push({beatTvMs:now+(index*beatMs-currentSong),peakPhoneMs:localPeak-calibrationOffset});
        const count=document.getElementById('calibration-count');if(count)count.textContent=`${calibrationSamples.length} / 8`;
        if(calibrationSamples.length===8){inputOffset=calibrateInputLatency(calibrationSamples,calibrationOffset);saveOffset();endAudio();feedback=`Offset: ${inputOffset>=0?'+':''}${Math.round(inputOffset)} ms. Ready to play.`;const offset=document.getElementById('offset');if(offset)offset.textContent=`${inputOffset>=0?'+':''}${Math.round(inputOffset)} ms`;}
      }
      return;
    }
    if(screen!=='round'||time-inputOffset<0||time-inputOffset>=60000)return;
    const result=judge?.punch({id:eventId,timeMs:time-inputOffset,type:m.kind,extension:m.extension});
    if(result){feedback=result.result;recordJudgments([result]);}
    pendingPeaks.push({t:localPeak,noteId:result?.noteId});guardAttempts++;
    extensions.push(m.extension);if(m.kind==='jab')jabs++;else if(m.kind==='cross')crosses++;
  }else if(m.type==='guard'&&m.state==='up'&&screen==='round'){
    const guardTime=m.t-estimate.remoteMinusLocalMs;
    const recovered=pendingPeaks.filter(p=>guardTime>=p.t);
    pendingPeaks=pendingPeaks.filter(p=>guardTime<p.t);
    for(const peak of recovered){const recovery=guardTime-peak.t;if(recovery<=600){guardSuccess++;if(peak.noteId)judge?.guardRecovered(peak.noteId,recovery);}}
  }
}}).connect();
setInterval(()=>{client.write({relay:1,action:'clock',t0:performance.now()});for(const peer of peers.keys())client.send({v:1,type:'ping',t0:performance.now()},peer);},2000);
function draw(){
  if(calibration){if(!ready())pauseForSync();else if(songTime()>=13*60000/bpm){endAudio();feedback='Eight clean samples were not captured. Restart the calibration test.';}}
  if(screen==='round'){
    const t=songTime();const canvas=document.getElementById('lane') as HTMLCanvasElement|null;
    if(canvas){const c=canvas.getContext('2d')!;c.clearRect(0,0,1200,340);c.strokeStyle='#c4cfe4';c.lineWidth=3;c.beginPath();c.moveTo(180,20);c.lineTo(180,320);c.stroke();c.font='24px Segoe UI';c.fillStyle='#c4cfe4';c.fillText('HIT',158,32);
      const judged=new Set(judge?.judgments.map(j=>j.noteId));for(const note of notes){const x=180+(note.timeMs-t)*.28;if(x<20||x>1100||judged.has(note.id))continue;const jab=note.type==='jab';c.fillStyle=jab?(palette?'#9ccaff':'#79f3c6'):'#ffbc76';c.beginPath();if(jab)c.arc(x,155,28,0,Math.PI*2);else{c.moveTo(x,122);c.lineTo(x+33,155);c.lineTo(x,188);c.lineTo(x-33,155);c.closePath();}c.fill();c.fillStyle='#0b1122';c.fillText(jab?'J':'C',x-8,164);}
      const edges=[[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12]];c.strokeStyle='#b3a2ff';c.lineWidth=3;for(const [a,b]of edges){if(skeleton[a*3+2]>=5000&&skeleton[b*3+2]>=5000){c.beginPath();c.moveTo(900+skeleton[a*3]/10000*260,skeleton[a*3+1]/10000*300);c.lineTo(900+skeleton[b*3]/10000*260,skeleton[b*3+1]/10000*300);c.stroke();}}
    }
    if(canvas&&!paused&&skeletonCapture!==undefined){
      const row=pendingTrace.get(skeletonCapture);
      if(row){
        const render=performance.now(),stamps=[row.capture+row.tvMinusPhoneMs,row.inferenceEnd+row.tvMinusPhoneMs,row.send+row.tvMinusPhoneMs,row.relay+row.tvMinusRelayMs,row.receipt,render];
        // Do not clamp clock uncertainty into fabricated zero-length stages.
        if(stamps.every((value,index)=>index===0||value>=stamps[index-1])){latencyRows.push({...row,render});if(latencyRows.length>5000)latencyRows.shift();}else reversedLatencySamples++;
        for(const key of pendingTrace.keys())if(key<=skeletonCapture)pendingTrace.delete(key);
      }
    }
    document.getElementById('score')!.textContent=String(judge?.score()??0);document.getElementById('combo')!.textContent=String(judge?.combo()??0);document.getElementById('timer')!.textContent=`${Math.max(0,Math.ceil((60000-t)/1000))}s`;
    // No guessed transport watermark: expire notes only when a synchronized frame establishes capture progress.
    if(!paused&&!ready())pauseForSync();
    if(frameWatermark>=60000&&!paused)finish();
  }
  const f=document.getElementById('feedback');if(f)f.textContent=captions?feedback:'';
  requestAnimationFrame(draw);
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'||e.key==='Backspace'){e.preventDefault();if(screen==='round'){finish();return;}go(screen==='home'?'home':screen==='calibrate'?'pair':'home');return;}
  if(e.code==='Space'&&screen==='round'){e.preventDefault();dispatch('togglepause');return;}
  if(e.key.startsWith('Arrow')){const buttons=[...app.querySelectorAll<HTMLButtonElement>('button')];const i=buttons.indexOf(document.activeElement as HTMLButtonElement);const next=Math.max(0,Math.min(buttons.length-1,i+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)));buttons[next]?.focus();e.preventDefault();}
});
window.addEventListener('beforeunload',()=>{client.close();endAudio();void audio?.close();});render();draw();
