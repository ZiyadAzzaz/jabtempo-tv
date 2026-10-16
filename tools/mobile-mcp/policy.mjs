import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
export const OWN_PACKAGES = Object.freeze(['org.jabtempo.tv','org.jabtempo.phone']);
export const ALLOWED_TOOLS = Object.freeze(['mobile_list_available_devices','mobile_launch_app','mobile_terminate_app',
  'mobile_press_button','mobile_take_screenshot','mobile_save_screenshot','mobile_list_elements_on_screen','mobile_get_screen_size']);
export const REMOTE_KEYS = Object.freeze(['BACK','ENTER','DPAD_CENTER','DPAD_UP','DPAD_DOWN','DPAD_LEFT','DPAD_RIGHT']);
export function deviceAlias(serial) { return createHash('sha256').update(serial).digest('hex').slice(0,12); }
export function contained(root, value) {
  const path=resolve(root,value), rel=relative(resolve(root),path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside allowed artifact directory');
  return path;
}
export function validateTool(name, args, { root, phoneSerial=process.env.JABTEMPO_PHONE_SERIAL }={}) {
  if(!ALLOWED_TOOLS.includes(name)) throw new Error('Tool outside JabTempo app scope');
  if(name==='mobile_list_available_devices') { if(Object.keys(args).length)throw new Error('Unexpected fields');return; }
  const serial=args.device;
  if(typeof serial!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(serial))throw new Error('Explicit safe device required');
  if(!/^emulator-\d+$/.test(serial)&&serial!==phoneSerial)throw new Error('Phone must match JABTEMPO_PHONE_SERIAL');
  const fields=['device'];
  if(['mobile_launch_app','mobile_terminate_app'].includes(name)) {
    fields.push('packageName'); if(!OWN_PACKAGES.includes(args.packageName))throw new Error('Only JabTempo packages allowed');
  }
  if(name==='mobile_press_button') {fields.push('button');if(!REMOTE_KEYS.includes(args.button))throw new Error('Button outside app navigation scope');}
  if(name==='mobile_save_screenshot') {fields.push('saveTo');if(typeof args.saveTo!=='string'||!args.saveTo.endsWith('.png'))throw new Error('PNG path required');contained(resolve(root,'local_private/device_lab'),args.saveTo);}
  if(Object.keys(args).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(args,k)))throw new Error('Unexpected or missing fields');
}
export function allowedCameraUrl(value) {
  const url=new URL(value);
  const host=url.hostname;
  const lan=/^10\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['localhost','127.0.0.1'].includes(host)&&!lan||url.port!=='8787'||!['/dev-cam','/phone'].includes(url.pathname)||url.search||url.hash)throw new Error('Only local JabTempo camera URL allowed');
  return url.href;
}
