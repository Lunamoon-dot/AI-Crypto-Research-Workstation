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
  assert.equal(source.includes("label: 'interrupted'"), true);
  assert.equal(source.includes('Interrupted before completion'), true);
  assert.equal(source.includes("label: 'blocked'"), true);
  assert.equal(source.includes('Blocked by upstream failure'), true);
  assert.equal(source.includes('Not reached before run failed'), false);
});

test('research workflow surfaces scenario planner scope', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ResearchRunWorkspacePage.tsx', import.meta.url),
    'utf8',
  );
  const workflowSource = readFileSync(
    new URL('../src/components/research/workflow-visualization.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('scenario planning'), true);
  assert.equal(pageSource.includes('Scenario map persisted (max 4)'), true);
  assert.equal(workflowSource.includes("return 'scenario agent'"), true);
});

test('workflow visualization styles blocked stages distinctly from missing output', () => {
  const source = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('.workflow-connector-blocked,'), true);
  assert.equal(source.includes('.workflow-connector-interrupted,'), true);
  assert.equal(source.includes('.workflow-state-blocked,'), true);
  assert.equal(source.includes('.workflow-state-interrupted,'), true);
});

test('workflow chart keeps top padding inside its scroll viewport', () => {
  const source = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('overflow-y: clip;'), true);
  assert.equal(source.includes('scroll-padding: 24px 14px 22px;'), true);
  assert.equal(source.includes('padding: 34px 32px 38px;'), true);
});

test('workflow merge connector does not inherit failure from the next sequential stage', () => {
  const source = readFileSync(
    new URL('../src/components/research/workflow-visualization.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("const mergeConnectorState = firstSequentialStage?.statusLabel ?? 'pending';"), false);
  assert.equal(source.includes('const mergeConnectorState = groupConnectorState(analystStages);'), true);
});
