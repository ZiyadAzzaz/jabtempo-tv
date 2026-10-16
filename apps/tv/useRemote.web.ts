import {useEffect,useRef} from 'react';
export default function useRemote(back:()=>boolean,togglePause:()=>void){
  const actions=useRef({back,togglePause});actions.current={back,togglePause};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{
    if(event.key==='Backspace'||event.key==='Escape'){event.preventDefault();actions.current.back();return;}
    if(event.code==='Space'||event.key==='MediaPlayPause'){if(event.repeat)return;event.preventDefault();actions.current.togglePause();return;}
    const buttons=[...document.querySelectorAll<HTMLElement>('[role="button"]')].filter(button=>button.getBoundingClientRect().width>0);
    const focused=document.activeElement as HTMLElement;if(event.key==='Enter'&&buttons.includes(focused)){event.preventDefault();focused.click();return;}
    if(!event.key.startsWith('Arrow')||!buttons.length)return;event.preventDefault();
    if(!buttons.includes(focused)){buttons[0].focus();return;}
    const box=focused.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
    const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',positive=event.key==='ArrowRight'||event.key==='ArrowDown';
    const candidates=buttons.filter(button=>button!==focused).map(button=>{const r=button.getBoundingClientRect(),dx=r.left+r.width/2-x,dy=r.top+r.height/2-y;return {button,along:horizontal?dx:dy,across:horizontal?dy:dx};}).filter(candidate=>positive?candidate.along>4:candidate.along<-4).sort((a,b)=>(Math.abs(a.along)+Math.abs(a.across)*3)-(Math.abs(b.along)+Math.abs(b.across)*3));
    candidates[0]?.button.focus();
  };document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
}
