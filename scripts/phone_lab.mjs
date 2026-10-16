/** Explicitly selected, already-authorized phone only. Never pairs or records automatically. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {adb,assertForeground,audit} from '../tools/mobile-mcp/device-guard.mjs';
import {allowedCameraUrl,OWN_PACKAGES} from '../tools/mobile-mcp/policy.mjs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
const serial=process.env.JABTEMPO_PHONE_SERIAL,action=process.argv[2],argument=process.argv[3];
if(!serial||!/^\w[\w.:-]{0,127}$/.test(serial)||/^emulator-/.test(serial))throw Error('Select the already-paired physical phone with JABTEMPO_PHONE_SERIAL.');
audit(serial,`phone lab ${action}`);
switch(action){
  case 'reverse':await adb(serial,['reverse','tcp:8787','tcp:8787']);break;
  case 'remove-reverse':await adb(serial,['reverse','--remove','tcp:8787']);break;
  case 'open-camera':{
    const url=allowedCameraUrl(argument??'http://localhost:8787/phone');
    await adb(serial,['shell','am','start','-a','android.intent.action.VIEW','-d',url,'-p','com.android.chrome']);
    console.log('Only the owned local camera page was opened. Grant this page camera access manually; browser-wide permissions/captures are not automated.');break;
  }
  case 'launch':case 'grant-camera':case 'grant-mic':{
    if(!OWN_PACKAGES.includes(argument))throw Error('Only JabTempo native packages allowed.');
    if(action==='launch')await adb(serial,['shell','monkey','-p',argument,'-c','android.intent.category.LAUNCHER','1']);
    else await adb(serial,['shell','pm','grant',argument,action==='grant-camera'?'android.permission.CAMERA':'android.permission.RECORD_AUDIO']);
    break;
  }
  case 'screenshot':{
    await assertForeground(serial);const image=await adb(serial,['exec-out','screencap','-p'],{binary:true});await assertForeground(serial);
    if(image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot.');
    mkdirSync('local_private/device_lab',{recursive:true});writeFileSync(resolve('local_private/device_lab/phone.png'),image);break;
  }
  default:throw Error('Use reverse, remove-reverse, open-camera, launch, grant-camera, grant-mic or screenshot.');
}
audit(serial,`phone lab ${action}`,'success');
