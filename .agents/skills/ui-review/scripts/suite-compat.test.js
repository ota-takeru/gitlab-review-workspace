#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(skillRoot, '..', '..');
const reviewSkill = path.join(skillRoot, 'ui-review');
const feelSkill = path.join(skillRoot, 'ui-feel-review');
const iterateSkill = path.join(skillRoot, 'ui-feel-iterate');
const resolver = path.join(reviewSkill, 'scripts', 'resolve-profile.js');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

function runResolver(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.stderr, '');
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  return { result, output: JSON.parse(result.stdout) };
}

test('current project profile preserves every existing review axis, gate, adapter, and validation command', () => {
  const { result, output } = runResolver(resolver, ['--root', repoRoot, '--require-implementation']);
  assert.equal(result.status, 0);
  assert.equal(output.compatibilityMode, 'preferred');

  assert.deepEqual(
    output.profile.evaluation.axes.map(({ id, weight }) => [id, weight]),
    [
      ['primary_task_clarity', 15],
      ['review_context_continuity', 15],
      ['workflow_efficiency', 10],
      ['state_feedback_and_recovery', 10],
      ['visual_hierarchy_and_composition', 15],
      ['typography_spacing_and_density', 10],
      ['color_surface_and_component_coherence', 10],
      ['keyboard_and_accessibility', 10],
      ['gitlab_and_vscode_fit', 5],
    ],
  );
  assert.deepEqual(
    output.profile.evaluation.hard_gates.map(({ id }) => id),
    [
      'keyboard_completion',
      'visible_focus',
      'non_color_state',
      'destructive_recovery',
      'required_state_evidence',
      'credential_safety',
    ],
  );
  assert.deepEqual(Object.keys(output.profile.adapters), [
    'storybook',
    'playwright',
    'vscode_webview',
    'vscode_extension_host',
  ]);
  assert.deepEqual(output.profile.implementation.source_roots, ['src', 'webview']);
  assert.deepEqual(output.profile.implementation.generated_paths, ['out', 'media/webview']);
  assert.deepEqual(
    output.profile.validation.commands.map(({ id, argv }) => [id, argv]),
    [
      ['check', ['npm', 'run', 'check']],
      ['storybook_test', ['npm', 'run', 'test:storybook']],
      ['storybook_build', ['npm', 'run', 'build:storybook']],
      ['full_test', ['npm', 'test']],
    ],
  );
  assert.equal(output.profile.domain.report_keys.host_fit_dimension, 'vscode_host_fit');
});

test('the reusable profile template validates for implementation mode', () => {
  const template = path.join(reviewSkill, 'assets', 'UI_PROJECT_PROFILE.template.yaml');
  const { result, output } = runResolver(resolver, ['--root', repoRoot, '--profile', template, '--require-implementation']);
  assert.equal(result.status, 0);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.profile.evaluation.axes.length, 9);
});

test('feel review retains repeated phases and action-result continuity safeguards', () => {
  const combined = [
    read(feelSkill, 'SKILL.md'),
    read(feelSkill, 'references', 'evidence-protocol.md'),
    read(feelSkill, 'references', 'experience-vocabulary.md'),
    read(feelSkill, 'assets', 'UI_FEEL_REVIEW.template.yaml'),
  ].join('\n');

  for (const token of [
    'orient_predict',
    'acknowledgement',
    'next_action_recovery',
    'action_result_continuity',
    'action_result_linkage',
    'semantic_identity',
    'visual_correspondence',
    'spatial_disconnect',
    'not_assessable',
  ]) {
    assert.match(combined, new RegExp(token));
  }
  const template = read(feelSkill, 'assets', 'UI_FEEL_REVIEW.template.yaml');
  assert.equal((template.match(/status: "unanswered"/g) || []).length, 3);
});

test('iteration retains authorization, same-condition proof, policy drift, and independent review gates', () => {
  const combined = [
    read(iterateSkill, 'SKILL.md'),
    read(iterateSkill, 'references', 'iteration-protocol.md'),
    read(iterateSkill, 'assets', 'UI_FEEL_ITERATION.template.yaml'),
  ].join('\n');

  for (const token of [
    'authorization',
    'fingerprint',
    'same condition',
    'pending_independent_review',
    'independent_ui_feel_review',
    'generated_paths',
    'validation.commands',
    'legacy_report_without_policy_fingerprint',
  ]) {
    assert.match(combined.toLowerCase(), new RegExp(token.toLowerCase().replace('.', '\\.')));
  }
});

test('suite resolver entry points return the same project fingerprint', () => {
  const scripts = [
    resolver,
    path.join(feelSkill, 'scripts', 'resolve-profile.js'),
    path.join(iterateSkill, 'scripts', 'resolve-profile.js'),
  ];
  const fingerprints = scripts.map((script) => {
    const { result, output } = runResolver(script, ['--root', repoRoot]);
    assert.equal(result.status, 0);
    return output.fingerprint;
  });
  assert.equal(new Set(fingerprints).size, 1);
});

test('skill trigger metadata is product-generic and names each skill explicitly', () => {
  const cases = [
    [reviewSkill, '$ui-review'],
    [feelSkill, '$ui-feel-review'],
    [iterateSkill, '$ui-feel-iterate'],
  ];
  for (const [directory, invocation] of cases) {
    const skill = read(directory, 'SKILL.md').split('---', 3)[1];
    assert.doesNotMatch(skill, /GitLab|VS Code|Pajamas|Webview|Storybook/);
    const metadata = read(directory, 'agents', 'openai.yaml');
    assert.match(metadata, new RegExp(invocation.replace('$', '\\$')));
  }
});

test('review verdict cannot invent a weighted-score failure threshold', () => {
  const combined = [read(reviewSkill, 'SKILL.md'), read(reviewSkill, 'references', 'rubric.md')].join('\n');
  assert.match(combined, /fail.*configured hard gate/is);
  assert.match(combined, /never invent a score threshold|not an implicit fail threshold/is);
  assert.match(combined, /not_observed.*not.*fail/is);
});
