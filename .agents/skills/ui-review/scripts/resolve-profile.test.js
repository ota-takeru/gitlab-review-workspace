#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const resolverPath = path.join(__dirname, 'resolve-profile.js');
const projectProfilePath = path.resolve(__dirname, '../../../..', 'docs', 'ui', 'project-profile.yaml');

function makeRoot(prefix = 'ui-profile-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeProfile(root, relativePath, source) {
  const profilePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, source, 'utf8');
  return profilePath;
}

function runResolver(args, options = {}) {
  return spawnSync(process.execPath, [resolverPath, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
  });
}

function parseOutput(result) {
  assert.equal(result.stderr, '');
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  return JSON.parse(result.stdout);
}

function withTempRoot(callback) {
  const root = makeRoot();
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const preferredProfile = `schema_version: 1
contracts:
  visual_quality: docs/ui/visual-quality.md
  screen_briefs:
    - docs/ui/screens/sidebar-review.md
adapters:
  browser:
    type: playwright
    host: storybook
implementation:
  source_roots:
    - src
    - webview
  generated_paths:
    - out
validation:
  commands:
    - id: check
      condition: always
      argv: [npm, run, check]
evaluation:
  axes:
    - id: clarity
      weight: 60
    - id: recovery
      weight: 40
  hard_gates:
    - id: focus
      fail_when: visible focus is missing
`;

test('discovery prefers explicit profile, then reusable profile, then legacy path', () => {
  withTempRoot((root) => {
    const explicitPath = writeProfile(root, 'custom/profile.yaml', 'schema_version: 1\n');
    const reusablePath = writeProfile(root, '.agents/ui/profile.yaml', 'schema_version: 1\n');
    const legacyPath = writeProfile(root, 'docs/ui/project-profile.yaml', 'version: 2\n');

    const explicit = runResolver(['--root', root, '--profile', explicitPath]);
    const explicitOutput = parseOutput(explicit);
    assert.equal(explicit.status, 0);
    assert.equal(explicitOutput.profilePath, path.resolve(explicitPath));
    assert.equal(explicitOutput.compatibilityMode, 'preferred');

    fs.unlinkSync(explicitPath);
    const reusable = runResolver(['--root', root]);
    const reusableOutput = parseOutput(reusable);
    assert.equal(reusable.status, 0);
    assert.equal(reusableOutput.profilePath, path.resolve(reusablePath));

    fs.unlinkSync(reusablePath);
    const legacy = runResolver(['--root', root]);
    const legacyOutput = parseOutput(legacy);
    assert.equal(legacy.status, 0);
    assert.equal(legacyOutput.profilePath, path.resolve(legacyPath));
    assert.equal(legacyOutput.schemaVersion, 2);
    assert.equal(legacyOutput.compatibilityMode, 'legacy_v2');
  });
});

test('a missing explicit candidate is authoritative and fails instead of selecting another policy', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', 'schema_version: 1\n');
    const result = runResolver(['--root', root, '--profile', 'missing.yaml']);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /profile path/);
  });
});

test('current project profile preserves configured axes, gates, and host-fit identity', () => {
  const result = runResolver(['--root', path.resolve(__dirname, '../../../..')]);
  const output = parseOutput(result);

  assert.equal(result.status, 0);
  assert.equal(output.found, true);
  assert.equal(output.profilePath, projectProfilePath);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.compatibilityMode, 'preferred');
  assert.deepEqual(output.profile.evaluation.score_range, [0, 4]);
  assert.equal(output.profile.evaluation.axes.length, 9);
  assert.equal(output.profile.evaluation.axes.find((axis) => axis.id === 'gitlab_and_vscode_fit').weight, 5);
  assert.equal(output.profile.evaluation.hard_gates.length, 6);
  assert.equal(output.profile.domain.report_keys.host_fit_dimension, 'vscode_host_fit');
});

test('preferred schema parses mappings, sequences, scalars, and inline arrays', () => {
  withTempRoot((root) => {
    const profilePath = writeProfile(root, '.agents/ui/profile.yaml', preferredProfile);
    const result = runResolver(['--root', root, '--require-implementation']);
    const output = parseOutput(result);

    assert.equal(result.status, 0);
    assert.equal(output.profilePath, path.resolve(profilePath));
    assert.equal(output.schemaVersion, 1);
    assert.equal(output.compatibilityMode, 'preferred');
    assert.deepEqual(output.profile.validation.commands[0].argv, ['npm', 'run', 'check']);
    assert.deepEqual(output.profile.contracts.screen_briefs, ['docs/ui/screens/sidebar-review.md']);
    assert.equal(output.profile.adapters.browser.type, 'playwright');
  });
});

test('fingerprint is stable and is the SHA-256 digest of the profile bytes', () => {
  withTempRoot((root) => {
    const source = 'schema_version: 1\n';
    const profilePath = writeProfile(root, '.agents/ui/profile.yaml', source);
    const first = parseOutput(runResolver(['--root', root]));
    const second = parseOutput(runResolver(['--root', root]));
    const expected = crypto.createHash('sha256').update(Buffer.from(source)).digest('hex');

    assert.equal(first.fingerprint, expected);
    assert.equal(second.fingerprint, expected);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(first.profilePath, path.resolve(profilePath));
  });
});

test('invalid weights exit nonzero with a JSON error and no stack trace', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
evaluation:
  weights:
    clarity: 60
    recovery: 30
`);
    const result = runResolver(['--root', root]);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /weights must total 100/);
    assert.doesNotMatch(result.stdout, /ProfileError|at [^\n]+\(/);
  });
});

test('duplicate axis and hard-gate IDs are rejected', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
evaluation:
  axes:
    - id: clarity
      weight: 50
    - id: clarity
      weight: 50
  hard_gates:
    - id: focus
    - id: focus
`);
    const result = runResolver(['--root', root]);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /duplicate axis ID/);
  });
});

test('command argv must be a non-empty array of strings', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
validation:
  commands:
    - id: check
      argv: npm run check
`);
    const result = runResolver(['--root', root]);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /validation\.commands\[0\]\.argv must be an array of strings/);
  });
});

test('adapters must be mappings and contract paths must be strings or string collections', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
adapters: []
`);
    const result = runResolver(['--root', root]);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /adapters must be a mapping/);
  });

  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
contracts:
  visual_quality: 42
`);
    const result = runResolver(['--root', root]);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /contracts\.visual_quality must contain path strings/);
  });
});

test('missing profile is successful for review mode and required for implementation mode', () => {
  withTempRoot((root) => {
    const review = runResolver(['--root', root]);
    const reviewOutput = parseOutput(review);
    assert.equal(review.status, 0);
    assert.deepEqual(reviewOutput, {
      found: false,
      root: path.resolve(root),
      profilePath: null,
      path: null,
      fingerprint: null,
      schemaVersion: null,
      compatibilityMode: null,
      profile: null,
    });

    const implementation = runResolver(['--root', root, '--require-implementation']);
    const implementationOutput = parseOutput(implementation);
    assert.notEqual(implementation.status, 0);
    assert.equal(implementationOutput.found, false);
    assert.match(implementationOutput.error, /required for implementation/);
  });
});

test('required implementation mode rejects profiles without implementation requirements', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', 'schema_version: 1\n');
    const result = runResolver(['--root', root, '--require-implementation']);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /implementation is required/);
  });
});

test('required implementation mode requires validation commands', () => {
  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
implementation:
  source_roots: [src]
  generated_paths: [out]
`);
    const result = runResolver(['--root', root, '--require-implementation']);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /validation\.commands is required/);
  });
});

test('required implementation mode requires validation command IDs and conditions', () => {
  const implementation = `implementation:
  source_roots: [src]
  generated_paths: [out]
`;

  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
${implementation}validation:
  commands:
    - condition: always
      argv: [tool, check]
`);
    const result = runResolver(['--root', root, '--require-implementation']);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /validation\.commands\[0\]\.id is required/);
  });

  withTempRoot((root) => {
    writeProfile(root, '.agents/ui/profile.yaml', `schema_version: 1
${implementation}validation:
  commands:
    - id: check
      argv: [tool, check]
`);
    const result = runResolver(['--root', root, '--require-implementation']);
    const output = parseOutput(result);

    assert.notEqual(result.status, 0);
    assert.match(output.error, /validation\.commands\[0\]\.condition is required/);
  });
});
