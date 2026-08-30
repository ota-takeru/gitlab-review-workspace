#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LANES = ['canonical', 'constrained', 'pressure'];

function fail(message, details) {
  const error = { error: message };
  if (details) error.details = details;
  process.stdout.write(`${JSON.stringify(error, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = { manifest: null, surface: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest' || arg === '-m') {
      if (args.manifest !== null || !argv[index + 1] || argv[index + 1].startsWith('-')) {
        throw new Error('--manifest requires one path');
      }
      args.manifest = argv[++index];
      continue;
    }
    if (arg === '--surface' || arg === '-s') {
      if (args.surface !== null || !argv[index + 1] || argv[index + 1].startsWith('-')) {
        throw new Error('--surface requires one name');
      }
      args.surface = argv[++index];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error('usage: node audit-manifest.js --manifest <path> [--surface <name>]');
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.manifest) throw new Error('--manifest is required');
  return args;
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readNested(caseItem, keys) {
  for (const key of keys) {
    if (caseItem[key] !== undefined && caseItem[key] !== null) return caseItem[key];
  }
  const metadata = asObject(caseItem.metadata);
  if (metadata) {
    for (const key of keys) {
      if (metadata[key] !== undefined && metadata[key] !== null) return metadata[key];
    }
  }
  return null;
}

function readStateValue(caseItem, keys) {
  const direct = readNested(caseItem, keys);
  if (direct !== null) return direct;
  for (const containerKey of ['stateVector', 'visualState', 'conditions']) {
    const container = readNested(caseItem, [containerKey]);
    if (!asObject(container)) continue;
    for (const key of keys) {
      if (container[key] !== undefined && container[key] !== null) return container[key];
    }
  }
  return null;
}

function normalizedTokens(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasPhrase(value, phrase) {
  return normalizedTokens(value).join('-').includes(phrase);
}

function normalizeLane(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  const aliases = {
    canonical: 'canonical',
    baseline: 'canonical',
    default: 'canonical',
    normal: 'canonical',
    initial: 'canonical',
    idle: 'canonical',
    ready: 'canonical',
    constrained: 'constrained',
    constraint: 'constrained',
    narrow: 'constrained',
    compact: 'constrained',
    mobile: 'constrained',
    'small-viewport': 'constrained',
    pressure: 'pressure',
    stressed: 'pressure',
    stress: 'pressure',
    'high-density': 'pressure',
    'high-pressure': 'pressure',
    'many-items': 'pressure',
    'large-dataset': 'pressure',
    overflow: 'pressure',
  };
  return aliases[token] || null;
}

function explicitLaneValue(caseItem) {
  return readNested(caseItem, [
    'evidenceLanes',
    'evidenceLane',
    'coverageLanes',
    'coverageLane',
    'coverage',
    'lane',
    'comparisonLane',
    'evidenceClass',
    'coverageClass',
    'evidenceType',
    'evidenceKind',
    'comparisonRole',
    'scenarioRole',
  ]);
}

function toLaneList(value) {
  if (Array.isArray(value)) return value.flatMap(toLaneList);
  if (asObject(value)) {
    const named = toLaneList(value.lane || value.lanes || value.kind || value.role);
    if (named.length > 0) return named;
    return LANES.filter((lane) => value[lane] === true);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[,+|]/)
    .map(normalizeLane)
    .filter(Boolean);
}

function inferLanes(caseItem) {
  const explicit = explicitLaneValue(caseItem);
  const explicitLanes = [...new Set(toLaneList(explicit))];
  if (explicitLanes.length > 0) {
    return { lanes: explicitLanes, source: 'explicit' };
  }

  const state = String(readStateValue(caseItem, ['state', 'variant', 'scenario']) || '');
  const tokens = normalizedTokens(state);
  const lanes = new Set();
  if (tokens.some((token) => ['canonical', 'baseline', 'default', 'normal', 'initial', 'idle', 'ready'].includes(token))) {
    lanes.add('canonical');
  }
  if (tokens.some((token) => ['constrained', 'constraint', 'narrow', 'compact', 'mobile'].includes(token)) || hasPhrase(state, 'small-viewport')) {
    lanes.add('constrained');
  }
  if (
    tokens.some((token) => ['pressure', 'stressed', 'stress', 'overflow'].includes(token)) ||
    hasPhrase(state, 'high-density') ||
    hasPhrase(state, 'high-pressure') ||
    hasPhrase(state, 'many-items') ||
    hasPhrase(state, 'large-dataset')
  ) {
    lanes.add('pressure');
  }
  return { lanes: [...lanes], source: lanes.size ? 'inferred' : 'unknown' };
}

function normalizeTheme(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'light') return 'light';
  if (token === 'dark') return 'dark';
  return null;
}

function inferTheme(caseItem) {
  const explicit = normalizeTheme(readStateValue(caseItem, ['theme', 'colorScheme']));
  if (explicit) return { theme: explicit, source: 'explicit' };
  const haystack = `${caseItem.id || ''} ${caseItem.file || ''}`.toLowerCase();
  const tokens = normalizedTokens(haystack);
  const matches = tokens.filter((token) => token === 'light' || token === 'dark');
  if (matches.length === 1) return { theme: matches[0], source: 'inferred' };
  return { theme: 'unknown', source: 'unknown' };
}

function normalizeViewport(value) {
  if (asObject(value)) {
    const width = Number(value.width);
    const height = Number(value.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height, label: `${width}x${height}` };
    }
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      return { width, height, label: `${width}x${height}` };
    }
  }
  return { width: null, height: null, label: 'unknown' };
}

function inferContentVolume(caseItem) {
  const explicit = String(readStateValue(caseItem, ['contentVolume', 'volume']) || '').toLowerCase();
  if (['low', 'medium', 'high'].includes(explicit)) return explicit;
  const state = String(readStateValue(caseItem, ['state', 'variant', 'scenario']) || '').toLowerCase();
  const tokens = normalizedTokens(state);
  if (
    tokens.some((token) => ['high', 'large', 'many', 'dense', 'long', 'overflow', 'pressure'].includes(token)) ||
    hasPhrase(state, 'long-content') ||
    hasPhrase(state, 'large-dataset')
  ) {
    return 'high';
  }
  return 'unknown';
}

function inferDisclosure(caseItem) {
  const explicit = String(readStateValue(caseItem, ['disclosure', 'disclosureState', 'expansion']) || '').toLowerCase();
  if (['collapsed', 'expanded', 'mixed'].includes(explicit)) return explicit;
  const state = String(readStateValue(caseItem, ['state', 'variant', 'scenario']) || '').toLowerCase();
  const tokens = normalizedTokens(state);
  if (tokens.some((token) => ['expanded', 'open'].includes(token))) return 'expanded';
  if (tokens.some((token) => ['collapsed', 'closed'].includes(token))) return 'collapsed';
  return 'unknown';
}

function inferWarningsErrors(caseItem) {
  const explicit = readStateValue(caseItem, ['warningsErrors', 'warnings', 'errors']);
  if (explicit !== null) {
    if (Array.isArray(explicit)) return explicit.map(String);
    if (typeof explicit === 'boolean') return explicit ? ['present'] : [];
    if (typeof explicit === 'string') return explicit.trim() ? [explicit.trim()] : [];
  }
  const state = String(readStateValue(caseItem, ['state', 'variant', 'scenario']) || '').toLowerCase();
  const tokens = normalizedTokens(state);
  if (tokens.some((token) => ['warning', 'warnings', 'error', 'errors', 'failed', 'failure'].includes(token))) {
    return ['inferred-visible-state'];
  }
  return ['unknown'];
}

function inferActiveStates(caseItem) {
  const explicit = readStateValue(caseItem, ['activeStates', 'simultaneousStates']);
  if (Array.isArray(explicit)) return explicit.map(String);
  if (typeof explicit === 'string' && explicit.trim()) return [explicit.trim()];
  const rawCount = readStateValue(caseItem, ['activeStateCount']);
  const count = Number(rawCount);
  if (rawCount !== null && Number.isInteger(count) && count >= 0) return [`count:${count}`];
  return ['unknown'];
}

function pairIdentity(caseItem) {
  const explicit = readNested(caseItem, ['pairId', 'scenarioId', 'comparisonId']);
  const story = readNested(caseItem, ['storyId', 'story']);
  const state = readStateValue(caseItem, ['state', 'variant', 'scenario']);
  const id = asNonEmptyString(explicit) || asNonEmptyString(story) || asNonEmptyString(state);
  if (id) return id;
  const rawId = String(caseItem.id || 'case');
  const withoutTheme = rawId.replace(/(?:^|[-_])(light|dark)(?=$|[-_])/gi, '');
  return withoutTheme || rawId;
}

function prepareCase(caseItem, index) {
  const id = asNonEmptyString(caseItem.id);
  const surface = asNonEmptyString(readNested(caseItem, ['surface'])) || 'unknown';
  const laneInfo = inferLanes(caseItem);
  const themeInfo = inferTheme(caseItem);
  const viewport = normalizeViewport(readStateValue(caseItem, ['viewport']));
  const pairId = pairIdentity(caseItem);
  const laneKey = laneInfo.lanes.length ? laneInfo.lanes.join('+') : 'unknown';
  return {
    id,
    index,
    surface,
    state: asNonEmptyString(readStateValue(caseItem, ['state', 'variant', 'scenario'])) || 'unknown',
    lanes: laneInfo.lanes,
    laneSource: laneInfo.source,
    theme: themeInfo.theme,
    themeSource: themeInfo.source,
    viewport: viewport.label,
    pairKey: `${pairId}|${laneKey}|${viewport.label}`,
    stateVector: {
      contentVolume: inferContentVolume(caseItem),
      activeStates: inferActiveStates(caseItem),
      disclosure: inferDisclosure(caseItem),
      warningsErrors: inferWarningsErrors(caseItem),
      viewport: viewport.label,
      theme: themeInfo.theme,
    },
  };
}

function statusFor(cases, pairs) {
  if (cases.length === 0) return 'missing';
  return pairs > 0 ? 'complete' : 'partial';
}

function pairGroups(cases) {
  const groups = new Map();
  for (const item of cases) {
    if (!groups.has(item.pairKey)) groups.set(item.pairKey, { cases: [], themes: new Set() });
    const group = groups.get(item.pairKey);
    group.cases.push(item.id);
    if (item.theme === 'light' || item.theme === 'dark') group.themes.add(item.theme);
  }
  return [...groups.entries()].map(([key, value]) => ({
    key,
    cases: value.cases,
    themes: [...value.themes].sort(),
    paired: value.themes.has('light') && value.themes.has('dark'),
  }));
}

function buildCoverage(cases) {
  const coverage = {};
  for (const lane of LANES) {
    const laneCases = cases.filter((item) => item.lanes.includes(lane));
    const pairs = pairGroups(laneCases).filter((group) => group.paired);
    coverage[lane] = {
      status: statusFor(laneCases, pairs.length),
      count: laneCases.length,
      cases: laneCases.map((item) => item.id),
      pairedCaseGroups: pairs.map((group) => group.cases),
    };
  }
  const allPairs = pairGroups(cases);
  const knownThemeCases = cases.filter((item) => item.theme === 'light' || item.theme === 'dark');
  const pairedGroups = allPairs.filter((group) => group.paired);
  return {
    ...coverage,
    themePair: {
      status: statusFor(knownThemeCases, pairedGroups.length),
      knownThemeCaseCount: knownThemeCases.length,
      pairedGroupCount: pairedGroups.length,
      pairs: pairedGroups,
      unpaired: allPairs.filter((group) => !group.paired),
    },
  };
}

function audit(manifestPath, surface) {
  let source;
  try {
    source = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read manifest: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`manifest is not valid JSON: ${error.message}`);
  }
  if (!asObject(manifest) || !Array.isArray(manifest.cases)) {
    throw new Error('manifest must be an object with a cases array');
  }
  const prepared = manifest.cases.map((item, index) => {
    if (!asObject(item)) throw new Error(`case ${index} must be an object`);
    if (!asNonEmptyString(item.id)) throw new Error(`case ${index} must have a non-empty id`);
    return prepareCase(item, index);
  });
  const selected = surface === null ? prepared : prepared.filter((item) => item.surface === surface);
  const surfaces = [...new Set(prepared.map((item) => item.surface))].sort();
  const explicitLaneCases = selected.filter((item) => item.laneSource === 'explicit').length;
  const inferredLaneCases = selected.filter((item) => item.laneSource === 'inferred').length;
  const unknownLaneCases = selected.filter((item) => item.laneSource === 'unknown').length;
  const explicitThemeCases = selected.filter((item) => item.themeSource === 'explicit').length;
  const inferredThemeCases = selected.filter((item) => item.themeSource === 'inferred').length;
  const unknownThemeCases = selected.filter((item) => item.themeSource === 'unknown').length;
  const result = {
    manifest: path.resolve(manifestPath),
    surface: surface === null ? null : surface,
    availableSurfaces: surfaces,
    caseCount: selected.length,
    coverage: buildCoverage(selected),
    inference: {
      lane: { explicit: explicitLaneCases, inferred: inferredLaneCases, unknown: unknownLaneCases },
      theme: { explicit: explicitThemeCases, inferred: inferredThemeCases, unknown: unknownThemeCases },
    },
    cases: selected.map((item) => ({
      id: item.id,
      surface: item.surface,
      state: item.state,
      lanes: item.lanes,
      laneSource: item.laneSource,
      theme: item.theme,
      themeSource: item.themeSource,
      viewport: item.viewport,
      pairKey: item.pairKey,
      stateVector: item.stateVector,
    })),
    notes: [
      'Coverage status reports evidence presence and theme pairing only; it does not judge visual quality.',
      'Unknown or inferred metadata should be verified against the rendered screenshots before drawing parity conclusions.',
    ],
  };
  return result;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(process.cwd(), args.manifest);
  const result = audit(manifestPath, args.surface);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
