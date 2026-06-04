import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('workflow analyst metadata keeps duration and completion time readable', () => {
  const css = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );

  assert.equal(css.includes('.workflow-node-analyst .workflow-node-meta'), true);
  assert.equal(css.includes('grid-template-columns: max-content max-content;'), true);
  assert.equal(css.includes('.workflow-node-analyst .workflow-node-meta span:last-child'), true);
});

test('research workflow only marks explicitly failed nodes as failed', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunWorkspacePage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('if (failed || runFailed)'), false);
  assert.equal(source.includes('const failed = latestMatchingEvent'), true);
  assert.equal(source.includes('Interrupted before completion'), true);
  assert.equal(source.includes('Not reached before run failed'), true);
});
