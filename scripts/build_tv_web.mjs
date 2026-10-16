import {spawnSync} from 'node:child_process';
import {existsSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
const root=resolve('.'),app=resolve(root,'apps/tv'),cli=resolve(app,'node_modules/expo/bin/cli');
if(!existsSync(cli))throw Error('Install TV dependencies first: conda activate amazon-tv; cd apps/tv; yarn install.');
const output=resolve(root,'.cache/tv-web'),staging=resolve(root,'.cache/tv-web-build');
const run=spawnSync(process.execPath,[cli,'export','--platform','web','--max-workers','1','--output-dir',staging],
  {cwd:app,stdio:'inherit',env:{...process.env,EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1'}});
process.exitCode=run.status??1;
// Preserve the playable app while Metro builds; publish only a complete successful export.
if(run.status===0&&existsSync(resolve(staging,'index.html'))){
  if(existsSync(output))renameSync(output,resolve(root,`.cache/tv-web.previous-${Date.now()}`));
  renameSync(staging,output);
}else if(run.status===0){process.exitCode=1;console.error('Export had no index.html; previous TV preview preserved.');}
