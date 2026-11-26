/**
 * `pnpm eval:agents [--json] [--no-fail]` — agent replay scenario gate.
 *
 * Runs 12–15 commerce scenarios through the real LangGraph router/specialists
 * with deterministic model steps and a fake tool registry. No keys, no network.
 * Results are written to `evals/results/agents.json` for CI (PLAN §10.5).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { agentDatasetSchema, replayModelCall, runAgentEval } from '../src/evals/agents.eval';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  const candidates = [
    path.resolve(process.cwd(), '../../evals/agents/scenarios.json'),
    path.resolve(process.cwd(), 'evals/agents/scenarios.json'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Agent dataset not found. Looked in: ${candidates.join(', ')}`);
  const dataset = agentDatasetSchema.parse(JSON.parse(fs.readFileSync(found, 'utf8')) as unknown);
  const result = await runAgentEval(dataset, { modelCallFor: replayModelCall });
  const output = { datasetVersion: 1, result, passed: result.passed };

  const outputPath = path.resolve(process.cwd(), '../../evals/results/agents.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('Agent eval (replay harness, offline)\n');
    console.log(`scenarios: ${result.cases}`);
    console.log(`accuracy: ${(result.metrics.accuracy * 100).toFixed(1)}%`);
    console.log(`failures: ${result.failures.join(', ') || 'none'}`);
    console.log(`results written to ${outputPath}`);
    console.log(`\n${result.passed ? 'PASS' : 'FAIL'}`);
  }

  if (!result.passed && !process.argv.includes('--no-fail')) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('Agent eval failed:', error);
  process.exit(1);
});
