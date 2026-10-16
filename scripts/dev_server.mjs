import { createReadStream, existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRelay } from '../packages/tv-pose-bridge/src/relay.js';
export async function startDevServer(options={}) {
const root=resolve(options.root??'.');
let tls;
if(process.env.JABTEMPO_TLS_PFX){
  const pfxPath=realpathSync(resolve(root,process.env.JABTEMPO_TLS_PFX)),workspacePath=relative(realpathSync(root),pfxPath);
  if(workspacePath.startsWith('..')||isAbsolute(workspacePath)||!['.p12','.pfx'].includes(extname(pfxPath).toLowerCase()))throw new Error('Development TLS PFX must be a workspace-local PKCS12 file.');
  if(!process.env.JABTEMPO_TLS_PASSWORD)throw new Error('Set JABTEMPO_TLS_PASSWORD in this shell without writing it to Git.');
  tls={pfx:readFileSync(pfxPath),passphrase:process.env.JABTEMPO_TLS_PASSWORD,minVersion:'TLSv1.2'};
}
const protocol=tls?'https':'http',socketProtocol=tls?'wss':'ws',port=Number(options.port??process.env.JABTEMPO_PORT??8787);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('JABTEMPO_PORT must be 0..65535; zero chooses an isolated lab port.');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.wasm':'application/wasm','.task':'application/octet-stream','.wav':'audio/wav','.json':'application/json','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.gz':'application/gzip'};
const relay=await createRelay({host:options.host??process.env.JABTEMPO_HOST??'127.0.0.1',port,tls,advertisedUrl:process.env.JABTEMPO_PUBLIC_RELAY_URL,httpHandler(req,res){
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health')return false;
  let file;
  if(path==='/dev-cam'||path==='/phone') file='apps/dev-web/camera.html';
  else if(path==='/play-guide') file='apps/dev-web/play-guide.html';
  else if(path==='/assets/play-guide.css') file='apps/dev-web/play-guide.css';
  else if(/^\/guide-images\/(Home|Pair|HowToPlay|Tutorial-ready|Calibrate|Calibrate-count-in|Calibrate-live|Round-live|Summary)\.png$/.test(path)) file='results/tv-web/'+path.split('/').at(-1);
  else if(path==='/guide-images/phone_setup.png') file='docs/images/phone_setup.png';
  else if(path==='/guide-images/punch_steps.svg') file='docs/images/punch_steps.svg';
  else if(path==='/tv-web'||path==='/tv-web/') file='.cache/tv-web/index.html';
  else if(path==='/dev-check') file='apps/dev-web/check.html';
  else if(path==='/assets/worker-check.js') file='apps/dev-web/worker-check.js';
  else if(path==='/') file='.cache/tv-web/index.html';
  else if(path==='/dev-tv') file='apps/dev-web/tv.html';
  else if(path==='/assets/style.css') file='apps/dev-web/style.css';
  else if(/^\/assets\/(camera|tv|pose-worker|voice-worker)\.js(\.map)?$/.test(path)) file='.cache/web/'+path.split('/').at(-1);
  else if(/^\/assets\/(chunk|vosk)-[A-Z0-9]+\.js(\.map)?$/.test(path)) file='.cache/web/'+path.split('/').at(-1);
  else if(/^\/assets\/vision-wasm\/vision_wasm_(internal|nosimd_internal)\.(js|wasm)$/.test(path)) file='node_modules/@mediapipe/tasks-vision/wasm/'+path.split('/').at(-1);
  else if(path==='/assets/models/voice-en.tar.gz') file='.cache/models/voice-en.tar.gz';
  else if(path==='/assets/models/pose_landmarker_full.task') file='.cache/models/pose_landmarker_full.task';
  else if(/^\/assets\/beats\/(90|110|130)\.wav$/.test(path)) file='.cache/beats/beat_'+path.split('/').at(-1);
  else if(path.startsWith('/_expo/')||path.startsWith('/assets/')){
    let decoded;try{decoded=decodeURIComponent(path);}catch{res.writeHead(400);res.end('Invalid asset path.');return true;}
    const exportRoot=resolve(root,'.cache/tv-web'),asset=resolve(exportRoot,'.'+decoded),inside=relative(exportRoot,asset);
    if(!inside.startsWith('..')&&!isAbsolute(inside)&&existsSync(asset)){
      const actual=realpathSync(asset),actualRelative=relative(realpathSync(exportRoot),actual);
      if(!actualRelative.startsWith('..')&&!isAbsolute(actualRelative))file=relative(root,actual);
    }
  }
  if(!file||!existsSync(resolve(root,file))){res.writeHead(404);res.end('Missing local asset. Run npm run setup:assets, npm run build:web and npm run build:tv-web.');return true;}
  res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const tvWeb=file.startsWith('.cache/tv-web');
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${file==='.cache/web/voice-worker.js'?" 'unsafe-eval'":''}; worker-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; style-src 'self'${tvWeb?" 'unsafe-inline'":''}; object-src 'none'; frame-ancestors 'none'`);
  if(file==='apps/dev-web/camera.html'){
    const selfTest=existsSync(resolve(root,'apps/dev-web/selftest.html'))?readFileSync(resolve(root,'apps/dev-web/selftest.html'),'utf8'):'';
    let html=readFileSync(resolve(root,file),'utf8');
    const recording=readFileSync(resolve(root,'apps/dev-web/recording.html'),'utf8');
    if(path==='/phone'){
      html=html.replace('JabTempo · Camera lab','JabTempo · Your camera').replace('JABTEMPO / LOCAL CAMERA LAB','JABTEMPO / YOUR CAMERA');
      html=html.replace('<section class="card"><h2>Consented keypoint recorder','<details class="card"><summary>Practice review and recording tools</summary>'+selfTest+'<section class="card"><h2>Consented keypoint recorder');
      html=html.replace('<a href="/dev-tv">',recording+'</details><a href="/tv-web">');
    }else html=html.replace('<a href="/dev-tv">',selfTest+recording+'<a href="/tv-web">');
    res.end(html);return true;
  }
  createReadStream(resolve(root,file)).pipe(res);return true;
}});
return {...relay,baseUrl:`${protocol}://127.0.0.1:${relay.server.address().port}`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
const relay=await startDevServer();
const port=relay.server.address().port,protocol=relay.baseUrl.startsWith('https:')?'https':'http',socketProtocol=protocol==='https'?'wss':'ws',tls=protocol==='https';
console.log(`JabTempo TV web preview: ${protocol}://localhost:${port}/tv-web · camera: ${protocol}://localhost:${port}/phone`);
if(!tls)console.log('Localhost links work on the laptop. iPhone needs same-Wi-Fi HTTPS setup: docs/how_to_play.md (npm run dev:iphone). Copying this link to an unconnected phone will not work.');
if(tls)console.log('Development HTTPS enabled. Browser/phone certificate trust is still a human step; no security bypass is configured.');
if(process.env.JABTEMPO_PUBLIC_RELAY_URL)console.log('Pairing uses the explicitly configured public relay URL.');
if(process.env.JABTEMPO_HOST==='0.0.0.0')for(const list of Object.values(networkInterfaces())) for(const entry of list??[]) if(entry.family==='IPv4'&&!entry.internal) console.log(`LAN relay: ${socketProtocol}://${entry.address}:${port}/bridge (optional LAN; deferred after M5)`);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await relay.close();process.exit(0);});
}
