// HTTP/bundle verification only. Does not open a camera or establish phone/device performance.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
const paths=['/health','/dev-tv','/dev-cam','/assets/style.css','/assets/camera.js','/assets/tv.js','/assets/pose-worker.js','/assets/vision-wasm/vision_wasm_internal.js','/assets/vision-wasm/vision_wasm_internal.wasm','/assets/models/pose_landmarker_full.task','/assets/beats/110.wav'];
const evidence=[];
for(const path of paths){const r=await fetch('http://localhost:8787'+path);assert.equal(r.status,200,path);const bytes=(await r.arrayBuffer()).byteLength;assert.ok(bytes>0);evidence.push({path,status:r.status,bytes});}
for(const path of ['/assets/../../package.json','/assets/models/not-allowed.task','/data/private/session.jsonl'])assert.equal((await fetch('http://localhost:8787'+path)).status,404);
mkdirSync('results',{recursive:true});writeFileSync('results/web_http_check.json',JSON.stringify({measuredSetup:'localhost-http-assets-only',createdAt:new Date().toISOString(),cameraOpened:false,checks:evidence},null,2)+'\n');console.log('11 local HTTP assets verified; unknown/private routes rejected. Camera remains off.');
