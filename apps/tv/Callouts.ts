import * as Speech from 'expo-speech';
export function speakCallout(text:string,volume:number){if(volume<=0)return;void Speech.stop();Speech.speak(text,{rate:1.05,volume});}
