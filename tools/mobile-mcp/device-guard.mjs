import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWN_PACKAGES, deviceAlias } from './policy.mjs';
const exec=promisify(execFile);
export const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export function audit(serial,action,outcome='attempt') {
  if(/^emulator-\d+$/.test(serial))return;
  appendFileSync(resolve(ROOT,'docs/phone_actions.log'),JSON.stringify({utc:new Date().toISOString(),deviceAlias:deviceAlias(serial),action,scope:'JabTempo app only',outcome})+'\n');
}
export function adbPath() {
  const roots=[process.env.ANDROID_SDK_ROOT,process.env.ANDROID_HOME,process.env.LOCALAPPDATA&&resolve(process.env.LOCALAPPDATA,'Android/Sdk')].filter(Boolean);
  for(const root of roots){const path=resolve(root,'platform-tools',process.platform==='win32'?'adb.exe':'adb');if(existsSync(path))return path;}
  if(process.env.JABTEMPO_ADB_PATH&&existsSync(process.env.JABTEMPO_ADB_PATH))return process.env.JABTEMPO_ADB_PATH;
  throw new Error('Android Platform Tools unavailable. Install SDK in Android Studio; set ANDROID_SDK_ROOT. No device test ran.');
}
export async function adb(serial,args,{binary=false}={}) {
  audit(serial,`adb ${args.slice(0,3).join(' ')}`);
  try{const {stdout}=await exec(adbPath(),['-s',serial,...args],{encoding:binary?'buffer':'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024*1024});audit(serial,'adb operation','success');return stdout;}
  catch{audit(serial,'adb operation','failed');throw new Error('Scoped adb operation failed; check SDK and authorized device.');}
}
export async function assertForeground(serial) {
  const windows=await adb(serial,['shell','dumpsys','window','windows']);
  const focus=windows.split('\n').find(line=>/mCurrentFocus=|mFocusedApp=/.test(line))??'';
  if(!OWN_PACKAGES.some(pkg=>new RegExp(`${pkg.replaceAll('.','\\.')}[/}]`).test(focus)))throw new Error('Foreground outside JabTempo native app. Capture/navigation refused.');
}
