#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const auditor = path.join(__dirname, 'audit-manifest.js');

function runAudit(manifest) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-review-audit-'));
  const manifestPath = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest), 'utf8');
  const result = spawnSync(process.execPath, [auditor, '--manifest', manifestPath], {
    encoding: 'utf8',
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

function parseOutput(result) {
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('constrained long content is high volume but not pressure', () => {
  const result = runAudit({
    cases: [
      { id: 'compact-long-dark', state: 'constrained-long-content', theme: 'dark', viewport: '320x844' },
      { id: 'compact-long-light', state: 'constrained-long-content', theme: 'light', viewport: '320x844' },
    ],
  });
  const audit = parseOutput(result);

  assert.equal(result.status, 0);
  assert.equal(audit.coverage.constrained.status, 'complete');
  assert.equal(audit.coverage.pressure.status, 'missing');
  assert.deepEqual(audit.cases[0].lanes, ['constrained']);
  assert.equal(audit.cases[0].stateVector.contentVolume, 'high');
});

test('explicit pressure lane remains authoritative', () => {
  const result = runAudit({
    cases: [
      { id: 'stress-dark', state: 'ordinary', evidenceLane: 'pressure', theme: 'dark', viewport: '800x700' },
      { id: 'stress-light', state: 'ordinary', evidenceLane: 'pressure', theme: 'light', viewport: '800x700' },
    ],
  });
  const audit = parseOutput(result);

  assert.equal(result.status, 0);
  assert.equal(audit.coverage.pressure.status, 'complete');
  assert.equal(audit.inference.lane.explicit, 2);
  assert.ok(audit.cases.every((item) => item.laneSource === 'explicit'));
});

test('missing pressure coverage is valid audit output', () => {
  const result = runAudit({
    cases: [
      { id: 'ready-dark', state: 'ready', theme: 'dark', viewport: '400x900' },
      { id: 'ready-light', state: 'ready', theme: 'light', viewport: '400x900' },
    ],
  });
  const audit = parseOutput(result);

  assert.equal(result.status, 0);
  assert.equal(audit.coverage.pressure.status, 'missing');
});

test('invalid manifest exits nonzero with JSON error', () => {
  const result = runAudit('{ invalid json');
  const audit = parseOutput(result);

  assert.notEqual(result.status, 0);
  assert.match(audit.error, /^manifest is not valid JSON:/);
});
