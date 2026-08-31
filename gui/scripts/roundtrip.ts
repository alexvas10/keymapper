// ---------------------------------------------------------------------------
// Round-trip test for config-io.
//
// The site now owns writing the file the daemon reads, so a serializer bug
// here silently destroys someone's mappings. This checks the property that
// matters: parsing a config and writing it straight back must produce the
// same bytes.
//
//   npm run test:config                 — runs against the fixtures below
//   npm run test:config -- <file.yaml>  — and against a real config too
//
// Run the fixture list through `serde_yaml` as well when changing the schema;
// this file only proves we agree with ourselves.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { parseConfig, serializeConfig, commandMappings, ConfigError } from '../src/config-io.js';

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/// The property under test: read → write must be byte-identical.
function roundTrips(name: string, yaml: string) {
  check(name, () => {
    const once = serializeConfig(parseConfig(yaml));
    const twice = serializeConfig(parseConfig(once));
    assert(once === twice, 'not stable across two passes');
    if (once !== yaml) {
      const a = yaml.split('\n');
      const b = once.split('\n');
      const i = a.findIndex((line, n) => line !== b[n]);
      throw new Error(`output differs at line ${i + 1}\n        - ${a[i]}\n        + ${b[i]}`);
    }
  });
}

/// Every target variant and both tagging styles from `shared/src/lib.rs`, so a
/// change to the schema fails here rather than in the daemon at load time.
const EVERY_FEATURE = `profiles:
- name: default
  device: feed:6060
  layers:
  - name: base
    trigger: null
    mappings:
    - from: CapsLock
      to:
        type: key
        key: Escape
    - from: F1
      to:
        type: macro
        steps:
        - action:
            type: press
            key: ControlLeft
        - action:
            type: tap
            key: KeyC
        - action:
            type: release
            key: ControlLeft
          delay_ms: 50
    - from: KeyA
      to:
        type: mod_tap
        hold: ControlLeft
        tap: KeyA
        hold_ms: 200
    - from: KeyB
      to:
        type: toggle
        key: ShiftLeft
    - from: KeyC
      to:
        type: command
        cmd: notify-send hello
    - from: MetaRight
      to:
        type: layer
        name: nav
  - name: nav
    trigger: MetaRight
    mappings:
    - from: KeyH
      to:
        type: key
        key: LeftArrow
  socd_pairs:
  - key1: KeyA
    key2: KeyD
    mode: last_input_priority
active_profile: default
settings:
  first_launch: false
  keyboard_size: '100'
  keyboard_style: ansi
  keyboard_layout: dvorak
  auto_save_on_start: false
`;

console.log('config-io round trip');
roundTrips('every target variant, macro tagging, socd, quoted numeric string', EVERY_FEATURE);

// A real config, when one is passed on the command line.
for (const path of process.argv.slice(2)) {
  roundTrips(`real config: ${path}`, readFileSync(path, 'utf8'));
}

console.log('\nvalidation');

check('reports the path to a bad node', () => {
  const bad = EVERY_FEATURE.replace('type: mod_tap', 'type: mod_tapp');
  try {
    parseConfig(bad);
    throw new Error('expected a ConfigError');
  } catch (e) {
    assert(e instanceof ConfigError, `expected ConfigError, got ${(e as Error).name}`);
    const msg = (e as ConfigError).message;
    assert(
      msg.includes('profiles[0].layers[0].mappings[2].to.type') && msg.includes('mod_tapp'),
      `unhelpful message: ${msg}`,
    );
  }
});

check('rejects an active_profile that names nothing', () => {
  const bad = EVERY_FEATURE.replace('active_profile: default', 'active_profile: ghost');
  try {
    parseConfig(bad);
    throw new Error('expected a ConfigError');
  } catch (e) {
    assert(e instanceof ConfigError, 'expected ConfigError');
    assert((e as ConfigError).path === 'active_profile', 'wrong path');
  }
});

check('fills in a missing settings block', () => {
  const partial = EVERY_FEATURE.slice(0, EVERY_FEATURE.indexOf('settings:'));
  const cfg = parseConfig(partial);
  assert(cfg.settings.keyboard_size === 'tkl', 'did not apply the serde default');
});

check('a YAML number where text is required names the field', () => {
  const bad = EVERY_FEATURE.replace('name: default', 'name: 100');
  try {
    parseConfig(bad);
    throw new Error('expected a ConfigError');
  } catch (e) {
    assert((e as ConfigError).message.includes('profiles[0].name'), 'wrong path');
  }
});

console.log('\nsafety');

check('finds command mappings so the UI can warn about them', () => {
  const uses = commandMappings(parseConfig(EVERY_FEATURE));
  assert(uses.length === 1, `expected 1 command mapping, found ${uses.length}`);
  assert(uses[0].cmd === 'notify-send hello', 'wrong command');
  assert(uses[0].from === 'KeyC' && uses[0].layer === 'base', 'wrong location');
});

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
