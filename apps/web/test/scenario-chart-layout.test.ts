import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('scenario chart source has no execution action copy', () => {
  const checkedSources = [
    source('../src/components/scenarios/ScenarioChart.tsx'),
    source('../src/components/scenarios/scenario-chart-overlays.ts'),
    source('../src/services/scenario-chart.ts'),
  ];
  const forbidden = /\b(Buy|Sell|Place order|Submit order|Auto trade|Arm order)\b/;

  for (const checked of checkedSources) {
    assert.equal(forbidden.test(checked), false);
  }
});
