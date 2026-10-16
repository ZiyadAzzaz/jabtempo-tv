import {readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):/\.test\.(js|ts)$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
const tests=walk('packages');
const coverage=process.argv.includes('--coverage');
const run=spawnSync(process.execPath,['--import','tsx','--test',...(coverage?['--experimental-test-coverage']:[]),...tests],{stdio:coverage?['inherit','pipe','pipe']:'inherit',encoding:'utf8',maxBuffer:10*1024*1024,env:{...process.env,...(coverage?{NODE_V8_COVERAGE:'.cache/coverage'}:{})}});
let thresholdPassed=true;
if(coverage){
  mkdirSync('results',{recursive:true});const log=(run.stdout??'')+(run.stderr??'');writeFileSync('results/core_test_coverage.txt',log);process.stdout.write(log);
  const files=[...log.matchAll(/^# (packages[^|]+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gm)].filter(m=>/[\\/]src[\\/]/.test(m[1])).map(m=>({file:m[1].trim().replaceAll('\\','/'),linePercent:Number(m[2]),branchPercent:Number(m[3]),functionPercent:Number(m[4])}));
  const sourceFiles=walkSources('packages');thresholdPassed=sourceFiles.every(file=>files.some(f=>f.file===file&&f.linePercent>=80));
  writeFileSync('results/core_coverage.json',JSON.stringify({measuredSetup:'Node20-unit-and-simulated-relay-integration',createdAt:new Date().toISOString(),metric:'Node experimental V8 test coverage with tsx source maps; per-source file line coverage',targetLinePercent:80,passed:run.status===0&&thresholdPassed,files},null,2)+'\n');
  if(!thresholdPassed)console.error('Missing source coverage or source line coverage below80%.');
}
// session.js only re-exports session.ts for Metro; it owns no executable logic.
function walkSources(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walkSources(`${dir}/${e.name}`):dir.includes('/src')&&/\.(js|ts)$/.test(e.name)&&!e.name.endsWith('.d.ts')&&!(dir==='packages/game/src'&&e.name==='session.js')?[`${dir}/${e.name}`]:[]);}
process.exit(run.status===0&&thresholdPassed?0:run.status||1);
