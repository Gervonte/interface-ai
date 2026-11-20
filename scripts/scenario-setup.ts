import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ScenarioSchema, scenarioNames } from '../apps/demo-api/src/scenarios.js';
async function main() {
  const [name = 'baseline', delay = '1000', failures = '1'] = process.argv.slice(2).filter(value => value !== '--');
  if (name === '--list') { console.info(scenarioNames.join('\n')); return; }
  const scenario = ScenarioSchema.parse({ name, delayMs: Number(delay), failuresBeforeSuccess: Number(failures) });
  const directory = resolve(import.meta.dirname, '../apps/demo-api/runtime'); await mkdir(directory, { recursive:true, mode:0o700 });
  const temporary = resolve(directory, randomUUID()+'.json');
  await writeFile(temporary, JSON.stringify(scenario,null,2)+'\n', { mode:0o600,flag:'wx' }); await rename(temporary,resolve(directory,'scenario.json'));
  console.info('Scenario configured for NEW staff sessions: '+scenario.name+'. Existing browser sessions keep their setup.');
}
main().catch(()=>{console.error('Invalid scenario. Use pnpm demo:scenario --list, then NAME [DELAY_MS] [FAILURES_BEFORE_SUCCESS].');process.exitCode=1;});
