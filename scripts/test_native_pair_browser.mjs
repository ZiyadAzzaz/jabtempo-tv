/** Desktop browser UI to actual native emulator through the trusted local relay. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import https from 'node:https';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WebSocket,WebSocketServer} from 'ws';
import {adbPath} from '../tools/mobile-mcp/device-guard.mjs';

if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
process.env.PLAYWRIGHT_BROWSERS_PATH??=`${process.env.CONDA_PREFIX}/playwright-browsers`;
const {chromium}=await import('playwright');
const host=process.env.JABTEMPO_NATIVE_PAIR_HOST,caFile=process.env.JABTEMPO_NATIVE_PAIR_CA;
if(!/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host??'')||!caFile)throw Error('Set JABTEMPO_NATIVE_PAIR_HOST to current private Wi-Fi IP and JABTEMPO_NATIVE_PAIR_CA to public root certificate.');
const ca=new X509Certificate(readFileSync(caFile)).toString(),adb=adbPath(),run=promisify(execFile),serial='emulator-5580';
const report={status:'FAIL',setup:'desktop Chromium phone UI over loopback proxy; real native Android TV emulator; upstream HTTPS certificate validated',physicalPhoneVerified:false,cameraVerified:false,commands:[],ws:{upgrades:0,opened:0,upstreamMessages:0,errors:[]},errors:[]};
let browser,server,page;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(...args){return (await run(adb,['-s',serial,...args],{timeout:25000,windowsHide:true,maxBuffer:5e6})).stdout;}
async function tree(){const dumped=await command('shell','uiautomator','dump','/sdcard/jabtempo-pair-browser.xml');assert.match(dumped,/dumped to:/);return command('exec-out','cat','/sdcard/jabtempo-pair-browser.xml');}
async function until(check,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await wait(300);}throw Error(`Timed out: ${label}`);}
try{
  if((await command('get-state')).trim()!=='device')throw Error('TV emulator is unavailable.');
  await command('shell','am','force-stop','org.jabtempo.tv');
  await command('shell','am','start','-W','-n','org.jabtempo.tv/.MainActivity');
  await wait(1500);
  const focus=await command('shell','dumpsys','window');
  assert(focus.split('\n').some(line=>line.includes('mCurrentFocus=')&&line.includes('org.jabtempo.tv/')),'JabTempo is not the native foreground activity.');
  let xml=await tree();
  if(xml.includes('Learn left and right.')){await command('shell','input','keyevent','KEYCODE_BACK');xml=await tree();}
  assert.match(xml,/Your moves\. Your rhythm\./);
  await command('shell','input','tap','150','720');
  xml=await until(async()=>{const current=await tree();return current.includes('Bring your camera.')?current:false;},'TV Pair');
  const code=xml.match(/text="(\d{4})"/)?.[1];assert(code,'No TV pairing code.');
  const wss=new WebSocketServer({noServer:true});
  server=createServer((request,response)=>{
    const upstream=https.request({hostname:host,port:8787,path:request.url,method:request.method,ca,rejectUnauthorized:true},remote=>{
      response.writeHead(remote.statusCode??502,remote.headers);remote.pipe(response);
    });
    upstream.on('error',error=>{response.writeHead(502);response.end(error.message);});upstream.end();
  });
  server.on('upgrade',(request,socket,head)=>{
    if(request.url!=='/bridge'){socket.destroy();return;}
    report.ws.upgrades++;
    wss.handleUpgrade(request,socket,head,down=>{
      const up=new WebSocket('ws://127.0.0.1:8789/bridge');
      const queue=[];
      up.on('open',()=>{report.ws.opened++;for(const item of queue)up.send(item,{binary:false});});
      down.on('message',data=>{if(up.readyState===WebSocket.OPEN)up.send(data,{binary:false});else if(queue.length<8)queue.push(data);else down.close(1013);});
      up.on('message',data=>{report.ws.upstreamMessages++;if(down.readyState===WebSocket.OPEN)down.send(data,{binary:false});});
      down.on('close',()=>up.close());up.on('close',()=>down.close());
      down.on('error',error=>{report.ws.errors.push(`browser: ${error.message}`);up.terminate();});up.on('error',error=>{report.ws.errors.push(`upstream: ${error.message}`);down.terminate();});
    });
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  browser=await chromium.launch({channel:'chromium',headless:true});
  page=await browser.newPage({viewport:{width:390,height:844}});const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('requestfailed',request=>report.errors.push(`request ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/phone`);
  assert.equal(await page.locator('#video').evaluate(video=>video.srcObject),null);
  await page.locator('#code').fill(code);await page.locator('#connect').click();
  await page.waitForFunction(()=>document.querySelector('#pair-status').textContent.includes('TV connected'));
  report.commands.push('Connect to TV without camera');
  assert.equal(await page.locator('#video').evaluate(video=>video.srcObject),null);
  mkdirSync('results/dev_preview',{recursive:true});
  await page.screenshot({path:'results/dev_preview/phone-paired-native.png',fullPage:true});
  await page.locator('[data-command="two players"]').click();
  await until(async()=>{const current=await tree();return current.includes('A little friendly competition.')?current:false;},'native Family after phone command');
  report.commands.push('Two Players opens native Family');
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Phone UI overflows the 390px viewport.');
  assert.deepEqual(pageErrors,[]);
  await page.locator('#stop').click();
  await page.waitForFunction(()=>document.querySelector('#pair-status').textContent.includes('disconnected'));
  report.commands.push('Stop disconnects');
  report.status='PASS';
}catch(error){report.errors.push(error.stack??error.message);if(page){report.phoneStatus=await page.locator('#pair-status').innerText().catch(()=>null);report.cameraStatus=await page.locator('#status').innerText().catch(()=>null);}process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server?.close(resolve)??resolve());mkdirSync('results/native',{recursive:true});writeFileSync('results/native/browser_to_native_pair.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
