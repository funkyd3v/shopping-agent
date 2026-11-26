/**
 * `pnpm eval:guardrails [--json] [--no-fail]` — local guardrail quality gate.
 *
 * Runs five dataset suites against the real production functions:
 * jailbreak, pii, redundancy, orders and cart. No network, no API keys, no
 * Chroma. Results are printed as a pass-rate table and written to
 * `evals/results/guardrails.json` for CI (PLAN §10.5).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { z } from 'zod';
import { validateEnv } from '../src/config/env';
import {
  cartDatasetSchema,
  EVAL_TARGETS,
  type EvalResult,
  jailbreakDatasetSchema,
  orderDatasetSchema,
  piiDatasetSchema,
  redundancyDatasetSchema,
  runCartEval,
  runJailbreakEval,
  runOrderEval,
  runPiiEval,
  runRedundancyEval,
  summarize,
} from '../src/evals/guardrails.eval';
import { detectJailbreak } from '../src/guardrails/jailbreak';
import { redactPii } from '../src/guardrails/pii';
import { detectRedundancy } from '../src/guardrails/redundancy';
import { evaluateOrder, orderLimits } from '../src/orders/order-limits';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function loadDataset<T>(file: string, schema: z.ZodType<T>): T {
  const candidates = [
    path.resolve(process.cwd(), '../../evals/guardrails', file),
    path.resolve(process.cwd(), 'evals/guardrails', file),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Eval dataset not found. Looked in: ${candidates.join(', ')}`);
  return schema.parse(JSON.parse(fs.readFileSync(found, 'utf8')) as unknown);
}

function metricText(result: EvalResult): string {
  return Object.entries(result.metrics)
    .map(([key, value]) =>
      key.includes('Rate') || key === 'accuracy'
        ? `${key}=${(value * 100).toFixed(1)}%`
        : `${key}=${value}`,
    )
    .join(' ');
}

function printTable(results: EvalResult[]): void {
  const rows = [
    ['category', 'cases', 'status', 'metrics', 'failures'],
    ...results.map((result) => [
      result.category,
      String(result.cases),
      result.passed ? 'PASS' : 'FAIL',
      metricText(result),
      result.failures.slice(0, 3).join(',') || '-',
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  for (const [index, row] of rows.entries()) {
    console.log(row.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  '));
    if (index === 0) console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  }
}

function main(): void {
  const json = process.argv.includes('--json');
  const env = validateEnv(process.env);

  const results: EvalResult[] = [
    runJailbreakEval(loadDataset('jailbreak.json', jailbreakDatasetSchema), detectJailbreak),
    runPiiEval(loadDataset('pii.json', piiDatasetSchema), redactPii),
    runRedundancyEval(loadDataset('redundancy.json', redundancyDatasetSchema), detectRedundancy),
    runOrderEval(loadDataset('orders.json', orderDatasetSchema), orderLimits(), evaluateOrder),
    runCartEval(loadDataset('cart.json', cartDatasetSchema), {
      maxLines: env.MAX_CART_LINES,
      maxQtyPerItem: env.MAX_QTY_PER_ITEM,
      maxOrderCents: env.MAX_ORDER_USD * 100,
    }),
  ];

  const summary = summarize(results);
  const output = {
    datasetVersion: 1,
    targets: EVAL_TARGETS,
    results,
    summary,
    passed: summary.allPassed,
  };

  const outputPath = path.resolve(process.cwd(), '../../evals/results/guardrails.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('Guardrail eval (production functions, offline)\n');
    printTable(results);
    console.log(
      `\ncategory pass-rate: ${(summary.passRate * 100).toFixed(1)}% (${results.filter((result) => result.passed).length}/${results.length})`,
    );
    console.log(`results written to ${outputPath}`);
    console.log(`\n${summary.allPassed ? 'PASS' : 'FAIL'}`);
  }

  if (!summary.allPassed && !process.argv.includes('--no-fail')) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error('Guardrail eval failed:', error);
  process.exit(1);
}
