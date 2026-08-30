#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROFILE_RELATIVE_PATHS = [
  path.join('.agents', 'ui', 'profile.yaml'),
  path.join('docs', 'ui', 'project-profile.yaml'),
];

class ProfileError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'ProfileError';
    this.result = result;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function formatLocation(line) {
  return line ? ` at line ${line}` : '';
}

function yamlError(message, line) {
  throw new ProfileError(`profile YAML${formatLocation(line)}: ${message}`);
}

function stripYamlComment(text) {
  let quote = null;
  let bracketDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote === '"') {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }

    if (quote === "'") {
      if (character === "'") {
        if (text[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      bracketDepth += 1;
      continue;
    }
    if (character === ']') {
      bracketDepth -= 1;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index).replace(/[ \t]+$/, '');
    }
  }

  return text.replace(/[ \t]+$/, '');
}

function tokenizeYaml(source) {
  if (typeof source !== 'string') {
    throw new ProfileError('profile source must be a string');
  }

  const normalizedSource = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = [];

  normalizedSource.split('\n').forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim()) return;

    const indentation = withoutComment.match(/^ */)[0].length;
    if (/^ *\t/.test(withoutComment)) {
      yamlError('tabs are not supported for indentation', lineNumber);
    }

    const text = withoutComment.slice(indentation).trimEnd();
    if (text === '---' || text === '...') {
      yamlError('document markers are not supported', lineNumber);
    }
    if (/^(?:\||>)\s*(?:#.*)?$/.test(text)) {
      yamlError('block scalar syntax is not supported', lineNumber);
    }

    lines.push({ indentation, text, line: lineNumber });
  });

  return lines;
}

function isSequenceItem(text) {
  return text === '-' || /^-\s/.test(text);
}

function findMappingColon(text) {
  let quote = null;
  let bracketDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote === '"') {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'") {
        if (text[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      bracketDepth += 1;
      continue;
    }
    if (character === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) return -1;
      continue;
    }
    if (character === ':' && bracketDepth === 0 && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      return index;
    }
  }

  return -1;
}

function parseQuotedScalar(text, line) {
  if (text[0] === '"') {
    if (text[text.length - 1] !== '"') {
      yamlError('unterminated double-quoted scalar', line);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      yamlError(`invalid double-quoted scalar: ${error.message}`, line);
    }
  }

  if (text[0] === "'") {
    if (text[text.length - 1] !== "'") {
      yamlError('unterminated single-quoted scalar', line);
    }
    const body = text.slice(1, -1);
    for (let index = 0; index < body.length; index += 1) {
      if (body[index] === "'") {
        if (body[index + 1] === "'") index += 1;
        else yamlError('single quotes inside a single-quoted scalar must be doubled', line);
      }
    }
    return body.replace(/''/g, "'");
  }

  yamlError('unsupported quoted scalar', line);
}

function splitInlineArray(text, line) {
  const values = [];
  let quote = null;
  let bracketDepth = 0;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote === '"') {
      if (character === '\\') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'") {
        if (text[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') {
      bracketDepth += 1;
      continue;
    }
    if (character === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) yamlError('unexpected closing bracket in inline array', line);
      continue;
    }
    if (character === ',' && bracketDepth === 0) {
      const part = text.slice(start, index).trim();
      if (!part) yamlError('inline arrays cannot contain empty elements or trailing commas', line);
      values.push(part);
      start = index + 1;
    }
  }

  if (quote !== null) yamlError('unterminated quoted scalar in inline array', line);
  if (bracketDepth !== 0) yamlError('unterminated nested inline array', line);

  const finalPart = text.slice(start).trim();
  if (!finalPart) yamlError('inline arrays cannot contain empty elements or trailing commas', line);
  values.push(finalPart);
  return values;
}

function parseInlineArray(text, line) {
  if (!text.endsWith(']')) yamlError('unterminated inline array', line);
  const body = text.slice(1, -1).trim();
  if (!body) return [];
  return splitInlineArray(body, line).map((part) => parseScalar(part, line));
}

function parseNumber(text, line) {
  const numericPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
  if (!numericPattern.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) yamlError(`number is outside the supported range: ${text}`, line);
  return number;
}

function parseScalar(text, line) {
  const value = text.trim();
  if (!value) return null;

  if (value[0] === '[') return parseInlineArray(value, line);
  if (value[0] === '{') yamlError('inline mapping syntax is not supported; use indentation-based mappings', line);
  if (value[0] === '|' || value[0] === '>') yamlError('block scalar syntax is not supported', line);
  if (value[0] === '&' || value[0] === '*' || value[0] === '!' || value[0] === '@' || value[0] === '`') {
    yamlError('anchors, aliases, and tags are not supported', line);
  }
  if (value[0] === '"' || value[0] === "'") return parseQuotedScalar(value, line);

  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null' || value === '~') return null;

  const number = parseNumber(value, line);
  if (number !== null) return number;

  if (value.includes('[') || value.includes(']') || value.includes('{') || value.includes('}')) {
    yamlError('ambiguous flow syntax must use a complete inline array', line);
  }
  if (findMappingColon(value) !== -1) {
    yamlError('ambiguous mapping syntax in a plain scalar; quote the value', line);
  }

  return value;
}

function parseKey(text, line) {
  const keyText = text.trim();
  if (!keyText) yamlError('mapping keys must not be empty', line);
  const key = parseScalar(keyText, line);
  if (typeof key !== 'string') yamlError('mapping keys must be strings', line);
  return key;
}

function assignMappingValue(object, key, value, line) {
  if (hasOwn(object, key)) yamlError(`duplicate mapping key "${key}"`, line);
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function parseBlock(lines, startIndex, indentation) {
  if (startIndex >= lines.length) return { value: null, nextIndex: startIndex };
  const firstLine = lines[startIndex];
  if (firstLine.indentation !== indentation) {
    yamlError(`expected indentation ${indentation}, found ${firstLine.indentation}`, firstLine.line);
  }

  if (isSequenceItem(firstLine.text)) return parseSequence(lines, startIndex, indentation);
  if (findMappingColon(firstLine.text) === -1) {
    yamlError('a block must contain mapping entries or sequence items', firstLine.line);
  }
  return parseMapping(lines, startIndex, indentation);
}

function parseMapping(lines, startIndex, indentation) {
  const object = {};
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (current.indentation < indentation) break;
    if (current.indentation > indentation) {
      yamlError(`unexpected indentation; expected ${indentation}, found ${current.indentation}`, current.line);
    }
    if (isSequenceItem(current.text)) {
      yamlError('cannot mix mapping entries and sequence items at the same indentation', current.line);
    }

    const colon = findMappingColon(current.text);
    if (colon === -1) yamlError('expected a mapping entry with a colon followed by whitespace', current.line);
    const key = parseKey(current.text.slice(0, colon), current.line);
    const rawValue = current.text.slice(colon + 1).trim();
    index += 1;

    let value;
    if (rawValue) {
      value = parseScalar(rawValue, current.line);
    } else if (index < lines.length && lines[index].indentation > indentation) {
      const child = parseBlock(lines, index, lines[index].indentation);
      value = child.value;
      index = child.nextIndex;
    } else {
      value = null;
    }
    assignMappingValue(object, key, value, current.line);
  }

  return { value: object, nextIndex: index };
}

function parseInlineMappingItem(lines, startIndex, sequenceIndentation, text, line) {
  const object = {};
  const colon = findMappingColon(text);
  if (colon === -1) yamlError('expected a mapping entry after a sequence marker', line);

  const key = parseKey(text.slice(0, colon), line);
  const rawValue = text.slice(colon + 1).trim();
  let index = startIndex;
  const continuationIndentation = sequenceIndentation + 2;

  if (rawValue) {
    assignMappingValue(object, key, parseScalar(rawValue, line), line);
  } else if (index < lines.length && lines[index].indentation > continuationIndentation) {
    const child = parseBlock(lines, index, lines[index].indentation);
    assignMappingValue(object, key, child.value, line);
    index = child.nextIndex;
  } else {
    assignMappingValue(object, key, null, line);
  }

  if (index < lines.length && lines[index].indentation > sequenceIndentation) {
    if (lines[index].indentation !== continuationIndentation) {
      yamlError(
        `unexpected indentation for sequence mapping; expected ${continuationIndentation}, found ${lines[index].indentation}`,
        lines[index].line,
      );
    }
    if (isSequenceItem(lines[index].text)) {
      yamlError('cannot start a nested sequence where mapping entries are expected', lines[index].line);
    }
    const continuation = parseMapping(lines, index, continuationIndentation);
    for (const [continuationKey, continuationValue] of Object.entries(continuation.value)) {
      assignMappingValue(object, continuationKey, continuationValue, lines[index].line);
    }
    index = continuation.nextIndex;
  }

  return { value: object, nextIndex: index };
}

function parseSequence(lines, startIndex, indentation) {
  const values = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (current.indentation < indentation) break;
    if (current.indentation > indentation) {
      yamlError(`unexpected indentation; expected ${indentation}, found ${current.indentation}`, current.line);
    }
    if (!isSequenceItem(current.text)) {
      yamlError('cannot mix sequence items and mapping entries at the same indentation', current.line);
    }

    const remainder = current.text.slice(1).trim();
    index += 1;
    if (!remainder) {
      if (index < lines.length && lines[index].indentation > indentation) {
        const child = parseBlock(lines, index, lines[index].indentation);
        values.push(child.value);
        index = child.nextIndex;
      } else {
        values.push(null);
      }
      continue;
    }

    if (findMappingColon(remainder) !== -1) {
      const item = parseInlineMappingItem(lines, index, indentation, remainder, current.line);
      values.push(item.value);
      index = item.nextIndex;
      continue;
    }

    values.push(parseScalar(remainder, current.line));
    if (index < lines.length && lines[index].indentation > indentation) {
      yamlError(`unexpected indentation after scalar sequence item`, lines[index].line);
    }
  }

  return { value: values, nextIndex: index };
}

function parseYaml(source) {
  const lines = tokenizeYaml(source);
  if (lines.length === 0) return null;
  const root = parseBlock(lines, 0, lines[0].indentation);
  if (root.nextIndex !== lines.length) {
    yamlError('unexpected content after the root value', lines[root.nextIndex].line);
  }
  return root.value;
}

function requireObject(value, label) {
  if (!isObject(value)) throw new ProfileError(`${label} must be a mapping`);
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProfileError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProfileError(`${label} must be a finite number`);
  }
  return value;
}

function validateStringArray(value, label, options = {}) {
  const { nonEmpty = false } = options;
  if (!Array.isArray(value)) throw new ProfileError(`${label} must be an array of strings`);
  if (nonEmpty && value.length === 0) throw new ProfileError(`${label} must not be empty`);
  value.forEach((item, index) => requireNonEmptyString(item, `${label}[${index}]`));
}

function validateWeightsMap(weights, label) {
  requireObject(weights, label);
  const entries = Object.entries(weights);
  if (entries.length === 0) throw new ProfileError(`${label} must contain at least one weight`);
  let total = 0;
  for (const [axisId, weight] of entries) {
    requireNonEmptyString(axisId, `${label} axis ID`);
    const numericWeight = requireNumber(weight, `${label}.${axisId}`);
    if (numericWeight < 0) throw new ProfileError(`${label}.${axisId} must be nonnegative`);
    total += numericWeight;
  }
  if (Math.abs(total - 100) > 1e-9) {
    throw new ProfileError(`${label} weights must total 100 (received ${total})`);
  }
}

function validateAxes(axes, label) {
  if (!Array.isArray(axes)) throw new ProfileError(`${label} must be an array`);
  if (axes.length === 0) throw new ProfileError(`${label} must contain at least one axis`);
  const ids = new Set();
  let total = 0;
  axes.forEach((axis, index) => {
    const axisLabel = `${label}[${index}]`;
    requireObject(axis, axisLabel);
    const id = requireNonEmptyString(axis.id, `${axisLabel}.id`);
    if (ids.has(id)) throw new ProfileError(`${label} contains duplicate axis ID "${id}"`);
    ids.add(id);
    const weight = requireNumber(axis.weight, `${axisLabel}.weight`);
    if (weight < 0) throw new ProfileError(`${axisLabel}.weight must be nonnegative`);
    if (hasOwn(axis, 'criterion')) requireNonEmptyString(axis.criterion, `${axisLabel}.criterion`);
    total += weight;
  });
  if (Math.abs(total - 100) > 1e-9) {
    throw new ProfileError(`${label} weights must total 100 (received ${total})`);
  }
}

function validateHardGates(gates, label) {
  if (!Array.isArray(gates)) throw new ProfileError(`${label} must be an array`);
  const ids = new Set();
  gates.forEach((gate, index) => {
    const gateLabel = `${label}[${index}]`;
    requireObject(gate, gateLabel);
    const id = requireNonEmptyString(gate.id, `${gateLabel}.id`);
    if (ids.has(id)) throw new ProfileError(`${label} contains duplicate hard-gate ID "${id}"`);
    ids.add(id);
    if (hasOwn(gate, 'fail_when')) requireNonEmptyString(gate.fail_when, `${gateLabel}.fail_when`);
  });
}

function validatePathNode(value, label) {
  if (typeof value === 'string') {
    requireNonEmptyString(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePathNode(item, `${label}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) validatePathNode(child, `${label}.${key}`);
    return;
  }
  throw new ProfileError(`${label} must contain path strings, arrays, or mappings`);
}

function validateAdapters(adapters) {
  requireObject(adapters, 'adapters');
  for (const [adapterId, adapter] of Object.entries(adapters)) {
    const label = `adapters.${adapterId}`;
    requireNonEmptyString(adapterId, 'adapter ID');
    requireObject(adapter, label);
    for (const key of ['type', 'provider', 'runtime', 'host']) {
      if (hasOwn(adapter, key)) requireNonEmptyString(adapter[key], `${label}.${key}`);
    }
    validateArgvFields(adapter, label);
  }
}

function validateArgvFields(value, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateArgvFields(item, `${label}[${index}]`));
    return;
  }
  if (!isObject(value)) return;

  if (hasOwn(value, 'argv')) validateStringArray(value.argv, `${label}.argv`, { nonEmpty: true });
  for (const [key, child] of Object.entries(value)) validateArgvFields(child, `${label}.${key}`);
}

function validateValidation(validation, required = false) {
  requireObject(validation, 'validation');
  if (!hasOwn(validation, 'commands')) {
    if (required) throw new ProfileError('validation.commands is required when --require-implementation is used');
    return;
  }
  const commands = validation.commands;
  if (!Array.isArray(commands)) throw new ProfileError('validation.commands must be an array');
  if (commands.length === 0) throw new ProfileError('validation.commands must not be empty');
  const ids = new Set();
  commands.forEach((command, index) => {
    const label = `validation.commands[${index}]`;
    requireObject(command, label);
    if (!hasOwn(command, 'argv')) throw new ProfileError(`${label}.argv is required`);
    validateStringArray(command.argv, `${label}.argv`, { nonEmpty: true });
    if (required && !hasOwn(command, 'id')) {
      throw new ProfileError(`${label}.id is required when --require-implementation is used`);
    }
    if (hasOwn(command, 'id')) {
      const id = requireNonEmptyString(command.id, `${label}.id`);
      if (ids.has(id)) throw new ProfileError(`validation.commands contains duplicate command ID "${id}"`);
      ids.add(id);
    }
    if (required && !hasOwn(command, 'condition')) {
      throw new ProfileError(`${label}.condition is required when --require-implementation is used`);
    }
    if (hasOwn(command, 'condition')) requireNonEmptyString(command.condition, `${label}.condition`);
  });
  validateArgvFields(validation, 'validation');
}

function validateImplementation(implementation, required) {
  if (implementation === undefined) {
    if (required) throw new ProfileError('implementation is required when --require-implementation is used');
    return;
  }
  requireObject(implementation, 'implementation');
  for (const key of ['source_roots', 'generated_paths']) {
    if (hasOwn(implementation, key)) validateStringArray(implementation[key], `implementation.${key}`);
  }
  for (const key of ['shared_ui_sources', 'token_sources', 'protocol_contracts', 'editable_roots']) {
    if (hasOwn(implementation, key)) validatePathNode(implementation[key], `implementation.${key}`);
  }

  if (required) {
    validateStringArray(implementation.source_roots, 'implementation.source_roots', { nonEmpty: true });
    validateStringArray(implementation.generated_paths, 'implementation.generated_paths', { nonEmpty: true });
  }
}

function validateEvaluation(evaluation) {
  if (evaluation === undefined) return;
  requireObject(evaluation, 'evaluation');
  const hasWeights = hasOwn(evaluation, 'weights');
  const hasAxes = hasOwn(evaluation, 'axes');
  if (hasWeights && hasAxes) {
    throw new ProfileError('evaluation must define either weights or axes, not both');
  }
  if (hasWeights) validateWeightsMap(evaluation.weights, 'evaluation.weights');
  if (hasAxes) validateAxes(evaluation.axes, 'evaluation.axes');
  if (hasOwn(evaluation, 'hard_gates')) validateHardGates(evaluation.hard_gates, 'evaluation.hard_gates');
}

function validateProfile(profile, options = {}) {
  const { requireImplementation = false } = options;
  requireObject(profile, 'profile root');

  const hasPreferredVersion = hasOwn(profile, 'schema_version');
  const hasLegacyVersion = hasOwn(profile, 'version');
  if (hasPreferredVersion && hasLegacyVersion) {
    throw new ProfileError('profile must not define both schema_version and version');
  }

  let schemaVersion;
  let compatibilityMode;
  if (hasPreferredVersion) {
    if (profile.schema_version !== 1) throw new ProfileError('schema_version must be 1');
    schemaVersion = 1;
    compatibilityMode = 'preferred';
  } else if (hasLegacyVersion) {
    if (profile.version !== 2) throw new ProfileError('version must be 2 for legacy compatibility');
    schemaVersion = 2;
    compatibilityMode = 'legacy_v2';
  } else {
    throw new ProfileError('profile must declare schema_version: 1 or version: 2');
  }

  validateArgvFields(profile, 'profile');
  validateEvaluation(profile.evaluation);

  if (hasOwn(profile, 'contracts')) validatePathNode(profile.contracts, 'contracts');
  if (hasOwn(profile, 'adapters')) validateAdapters(profile.adapters);
  validateImplementation(profile.implementation, requireImplementation);
  if (hasOwn(profile, 'validation')) validateValidation(profile.validation, requireImplementation);
  else if (requireImplementation) {
    throw new ProfileError('validation.commands is required when --require-implementation is used');
  }

  return { schemaVersion, compatibilityMode };
}

function resolveExplicitPath(root, explicitProfile) {
  if (explicitProfile === undefined || explicitProfile === null) return null;
  if (typeof explicitProfile !== 'string' || !explicitProfile.trim()) {
    throw new ProfileError('--profile must be a non-empty path');
  }
  return path.resolve(root, explicitProfile);
}

function candidateProfilePaths(root, explicitProfile) {
  const explicitPath = resolveExplicitPath(root, explicitProfile);
  const defaults = DEFAULT_PROFILE_RELATIVE_PATHS.map((relativePath) => path.resolve(root, relativePath));
  return explicitPath ? [explicitPath] : defaults;
}

function findProfilePath(root, explicitProfile) {
  const candidates = candidateProfilePaths(root, explicitProfile);
  for (const candidate of candidates) {
    let stats;
    try {
      stats = fs.statSync(candidate);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw new ProfileError(`cannot inspect profile path ${candidate}: ${error.message}`);
    }
    if (!stats.isFile()) throw new ProfileError(`profile path is not a file: ${candidate}`);
    return candidate;
  }
  if (explicitProfile !== undefined && explicitProfile !== null) {
    throw new ProfileError(`profile path does not exist: ${candidates[0]}`);
  }
  return null;
}

function missingResult(root, requireImplementation) {
  const result = {
    found: false,
    root,
    profilePath: null,
    path: null,
    fingerprint: null,
    schemaVersion: null,
    compatibilityMode: null,
    profile: null,
  };
  if (requireImplementation) {
    result.error = 'project profile is required for implementation work but no profile was found';
  }
  return result;
}

function resolveProfile(options = {}) {
  const rootInput = options.root === undefined ? process.cwd() : options.root;
  if (typeof rootInput !== 'string' || !rootInput.trim()) throw new ProfileError('--root must be a non-empty path');
  const root = path.resolve(rootInput);
  let rootStats;
  try {
    rootStats = fs.statSync(root);
  } catch (error) {
    throw new ProfileError(`cannot inspect repository root ${root}: ${error.message}`);
  }
  if (!rootStats.isDirectory()) throw new ProfileError(`repository root is not a directory: ${root}`);

  const requireImplementation = options.requireImplementation === true;
  const profilePath = findProfilePath(root, options.profile ?? options.profilePath);
  if (!profilePath) {
    const result = missingResult(root, requireImplementation);
    if (requireImplementation) throw new ProfileError(result.error, result);
    return result;
  }

  let source;
  try {
    source = fs.readFileSync(profilePath);
  } catch (error) {
    throw new ProfileError(`cannot read profile ${profilePath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = parseYaml(source.toString('utf8'));
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError(`cannot parse profile ${profilePath}: ${error.message}`);
  }

  let metadata;
  try {
    metadata = validateProfile(parsed, { requireImplementation });
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError(`cannot validate profile ${profilePath}: ${error.message}`);
  }

  const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
  return {
    found: true,
    root,
    profilePath,
    path: profilePath,
    fingerprint,
    schemaVersion: metadata.schemaVersion,
    compatibilityMode: metadata.compatibilityMode,
    profile: parsed,
  };
}

function requireArgumentValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new ProfileError(`${option} requires one path`);
  return value;
}

function parseArgs(argv) {
  const args = { root: process.cwd(), profile: null, requireImplementation: false };
  let rootProvided = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      if (rootProvided) throw new ProfileError('--root may only be provided once');
      args.root = requireArgumentValue(argv, index, '--root');
      rootProvided = true;
      index += 1;
      continue;
    }
    if (argument === '--profile') {
      if (args.profile !== null) throw new ProfileError('--profile may only be provided once');
      args.profile = requireArgumentValue(argv, index, '--profile');
      index += 1;
      continue;
    }
    if (argument === '--require-implementation') {
      if (args.requireImplementation) throw new ProfileError('--require-implementation may only be provided once');
      args.requireImplementation = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      throw new ProfileError('usage: node resolve-profile.js [--root <repo>] [--profile <path>] [--require-implementation]');
    }
    throw new ProfileError(`unknown argument: ${argument}`);
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const result = resolveProfile(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (args.requireImplementation && !result.found) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = error instanceof ProfileError && error.result ? { ...error.result, error: message } : { error: message };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_PROFILE_RELATIVE_PATHS,
  ProfileError,
  findProfilePath,
  parseArgs,
  parseYaml,
  resolveProfile,
  runCli,
  validateProfile,
};
