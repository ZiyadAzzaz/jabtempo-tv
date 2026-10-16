import {KeypointRecorder,type Landmark,type RecordingPermissions} from '../../../packages/motion/src/index.js';
export const VOICE_COMMANDS=['start','pause','resume','harder','easier','next round','two players'] as const;
export interface Instruction {id:string;startMs:number;endMs:number;prompt:string;category:'negative'|'punch'|'guard'|'free'|'voice';expectedKind?:'jab'|'cross';bpm?:90|110}
export interface SessionScript {v:1;seed:number;sessionIndex:1|2;durationMs:600000;voiceRepeats:number;instructions:Instruction[];labelsAreExpectedOnly:true}
export function createSessionScript(seed:number,sessionIndex:1|2,voiceRepeats=2):SessionScript{
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||![1,2].includes(sessionIndex)||!Number.isInteger(voiceRepeats)||voiceRepeats<1||voiceRepeats>2)throw new RangeError('Invalid recording script options');
  let state=(seed^(sessionIndex*0x9e3779b9))>>>0;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const instructions:Instruction[]=[];
  const add=(value:Omit<Instruction,'id'>)=>instructions.push({id:`cue-${instructions.length+1}`,...value});
  for(const [i,prompt]of ['IDLE — stand still','DANCE — move freely','TALK — speak naturally'].entries())add({startMs:i*60000,endMs:(i+1)*60000,prompt,category:'negative'});
  for(let i=0;i<7*voiceRepeats;i++)add({startMs:125000+i*3500,endMs:127500+i*3500,prompt:`Say: ${VOICE_COMMANDS[i%7]}`,category:'voice'});
  for(const [block,bpm]of [[0,90],[1,110]] as const){
    const beat=60000/bpm,begin=180000+block*180000,end=begin+180000;
    for(let t=begin+2*beat;t<end-2*beat;t+=4*beat){
      const kind=random()<.5?'jab':'cross';
      add({startMs:Math.round(t),endMs:Math.round(t+beat),prompt:kind.toUpperCase(),category:'punch',expectedKind:kind,bpm});
      add({startMs:Math.round(t+beat),endMs:Math.round(t+3*beat),prompt:'GUARD — hands back up',category:'guard',bpm});
    }
  }
  add({startMs:540000,endMs:600000,prompt:'FREE PLAY — punch or rest at your own pace',category:'free'});
  instructions.sort((a,b)=>a.startMs-b.startMs||a.id.localeCompare(b.id));
  return {v:1,seed,sessionIndex,durationMs:600000,voiceRepeats,instructions,labelsAreExpectedOnly:true};
}
export function validatePermissions(permissions:RecordingPermissions,wantsVideo:boolean){
  if(permissions.evaluation!==true)throw new Error('Evaluation and aggregate reporting consent is required.');
  if(wantsVideo&&!permissions.localVideo)throw new Error('Local video/testing consent is required for video recording.');
  if(permissions.appearInDemo&&!permissions.localVideo)throw new Error('Demo appearance requires local video consent too.');
  if(![permissions.commitKeypoints,permissions.localVideo,permissions.appearInDemo].every(n=>typeof n==='boolean'))throw new Error('Record every separate consent choice.');
}
export class GuidedRecordingLab {
  private keypoints?:KeypointRecorder;
  private rawVideo?:MediaRecorder;
  private chunks:Blob[]=[];
  private finishedVideo?:Blob;
  private stopped?:Promise<void>;
  private clonedStream?:MediaStream;
  private videoError?:string;
  private videoFinishing=false;
  private saved=true;
  script?:SessionScript;
  startAt=0;
  session='';
  active=false;
  begin(options:{participant:string;sessionIndex:1|2;seed:number;stance:'orthodox'|'southpaw';aspectRatio:number;permissions:RecordingPermissions;recordVideo:boolean},stream:MediaStream,startAt=performance.now()){
    if(this.active||this.videoFinishing)throw new Error('Stop the current session and wait for video finalization before starting another.');
    if(!this.saved)throw new Error('Download the previous local recording before starting another session.');
    validatePermissions(options.permissions,options.recordVideo);
    if(!stream.getVideoTracks().some(track=>track.readyState==='live'))throw new Error('Start the consented camera first.');
    if(stream.getVideoTracks().some(track=>/\.y4m$|fake_device/i.test(track.label)))throw new Error('File-backed/fake capture cannot create a new human evaluation recording.');
    const session=crypto.randomUUID(),script=createSessionScript(options.seed,options.sessionIndex);
    const recorder=new KeypointRecorder({type:'session',v:1,participant:options.participant,session,consent:true,synthetic:false,aspectRatio:options.aspectRatio,stance:options.stance,labelsExpected:true,permissions:options.permissions});
    this.chunks=[];this.finishedVideo=undefined;this.stopped=undefined;this.rawVideo=undefined;this.videoError=undefined;
    if(options.recordVideo){
      if(typeof MediaRecorder==='undefined')throw new Error('Local video recording is unavailable in this browser.');
      const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      this.clonedStream=new MediaStream(stream.getVideoTracks().map(track=>track.clone())); // No microphone/audio capture.
      try{
        this.rawVideo=new MediaRecorder(this.clonedStream,mime?{mimeType:mime,videoBitsPerSecond:1200000}:undefined);
        this.rawVideo.ondataavailable=event=>{if(event.data.size)this.chunks.push(event.data);};
        this.stopped=new Promise(resolve=>{this.rawVideo!.onstop=()=>{this.finishedVideo=new Blob(this.chunks,{type:this.rawVideo!.mimeType});this.chunks=[];this.clonedStream?.getTracks().forEach(track=>track.stop());resolve();};this.rawVideo!.onerror=()=>{this.videoError='Local video recorder failed. Keypoints can still be saved; video must be checked before use.';this.clonedStream?.getTracks().forEach(track=>track.stop());resolve();};});
        this.rawVideo.start(1000);
      }catch(error){this.clonedStream.getTracks().forEach(track=>track.stop());this.rawVideo=undefined;throw error;}
    }
    this.keypoints=recorder;this.session=session;this.script=script;this.startAt=startAt;this.active=true;this.saved=false;
  }
  onFrame(landmarks:Landmark[],t:number){if(this.active&&landmarks.length===33)this.keypoints!.frame(t,landmarks);}
  elapsed(now=performance.now()){return Math.max(0,now-this.startAt);}
  current(now=performance.now()){const elapsed=this.elapsed(now);return this.script?.instructions.filter(cue=>cue.startMs<=elapsed&&cue.endMs>elapsed)??[];}
  stop(){this.active=false;if(this.rawVideo&&this.rawVideo.state!=='inactive'){this.videoFinishing=true;this.rawVideo.stop();}return (this.stopped??Promise.resolve()).finally(()=>{this.videoFinishing=false;});}
  async files(){
    await this.stop();if(!this.keypoints||!this.script)throw new Error('No recording to save.');
    const prefix=this.session;
    const files=[{name:`${prefix}.jsonl`,blob:new Blob([this.keypoints.toJSONL()],{type:'application/x-ndjson'})},
      {name:`${prefix}.script.json`,blob:new Blob([JSON.stringify({...this.script,startAtPhoneMs:this.startAt,session:this.session,videoError:this.videoError??null},null,2)],{type:'application/json'})}];
    if(this.finishedVideo&&!this.videoError){
      const videoName=`${prefix}.${this.finishedVideo.type.includes('mp4')?'mp4':'webm'}`;
      const digest=await crypto.subtle.digest('SHA-256',await this.finishedVideo.arrayBuffer());
      const videoSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      const header=JSON.parse(this.keypoints.toJSONL().split('\n')[0]);
      const manifest={v:1,synthetic:false,session:this.session,videoName,videoSha256,localOnly:true,
        consent:{localVideoTesting:header.permissions.localVideo,appearInDemo:header.permissions.appearInDemo,commitKeypoints:header.permissions.commitKeypoints,evaluation:header.permissions.evaluation},
        deletion:'Delete raw footage after the hackathon. No automatic upload or publication.'};
      files.push({name:videoName,blob:this.finishedVideo},{name:`${prefix}.consent.json`,blob:new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'})});
    }
    return files;
  }
}
export function installRecordingUI(hooks:{getStream:()=>MediaStream|undefined;getCameraReady:()=>boolean;getStance:()=> 'orthodox'|'southpaw';getAspectRatio:()=>number}){
  const lab=new GuidedRecordingLab(),byId=(id:string)=>document.getElementById(id) as HTMLInputElement;
  if(!byId('lab-record-start'))return lab;
  const status=byId('lab-record-status'),prompt=byId('lab-record-prompt');
  let timer:ReturnType<typeof setInterval>|undefined,audio:AudioContext|undefined,lastBeat=-1;
  const halt=()=>{clearInterval(timer);void lab.stop();if(audio&&audio.state!=='closed')void audio.close().catch(()=>{});audio=undefined;(byId('lab-record-start') as unknown as HTMLButtonElement).disabled=false;};
  byId('lab-record-start').onclick=()=>{try{
    if(!hooks.getCameraReady()||!hooks.getStream())throw new Error('Start the camera before recording.');
    const seed=Number(byId('lab-seed').value),sessionIndex=Number(byId('lab-session').value) as 1|2;
    const permissions={evaluation:byId('lab-eval-consent').checked as true,commitKeypoints:byId('lab-git-consent').checked,localVideo:byId('lab-video-consent').checked,appearInDemo:byId('lab-demo-consent').checked};
    lab.begin({participant:byId('lab-participant').value,sessionIndex,seed,stance:hooks.getStance(),aspectRatio:hooks.getAspectRatio(),permissions,recordVideo:byId('lab-record-video').checked},hooks.getStream()!);
    (byId('lab-record-start') as unknown as HTMLButtonElement).disabled=true;
    audio=new AudioContext();void audio.resume();lastBeat=-1;status.textContent='Session recording locally. Prompts are expected actions, not confirmed labels.';
    timer=setInterval(()=>{if(!lab.active){halt();return;}const elapsed=lab.elapsed(),cues=lab.current(),cue=cues.find(item=>item.category==='voice')??cues.at(-1);prompt.textContent=`${Math.floor(elapsed/60000)}:${String(Math.floor(elapsed/1000)%60).padStart(2,'0')} / 10:00 — ${cue?.prompt??'REST / GUARD'}`;
      const bpm=elapsed>=180000&&elapsed<360000?90:elapsed>=360000&&elapsed<540000?110:0;
      if(bpm&&audio){const beat=Math.floor((elapsed-(elapsed<360000?180000:360000))/(60000/bpm));if(beat!==lastBeat){lastBeat=beat;const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=880;gain.gain.setValueAtTime(.08,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.06);osc.connect(gain).connect(audio.destination);osc.start();osc.stop(audio.currentTime+.07);}}
      if(elapsed>=600000){halt();status.textContent='Session complete. Save locally, then change clothes/light/distance for session 2.';}
    },100);
  }catch(error){if(lab.active)halt();status.textContent=String(error);}};
  byId('lab-record-stop').onclick=()=>{halt();status.textContent='Stopped. Save keypoints and any consented video locally.';};
  byId('lab-record-save').onclick=async()=>{try{halt();for(const file of await lab.files()){const link=document.createElement('a');link.href=URL.createObjectURL(file.blob);link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}status.textContent='Downloaded locally. Move raw video to local_private/; never upload or commit it. Independent review is required before evaluation.';}catch(error){status.textContent=String(error);}};
  window.addEventListener('beforeunload',halt);
  return lab;
}
