import {BridgeClient} from '../../../packages/tv-pose-bridge/src/client.js';
import {commands} from '../../../packages/tv-pose-bridge/src/protocol.js';
import {installOfflineVoice} from './offline-voice.js';
import {MotionDetector,KeypointRecorder,type Landmark} from '../../../packages/motion/src/index.js';
import {installRecordingUI} from './recording.js';
import {installSelfTestUI} from './selftest.js';
import {encodeMediaPipe} from '../../../packages/motion/src/landmarks.js';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video'),status=$('status'),pairStatus=$('pair-status');
const suggestedCode=new URL(location.href).searchParams.get('code');
if(suggestedCode&&/^\d{4}$/.test(suggestedCode))$<HTMLInputElement>('code').value=suggestedCode;
let stream:MediaStream|undefined,worker:Worker|undefined,client:BridgeClient|undefined,detector:MotionDetector,recorder:KeypointRecorder|undefined;
let practicePunches=0,leftPunches=0,rightPunches=0;
let inferenceTimes:number[]=[],lastHand='',aspect=0;
let wakeLock:any,bridgeConnected=false,sessionEndedAt=0;
let running=false,busy=false,lastFrame=0,lastQuality=0,frameCount=0,startedAt=0,token=0,animation=0;
let initializationTimer:ReturnType<typeof setTimeout>|undefined;
let pairingTimer:ReturnType<typeof setTimeout>|undefined,pairToken=0,connectedCode='',pairTerminal=false;
let sentAt:number[]=[];
const localVoice=installOfflineVoice(send,()=>bridgeConnected);
const stance=()=>($<HTMLSelectElement>('stance').value as 'orthodox'|'southpaw');
const recordingLab=installRecordingUI({getStream:()=>stream,getCameraReady:()=>running,getStance:stance,getAspectRatio:()=>video.videoWidth/video.videoHeight});
const selfTest=installSelfTestUI({getStream:()=>stream,getReady:()=>running,getStance:stance,getAspectRatio:()=>video.videoWidth/video.videoHeight});
const memoryDeviceId=crypto.randomUUID();
function cameraDeviceId(){try{const key='jabtempo-camera-device-id',stored=localStorage.getItem(key);if(stored&&/^[a-f0-9-]{36}$/.test(stored))return stored;localStorage.setItem(key,memoryDeviceId);return memoryDeviceId;}catch{return memoryDeviceId;}}
const lumaCanvas=document.createElement('canvas');lumaCanvas.width=32;lumaCanvas.height=24;
const luma=lumaCanvas.getContext('2d',{willReadFrequently:true})!;
function lightLevel(){luma.drawImage(video,0,0,32,24);const pixels=luma.getImageData(0,0,32,24).data;let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];return sum/(32*24*255);}
// Cap all protocol traffic below relay's 80/s ceiling even with guard jitter.
function send(message:any){const now=performance.now();sentAt=sentAt.filter(t=>now-t<1000);if(sentAt.length>=60)return false;const sent=client?.send(message)??false;if(sent)sentAt.push(now);return sent;}
function stopCamera(){if(running)sessionEndedAt=performance.now();localVoice.stop();void wakeLock?.release();wakeLock=undefined;selfTest.stop();void recordingLab.stop();token++;running=false;busy=false;cancelAnimationFrame(animation);clearTimeout(initializationTimer);stream?.getTracks().forEach(t=>t.stop());stream=undefined;worker?.terminate();worker=undefined;video.srcObject=null;recorder=undefined;$('camera-frame').dataset.tracking='off';$('framing-hint').textContent='Fit your upper body inside the outline, with room to extend both arms.';$('recorder-status').textContent='Recording stopped. Save before stopping camera to retain it.';status.textContent='Camera off. TV controls can work without the camera.';$<HTMLButtonElement>('start').disabled=false;}
function disconnect(){pairToken++;clearTimeout(pairingTimer);pairingTimer=undefined;bridgeConnected=false;client?.close();client=undefined;connectedCode='';$<HTMLButtonElement>('connect').disabled=false;pairStatus.textContent='TV disconnected. Enter the code currently shown on the TV, then Connect to TV.';}
function stop(){stopCamera();disconnect();}
function connectController(){
  const code=$<HTMLInputElement>('code').value.trim();
  if(!/^\d{4}$/.test(code)){pairStatus.textContent='Enter the four-digit code currently shown on the TV, then Connect to TV.';return false;}
  if(client&&connectedCode===code&&!pairTerminal)return true;
  disconnect();const connectionToken=++pairToken;connectedCode=code;pairTerminal=false;
  const fail=(message:string)=>{if(connectionToken!==pairToken)return;pairTerminal=true;bridgeConnected=false;clearTimeout(pairingTimer);pairingTimer=undefined;client?.close();$<HTMLButtonElement>('connect').disabled=false;pairStatus.textContent=message;};
  const deadline=()=>{if(pairingTimer!==undefined)return;pairingTimer=setTimeout(()=>fail('TV connection timed out. Keep both devices on the same Wi-Fi, check the laptop server, refresh the TV code and Connect again.'),30000);};
  $<HTMLButtonElement>('connect').disabled=true;pairStatus.textContent='Connecting to TV. Camera and microphone are off unless you start them separately.';deadline();
  client=new BridgeClient({url:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/bridge`,role:'phone',hello:{v:1,type:'hello',deviceId:cameraDeviceId(),model:'browser-camera / anatomical-hands',players:1,pairCode:code},onState:(s:string)=>{
    if(connectionToken!==pairToken||pairTerminal)return;
    bridgeConnected=s==='connected';
    if(bridgeConnected){clearTimeout(pairingTimer);pairingTimer=undefined;$<HTMLButtonElement>('connect').disabled=false;pairStatus.textContent='TV connected. Game commands are ready. Start the camera to practice LEFT and RIGHT.';if(!running)status.textContent='TV connected. Check camera consent, then tap Start camera to practice LEFT and RIGHT.';}
    else if(s==='rejected'){fail('Pairing code is invalid or expired. Refresh the code on the TV, enter the new code here and Connect to TV again.');}
    else{deadline();pairStatus.textContent='TV connection interrupted. Reconnecting for up to 30 seconds. Keep the laptop server running and this page open.';}
  },onMessage:(m:any)=>{if(connectionToken===pairToken&&!pairTerminal&&m.type==='ping'){const t1=performance.now();send({v:1,type:'pong',t0:m.t0,t1,t2:performance.now()});}}}).connect();
  return true;
}
$('connect').onclick=connectController;
async function frame(runToken:number){
  if(!running||runToken!==token)return;
  if(!busy&&video.readyState>=2){
    busy=true;const t=performance.now();
    try{const nextAspect=video.videoWidth/video.videoHeight;if(nextAspect&&Math.abs(nextAspect-aspect)>.02){aspect=nextAspect;detector=new MotionDetector({stance:stance(),aspectRatio:aspect});}
    let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(video);}catch{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d')!.drawImage(video,0,0);bitmap=await createImageBitmap(canvas);}if(!running||runToken!==token){bitmap.close();return;}worker!.postMessage({type:'frame',bitmap,t},[bitmap]);}catch(error){if(runToken!==token)return;busy=false;stopCamera();status.textContent=`Frame capture failed: ${String(error)}. TV controls remain available; retry camera.`;return;}
  }
  if(running&&runToken===token)animation=requestAnimationFrame(()=>void frame(runToken));
}
$('start').onclick=async()=>{
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){status.textContent='Camera needs a trusted HTTPS page (or laptop localhost). Open directly in Safari or Chrome.';return;}
  if(!globalThis.Worker||!globalThis.WebAssembly||!globalThis.createImageBitmap){status.textContent='This browser lacks camera processing features. Update Safari/Chrome or use another device.';return;}
  if(!$<HTMLInputElement>('consent').checked){status.textContent='Confirm camera consent before starting.';return;}
  const code=$<HTMLInputElement>('code').value;
  if(!/^\d{4}$/.test(code)){status.textContent='Enter the four-digit code from the TV.';return;}
  if(!connectController())return;
  stopCamera();const runToken=++token;status.textContent='Requesting camera permission. Allow camera access to practice LEFT and RIGHT.';$<HTMLButtonElement>('start').disabled=true;
  try{
    const requested=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:{ideal:$<HTMLSelectElement>('camera-facing').value}},audio:false});
    if(runToken!==token){requested.getTracks().forEach(t=>t.stop());return;}
    stream=requested;video.srcObject=stream;await video.play();
    if(runToken!==token){requested.getTracks().forEach(t=>t.stop());return;}
    if(!video.videoWidth||!video.videoHeight)throw new Error('Camera returned no image dimensions.');
    lastFrame=lastQuality=0;sentAt=[];practicePunches=leftPunches=rightPunches=0;inferenceTimes=[];lastHand='';aspect=video.videoWidth/video.videoHeight;$('left-count').textContent='LEFT: 0';$('right-count').textContent='RIGHT: 0';$('movement-status').textContent='Hold both hands near your chin. Practice one jab, then return to guard.';
    requested.getTracks().forEach(track=>track.onended=()=>{if(runToken===token){stopCamera();status.textContent='Camera permission or stream ended. TV controls remain available. Start camera again to play.';}});
    detector=new MotionDetector({stance:stance(),aspectRatio:video.videoWidth/video.videoHeight});
    status.textContent='Camera permission granted. Loading the local pose model; game controls can already work when TV connected.';
    // MediaPipe's Emscripten loader uses importScripts; bundle worker as classic IIFE.
    worker=new Worker('/assets/pose-worker.js');
    const failWorker=(message:string)=>{if(runToken!==token)return;stopCamera();status.textContent=`Pose error: ${message}. TV controls remain available; retry camera or use the remote.`;};
    worker.onerror=event=>{event.preventDefault();failWorker(event.message||'Worker runtime or local asset loading failed.');};
    worker.onmessageerror=()=>failWorker('Worker message could not be decoded.');
    initializationTimer=setTimeout(()=>failWorker('Local pose initialization timed out. Check model/WASM assets and console.'),30000);
    worker.onmessage=({data})=>{
      try{
      if(runToken!==token)return;
      if(data.type==='error'){failWorker(data.message);return;}
      if(data.type==='ready'){if((navigator as any).wakeLock)void (navigator as any).wakeLock.request('screen').then((lock:any)=>{if(runToken===token)wakeLock=lock;else void lock.release();}).catch(()=>{});clearTimeout(initializationTimer);running=true;busy=false;frameCount=0;startedAt=performance.now();sessionEndedAt=0;status.textContent='Camera ready. On the TV, practice LEFT then RIGHT and calibrate both hands before starting a round.';void frame(runToken);return;}
      if(data.type!=='pose')return;busy=false;frameCount++;if(Number.isFinite(data.inferenceMs)&&inferenceTimes.length<10000)inferenceTimes.push(data.inferenceMs);
      const landmarks:Landmark[]=data.landmarks.map((p:any)=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility??0}));
      $('stats').textContent=`Local camera: ${(frameCount/((performance.now()-startedAt)/1000)).toFixed(1)} inference fps · latest inference ${data.inferenceMs.toFixed(1)} ms. Device gate unverified.`;
      if(landmarks.length===33){
        recordingLab.onFrame(landmarks,data.t);const result=detector.update(landmarks,data.t);practicePunches+=result.events.length;for(const event of result.events){if(event.hand==='left')leftPunches++;else rightPunches++;lastHand=event.hand.toUpperCase();}$('left-count').textContent=`LEFT: ${leftPunches}`;$('right-count').textContent=`RIGHT: ${rightPunches}`;$('movement-status').textContent=result.valid?`Tracking ready. Punches detected: ${practicePunches}${lastHand?` / Last: ${lastHand}`:''}. Punch, then return to guard.`:'Keep your face, both shoulders, elbows and wrists in view, including during a punch.';selfTest.onFrame(landmarks,data.t,result);recorder?.frame(data.t,landmarks);
        $('camera-frame').dataset.tracking=result.valid?'ready':'adjust';
        if(data.t-lastFrame>=1000/15){if(send({v:1,type:'frame',t:data.t,players:[{id:1,kp:encodeMediaPipe(landmarks)}]})&&sentAt.length<60){const tSendPhone=performance.now();if(client?.write({relay:1,action:'trace',tCapturePhone:data.t,tInferenceEndPhone:data.inferenceEnd,tSendPhone}))sentAt.push(tSendPhone);}lastFrame=data.t;}
        for(const m of [...result.events,...result.guards])send(m);
        if(data.t-lastQuality>1000){
          luma.drawImage(video,0,0,32,24);const pixels=luma.getImageData(0,0,32,24).data;let brightness=0;for(let i=0;i<pixels.length;i+=4)brightness+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];const light=brightness/(32*24*255);
          const issues:string[]=[];if(!result.valid)issues.push('upper body missing');if(light<.15)issues.push('more light');
          $('framing-hint').textContent=light<.15?'Add more light so the camera can see both arms.':result.valid?'Framing ready. Keep both hands visible and return to guard after each punch.':'Step back and show your face, shoulders, elbows and both wrists.';
          send({v:1,type:'quality',t:data.t,framing:result.valid?1:0,light,issues});lastQuality=data.t;
        }
      }else { $('camera-frame').dataset.tracking='adjust';$('movement-status').textContent='Tracking lost. Step back until your face and both arms fit in the camera view.';detector.reset();if(data.t-lastQuality>1000){$('framing-hint').textContent='Step back and show your face, shoulders, elbows and both wrists.';send({v:1,type:'quality',t:data.t,framing:0,light:lightLevel(),issues:['tracking lost']});lastQuality=data.t;} }
      }catch(error){failWorker(error instanceof Error?error.message:String(error));}
    };
    worker.postMessage({type:'init',mainTimeOrigin:performance.timeOrigin});
  }catch(error){if(runToken!==token)return;stopCamera();status.textContent=`Camera setup failed: ${error instanceof Error?error.message:String(error)}. TV controls remain available. Allow camera access in Safari/Chrome, then retry.`;}
};
$('stop').onclick=stop;window.addEventListener('beforeunload',stop);
$('stance').onchange=()=>{selfTest.stop();void recordingLab.stop();if(detector){detector=new MotionDetector({stance:stance(),aspectRatio:video.videoWidth/video.videoHeight});recorder=undefined;$('recorder-status').textContent='Stance changed. Start a new recording.';}};
$('record').onclick=()=>{try{if(!running||!$<HTMLInputElement>('record-consent').checked)throw new Error('Camera must be running and recording consent confirmed.');recorder=new KeypointRecorder({type:'session',v:1,participant:$<HTMLInputElement>('participant').value,session:crypto.randomUUID(),consent:true,synthetic:false,aspectRatio:video.videoWidth/video.videoHeight,stance:stance()});$('recorder-status').textContent='Recording keypoints locally. Label peaks with the buttons.';}catch(e){$('recorder-status').textContent=String(e);}};
for(const kind of ['jab','cross'] as const)$('label-'+kind).onclick=()=>{if(recorder){const lead=stance()==='orthodox'?'left':'right';recorder.label(performance.now(),kind,kind==='jab'?lead:lead==='left'?'right':'left');$('recorder-status').textContent=`Manual ${kind} label added. Human reaction delay is not corrected.`;}};
$('save').onclick=()=>{if(!recorder)return;const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([recorder.toJSONL()],{type:'application/x-ndjson'}));link.download='jabtempo-keypoints.jsonl';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);recorder=undefined;$('recorder-status').textContent='Saved locally. Recording stopped.';};
// Commands use the same registry and validated wire messages as speech, with explicit touch input.
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-command]'))button.onclick=()=>{
  if(!bridgeConnected){pairStatus.textContent='Connect to TV first: enter the current TV code and tap Connect to TV.';return;}
  const command=button.dataset.command!;
  if(commands.includes(command)&&send({v:1,type:'voice',t:performance.now(),command,conf:1}))$('voice-status').textContent=`Sent game command: ${command}. These buttons do not move TV menu focus. Start requires LEFT/RIGHT practice and calibration; Pause/Resume work during a round.`;
  else $('voice-status').textContent='Not connected yet. Wait for pairing, then retry.';
};
$('camera-facing').onchange=()=>{stopCamera();status.textContent='Camera changed. Start camera again; recheck LEFT and RIGHT in the tutorial. TV controls remain available.';};
// A backgrounded controller must not continue recording or generating motion events.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(client||stream||worker)){stop();status.textContent='Camera and TV connection stopped while this page was hidden. Connect again, then start camera.';}});
window.addEventListener('pagehide',stop);
$('metrics-save').onclick=()=>{
  const samples=[...inferenceTimes].sort((a,b)=>a-b),durationMs=startedAt?(sessionEndedAt||performance.now())-startedAt:0;
  const iphone=/iPhone|iPad/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const safari=/Safari/.test(navigator.userAgent)&&!/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  const setup=iphone?(safari?'iPhone-Safari-LAN':'iOS-browser-LAN'):/Android/.test(navigator.userAgent)?'Android-Chrome-LAN':'desktop-browser';
  const metrics={v:1,setup,physicalDeviceVerified:false,synthetic:false,userAgent:navigator.userAgent,durationMs,frames:frameCount,inferenceFps:durationMs>0?frameCount/(durationMs/1000):null,inferenceP50Ms:samples.length?samples[Math.floor(samples.length*.5)]:null,inferenceP95Ms:samples.length?samples[Math.min(samples.length-1,Math.floor(samples.length*.95))]:null,captureToRenderLatencyMs:null,leftDetections:leftPunches,rightDetections:rightPunches,thermalNotes:'User records warmth manually',batteryNotes:'User records start/end battery manually',notes:'Local inference timings only. Not G1 latency, held-out accuracy or proof of a physical device.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(metrics,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='jabtempo-session-metrics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
