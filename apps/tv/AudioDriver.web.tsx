import React,{forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {Asset} from 'expo-asset';
import type {AudioDriverProps,AudioDriverHandle} from './AudioDriver.types';
const beats={90:require('./assets/audio/beat_90.wav'),110:require('./assets/audio/beat_110.wav'),130:require('./assets/audio/beat_130.wav')};
const effects={perfect:require('./assets/audio/hit_perfect.wav'),good:require('./assets/audio/hit_good.wav'),guard:require('./assets/audio/hit_guard.wav'),miss:require('./assets/audio/hit_miss.wav'),combo:require('./assets/audio/hit_combo.wav')};
export default forwardRef<AudioDriverHandle,AudioDriverProps>(function AudioDriver(props,ref){
  const current=useRef(props);current.current=props;
  const audio=useRef<AudioContext|null>(null),gain=useRef<GainNode|null>(null),buffers=useRef(new Map<string,AudioBuffer>());
  const timeline=useRef<{source:AudioBufferSourceNode;context:AudioContext;last:number;position:number;rate:number}|undefined>(undefined);
  const advance=()=>{const value=timeline.current;if(!value)return 0;const current=value.context.currentTime;const elapsed=Math.max(0,current-value.last);value.position+=elapsed*1000*value.rate;value.last=Math.max(value.last,current);return value.position;};
  useImperativeHandle(ref,()=>({cue:kind=>{const context=audio.current,buffer=buffers.current.get(kind);if(!context||!buffer||current.current.paused)return;const source=context.createBufferSource();source.buffer=buffer;source.connect(gain.current!);source.start();}}),[]);
  useEffect(()=>{
    if(!props.active)return;const controller=new AbortController();let disposed=false,raf=0,source:AudioBufferSourceNode|undefined;
    const context=new AudioContext();audio.current=context;gain.current=context.createGain();gain.current.gain.value=current.current.volume;gain.current.connect(context.destination);
    const load=async(module:number)=>{const response=await fetch(Asset.fromModule(module).uri,{signal:controller.signal});if(!response.ok)throw new Error('Missing generated audio asset');return context.decodeAudioData(await response.arrayBuffer());};
    void(async()=>{try{
      await context.resume();const buffer=await load(beats[props.bpm]);if(disposed)return;
      for(const [kind,module] of Object.entries(effects))void load(module).then(value=>{if(!disposed)buffers.current.set(kind,value);}).catch(()=>{});
      source=context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(gain.current!);const start=context.currentTime+.1;source.playbackRate.value=current.current.rate;source.start(start);timeline.current={source,context,last:start,position:0,rate:current.current.rate};
      const draw=()=>{if(disposed)return;gain.current!.gain.value=current.current.volume;if(!current.current.paused)current.current.onTick(advance(),performance.now(),(context.outputLatency??0)*1000);raf=requestAnimationFrame(draw);};raf=requestAnimationFrame(draw);
    }catch(error){if(!disposed)current.current.onError(`Audio could not start: ${error instanceof Error?error.message:'retry playback'}`);}})();
    return()=>{disposed=true;controller.abort();cancelAnimationFrame(raf);try{source?.stop();}catch{}void context.close();audio.current=null;timeline.current=undefined;buffers.current.clear();};
  },[props.active,props.bpm,props.run]);
  useEffect(()=>{const value=timeline.current;if(!value)return;advance();value.rate=props.rate;value.source.playbackRate.setValueAtTime(props.rate,value.context.currentTime);},[props.rate]);
  useEffect(()=>{const context=audio.current;if(!context)return;void(props.paused?context.suspend():context.resume()).catch(()=>{});},[props.paused,props.active]);
  return null;
});
