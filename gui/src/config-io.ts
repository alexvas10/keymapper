// ---------------------------------------------------------------------------
// Reading and writing the daemon's config.yaml from the browser.
//
// The daemon is the authority on this format — it is `serde_yaml` parsing the
// types in `shared/src/lib.rs`. Everything here exists to make sure what we
// write back is something it will accept, and that what we refuse to open
// fails with a message a person can act on rather than a stack trace.
//
// Two details of the Rust schema drive the shape of this file:
//
//   * `Target` is *internally* tagged — the variant name is a `type` key
//     alongside the variant's own fields.
//   * `MacroAction` is *adjacently* tagged (`tag = "type"`, `content = "key"`),
//     so it nests under `MacroStep.action` rather than flattening into it.
//
// Field order is not semantically meaningful to a YAML parser, but it is
// preserved here to match the daemon's own output. That keeps a
// write-after-read a no-op in `git diff` and in the round-trip test.
// ---------------------------------------------------------------------------

import { parse, stringify } from 'yaml';
import type {
  AppSettings, Config, Layer, MacroStep, Mapping, Profile, SocdPair, Target,
} from './types';

/// A validation failure with the path to the offending node, e.g.
/// `profiles[0].layers[1].mappings[3].to`.
export class ConfigError extends Error {
  constructor(public readonly path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ConfigError';
  }
}

const SOCD_MODES = ['last_input_priority', 'neutral', 'key1_priority', 'key2_priority'];
const MACRO_ACTIONS = ['press', 'release', 'tap'];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// Parse and validate a `config.yaml`. Throws `ConfigError` on anything the
/// daemon would reject.
export function parseConfig(text: string): Config {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new ConfigError('', `not valid YAML — ${(e as Error).message}`);
  }
  if (doc === null || doc === undefined) throw new ConfigError('', 'the file is empty');
  return validateConfig(doc);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ConfigError(path, `expected a mapping, found ${describe(v)}`);
  }
  return v as Record<string, unknown>;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ConfigError(path, `expected a list, found ${describe(v)}`);
  return v;
}

function str(v: unknown, path: string): string {
  // YAML happily reads `name: 100` as a number; the daemon wants a string and
  // would refuse the file, so say so here rather than writing it back.
  if (typeof v !== 'string') throw new ConfigError(path, `expected text, found ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null || v === undefined) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  return `a ${typeof v}`;
}

export function validateConfig(doc: unknown): Config {
  const root = obj(doc, '');
  const profiles = arr(root.profiles, 'profiles').map((p, i) => validateProfile(p, `profiles[${i}]`));
  if (profiles.length === 0) throw new ConfigError('profiles', 'a config needs at least one profile');

  const active = str(root.active_profile, 'active_profile');
  if (!profiles.some(p => p.name === active)) {
    throw new ConfigError('active_profile', `no profile is named "${active}"`);
  }
  return { profiles, active_profile: active, settings: validateSettings(root.settings) };
}

function validateProfile(v: unknown, path: string): Profile {
  const p = obj(v, path);
  const device = p.device === undefined || p.device === null ? null : str(p.device, `${path}.device`);
  const layers = arr(p.layers, `${path}.layers`).map((l, i) => validateLayer(l, `${path}.layers[${i}]`));
  if (layers.length === 0) throw new ConfigError(`${path}.layers`, 'a profile needs at least one layer');

  const socd = p.socd_pairs === undefined || p.socd_pairs === null
    ? []
    : arr(p.socd_pairs, `${path}.socd_pairs`).map((s, i) => validateSocd(s, `${path}.socd_pairs[${i}]`));

  return { name: str(p.name, `${path}.name`), device, layers, socd_pairs: socd };
}

function validateLayer(v: unknown, path: string): Layer {
  const l = obj(v, path);
  return {
    name: str(l.name, `${path}.name`),
    trigger: l.trigger === undefined || l.trigger === null ? null : str(l.trigger, `${path}.trigger`),
    mappings: arr(l.mappings, `${path}.mappings`).map((m, i) => validateMapping(m, `${path}.mappings[${i}]`)),
  };
}

function validateMapping(v: unknown, path: string): Mapping {
  const m = obj(v, path);
  return { from: str(m.from, `${path}.from`), to: validateTarget(m.to, `${path}.to`) };
}

function validateTarget(v: unknown, path: string): Target {
  const t = obj(v, path);
  const type = str(t.type, `${path}.type`);
  switch (type) {
    case 'key':
      return { type, key: str(t.key, `${path}.key`) };
    case 'toggle':
      return { type, key: str(t.key, `${path}.key`) };
    case 'command':
      return { type, cmd: str(t.cmd, `${path}.cmd`) };
    case 'layer':
      return { type, name: str(t.name, `${path}.name`) };
    case 'mod_tap':
      return {
        type,
        hold: str(t.hold, `${path}.hold`),
        tap: str(t.tap, `${path}.tap`),
        hold_ms: num(t.hold_ms, `${path}.hold_ms`, 200),
      };
    case 'macro':
      return {
        type,
        steps: arr(t.steps, `${path}.steps`).map((s, i) => validateMacroStep(s, `${path}.steps[${i}]`)),
      };
    default:
      throw new ConfigError(`${path}.type`, `unknown mapping type "${type}"`);
  }
}

function validateMacroStep(v: unknown, path: string): MacroStep {
  const s = obj(v, path);
  const a = obj(s.action, `${path}.action`);
  const type = str(a.type, `${path}.action.type`);
  if (!MACRO_ACTIONS.includes(type)) {
    throw new ConfigError(`${path}.action.type`, `expected one of ${MACRO_ACTIONS.join(', ')}, found "${type}"`);
  }
  const step: MacroStep = {
    action: { type: type as MacroStep['action']['type'], key: str(a.key, `${path}.action.key`) },
  };
  if (s.delay_ms !== undefined && s.delay_ms !== null) {
    step.delay_ms = num(s.delay_ms, `${path}.delay_ms`, 0);
  }
  return step;
}

function validateSocd(v: unknown, path: string): SocdPair {
  const s = obj(v, path);
  const mode = str(s.mode, `${path}.mode`);
  if (!SOCD_MODES.includes(mode)) {
    throw new ConfigError(`${path}.mode`, `expected one of ${SOCD_MODES.join(', ')}, found "${mode}"`);
  }
  return {
    key1: str(s.key1, `${path}.key1`),
    key2: str(s.key2, `${path}.key2`),
    mode: mode as SocdPair['mode'],
  };
}

function num(v: unknown, path: string, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ConfigError(path, `expected a number, found ${describe(v)}`);
  }
  return v;
}

/// Every field of `AppSettings` has a serde default, so a missing or partial
/// `settings:` block is valid — fill the gaps rather than rejecting the file.
function validateSettings(v: unknown): AppSettings {
  const s = v === undefined || v === null ? {} : obj(v, 'settings');
  const pick = <T>(key: string, fallback: T, check: (x: unknown) => boolean): T =>
    s[key] === undefined || !check(s[key]) ? fallback : (s[key] as T);
  const isStr = (x: unknown) => typeof x === 'string';
  const isBool = (x: unknown) => typeof x === 'boolean';
  return {
    first_launch: pick('first_launch', true, isBool),
    keyboard_size: pick('keyboard_size', 'tkl', isStr),
    keyboard_style: pick('keyboard_style', 'ansi', isStr),
    keyboard_layout: pick('keyboard_layout', 'qwerty', isStr),
    auto_save_on_start: pick('auto_save_on_start', false, isBool),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Serialize to YAML the daemon will accept, byte-for-byte in `serde_yaml`'s
/// own output style: block sequences sit at their parent's indentation, lines
/// are never wrapped, and a scalar that needs quoting gets single quotes — as
/// `keyboard_size: '100'` does, being text that would otherwise read as a
/// number.
export function serializeConfig(config: Config): string {
  return stringify(normalize(config), { indentSeq: false, lineWidth: 0, singleQuote: true });
}

/// Rebuild the object with keys in the order the Rust structs declare them.
/// JavaScript preserves insertion order and the YAML writer follows it, so
/// this is what keeps our output diff-clean against the daemon's own.
function normalize(c: Config): unknown {
  return {
    profiles: c.profiles.map(p => ({
      name: p.name,
      device: p.device ?? null,
      layers: p.layers.map(l => ({
        name: l.name,
        trigger: l.trigger ?? null,
        mappings: l.mappings.map(m => ({ from: m.from, to: normalizeTarget(m.to) })),
      })),
      socd_pairs: p.socd_pairs.map(s => ({ key1: s.key1, key2: s.key2, mode: s.mode })),
    })),
    active_profile: c.active_profile,
    settings: {
      first_launch: c.settings.first_launch,
      keyboard_size: c.settings.keyboard_size,
      keyboard_style: c.settings.keyboard_style,
      keyboard_layout: c.settings.keyboard_layout,
      auto_save_on_start: c.settings.auto_save_on_start,
    },
  };
}

function normalizeTarget(t: Target): unknown {
  switch (t.type) {
    case 'key':
    case 'toggle':
      return { type: t.type, key: t.key };
    case 'command':
      return { type: t.type, cmd: t.cmd };
    case 'layer':
      return { type: t.type, name: t.name };
    case 'mod_tap':
      return { type: t.type, hold: t.hold, tap: t.tap, hold_ms: t.hold_ms };
    case 'macro':
      return {
        type: t.type,
        steps: t.steps.map(s =>
          // `delay_ms` is `Option<u64>` with a serde default, so omitting it
          // entirely is the faithful representation of "no delay".
          s.delay_ms === undefined || s.delay_ms === null
            ? { action: { type: s.action.type, key: s.action.key } }
            : { action: { type: s.action.type, key: s.action.key }, delay_ms: s.delay_ms },
        ),
      };
  }
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/// Where a config runs a shell command. The daemon executes these with
/// `sh -c`, so importing someone else's config is equivalent to running their
/// script. The UI must surface these before a downloaded config is saved.
export interface CommandUse {
  profile: string;
  layer: string;
  from: string;
  cmd: string;
}

export function commandMappings(config: Config): CommandUse[] {
  const found: CommandUse[] = [];
  for (const profile of config.profiles) {
    for (const layer of profile.layers) {
      for (const m of layer.mappings) {
        if (m.to.type === 'command') {
          found.push({ profile: profile.name, layer: layer.name, from: m.from, cmd: m.to.cmd });
        }
      }
    }
  }
  return found;
}
