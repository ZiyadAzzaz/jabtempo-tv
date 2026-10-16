import { build } from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
// Serve Vosk's pinned embedded worker as a separate local asset. Its Emscripten binding
// generator needs JS eval; isolate that permission to the worker, never the controller page.
const localVoskWorker={name:'local-vosk-worker',setup(builder){builder.onLoad({filter:/vosk-browser[\\/]dist[\\/]vosk\.js$/},async({path})=>{
  const runtime=await readFile(path,'utf8');
  const match=runtime.match(/var WorkerFactory = createBase64WorkerFactory\('([^']+)'[^;]*;/);
  if(!match)throw Error('Pinned Vosk worker format changed; review before building.');
  await mkdir('.cache/web',{recursive:true});
  let worker=Buffer.from(match[1],'base64').toString('utf8');
  // Keep model files in worker memory: Safari/private browsing need not provide IndexedDB.
  worker=worker.replace('this.Vosk.FS.mount(this.Vosk.IDBFS, {}, storagePath);','').replace(/this\.Vosk\.syncFilesystem\((true|false)\)/g,'Promise.resolve()');
  await writeFile('.cache/web/voice-worker.js',worker);
  return {contents:runtime.replace(match[0],'var WorkerFactory = function(options) { return new Worker("/assets/voice-worker.js", options); };'),loader:'js'};
});}};
await build({entryPoints:['apps/dev-web/src/camera.ts','apps/dev-web/src/tv.ts'],outdir:'.cache/web',bundle:true,splitting:true,plugins:[localVoskWorker],format:'esm',platform:'browser',target:'es2022',sourcemap:true});
await build({entryPoints:['apps/dev-web/src/pose-worker.ts'],outdir:'.cache/web',bundle:true,format:'iife',platform:'browser',target:'es2022',sourcemap:true});
console.log('Local camera and TV preview built.');
