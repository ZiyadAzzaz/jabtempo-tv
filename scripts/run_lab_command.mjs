import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
const mode=process.argv[2],extra=process.argv.slice(3);
const specs={motion:{script:'eval_motion.py',input:'local_private/reviewed_dataset',reason:'Need independently reviewed recordings from three consented people, two sessions each.'},
  voice:{script:'eval_voice.py',input:'local_private/voice-evaluation/cases.csv',reason:'Need recorded recognition outcomes; synthetic generated speech is regression only.'},
  latency:{script:'summarize_latency.py',input:'local_private/latency.jsonl',reason:'Need real capture-to-render instrumentation exported by TV preview Settings. Choose the measured setup explicitly.'}};
const spec=specs[mode];if(!spec)throw Error('Unknown lab command.');
const args=extra.length?extra:[spec.input];
if(!existsSync(args[0])){
  const report={status:'PENDING',command:mode,gatePass:false,reason:spec.reason};
  mkdirSync('results',{recursive:true});writeFileSync(`results/${mode}_lab_pending.json`,JSON.stringify(report,null,2)+'\n');console.error(report.reason);process.exitCode=2;
}else{const run=spawnSync('python',[`scripts/${spec.script}`,...args],{stdio:'inherit'});process.exitCode=run.status??1;}
