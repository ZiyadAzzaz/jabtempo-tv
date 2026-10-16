import React,{forwardRef,memo,useImperativeHandle,useMemo,useRef,useState} from 'react';
import {Image,StyleSheet} from 'react-native';
import Video from 'react-native-video';
import type {AudioDriverProps,AudioDriverHandle} from './AudioDriver.types';
import {AudioPositionTracker} from '../../packages/game/src/audio-position';
const beats={90:require('./assets/audio/beat_90.wav'),110:require('./assets/audio/beat_110.wav'),130:require('./assets/audio/beat_130.wav')};
const effects={perfect:require('./assets/audio/hit_perfect.wav'),good:require('./assets/audio/hit_good.wav'),guard:require('./assets/audio/hit_guard.wav'),miss:require('./assets/audio/hit_miss.wav'),combo:require('./assets/audio/hit_combo.wav')};
const Driver=forwardRef<AudioDriverHandle,AudioDriverProps>(function AudioDriver(props,ref){
  const position=useRef({tracker:new AudioPositionTracker(),run:props.run}),[effect,setEffect]=useState<{kind:keyof typeof effects;run:number}>();
  if(position.current.run!==props.run)position.current={tracker:new AudioPositionTracker(),run:props.run};
  const beatSource=useMemo(()=>({uri:Image.resolveAssetSource(beats[props.bpm]).uri}),[props.bpm]);
  useImperativeHandle(ref,()=>({cue:kind=>setEffect(previous=>({kind,run:(previous?.run??0)+1}))}),[]);
  if(!props.active)return null;
  return <><Video key={props.run} source={beatSource} repeat rate={props.rate} paused={props.paused} volume={props.volume}
    onLoad={({duration})=>{position.current.tracker.setDuration(duration*1000);}} progressUpdateInterval={33}
    onProgress={({currentTime})=>{if(props.paused)return;props.onTick(position.current.tracker.update(currentTime*1000),performance.now(),0);}}
    onError={()=>props.onError('Audio could not start. Check the native build and generated assets.')} style={style.hidden}/>
    {effect&&<Video key={`cue-${effect.run}`} source={{uri:Image.resolveAssetSource(effects[effect.kind]).uri}} disableFocus volume={props.volume} paused={props.paused} onEnd={()=>setEffect(undefined)} style={style.hidden}/>}</>;
});
export default memo(Driver,(previous,next)=>previous.active===next.active&&previous.paused===next.paused&&previous.bpm===next.bpm&&previous.rate===next.rate&&previous.run===next.run&&previous.volume===next.volume);
const style=StyleSheet.create({hidden:{position:'absolute',width:1,height:1,left:0,bottom:0}});
