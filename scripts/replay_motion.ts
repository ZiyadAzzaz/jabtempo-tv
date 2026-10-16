import { readFileSync } from 'node:fs';
import { replayMotion } from '../packages/motion/src/index.js';
const [, , configJSON, ...files] = process.argv;
if (!configJSON || !files.length) throw new Error('Usage: node --import tsx scripts/replay_motion.ts configJSON session.jsonl ...');
const config = JSON.parse(configJSON);
for (const file of files) {
  const output = replayMotion(readFileSync(file, 'utf8'), { config });
  process.stdout.write(JSON.stringify({ file, events: output.flatMap(r => r.events), guardRecoveryMs: output.flatMap(r => r.guardRecoveryMs) }) + '\n');
}
