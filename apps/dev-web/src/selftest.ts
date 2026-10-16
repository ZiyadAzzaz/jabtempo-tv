import {KeypointRecorder,replayMotion,type Landmark,type PunchEvent} from '../../../packages/motion/src/index.js';
interface CaptureFrame {t:number;landmarks:Landmark[]}
interface ManualPunch {t:number;kind:'jab'|'cross';source:'independent-tap'|'independent-replay-review'}
export class SelfTestSession {
  private recorder?:KeypointRecorder;
  private frames:CaptureFrame[]=[];
  private punches:ManualPunch[]=[];
  private detections:PunchEvent[]=[];
  private liveDetections:PunchEvent[]=[];
  private lead:'left'|'right'='left';
  active=false;
  startAt=0;
  begin(options:{consent:boolean;ready:boolean;stance:'orthodox'|'southpaw';aspectRatio:number},t=performance.now()){
    if(!options.consent)throw new Error('Confirm your own keypoints-only training consent first.');
    if(!options.ready)throw new Error('Start the consented camera and pairing first.');
    if(this.active)throw new Error('Self-test is already recording.');
    if(!Number.isFinite(t)||t<0)throw new Error('Invalid self-test timestamp.');
    this.recorder=new KeypointRecorder({type:'session',v:1,participant:'m1-training-person',session:crypto.randomUUID(),consent:true,synthetic:false,aspectRatio:options.aspectRatio,stance:options.stance,trainingOnly:true,labelsExpected:false});
    this.frames=[];this.punches=[];this.detections=[];this.liveDetections=[];this.lead=options.stance==='orthodox'?'left':'right';this.startAt=t;this.active=true;
  }
  onFrame(landmarks:Landmark[],t:number,result?:{events:PunchEvent[]}){if(!this.active||landmarks.length!==33||t<this.startAt)return;if(t-this.startAt>120000){this.stop();return;}this.recorder!.frame(t,landmarks);this.frames.push({t,landmarks:landmarks.map(point=>({...point}))});if(result)this.liveDetections.push(...result.events.filter(event=>event.t_peak>=this.startAt).map(event=>({...event})));}
  label(kind:'jab'|'cross',t=performance.now(),reviewed=false){if(!this.recorder||(!this.active&&!reviewed))throw new Error('Record a self-test before adding observed punches.');if(!Number.isFinite(t)||t<this.startAt||t-this.startAt>120000)throw new Error('Observed punch is outside this self-test.');const hand=kind==='jab'?this.lead:this.lead==='left'?'right':'left';this.recorder.label(t,kind,hand);this.punches.push({t,kind,source:reviewed?'independent-replay-review':'independent-tap'});}
  stop(){this.active=false;if(this.frames.length)this.detections=replayMotion(this.recorder!.toJSONL()).flatMap(frame=>frame.events);}
  data(){return {frames:this.frames,punches:this.punches,detections:this.detections,liveDetections:this.liveDetections,startAt:this.startAt};}
  jsonl(){if(!this.recorder)throw new Error('No self-test exists.');return this.recorder.toJSONL();}
}
export function installSelfTestUI(hooks:{getStream:()=>MediaStream|undefined;getReady:()=>boolean;getStance:()=> 'orthodox'|'southpaw';getAspectRatio:()=>number}){
  const session=new SelfTestSession(),element=(id:string)=>document.getElementById(id)!;
  if(!element('selftest-start'))return session;
  const status=element('selftest-status'),slider=element('selftest-time') as HTMLInputElement,canvas=element('selftest-replay') as HTMLCanvasElement,context=canvas.getContext('2d')!;
  let timer:ReturnType<typeof setInterval>|undefined,animation=0,playing=false,playStarted=0,playOffset=0;
  const duration=()=>{const data=session.data();return data.frames.length?data.frames.at(-1)!.t-data.startAt:0;};
  function draw(offset=Number(slider.value)){
    const data=session.data(),absolute=data.startAt+offset;context.fillStyle='#0a1424';context.fillRect(0,0,canvas.width,canvas.height);
    const frame=data.frames.reduce<CaptureFrame|undefined>((nearest,item)=>Math.abs(item.t-absolute)<Math.abs((nearest?.t??Infinity)-absolute)?item:nearest,undefined);
    context.font='20px sans-serif';context.fillStyle='#d9e7f7';context.fillText('KEYPOINT REPLAY · TRAINING ONLY',24,32);
    if(frame){const p=frame.landmarks,project=(index:number)=>({x:40+p[index].x*(canvas.width-80),y:50+p[index].y*(canvas.height-150)});context.lineWidth=5;
      for(const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]] as const){if(Math.min(p[a].visibility,p[b].visibility)<.5)continue;const first=project(a),second=project(b);context.strokeStyle=a===12||a===14?'#ffaf64':'#69c5ff';context.beginPath();context.moveTo(first.x,first.y);context.lineTo(second.x,second.y);context.stroke();}
      for(const index of [0,11,12,13,14,15,16]){if(p[index].visibility<.5)continue;const point=project(index);context.fillStyle=index===16?'#ffaf64':'#69c5ff';context.beginPath();context.arc(point.x,point.y,7,0,Math.PI*2);context.fill();}
    }
    const total=Math.max(duration(),1),left=180,width=canvas.width-left-24;context.font='16px sans-serif';
    for(const [label,y,items,color] of [['Detector',canvas.height-70,data.detections.map(event=>({t:event.t_peak,kind:event.kind})),'#69c5ff'],['Your observations',canvas.height-30,data.punches,'#ffaf64']] as const){context.fillStyle=color;context.fillText(label,16,y+5);context.strokeStyle='#3c506a';context.beginPath();context.moveTo(left,y);context.lineTo(canvas.width-24,y);context.stroke();for(const item of items){const x=left+(item.t-data.startAt)/total*width;context.fillStyle=color;if(item.kind==='jab'){context.beginPath();context.arc(x,y,5,0,Math.PI*2);context.fill();}else context.fillRect(x-4,y-7,8,14);}}
    const cursor=left+offset/total*width;context.strokeStyle='#ffffff';context.beginPath();context.moveTo(cursor,canvas.height-90);context.lineTo(cursor,canvas.height-12);context.stroke();
    element('selftest-position').textContent=`Replay ${(offset/1000).toFixed(1)} s / ${(duration()/1000).toFixed(1)} s. Detector ${data.detections.length} events; ${data.punches.length} independent observations. These counts are not accuracy.`;
  }
  function stopPlayback(){playing=false;cancelAnimationFrame(animation);}
  function finish(){clearInterval(timer);session.stop();slider.max=String(duration());slider.value='0';draw();status.textContent='Training capture stopped. Review your punches on the keypoint replay. No raw video/audio recorded; no evaluation accuracy claimed.';}
  element('selftest-start').onclick=()=>{try{stopPlayback();session.begin({consent:(element('selftest-consent') as HTMLInputElement).checked,ready:hooks.getReady()&&Boolean(hooks.getStream()),stance:hooks.getStance(),aspectRatio:hooks.getAspectRatio()});status.textContent='Recording your training keypoints for two minutes. Play a round or alternate comfortable jabs/crosses with guard and rests.';timer=setInterval(()=>{const remaining=Math.max(0,120000-(performance.now()-session.startAt));status.textContent=`Training-only self-test: ${Math.ceil(remaining/1000)} seconds remaining. Keypoints only.`;if(!remaining||!session.active)finish();},250);}catch(error){status.textContent=String(error);}};
  element('selftest-stop').onclick=finish;
  for(const kind of ['jab','cross'] as const){element('selftest-label-'+kind).onclick=()=>{try{session.label(kind);status.textContent=`Independent ${kind} tap noted. Your reaction delay is not corrected.`;}catch(error){status.textContent=String(error);}};element('selftest-review-'+kind).onclick=()=>{try{if(session.active)throw new Error('Stop capture before replay review.');session.label(kind,session.startAt+Number(slider.value),true);draw();status.textContent=`Independently marked ${kind} at replay position. Inspect your own movement, not detector marks.`;}catch(error){status.textContent=String(error);}};}
  slider.oninput=()=>{stopPlayback();draw();};
  element('selftest-play').onclick=()=>{if(session.active){status.textContent='Stop recording before replay.';return;}if(!duration()){status.textContent='Record keypoints before replay.';return;}if(playing){stopPlayback();return;}playing=true;playStarted=performance.now();playOffset=Number(slider.value)>=duration()?0:Number(slider.value);const tick=()=>{if(!playing)return;const position=Math.min(duration(),playOffset+performance.now()-playStarted);slider.value=String(position);draw(position);if(position>=duration())stopPlayback();else animation=requestAnimationFrame(tick);};tick();};
  element('selftest-save').onclick=()=>{try{if(session.active)finish();const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([session.jsonl()],{type:'application/x-ndjson'}));link.download='jabtempo-m1-training-only.jsonl';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);status.textContent='Keypoints downloaded locally. This person is training-only: never include this session/person in held-out evaluation.';}catch(error){status.textContent=String(error);}};
  window.addEventListener('beforeunload',()=>{clearInterval(timer);stopPlayback();session.stop();});
  draw();return session;
}
