import test from 'node:test';import assert from 'node:assert/strict';
import {validateTool,allowedCameraUrl,deviceAlias} from './policy.mjs';
const options={root:process.cwd(),phoneSerial:'consented-test-phone'};
test('policy blocks cloud, personal apps, clipboard, arbitrary fields and unselected phones',()=>{
  assert.throws(()=>validateTool('mobile_allocate_remote_device',{},options));
  assert.throws(()=>validateTool('mobile_launch_app',{device:'emulator-5554',packageName:'com.personal.messages'},options));
  assert.throws(()=>validateTool('mobile_take_screenshot',{device:'another-phone'},options));
  assert.throws(()=>validateTool('mobile_press_button',{device:'consented-test-phone',button:'HOME'},options));
  assert.throws(()=>validateTool('mobile_press_button',{device:'emulator-5554',button:'DPAD_CENTER',extra:'raw'},options));
  validateTool('mobile_launch_app',{device:'emulator-5554',packageName:'org.jabtempo.tv'},options);
  validateTool('mobile_take_screenshot',{device:'consented-test-phone'},options);
});
test('camera URL is local owned endpoint only; logging aliases conceal serial',()=>{
  assert.equal(allowedCameraUrl('https://192.168.1.2:8787/dev-cam'),'https://192.168.1.2:8787/dev-cam');
  for(const url of ['https://example.com:8787/dev-cam','https://192.168.1.2:8787/messages','https://192.168.1.2:8787/dev-cam?token=secret'])assert.throws(()=>allowedCameraUrl(url));
  assert.equal(deviceAlias('consented-test-phone').length,12);assert.ok(!deviceAlias('consented-test-phone').includes('phone'));
});
