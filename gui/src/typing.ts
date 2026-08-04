import type { Layer, Profile } from './types';
import { WORDS } from './corpus';

// ---------------------------------------------------------------------------
// Typing trainer engine — modelled on keybr's guided lessons.
//
// Two ideas carry the whole design, both taken from keybr:
//
//  1. Letters are introduced in order of their frequency *in the language*,
//     never by keyboard position. That is what makes it work for any layout:
//     you start on "e t a o i n", which spell real words on day one, and the
//     board simply tells you where those letters live. A home-row-first order
//     would be a QWERTY finger drill wearing a different hat.
//
//  2. A key is "learnt" when you type it at the target speed —
//     confidence = targetTimePerChar / yourTimePerChar, so >= 1 means at or
//     above target. A new letter is unlocked only once every letter already in
//     play is confident, and the least confident one is focused in the
//     generated text.
//
// The daemon remaps in the kernel, so the layout itself is derived from the
// user's own mappings rather than a fixed table.
// ---------------------------------------------------------------------------

/// Characters a key emits under a US system layout, [unshifted, shifted].
/// The daemon emits keycodes; the OS turns them into characters, and US is the
/// sane assumption when remapping is being done inside KeyMapper itself.
const KEY_CHARS: Record<string, [string, string]> = {
  KeyA:['a','A'], KeyB:['b','B'], KeyC:['c','C'], KeyD:['d','D'], KeyE:['e','E'],
  KeyF:['f','F'], KeyG:['g','G'], KeyH:['h','H'], KeyI:['i','I'], KeyJ:['j','J'],
  KeyK:['k','K'], KeyL:['l','L'], KeyM:['m','M'], KeyN:['n','N'], KeyO:['o','O'],
  KeyP:['p','P'], KeyQ:['q','Q'], KeyR:['r','R'], KeyS:['s','S'], KeyT:['t','T'],
  KeyU:['u','U'], KeyV:['v','V'], KeyW:['w','W'], KeyX:['x','X'], KeyY:['y','Y'],
  KeyZ:['z','Z'],
  Num1:['1','!'], Num2:['2','@'], Num3:['3','#'], Num4:['4','$'], Num5:['5','%'],
  Num6:['6','^'], Num7:['7','&'], Num8:['8','*'], Num9:['9','('], Num0:['0',')'],
  Minus:['-','_'], Equal:['=','+'],
  LeftBracket:['[','{'], RightBracket:[']','}'], BackSlash:['\\','|'],
  SemiColon:[';',':'], Quote:["'",'"'], BackQuote:['`','~'],
  Comma:[',','<'], Dot:['.','>'], Slash:['/','?'],
  IntlBackslash:['\\','|'],
  Space:[' ',' '],
};

/// Browser KeyboardEvent.code → our key names. Used only when the daemon is
/// not running, so practice still reflects the remapped layout.
const CODE_TO_KEY: Record<string, string> = {
  Digit1:'Num1', Digit2:'Num2', Digit3:'Num3', Digit4:'Num4', Digit5:'Num5',
  Digit6:'Num6', Digit7:'Num7', Digit8:'Num8', Digit9:'Num9', Digit0:'Num0',
  BracketLeft:'LeftBracket', BracketRight:'RightBracket',
  Backslash:'BackSlash', Semicolon:'SemiColon', Backquote:'BackQuote',
  Period:'Dot', IntlBackslash:'IntlBackslash',
  Minus:'Minus', Equal:'Equal', Quote:'Quote', Comma:'Comma', Slash:'Slash',
  Space:'Space', CapsLock:'CapsLock', Tab:'Tab',
};

export function browserCodeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code;
  return CODE_TO_KEY[code] ?? null;
}

// ---------------------------------------------------------------------------
// Finger assignment (standard touch-typing home position, ANSI)
// ---------------------------------------------------------------------------

export type Finger = 'l-pinky' | 'l-ring' | 'l-middle' | 'l-index' | 'thumb'
                   | 'r-index' | 'r-middle' | 'r-ring' | 'r-pinky';

const FINGER_KEYS: [Finger, string[]][] = [
  ['l-pinky',  ['BackQuote','Num1','Tab','KeyQ','CapsLock','KeyA','ShiftLeft','KeyZ','Escape','IntlBackslash']],
  ['l-ring',   ['Num2','KeyW','KeyS','KeyX']],
  ['l-middle', ['Num3','KeyE','KeyD','KeyC']],
  ['l-index',  ['Num4','Num5','KeyR','KeyT','KeyF','KeyG','KeyV','KeyB']],
  ['thumb',    ['Space']],
  ['r-index',  ['Num6','Num7','KeyY','KeyU','KeyH','KeyJ','KeyN','KeyM']],
  ['r-middle', ['Num8','KeyI','KeyK','Comma']],
  ['r-ring',   ['Num9','KeyO','KeyL','Dot']],
  ['r-pinky',  ['Num0','Minus','Equal','Backspace','KeyP','LeftBracket','RightBracket',
                'BackSlash','SemiColon','Quote','Return','Slash','ShiftRight']],
];

export const FINGER_OF: Record<string, Finger> = Object.fromEntries(
  FINGER_KEYS.flatMap(([finger, keys]) => keys.map(k => [k, finger] as const))
);

export const FINGER_COLOR: Record<Finger, string> = {
  'l-pinky':  '#f43f5e',
  'l-ring':   '#f97316',
  'l-middle': '#eab308',
  'l-index':  '#22c55e',
  'thumb':    '#71717a',
  'r-index':  '#14b8a6',
  'r-middle': '#3b82f6',
  'r-ring':   '#8b5cf6',
  'r-pinky':  '#ec4899',
};

export const FINGER_LABEL: Record<Finger, string> = {
  'l-pinky':'Left pinky', 'l-ring':'Left ring', 'l-middle':'Left middle', 'l-index':'Left index',
  'thumb':'Thumb',
  'r-index':'Right index', 'r-middle':'Right middle', 'r-ring':'Right ring', 'r-pinky':'Right pinky',
};

// ---------------------------------------------------------------------------
// Language letter order
// ---------------------------------------------------------------------------

/// English letters, most frequent first. This is the lesson order: keybr's
/// `Letter.frequencyOrder`, which is what makes the progression layout-neutral.
const FREQUENCY_ORDER = 'etaoinsrhldcumfpgwybvkxjqz'.split('');

/// Digits and punctuation are appended after the alphabet — you learn to touch
/// type letters first, exactly as keybr does.
const EXTRA_ORDER = ',.\'-;/0123456789'.split('');

/// keybr's optional "keyboard order": frequency blended with a preference for
/// the home row, so early letters also sit under the fingers. Off by default.
const ROW_BONUS: Record<string, number> = {
  KeyA:0, KeyS:0, KeyD:0, KeyF:0, KeyG:0, KeyH:0, KeyJ:0, KeyK:0, KeyL:0, SemiColon:0,
  KeyQ:1, KeyW:1, KeyE:1, KeyR:1, KeyT:1, KeyY:1, KeyU:1, KeyI:1, KeyO:1, KeyP:1,
  KeyZ:2, KeyX:2, KeyC:2, KeyV:2, KeyB:2, KeyN:2, KeyM:2, Comma:2, Dot:2, Slash:2,
};

// ---------------------------------------------------------------------------
// Effective layout
// ---------------------------------------------------------------------------

export interface KeyStroke { key: string; shift: boolean; }

export interface EffectiveLayout {
  /// physical key → [unshifted, shifted] characters it produces after remapping
  produces: Record<string, [string, string]>;
  /// character → the keystroke that produces it
  strokeFor: Record<string, KeyStroke>;
  /// every character this layout can type, most frequent in English first
  alphabet: string[];
}

function mappingsOf(profile: Profile, layerIdx: number): Record<string, { key: string } | null> {
  // Base layer first, selected layer on top — the daemon resolves the same way.
  const layers: Layer[] = [];
  if (profile.layers[0]) layers.push(profile.layers[0]);
  if (layerIdx > 0 && profile.layers[layerIdx]) layers.push(profile.layers[layerIdx]);

  const out: Record<string, { key: string } | null> = {};
  for (const layer of layers) {
    for (const m of layer.mappings) {
      switch (m.to.type) {
        case 'key':     out[m.from] = { key: m.to.key }; break;
        case 'toggle':  out[m.from] = { key: m.to.key }; break;
        // A mod-tap types its tap key on a quick press, which is what typing does.
        case 'mod_tap': out[m.from] = { key: m.to.tap }; break;
        // Macros, commands and layer switches don't produce a single character.
        default:        out[m.from] = null; break;
      }
    }
  }
  return out;
}

/// `hardwareMap`, when given, replaces the profile's mappings entirely: the
/// remapping lives outside KeyMapper (in the keyboard's own firmware, say), so
/// nothing here should apply the profile on top of it. An empty table means a
/// plain unremapped board.
export function resolveLayout(
  profile: Profile,
  layerIdx: number,
  keyboardOrder = false,
  hardwareMap?: Record<string, string>,
): EffectiveLayout {
  const remap: Record<string, { key: string } | null> = hardwareMap
    ? Object.fromEntries(Object.entries(hardwareMap).map(([from, to]) => [from, { key: to }]))
    : mappingsOf(profile, layerIdx);

  const produces: Record<string, [string, string]> = {};
  for (const physical of Object.keys(KEY_CHARS)) {
    const mapped = physical in remap ? remap[physical] : { key: physical };
    if (!mapped) continue; // remapped to something untypeable
    const chars = KEY_CHARS[mapped.key];
    if (chars) produces[physical] = chars;
  }

  const strokeFor: Record<string, KeyStroke> = {};
  for (const [physical, [lower, upper]] of Object.entries(produces)) {
    if (!(lower in strokeFor)) strokeFor[lower] = { key: physical, shift: false };
    if (!(upper in strokeFor)) strokeFor[upper] = { key: physical, shift: true };
  }

  // Only characters this board can actually type are teachable.
  const typeable = (c: string) => c in strokeFor && !strokeFor[c].shift;
  let alphabet = [...FREQUENCY_ORDER, ...EXTRA_ORDER].filter(typeable);

  if (keyboardOrder) {
    // Stable sort by row, so frequency still breaks ties within a row.
    alphabet = alphabet
      .map((c, i) => ({ c, i, row: ROW_BONUS[strokeFor[c].key] ?? 3 }))
      .sort((a, b) => a.row - b.row || a.i - b.i)
      .map(x => x.c);
  }

  return { produces, strokeFor, alphabet };
}

// ---------------------------------------------------------------------------
// Per-key statistics
// ---------------------------------------------------------------------------

const RECENT_WINDOW = 20;
/// A key needs this many timed strokes before its speed is taken seriously.
const MIN_SAMPLES = 5;

export interface KeyStat {
  hits: number;
  misses: number;
  /// Most recent inter-key times in ms (correct strokes only), newest last.
  recentMs: number[];
  /// Most recent outcomes, newest last (true = correct).
  recentOk: boolean[];
}

export interface Progress {
  /// Keyed by character, so stats survive moving a letter to another key.
  stats: Record<string, KeyStat>;
  /// How many characters of the alphabet are in play.
  unlockedCount: number;
  totalKeystrokes: number;
  totalSeconds: number;
  bestWpm: number;
}

/// keybr's `minSize` — lessons never run on fewer than six letters.
export const MIN_ALPHABET = 6;

export function emptyProgress(): Progress {
  return { stats: {}, unlockedCount: MIN_ALPHABET, totalKeystrokes: 0, totalSeconds: 0, bestWpm: 0 };
}

export function emptyStat(): KeyStat {
  return { hits: 0, misses: 0, recentMs: [], recentOk: [] };
}

/// `ms` is null when the stroke has no meaningful duration — the first key of a
/// lesson, or one typed after a pause. Accuracy still counts; speed does not.
export function recordStroke(stat: KeyStat, ok: boolean, ms: number | null): KeyStat {
  return {
    hits:   stat.hits + (ok ? 1 : 0),
    misses: stat.misses + (ok ? 0 : 1),
    recentMs: ok && ms !== null ? [...stat.recentMs, ms].slice(-RECENT_WINDOW) : stat.recentMs,
    recentOk: [...stat.recentOk, ok].slice(-RECENT_WINDOW),
  };
}

/// Milliseconds per character at a given words-per-minute (5 chars = 1 word).
export function speedToTime(wpm: number) { return 12000 / wpm; }
export function msToWpm(ms: number) { return ms > 0 ? 12000 / ms : 0; }

/// Typical time to type this key. Median, which is steadier than the mean when
/// the odd stroke stalls.
export function keyTime(stat: KeyStat | undefined): number | null {
  if (!stat || stat.recentMs.length < MIN_SAMPLES) return null;
  const sorted = [...stat.recentMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function keyWpm(stat: KeyStat | undefined): number {
  const t = keyTime(stat);
  return t === null ? 0 : msToWpm(t);
}

export function keyAccuracy(stat: KeyStat | undefined): number {
  if (!stat || stat.recentOk.length === 0) return 1;
  return stat.recentOk.filter(Boolean).length / stat.recentOk.length;
}

/// keybr's confidence: targetTimePerChar / yourTimePerChar. 1.0 means you are
/// typing this key exactly at the target speed. Null until there is data.
export function keyConfidence(stat: KeyStat | undefined, targetWpm: number): number | null {
  const t = keyTime(stat);
  if (t === null) return null;
  // Repeated misses shouldn't let a key coast through on raw speed.
  const acc = keyAccuracy(stat);
  const penalty = acc >= 0.9 ? 1 : acc / 0.9;
  return (speedToTime(targetWpm) / t) * penalty;
}

export function isConfident(stat: KeyStat | undefined, targetWpm: number): boolean {
  const c = keyConfidence(stat, targetWpm);
  return c !== null && c >= 1;
}

// ---------------------------------------------------------------------------
// Lesson alphabet — which letters are in play, and which one to drill
// ---------------------------------------------------------------------------

export interface LessonAlphabet {
  /// Characters included in this lesson, frequency order.
  included: string[];
  /// The least confident included character — generation is biased toward it.
  focused: string | null;
  /// The next character waiting to be unlocked, if any.
  next: string | null;
}

export function lessonAlphabet(
  layout: EffectiveLayout,
  progress: Progress,
  targetWpm: number,
): LessonAlphabet {
  const size = Math.max(MIN_ALPHABET, Math.min(progress.unlockedCount, layout.alphabet.length));
  const included = layout.alphabet.slice(0, size);

  // Focus the weakest key. Untyped keys have no confidence yet and are the
  // most urgent of all, so they sort first.
  let focused: string | null = null;
  let worst = Infinity;
  for (const c of included) {
    const conf = keyConfidence(progress.stats[c], targetWpm);
    const rank = conf === null ? -1 : conf;
    if (rank < worst) { worst = rank; focused = c; }
  }

  return { included, focused, next: layout.alphabet[size] ?? null };
}

/// A new letter is unlocked once every letter already in play is confident.
export function shouldUnlock(layout: EffectiveLayout, progress: Progress, targetWpm: number): boolean {
  const { included, next } = lessonAlphabet(layout, progress, targetWpm);
  if (next === null) return false;
  return included.every(c => isConfident(progress.stats[c], targetWpm));
}

// ---------------------------------------------------------------------------
// Phonetic model
//
// keybr generates pseudo-words from an n-gram model of the language so the
// text reads like real writing rather than random letters. We build the same
// thing at runtime: a character-level trigram Markov chain trained on the
// corpus, then sampled with the alphabet restricted to the unlocked letters.
// ---------------------------------------------------------------------------

const BOUNDARY = ' ';
const ORDER = 2; // two characters of context → trigram

type Transitions = Map<string, number>;
let modelCache: Map<string, Transitions> | null = null;

function phoneticModel(): Map<string, Transitions> {
  if (modelCache) return modelCache;
  const model = new Map<string, Transitions>();
  for (const word of WORDS) {
    const padded = BOUNDARY.repeat(ORDER) + word + BOUNDARY;
    for (let i = ORDER; i < padded.length; i++) {
      const context = padded.slice(i - ORDER, i);
      const next = padded[i];
      let t = model.get(context);
      if (!t) { t = new Map(); model.set(context, t); }
      t.set(next, (t.get(next) ?? 0) + 1);
    }
  }
  modelCache = model;
  return model;
}

function sample(weights: [string, number][]): string | null {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [c, w] of weights) {
    r -= w;
    if (r <= 0) return c;
  }
  return weights[weights.length - 1][0];
}

/// Generate one pseudo-word using only `allowed` characters. `focused` is
/// weighted up during sampling and required in the result, so — as in a real
/// keybr lesson — every word drills the letter being learnt.
function phoneticWord(allowed: Set<string>, focused: string | null, minLen: number, maxLen: number): string {
  const model = phoneticModel();
  const allow = (c: string) => c === BOUNDARY || allowed.has(c);

  for (let attempt = 0; attempt < 24; attempt++) {
    let context = BOUNDARY.repeat(ORDER);
    let word = '';

    while (word.length < maxLen) {
      const t = model.get(context);
      if (!t) break;
      const options: [string, number][] = [];
      for (const [c, count] of t) {
        if (!allow(c)) continue;
        // Ending early is not allowed until the word is long enough.
        if (c === BOUNDARY && word.length < minLen) continue;
        options.push([c, c === focused ? count * 3 : count]);
      }
      const next = sample(options);
      if (next === null || next === BOUNDARY) break;
      word += next;
      context = (context + next).slice(-ORDER);
    }

    if (word.length < minLen) continue;
    // Give up on the focus requirement late rather than never producing a word.
    if (focused && !word.includes(focused) && attempt < 20) continue;
    return word;
  }

  // The unlocked set may be too sparse for the model to find a path; fall back
  // to sampling letters directly so a lesson is always produced.
  const pool = [...allowed];
  if (pool.length === 0) return '';
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  const chars = Array.from({ length: len }, () => pool[Math.floor(Math.random() * pool.length)]);
  if (focused && !chars.includes(focused)) chars[Math.floor(Math.random() * len)] = focused;
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Lesson generation
// ---------------------------------------------------------------------------

export type LessonSource = 'generated' | 'words';

export interface LessonOptions {
  source: LessonSource;
  wordCount: number;
  capitals: boolean;
  punctuation: boolean;
  /// keybr's "keyboard order": bias the letter order toward the home row.
  keyboardOrder: boolean;
}

export const DEFAULT_LESSON: LessonOptions = {
  source: 'words', wordCount: 24, capitals: false, punctuation: false, keyboardOrder: false,
};

/// Below this many real words the dictionary is too thin to build a lesson from
/// and pseudo-words take over, as they do on keybr.
const MIN_NATURAL_WORDS = 8;

/// Draw from the commonest spellable words rather than the whole tail: WORDS is
/// in frequency order, so a prefix is exactly "the N most common words this
/// layout can type". Wide enough for variety, narrow enough to stay familiar.
const CANDIDATE_WORDS = 200;

/// Words the given alphabet can spell, most common in English first.
export function naturalWords(alphabet: string[]): string[] {
  const allowed = new Set(alphabet);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of WORDS) {
    if (seen.has(w)) continue;
    if ([...w].every(c => allowed.has(c))) { seen.add(w); out.push(w); }
  }
  return out;
}

function pick<T>(xs: T[]): T { return xs[Math.floor(Math.random() * xs.length)]; }

/// Draw `count` words, never repeating one back-to-back while there is an
/// alternative — a lesson on a six-letter alphabet reuses words heavily, and
/// "note note note" would be drilling the word rather than the letters.
function drawWords(candidates: string[], count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = pick(candidates);
    if (candidates.length > 1) {
      for (let tries = 0; tries < 8 && w === out[out.length - 1]; tries++) w = pick(candidates);
    }
    out.push(w);
  }
  return out;
}

export function buildLesson(
  layout: EffectiveLayout,
  progress: Progress,
  targetWpm: number,
  opts: LessonOptions,
): string {
  const { included, focused } = lessonAlphabet(layout, progress, targetWpm);
  if (included.length === 0) return '';
  const allowed = new Set(included);

  // A lesson drills one letter, so — as on keybr — every word in it should
  // contain that letter. Whole words are what builds muscle memory, so real
  // dictionary words win whenever the alphabet can spell enough of them, and
  // only a genuinely unspellable alphabet falls back to pseudo-words.
  let candidates: string[] = [];
  if (opts.source === 'words') {
    const spellable = naturalWords(included);
    const withFocus = focused ? spellable.filter(w => w.includes(focused)) : spellable;
    const chosen = withFocus.length >= MIN_NATURAL_WORDS ? withFocus : spellable;
    if (chosen.length >= MIN_NATURAL_WORDS) candidates = chosen.slice(0, CANDIDATE_WORDS);
  }

  let words = candidates.length > 0
    ? drawWords(candidates, opts.wordCount)
    : Array.from({ length: opts.wordCount }, () => phoneticWord(allowed, focused, 2, 7));
  words = words.filter(w => w.length > 0);

  if (opts.capitals) {
    words = words.map(w => Math.random() < 0.15 ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  }
  if (opts.punctuation) {
    const marks = [',', '.', ';', '?', '!'].filter(m => m in layout.strokeFor);
    if (marks.length > 0) {
      words = words.map(w => Math.random() < 0.18 ? w + marks[Math.floor(Math.random() * marks.length)] : w);
    }
  }
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// Session metrics
// ---------------------------------------------------------------------------

export function sessionWpm(correctChars: number, ms: number): number {
  if (ms <= 0) return 0;
  return (correctChars / 5) / (ms / 60000);
}
