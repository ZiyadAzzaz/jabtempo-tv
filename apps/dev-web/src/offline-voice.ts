import {commands} from '../../../packages/tv-pose-bridge/src/protocol.js';

// Vosk is loaded only on an explicit Enable click. Microphone capture occurs only during PTT.
export function installOfflineVoice(send:(message:unknown)=>boolean,ready:()=>boolean){
  const status=document.getElementById('voice-status')!;
  const enable=document.getElementById('voice-enable') as HTMLButtonElement;
  const button=document.getElementById('voice') as HTMLButtonElement;
  let model:any,recognizer:any,context:AudioContext|undefined,mic:MediaStream|undefined,node:ScriptProcessorNode|undefined;
  let holding=false,generation=0,last=-Infinity,delivered=false,holdTimer:ReturnType<typeof setTimeout>|undefined;
  status.textContent='Voice is optional: enable local English speech, or use the command buttons. No cloud recognition.';
  async function release(){
    holding=false;generation++;clearTimeout(holdTimer);mic?.getTracks().forEach(t=>t.stop());mic=undefined;
    if(node){node.onaudioprocess=null;node.disconnect();node=undefined;}
    if(context){void context.close();context=undefined;}
    if(recognizer){const final=recognizer;recognizer=undefined;final.retrieveFinalResult();setTimeout(()=>final.remove(),250);}
    button.textContent='Hold to speak';
  }
  function stop(){delivered=true;void release();button.disabled=!model;}
  enable.onclick=async()=>{
    enable.disabled=true;status.textContent='Loading optional local English model (~40 MB). Camera can keep running.';
    try{
      const response=await fetch('/assets/models/voice-en.tar.gz',{method:'HEAD'});
      if(!response.ok)throw Error('Run npm run setup:voice in the laptop terminal first.');
      const imported:any=await import('vosk-browser');
      const Vosk=imported.default??imported;
      const loading=new Vosk.Model(new URL('/assets/models/voice-en.tar.gz',location.href).href,-1);
      model=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{loading.terminate();reject(Error('Model load timed out; use buttons.'));},90000);
        loading.on('load',(message:any)=>{clearTimeout(timeout);message.result?resolve(loading):reject(Error('Model unavailable.'));});
        loading.on('error',(message:any)=>{clearTimeout(timeout);reject(Error(message.error||'Local speech failed.'));});
      });
      enable.textContent='Local speech ready';button.disabled=false;
      status.textContent='Hold to speak: start, pause, resume, harder, easier, next round, two players. Audio is processed in this browser only. Device accuracy unverified.';
    }catch(error){enable.disabled=false;status.textContent=`Local speech unavailable: ${error instanceof Error?error.message:String(error)} Use buttons.`;}
  };
  async function press(){
    if(!model||holding)return;
    if(!ready()){status.textContent='Connect to TV before sending a command. Camera use is separate.';return;}
    holding=true;delivered=false;const run=++generation;button.textContent='Listening locally...';
    try{
      context=new AudioContext();await context.resume();
      const captured=await navigator.mediaDevices.getUserMedia({video:false,audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(!holding||run!==generation){captured.getTracks().forEach(t=>t.stop());return;}
      mic=captured;const audio=context!;
      recognizer=new model.KaldiRecognizer(audio.sampleRate,JSON.stringify([...commands,'[unk]']));recognizer.setWords(true);
      recognizer.on('result',(message:any)=>{
        if(delivered||!ready())return;
        const result=message.result,text=result?.text?.trim().toLowerCase();
        const words=result?.result??[],confidence=words.length?Math.min(...words.map((word:any)=>word.conf??0)):0;
        const t=performance.now();
        if(commands.includes(text)&&confidence>=.75&&t-last>=1500){
          delivered=true;last=t;send({v:1,type:'voice',t,command:text,conf:confidence});status.textContent=`Local voice command: ${text}`;
        }else if(text)status.textContent='Command not clear. Try again or tap its button.';
      });
      const source=audio.createMediaStreamSource(captured);node=audio.createScriptProcessor(4096,1,1);
      const silent=audio.createGain();silent.gain.value=0;
      node.onaudioprocess=event=>{if(holding&&recognizer)recognizer.acceptWaveform(event.inputBuffer);};
      source.connect(node);node.connect(silent);silent.connect(audio.destination);
      holdTimer=setTimeout(()=>void release(),8000);
      status.textContent='Listening on this device. Release after one command.';
    }catch(error){stop();status.textContent=`Microphone unavailable: ${error instanceof Error?error.message:String(error)} Use buttons.`;}
  }
  button.onpointerdown=event=>{event.preventDefault();button.setPointerCapture(event.pointerId);void press();};
  button.onpointerup=()=>void release();button.onpointercancel=()=>{delivered=true;void release();};button.onblur=()=>{delivered=true;void release();};
  button.onkeydown=event=>{if(['Space','Enter'].includes(event.code)&&!event.repeat){event.preventDefault();void press();}};
  button.onkeyup=event=>{if(['Space','Enter'].includes(event.code))void release();};
  window.addEventListener('pagehide',()=>{stop();model?.terminate();model=undefined;});
  return {stop};
}
