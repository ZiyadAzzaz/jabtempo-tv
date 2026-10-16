import {useEffect,useRef} from 'react';
import {BackHandler,useTVEventHandler} from 'react-native';
export default function useRemote(back:()=>boolean,togglePause:()=>void){const actions=useRef({back,togglePause});actions.current={back,togglePause};useEffect(()=>{const subscription=BackHandler.addEventListener('hardwareBackPress',()=>actions.current.back());return()=>subscription.remove();},[]);useTVEventHandler(event=>{if(event.eventType==='playPause'&&event.eventKeyAction!==1)actions.current.togglePause();});}
