import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Keyboard, Save, RefreshCw, Plus, Trash2, Play, Square, AlertCircle, X, LayoutGrid, List, Settings, ChevronLeft, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppSettings {
  first_launch: boolean;
  keyboard_size: string;
  keyboard_style: string;
  keyboard_layout: string;
  auto_save_on_start: boolean;
}

interface Config {
  profiles: Profile[];
  active_profile: string;
  settings: AppSettings;
}
interface Profile { name: string; layers: Layer[]; socd_pairs: SocdPair[]; }
interface Layer { name: string; trigger: string | null; mappings: Mapping[]; }
interface SocdPair { key1: string; key2: string; mode: SocdMode; }
type SocdMode = 'last_input_priority' | 'neutral' | 'key1_priority' | 'key2_priority';
interface Mapping { from: string; to: Target; }
type Target =
  | { type: 'key'; key: string }
  | { type: 'mod_tap'; hold: string; tap: string; hold_ms: number }
  | { type: 'toggle'; key: string }
  | { type: 'command'; cmd: string }
  | { type: 'macro'; steps: MacroStep[] }
  | { type: 'layer'; name: string };
interface MacroStep { action: MacroAction; delay_ms?: number | null; }
type MacroAction = { type: 'press'; key: string } | { type: 'release'; key: string } | { type: 'tap'; key: string };
type DaemonStatus = 'active' | 'inactive' | 'not-installed' | 'loading' | 'unknown';

// ---------------------------------------------------------------------------
// Key catalogue
// ---------------------------------------------------------------------------

const KEY_DISPLAY: Record<string, string> = {
  KeyA:'A', KeyB:'B', KeyC:'C', KeyD:'D', KeyE:'E', KeyF:'F', KeyG:'G',
  KeyH:'H', KeyI:'I', KeyJ:'J', KeyK:'K', KeyL:'L', KeyM:'M', KeyN:'N',
  KeyO:'O', KeyP:'P', KeyQ:'Q', KeyR:'R', KeyS:'S', KeyT:'T', KeyU:'U',
  KeyV:'V', KeyW:'W', KeyX:'X', KeyY:'Y', KeyZ:'Z',
  Num0:'0', Num1:'1', Num2:'2', Num3:'3', Num4:'4',
  Num5:'5', Num6:'6', Num7:'7', Num8:'8', Num9:'9',
  ShiftLeft:'L-Shift', ShiftRight:'R-Shift',
  ControlLeft:'L-Ctrl', ControlRight:'R-Ctrl',
  Alt:'L-Alt', AltGr:'R-Alt',
  MetaLeft:'L-Super', MetaRight:'R-Super',
  Return:'Enter', Backspace:'Bksp',
  UpArrow:'↑', DownArrow:'↓', LeftArrow:'←', RightArrow:'→',
  PageUp:'PgUp', PageDown:'PgDn',
  PrintScreen:'PrtSc', ScrollLock:'ScrLk', NumLock:'NumLk', CapsLock:'Caps',
  Minus:'-', Equal:'=', LeftBracket:'[', RightBracket:']',
  BackSlash:'\\', SemiColon:';', Quote:"'", BackQuote:'`',
  Comma:',', Dot:'.', Slash:'/',
  VolumeUp:'Vol+', VolumeDown:'Vol-', VolumeMute:'Mute',
  KpPlus:'N+', KpMinus:'N-', KpMultiply:'N*',
  KpDivide:'N/', KpReturn:'NEntr', KpDelete:'N.',
  Kp0:'N0', Kp1:'N1', Kp2:'N2', Kp3:'N3', Kp4:'N4',
  Kp5:'N5', Kp6:'N6', Kp7:'N7', Kp8:'N8', Kp9:'N9',
  IntlBackslash:'\\|',
};

const ALL_KEYS: Record<string, string[]> = {
  Letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => `Key${c}`),
  Numbers: Array.from({length: 10}, (_, i) => `Num${i}`),
  'F1–F12': Array.from({length: 12}, (_, i) => `F${i + 1}`),
  'F13–F24': Array.from({length: 12}, (_, i) => `F${i + 13}`),
  Modifiers: ['ShiftLeft','ShiftRight','ControlLeft','ControlRight','Alt','AltGr','MetaLeft','MetaRight','CapsLock'],
  Navigation: ['UpArrow','DownArrow','LeftArrow','RightArrow','Home','End','PageUp','PageDown','Insert','Delete'],
  Editing: ['Return','Backspace','Tab','Space','Escape'],
  System: ['PrintScreen','ScrollLock','Pause','NumLock'],
  Numpad: ['Kp0','Kp1','Kp2','Kp3','Kp4','Kp5','Kp6','Kp7','Kp8','Kp9','KpPlus','KpMinus','KpMultiply','KpDivide','KpReturn','KpDelete'],
  Punctuation: ['Minus','Equal','LeftBracket','RightBracket','BackSlash','SemiColon','Quote','BackQuote','Comma','Dot','Slash'],
  Media: ['VolumeUp','VolumeDown','VolumeMute'],
};

function dk(key: string) { return KEY_DISPLAY[key] ?? key; }

function targetSummary(to: Target): string {
  switch (to.type) {
    case 'key': return `→ ${dk(to.key)}`;
    case 'mod_tap': return `Hold: ${dk(to.hold)} / Tap: ${dk(to.tap)}`;
    case 'toggle': return `Toggle ${dk(to.key)}`;
    case 'command': return `$ ${to.cmd.slice(0, 30)}${to.cmd.length > 30 ? '…' : ''}`;
    case 'macro': return `Macro (${to.steps.length} steps)`;
    case 'layer': return `⇕ Layer: ${to.name}`;
  }
}

// ---------------------------------------------------------------------------
// Keyboard layout data
// ---------------------------------------------------------------------------

interface KD { id: string; label: string; sub?: string; w?: number; }

// KD shorthand helpers
const k = (id: string, label: string, sub?: string, w?: number): KD => ({ id, label, sub, w });
const sp = (w = 0.5): KD => ({ id: `__sp${Math.random().toString(36).slice(2)}`, label: '', w });

const FN_ROW: KD[] = [
  k('Escape','Esc'), sp(), k('F1','F1'), k('F2','F2'), k('F3','F3'), k('F4','F4'),
  sp(), k('F5','F5'), k('F6','F6'), k('F7','F7'), k('F8','F8'),
  sp(), k('F9','F9'), k('F10','F10'), k('F11','F11'), k('F12','F12'),
];

// ANSI main block (each row = 15u)
const ANSI_ROWS: KD[][] = [
  [ k('BackQuote','`','~'), k('Num1','1','!'), k('Num2','2','@'), k('Num3','3','#'),
    k('Num4','4','$'), k('Num5','5','%'), k('Num6','6','^'), k('Num7','7','&'),
    k('Num8','8','*'), k('Num9','9','('), k('Num0','0',')'), k('Minus','-','_'), k('Equal','=','+'), k('Backspace','⌫',undefined,2) ],
  [ k('Tab','Tab',undefined,1.5), k('KeyQ','Q'), k('KeyW','W'), k('KeyE','E'), k('KeyR','R'),
    k('KeyT','T'), k('KeyY','Y'), k('KeyU','U'), k('KeyI','I'), k('KeyO','O'), k('KeyP','P'),
    k('LeftBracket','[','{'), k('RightBracket',']','}'), k('BackSlash','\\','|',1.5) ],
  [ k('CapsLock','Caps',undefined,1.75), k('KeyA','A'), k('KeyS','S'), k('KeyD','D'),
    k('KeyF','F'), k('KeyG','G'), k('KeyH','H'), k('KeyJ','J'), k('KeyK','K'), k('KeyL','L'),
    k('SemiColon',';',':'), k('Quote',"'",'"'), k('Return','↵',undefined,2.25) ],
  [ k('ShiftLeft','⇧',undefined,2.25), k('KeyZ','Z'), k('KeyX','X'), k('KeyC','C'),
    k('KeyV','V'), k('KeyB','B'), k('KeyN','N'), k('KeyM','M'),
    k('Comma',',','<'), k('Dot','.', '>'), k('Slash','/','?'), k('ShiftRight','⇧',undefined,2.75) ],
  [ k('ControlLeft','Ctrl',undefined,1.25), k('MetaLeft','◆',undefined,1.25), k('Alt','Alt',undefined,1.25),
    k('Space','',undefined,6.25),
    k('AltGr','Alt',undefined,1.25), k('MetaRight','◆',undefined,1.25), k('ControlRight','Ctrl',undefined,1.25) ],
];

// ISO main block — rows that differ from ANSI
const ISO_QWERTY_ROW: KD[] = [
  k('Tab','Tab',undefined,1.5), k('KeyQ','Q'), k('KeyW','W'), k('KeyE','E'), k('KeyR','R'),
  k('KeyT','T'), k('KeyY','Y'), k('KeyU','U'), k('KeyI','I'), k('KeyO','O'), k('KeyP','P'),
  k('LeftBracket','[','{'), k('RightBracket',']','}'),
  k('Return','↵',undefined,1.5), // ISO upper-enter (same key id, visual only)
];
const ISO_HOME_ROW: KD[] = [
  k('CapsLock','Caps',undefined,1.75), k('KeyA','A'), k('KeyS','S'), k('KeyD','D'),
  k('KeyF','F'), k('KeyG','G'), k('KeyH','H'), k('KeyJ','J'), k('KeyK','K'), k('KeyL','L'),
  k('SemiColon',';',':'), k('Quote',"'",'"'), k('BackSlash','#','~'),
  k('Return','↵',undefined,1.25),
];
const ISO_SHIFT_ROW: KD[] = [
  k('ShiftLeft','⇧',undefined,1.25), k('IntlBackslash','\\','|'),
  k('KeyZ','Z'), k('KeyX','X'), k('KeyC','C'), k('KeyV','V'), k('KeyB','B'),
  k('KeyN','N'), k('KeyM','M'), k('Comma',',','<'), k('Dot','.', '>'), k('Slash','/','?'),
  k('ShiftRight','⇧',undefined,2.75),
];
const ISO_ROWS: KD[][] = [
  ANSI_ROWS[0], ISO_QWERTY_ROW, ISO_HOME_ROW, ISO_SHIFT_ROW, ANSI_ROWS[4],
];

// Navigation cluster: 6 rows × 3 keys
const NAV_ROWS: KD[][] = [
  [ k('PrintScreen','PrtSc'), k('ScrollLock','ScrLk'), k('Pause','Pause') ],
  [ k('Insert','Ins'), k('Home','Home'), k('PageUp','PgUp') ],
  [ k('Delete','Del'), k('End','End'), k('PageDown','PgDn') ],
  [ sp(3) ], // blank spacer row for alignment
  [ sp(), k('UpArrow','↑'), sp() ],
  [ k('LeftArrow','←'), k('DownArrow','↓'), k('RightArrow','→') ],
];

// Arrow-only cluster (65%, 75%)
const ARROW_ROWS: KD[][] = [
  [ sp(), k('UpArrow','↑'), sp() ],
  [ k('LeftArrow','←'), k('DownArrow','↓'), k('RightArrow','→') ],
];

// Numpad
const NUMPAD_ROWS: KD[][] = [
  [ k('NumLock','Num\nLk'), k('KpDivide','N/'), k('KpMultiply','N*'), k('KpMinus','N-') ],
  [ k('Kp7','7'), k('Kp8','8'), k('Kp9','9'), k('KpPlus','N+') ],
  [ k('Kp4','4'), k('Kp5','5'), k('Kp6','6'), sp() ],
  [ k('Kp1','1'), k('Kp2','2'), k('Kp3','3'), k('KpReturn','↵') ],
  [ k('Kp0','0',undefined,2), sp(), k('KpDelete','.'), sp() ],
];

// ---------------------------------------------------------------------------
// Preset remapping tables (QWERTY physical key → output key)
// ---------------------------------------------------------------------------

const DVORAK_MAP: Record<string, string> = {
  KeyQ:'Quote', KeyW:'Comma', KeyE:'Dot', KeyR:'KeyP', KeyT:'KeyY',
  KeyY:'KeyF', KeyU:'KeyG', KeyI:'KeyC', KeyO:'KeyR', KeyP:'KeyL',
  LeftBracket:'Slash', RightBracket:'Equal',
  KeyS:'KeyO', KeyD:'KeyE', KeyF:'KeyU', KeyG:'KeyI',
  KeyH:'KeyD', KeyJ:'KeyH', KeyK:'KeyT', KeyL:'KeyN',
  SemiColon:'KeyS', Quote:'Minus',
  KeyZ:'SemiColon', KeyX:'KeyQ', KeyC:'KeyJ', KeyV:'KeyK',
  KeyB:'KeyX', KeyN:'KeyB',
  Comma:'KeyW', Dot:'KeyV', Slash:'KeyZ',
};

const COLEMAK_MAP: Record<string, string> = {
  KeyE:'KeyF', KeyR:'KeyP', KeyT:'KeyG', KeyY:'KeyJ', KeyU:'KeyL',
  KeyI:'KeyU', KeyO:'KeyY', KeyP:'SemiColon',
  KeyS:'KeyR', KeyD:'KeyS', KeyF:'KeyT', KeyG:'KeyD',
  KeyJ:'KeyN', KeyK:'KeyE', KeyL:'KeyI', SemiColon:'KeyO',
  KeyN:'KeyK', CapsLock:'Backspace',
};

// ---------------------------------------------------------------------------
// Keyboard visual components
// ---------------------------------------------------------------------------

const UNIT = 38; // px per 1u key
const GAP  = 3;  // px gap between keys

function keyW(w: number) { return w * UNIT + (w - 1) * GAP; }

interface KeyCapProps {
  def: KD; mapping?: Target; selected: boolean; onClick: (id: string) => void;
  layerTrigger?: string;
  isDragOver?: boolean;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
}

function KeyCap({ def, mapping, selected, onClick, layerTrigger, isDragOver, onDropKey, onDragOverKey }: KeyCapProps) {
  const w = def.w ?? 1;
  const isSpace = def.id.startsWith('__sp');
  if (isSpace) return <div style={{ width: keyW(w), height: UNIT, flexShrink: 0 }} />;

  const isModTap      = mapping?.type === 'mod_tap';
  const isSpecial     = mapping?.type === 'toggle' || mapping?.type === 'command' || mapping?.type === 'macro';
  const isRemap       = mapping?.type === 'key';
  const isLayerTrig   = !!layerTrigger;
  const isLayerMap    = mapping?.type === 'layer';
  const isAnyLayer    = isLayerTrig || isLayerMap;

  let border = 'border-zinc-700';
  let bg = 'bg-zinc-800 hover:bg-zinc-700';
  if (isDragOver)        { border = 'border-orange-400'; bg = 'bg-orange-900/40'; }
  else if (selected)     { border = 'border-orange-400'; bg = 'bg-zinc-700 ring-1 ring-orange-400'; }
  else if (isAnyLayer)   { border = 'border-violet-500/70'; bg = 'bg-violet-900/30 hover:bg-violet-900/50'; }
  else if (isModTap)     { border = 'border-blue-500/60'; bg = 'bg-blue-900/30 hover:bg-blue-900/50'; }
  else if (isSpecial)    { border = 'border-purple-500/60'; bg = 'bg-purple-900/30 hover:bg-purple-900/50'; }
  else if (isRemap)      { border = 'border-orange-500/50'; bg = 'bg-orange-900/25 hover:bg-orange-900/40'; }

  let sub = '';
  if (isLayerTrig)                        sub = `⇕ ${layerTrigger}`;
  else if (mapping?.type === 'layer')     sub = `⇕ ${mapping.name}`;
  else if (mapping?.type === 'key')       sub = dk(mapping.key);
  else if (mapping?.type === 'mod_tap')   sub = `${dk(mapping.hold)}/${dk(mapping.tap)}`;
  else if (mapping?.type === 'toggle')    sub = `T:${dk(mapping.key)}`;
  else if (mapping?.type === 'command')   sub = '$';
  else if (mapping?.type === 'macro')     sub = '▶';

  return (
    <div
      onClick={() => onClick(def.id)}
      onDragOver={e => { e.preventDefault(); onDragOverKey?.(def.id); }}
      onDragLeave={() => onDragOverKey?.(null)}
      onDrop={e => { e.preventDefault(); const tk = e.dataTransfer.getData('targetKey'); if (tk) onDropKey?.(def.id, tk); onDragOverKey?.(null); }}
      style={{ width: keyW(w), height: UNIT, flexShrink: 0 }}
      className={`border rounded cursor-pointer flex flex-col items-center justify-center transition-colors select-none ${bg} ${border}`}
    >
      <span className="text-[10px] font-medium text-zinc-200 leading-tight">{def.label}</span>
      {def.sub && !mapping && !isAnyLayer && (
        <span className="text-[8px] text-zinc-500 leading-none">{def.sub}</span>
      )}
      {sub && (
        <span className={`text-[8px] leading-none mt-px font-medium truncate max-w-full px-0.5 ${
          isAnyLayer ? 'text-violet-400' : isModTap ? 'text-blue-400' : isSpecial ? 'text-purple-400' : 'text-orange-400'
        }`}>{sub}</span>
      )}
    </div>
  );
}

interface KeyRowProps {
  row: KD[]; mappings: Record<string, Target>; selected: string | null; onClick: (id: string) => void;
  layerTriggers?: Record<string, string>;
  dragOverKey?: string | null;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
}

function KeyRow({ row, mappings, selected, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey }: KeyRowProps) {
  return (
    <div className="flex" style={{ gap: GAP }}>
      {row.map((def, i) => (
        <KeyCap key={def.id + i} def={def} mapping={mappings[def.id]} selected={selected === def.id} onClick={onClick}
          layerTrigger={layerTriggers?.[def.id]}
          isDragOver={dragOverKey === def.id}
          onDropKey={onDropKey}
          onDragOverKey={onDragOverKey} />
      ))}
    </div>
  );
}

type KbSize = '60' | '65' | '75' | 'tkl' | '100';

interface KbVisualProps {
  size: KbSize; style: 'ansi' | 'iso';
  mappings: Record<string, Target>; selected: string | null;
  onClick: (id: string) => void;
  layerTriggers?: Record<string, string>;
  dragOverKey?: string | null;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
}

function KeyboardVisual({ size, style, mappings, selected, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey }: KbVisualProps) {
  const mainRows = style === 'iso' ? ISO_ROWS : ANSI_ROWS;
  const showFn    = size !== '60' && size !== '65';
  const showNav   = size === 'tkl' || size === '100';
  const showArrows = size === '65' || size === '75';
  const showNum   = size === '100';
  const fnOffset = showFn ? (UNIT + GAP + 6) : 0;

  const rowProps = { mappings, selected, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey };

  return (
    <div className="flex items-start" style={{ gap: 16 }}>
      <div>
        {showFn && (
          <>
            <KeyRow row={FN_ROW} {...rowProps} />
            <div style={{ height: 6 }} />
          </>
        )}
        <div className="flex flex-col" style={{ gap: GAP }}>
          {mainRows.map((row, i) => <KeyRow key={i} row={row} {...rowProps} />)}
        </div>
      </div>

      {showNav && (
        <div style={{ marginTop: fnOffset }}>
          <div className="flex flex-col" style={{ gap: GAP }}>
            {NAV_ROWS.map((row, i) => <KeyRow key={i} row={row} {...rowProps} />)}
          </div>
        </div>
      )}

      {showArrows && !showNav && (
        <div className="flex flex-col justify-end" style={{ gap: GAP, height: fnOffset + mainRows.length * UNIT + (mainRows.length - 1) * GAP }}>
          {ARROW_ROWS.map((row, i) => <KeyRow key={i} row={row} {...rowProps} />)}
        </div>
      )}

      {showNum && (
        <div style={{ marginTop: fnOffset }}>
          <div className="flex flex-col" style={{ gap: GAP }}>
            {NUMPAD_ROWS.map((row, i) => <KeyRow key={i} row={row} {...rowProps} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout view
// ---------------------------------------------------------------------------

interface LayoutViewProps {
  profile: Profile;
  layerIdx: number;
  settings: AppSettings;
  savedToken: number;
  onMappingEdit: (from: string) => void;
  onPreset: (map: Record<string, string>) => void;
  onClearLayout: () => void;
  onResetProfile: () => void;
}

const KB_SIZES: { value: KbSize; label: string }[] = [
  { value: '60', label: '60%' }, { value: '65', label: '65%' },
  { value: '75', label: '75%' }, { value: 'tkl', label: 'TKL' }, { value: '100', label: '100%' },
];

function LayoutView({ profile, layerIdx, settings, savedToken, onMappingEdit, onPreset, onClearLayout, onResetProfile }: LayoutViewProps) {
  const [overrideDisplay, setOverrideDisplay] = useState(false);
  const [localSize, setLocalSize]   = useState<KbSize>('tkl');
  const [localStyle, setLocalStyle] = useState<'ansi' | 'iso'>('ansi');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { setSelected(null); }, [savedToken]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolCat, setPoolCat] = useState('Letters');

  const kbSize  = overrideDisplay ? localSize  : settings.keyboard_size  as KbSize;
  const kbStyle = overrideDisplay ? localStyle : settings.keyboard_style as 'ansi' | 'iso';

  function handleOverrideToggle() {
    if (!overrideDisplay) {
      setLocalSize(settings.keyboard_size as KbSize);
      setLocalStyle(settings.keyboard_style as 'ansi' | 'iso');
    }
    setOverrideDisplay(o => !o);
  }

  const layer = profile.layers[layerIdx];
  const mappings: Record<string, Target> = {};
  layer.mappings.forEach(m => { mappings[m.from] = m.to; });

  // Build trigger map: physical key → layer name (trigger-field AND mapping-based activations)
  const layerTriggers: Record<string, string> = {};
  profile.layers.forEach(l => {
    if (l.trigger) layerTriggers[l.trigger] = l.name;
    l.mappings.forEach(m => { if (m.to.type === 'layer') layerTriggers[m.from] = m.to.name; });
  });

  function handleClick(id: string) {
    const realId = id === 'Return' ? 'Return' : id;
    setSelected(realId);
    onMappingEdit(realId);
  }

  function handleKeyDrop(physicalId: string, targetKey: string) {
    onPreset({ [physicalId]: targetKey });
    setSelected(physicalId);
  }

  const selectedMapping = selected ? mappings[selected] : undefined;

  const availableLayerNames = profile.layers
    .map(l => l.name)
    .filter((_, i) => i !== layerIdx && i !== 0);

  const poolKeys = poolSearch.trim()
    ? Object.values(ALL_KEYS).flat().filter(k =>
        k.toLowerCase().includes(poolSearch.toLowerCase()) ||
        (KEY_DISPLAY[k] ?? '').toLowerCase().includes(poolSearch.toLowerCase()))
    : ALL_KEYS[poolCat] ?? [];

  return (
    <div className="p-5 space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5 transition-opacity ${overrideDisplay ? '' : 'opacity-40'}`}>
          {KB_SIZES.map(s => (
            <button key={s.value} onClick={() => overrideDisplay && setLocalSize(s.value as KbSize)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${kbSize === s.value ? 'bg-orange-600 text-white' : overrideDisplay ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 cursor-default'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className={`flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5 transition-opacity ${overrideDisplay ? '' : 'opacity-40'}`}>
          {(['ansi','iso'] as const).map(s => (
            <button key={s} onClick={() => overrideDisplay && setLocalStyle(s)}
              className={`px-3 py-1 rounded text-sm font-medium uppercase transition-colors ${kbStyle === s ? 'bg-orange-600 text-white' : overrideDisplay ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 cursor-default'}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={handleOverrideToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${overrideDisplay ? 'bg-zinc-700 border-zinc-600 text-zinc-200' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'}`}>
          <Settings size={12} />
          {overrideDisplay ? 'Using custom display' : 'Override display'}
        </button>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-zinc-500">Presets:</span>
          <button onClick={() => setShowResetConfirm(true)}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">QWERTY</button>
          <button onClick={() => { onPreset(DVORAK_MAP); setSelected(null); }}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">Dvorak</button>
          <button onClick={() => { onPreset(COLEMAK_MAP); setSelected(null); }}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">Colemak</button>
          <button onClick={() => { onClearLayout(); setSelected(null); }}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded-lg transition-colors">Clear layout</button>
        </div>
      </div>

      {/* Keyboard + key pool */}
      <div className="flex gap-4 items-start">
        {/* Left: keyboard */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="overflow-x-auto pb-1">
            <div className="inline-block">
              <KeyboardVisual size={kbSize} style={kbStyle} mappings={mappings} selected={selected} onClick={handleClick}
                layerTriggers={layerTriggers} dragOverKey={dragOverKey}
                onDropKey={handleKeyDrop} onDragOverKey={setDragOverKey} />
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-orange-500/50 bg-orange-900/25 inline-block"/> Remapped</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-blue-500/60 bg-blue-900/30 inline-block"/> Mod-tap</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-purple-500/60 bg-purple-900/30 inline-block"/> Special</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-violet-500/70 bg-violet-900/30 inline-block"/> Layer trigger</span>
            <span className="ml-auto text-zinc-600">Click to edit · Drag from pool to remap</span>
          </div>

          {selected && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between">
              <div>
                <span className="text-sm text-zinc-400">Selected: </span>
                <span className="font-mono font-medium text-orange-400">{dk(selected)}</span>
                {layerTriggers[selected] && (
                  <span className="ml-3 text-xs text-violet-400">⇕ triggers layer "{layerTriggers[selected]}"</span>
                )}
                {selectedMapping && !layerTriggers[selected] && (
                  <span className="ml-3 text-sm text-zinc-400">{targetSummary(selectedMapping)}</span>
                )}
              </div>
              <div className="flex gap-2">
                {!layerTriggers[selected] && (
                  <button onClick={() => onMappingEdit(selected)}
                    className="px-3 py-1.5 text-sm bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors">
                    {selectedMapping ? 'Edit mapping' : 'Add mapping'}
                  </button>
                )}
                {selectedMapping && (
                  <button onClick={() => { onPreset({ [selected]: '__clear__' }); setSelected(null); }}
                    className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-zinc-400 transition-colors">Clear</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: key pool */}
        <div className="w-64 shrink-0 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col" style={{ maxHeight: 560 }}>
          <div className="px-3 pt-3 pb-2 border-b border-zinc-800 shrink-0">
            <p className="text-xs font-semibold text-zinc-400 mb-2">Key Pool</p>
            <input value={poolSearch} onChange={e => setPoolSearch(e.target.value)}
              placeholder="Search keys…"
              className="w-full bg-zinc-800 rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-orange-500" />
          </div>
          {!poolSearch && (
            <div className="flex gap-1 p-2 border-b border-zinc-800 flex-wrap shrink-0">
              {[...Object.keys(ALL_KEYS), 'Layers'].map(c => (
                <button key={c} onClick={() => setPoolCat(c)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    poolCat === c
                      ? c === 'Layers' ? 'bg-violet-600 text-white' : 'bg-orange-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex flex-wrap gap-1.5">
              {poolCat === 'Layers' && !poolSearch ? (
                availableLayerNames.length === 0 ? (
                  <p className="text-zinc-600 text-xs">No other layers. Add a layer first.</p>
                ) : (
                  availableLayerNames.map(name => (
                    <div key={name}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('targetKey', `__layer:${name}`)}
                      title={`Drag onto a key to activate layer "${name}" when held`}
                      className="px-2 py-1 rounded border border-violet-700 bg-violet-900/30 hover:border-violet-500 hover:bg-violet-900/50 text-xs font-mono text-violet-300 cursor-grab active:cursor-grabbing transition-colors select-none">
                      ⇕ {name}
                    </div>
                  ))
                )
              ) : (
                <>
                  {poolKeys.map(k => (
                    <div key={k}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('targetKey', k)}
                      title={`Drag onto a key to remap it → ${dk(k)}`}
                      className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800 hover:border-orange-500 hover:bg-zinc-700 text-xs font-mono text-zinc-300 cursor-grab active:cursor-grabbing transition-colors select-none">
                      {dk(k)}
                    </div>
                  ))}
                  {poolKeys.length === 0 && <p className="text-zinc-600 text-xs">No keys match.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[400px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold">Reset all mappings?</h3>
              <button onClick={() => setShowResetConfirm(false)}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
            </div>
            <div className="p-4">
              <p className="text-sm text-zinc-300">
                This will permanently clear <span className="font-semibold text-white">all keybind mappings</span> in the <span className="font-semibold text-orange-400">{profile.name}</span> profile, across every layer.
              </p>
              <p className="text-xs text-zinc-500 mt-2">This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
              <button onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
              <button onClick={() => { onResetProfile(); setSelected(null); setShowResetConfirm(false); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 transition-colors">Reset all mappings</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key picker modal
// ---------------------------------------------------------------------------

function KeyPickerModal({ value, onChange, onClose }: { value: string; onChange: (k: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('Letters');
  const filtered = search.trim()
    ? Object.values(ALL_KEYS).flat().filter(k => k.toLowerCase().includes(search.toLowerCase()) || (KEY_DISPLAY[k]??'').toLowerCase().includes(search.toLowerCase()))
    : ALL_KEYS[cat] ?? [];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="font-semibold">Pick a key</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="p-3 border-b border-zinc-800">
          <input autoFocus className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-orange-500"
            placeholder="Search keys…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {!search && (
          <div className="flex gap-1 p-2 border-b border-zinc-800 flex-wrap">
            {Object.keys(ALL_KEYS).map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${cat === c ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>{c}</button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-wrap gap-1.5">
            {filtered.map(k => (
              <button key={k} onClick={() => { onChange(k); onClose(); }}
                className={`px-2.5 py-1.5 rounded-md text-sm font-mono transition-colors border ${value === k ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 hover:border-orange-500 text-zinc-200'}`}>
                {dk(k)}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-zinc-500 text-sm">No keys match.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyButton({ value, onPick, placeholder = 'Pick key' }: { value: string; onPick: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-orange-500 rounded-md text-sm font-mono transition-colors">
        {value ? dk(value) : <span className="text-zinc-500">{placeholder}</span>}
      </button>
      {open && <KeyPickerModal value={value} onChange={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mapping editor modal
// ---------------------------------------------------------------------------

function MappingModal({ initial, prefillFrom, onSave, onClose, availableLayers = [] }:
  { initial: Mapping | null; prefillFrom?: string; onSave: (m: Mapping) => void; onClose: () => void; availableLayers?: string[] }) {
  const [from, setFrom] = useState(initial?.from ?? prefillFrom ?? '');
  const [toType, setToType] = useState<Target['type']>(initial?.to.type ?? 'key');
  const [toKey, setToKey] = useState(initial?.to.type === 'key' ? initial.to.key : '');
  const [holdKey, setHoldKey] = useState(initial?.to.type === 'mod_tap' ? initial.to.hold : '');
  const [tapKey, setTapKey] = useState(initial?.to.type === 'mod_tap' ? initial.to.tap : '');
  const [holdMs, setHoldMs] = useState(initial?.to.type === 'mod_tap' ? initial.to.hold_ms : 200);
  const [toggleKey, setToggleKey] = useState(initial?.to.type === 'toggle' ? initial.to.key : '');
  const [cmd, setCmd] = useState(initial?.to.type === 'command' ? initial.to.cmd : '');
  const [steps, setSteps] = useState<MacroStep[]>(initial?.to.type === 'macro' ? initial.to.steps : []);
  const [layerName, setLayerName] = useState(initial?.to.type === 'layer' ? initial.to.name : (availableLayers[0] ?? ''));

  function buildTarget(): Target {
    switch (toType) {
      case 'key': return { type: 'key', key: toKey };
      case 'mod_tap': return { type: 'mod_tap', hold: holdKey, tap: tapKey, hold_ms: holdMs };
      case 'toggle': return { type: 'toggle', key: toggleKey };
      case 'command': return { type: 'command', cmd };
      case 'macro': return { type: 'macro', steps };
      case 'layer': return { type: 'layer', name: layerName };
    }
  }

  const BEHAVIOR_LABELS: Record<string, string> = {
    key: 'Remap', mod_tap: 'Mod-Tap', toggle: 'Toggle',
    command: 'Command', macro: 'Macro', layer: 'Layer',
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[480px] max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="font-semibold">{initial ? 'Edit Mapping' : 'Add Mapping'}</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">From</label>
            <KeyButton value={from} onPick={setFrom} placeholder="Pick source key" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Behavior</label>
            <div className="flex flex-wrap gap-1.5">
              {(['key','mod_tap','toggle','command','macro','layer'] as Target['type'][]).map(t => (
                <button key={t} onClick={() => setToType(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${toType === t ? (t === 'layer' ? 'bg-violet-600 text-white' : 'bg-orange-600 text-white') : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
                  {BEHAVIOR_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {toType === 'key' && (
            <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Target key</label><KeyButton value={toKey} onPick={setToKey} /></div>
          )}
          {toType === 'mod_tap' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">Hold for the modifier, tap quickly for the key.</p>
              <div className="flex gap-4">
                <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5">Hold (modifier)</label><KeyButton value={holdKey} onPick={setHoldKey} /></div>
                <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5">Tap (key)</label><KeyButton value={tapKey} onPick={setTapKey} /></div>
              </div>
              <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5">Hold threshold (ms)</label>
                <input type="number" min={50} max={1000} step={10} value={holdMs}
                  onChange={e => setHoldMs(Number(e.target.value))}
                  className="w-24 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm outline-none focus:border-orange-500" />
              </div>
            </div>
          )}
          {toType === 'toggle' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Key to toggle on/off</label>
              <p className="text-xs text-zinc-500 mb-2">First press holds it; second press releases it.</p>
              <KeyButton value={toggleKey} onPick={setToggleKey} />
            </div>
          )}
          {toType === 'command' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Shell command</label>
              <input type="text" value={cmd} onChange={e => setCmd(e.target.value)}
                placeholder="e.g. firefox" className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono" />
            </div>
          )}
          {toType === 'macro' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Steps</label>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 bg-zinc-800 rounded-lg p-2">
                    <select value={step.action.type}
                      onChange={e => setSteps(s => s.map((st, idx) => idx === i ? { ...st, action: { type: e.target.value as MacroAction['type'], key: (st.action as any).key ?? '' } } : st))}
                      className="bg-zinc-700 rounded px-2 py-1 text-sm outline-none">
                      <option value="tap">Tap</option>
                      <option value="press">Press</option>
                      <option value="release">Release</option>
                    </select>
                    <KeyButton value={(step.action as any).key ?? ''} onPick={k => setSteps(s => s.map((st, idx) => idx === i ? { ...st, action: { ...st.action, key: k } } : st))} />
                    <input type="number" min={0} max={5000} placeholder="ms" value={step.delay_ms ?? ''}
                      onChange={e => setSteps(s => s.map((st, idx) => idx === i ? { ...st, delay_ms: e.target.value ? Number(e.target.value) : null } : st))}
                      className="w-16 bg-zinc-700 rounded px-2 py-1 text-xs outline-none" />
                    <button onClick={() => setSteps(s => s.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-400 ml-auto"><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => setSteps(s => [...s, { action: { type: 'tap', key: '' }, delay_ms: null }])}
                className="mt-2 flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300"><Plus size={14} /> Add step</button>
            </div>
          )}
          {toType === 'layer' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Activate layer</label>
              <p className="text-xs text-zinc-500 mb-2">Hold this key to activate the chosen layer. The layer stays active as long as the key is held.</p>
              {availableLayers.length === 0 ? (
                <p className="text-sm text-zinc-500">No other layers exist. Add a layer first.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableLayers.map(n => (
                    <button key={n} onClick={() => setLayerName(n)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${layerName === n ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-violet-500'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (from && (toType !== 'layer' || layerName)) { onSave({ from, to: buildTarget() }); onClose(); } }}
            disabled={!from || (toType === 'layer' && !layerName)} className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-700 disabled:opacity-40 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SOCD editor modal
// ---------------------------------------------------------------------------

const SOCD_MODES: { value: SocdMode; label: string; desc: string }[] = [
  { value: 'last_input_priority', label: 'Snappy Tappy', desc: 'Last key pressed wins; pressing the opposing key instantly switches.' },
  { value: 'neutral', label: 'Neutral', desc: 'Both keys cancel each other when held together.' },
  { value: 'key1_priority', label: 'Key 1 Priority', desc: 'Key 1 always wins if both are held.' },
  { value: 'key2_priority', label: 'Key 2 Priority', desc: 'Key 2 always wins if both are held.' },
];

function SocdModal({ initial, onSave, onClose }: { initial: SocdPair | null; onSave: (p: SocdPair) => void; onClose: () => void }) {
  const [key1, setKey1] = useState(initial?.key1 ?? '');
  const [key2, setKey2] = useState(initial?.key2 ?? '');
  const [mode, setMode] = useState<SocdMode>(initial?.mode ?? 'last_input_priority');
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="font-semibold">{initial ? 'Edit SOCD Pair' : 'Add SOCD Pair'}</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex gap-4 items-end">
            <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5">Key 1</label><KeyButton value={key1} onPick={setKey1} /></div>
            <span className="text-zinc-500 pb-1">↔</span>
            <div><label className="block text-xs font-semibold text-zinc-400 mb-1.5">Key 2</label><KeyButton value={key2} onPick={setKey2} /></div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2">Resolution mode</label>
            <div className="space-y-2">
              {SOCD_MODES.map(m => (
                <label key={m.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === m.value ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}>
                  <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5" />
                  <div><p className="text-sm font-medium">{m.label}</p><p className="text-xs text-zinc-400 mt-0.5">{m.desc}</p></div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (key1 && key2) { onSave({ key1, key2, mode }); onClose(); } }}
            disabled={!key1 || !key2} className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-700 disabled:opacity-40 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer settings modal
// ---------------------------------------------------------------------------

function LayerModal({ initial, onSave, onClose }: { initial: Layer | null; onSave: (name: string, trigger: string | null) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState(initial?.trigger ?? '');
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[360px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="font-semibold">{initial ? 'Edit Layer' : 'Add Layer'}</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Layer name</label>
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. fn, gaming"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Trigger key (optional)</label>
            <p className="text-xs text-zinc-500 mb-2">Hold this key to activate the layer globally. Leave empty to activate only via a "Layer" mapping in another layer.</p>
            <div className="flex items-center gap-2">
              <KeyButton value={trigger} onPick={setTrigger} placeholder="None" />
              {trigger && <button onClick={() => setTrigger('')} className="text-zinc-500 hover:text-zinc-300 text-xs">Clear</button>}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (name) { onSave(name, trigger || null); onClose(); } }}
            disabled={!name} className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-700 disabled:opacity-40 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard visual preview helpers
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Wizard full-keyboard preview components
// ---------------------------------------------------------------------------

function wkw(w: number, u: number, g: number) { return w * u + Math.max(0, w - 1) * g; }

function wizLabel(def: KD, map: Record<string, string>): string {
  const t = map[def.id];
  return t ? (KEY_DISPLAY[t] ?? t.replace('Key', '')) : def.label;
}

function WizKey({ def, u, g, hl, lbl, ghost }: {
  def: KD; u: number; g: number; hl?: boolean; lbl?: string; ghost?: boolean;
}) {
  const w = def.w ?? 1;
  if (def.id.startsWith('__sp') || ghost) return <div style={{ width: wkw(w, u, g), height: u, flexShrink: 0 }} />;
  return (
    <div style={{ width: wkw(w, u, g), height: u, flexShrink: 0 }}
      className={`border rounded-[2px] flex items-center justify-center ${hl ? 'border-orange-400 bg-orange-600/25' : 'border-zinc-600 bg-zinc-800'}`}>
      {lbl && <span className="text-[7px] leading-none font-medium text-zinc-300 truncate px-px">{lbl}</span>}
    </div>
  );
}

function WizRow({ row, u, g, hl, lmap, ghost }: {
  row: KD[]; u: number; g: number; hl?: Set<string>; lmap?: Record<string, string>; ghost?: Set<string>;
}) {
  return (
    <div className="flex" style={{ gap: g }}>
      {row.map((def, i) => (
        <WizKey key={def.id + i} def={def} u={u} g={g}
          hl={hl?.has(def.id)}
          lbl={lmap ? wizLabel(def, lmap) : undefined}
          ghost={ghost?.has(def.id)} />
      ))}
    </div>
  );
}

const ISO_ENTER_GHOST = new Set(['Return']);

function WizKb60({ style, hl, lmap, u, g }: {
  style: 'ansi' | 'iso'; hl?: Set<string>; lmap?: Record<string, string>; u: number; g: number;
}) {
  if (style === 'ansi') {
    return (
      <div className="flex flex-col select-none" style={{ gap: g }}>
        {ANSI_ROWS.map((row, i) => <WizRow key={i} row={row} u={u} g={g} hl={hl} lmap={lmap} />)}
      </div>
    );
  }
  const xTop = wkw(1.5, u, g) + g + 12 * (wkw(1, u, g) + g);
  const xBot = wkw(1.75, u, g) + g + 12 * (wkw(1, u, g) + g);
  const totalW = xTop + wkw(1.5, u, g);
  const enterHl = hl?.has('Return');
  const pts = `${xTop},0 ${totalW},0 ${totalW},${2*u+g} ${xBot},${2*u+g} ${xBot},${u+g} ${xTop},${u+g}`;
  return (
    <div className="flex flex-col select-none" style={{ gap: g }}>
      <WizRow row={ANSI_ROWS[0]} u={u} g={g} hl={hl} lmap={lmap} />
      <div className="relative" style={{ width: totalW, height: 2*u+g }}>
        <div className="absolute inset-0 flex flex-col" style={{ gap: g }}>
          <WizRow row={ISO_QWERTY_ROW} u={u} g={g} hl={hl} lmap={lmap} ghost={ISO_ENTER_GHOST} />
          <WizRow row={ISO_HOME_ROW}   u={u} g={g} hl={hl} lmap={lmap} ghost={ISO_ENTER_GHOST} />
        </div>
        <svg className="absolute inset-0 pointer-events-none" width={totalW} height={2*u+g}>
          <polygon points={pts}
            fill={enterHl ? 'rgba(234,88,12,0.25)' : 'rgb(39,39,42)'}
            stroke={enterHl ? 'rgb(251,146,60)' : 'rgb(82,82,91)'}
            strokeWidth="1" strokeLinejoin="round" />
          {lmap && <text x={(xTop + totalW) / 2} y={(2*u+g) / 2}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="7" fill="rgb(212,212,216)" fontWeight="500">↵</text>}
        </svg>
      </div>
      <WizRow row={ISO_SHIFT_ROW} u={u} g={g} hl={hl} lmap={lmap} />
      <WizRow row={ANSI_ROWS[4]}  u={u} g={g} hl={hl} lmap={lmap} />
    </div>
  );
}

function WizKbFull({ size, style, lmap, u, g }: {
  size: KbSize; style: 'ansi' | 'iso'; lmap?: Record<string, string>; u: number; g: number;
}) {
  const showFn     = size !== '60' && size !== '65';
  const showNav    = size === 'tkl' || size === '100';
  const showArrows = size === '65' || size === '75';
  const showNum    = size === '100';
  const fnOff      = showFn ? u + 4 : 0;
  const mainH      = fnOff + 5 * u + 4 * g;
  return (
    <div className="flex items-start select-none" style={{ gap: 8 }}>
      <div>
        {showFn && <><WizRow row={FN_ROW} u={u} g={g} lmap={lmap} /><div style={{ height: 4 }} /></>}
        <WizKb60 style={style} lmap={lmap} u={u} g={g} />
      </div>
      {showNav && (
        <div style={{ marginTop: fnOff }}>
          <div className="flex flex-col" style={{ gap: g }}>
            {NAV_ROWS.map((row, i) => <WizRow key={i} row={row} u={u} g={g} />)}
          </div>
        </div>
      )}
      {showArrows && !showNav && (
        <div className="flex flex-col justify-end" style={{ gap: g, height: mainH }}>
          {ARROW_ROWS.map((row, i) => <WizRow key={i} row={row} u={u} g={g} />)}
        </div>
      )}
      {showNum && (
        <div style={{ marginTop: fnOff }}>
          <div className="flex flex-col" style={{ gap: g }}>
            {NUMPAD_ROWS.map((row, i) => <WizRow key={i} row={row} u={u} g={g} />)}
          </div>
        </div>
      )}
    </div>
  );
}

const LAYOUT_MAPS: Record<string, Record<string, string>> = {
  qwerty: {}, dvorak: DVORAK_MAP, colemak: COLEMAK_MAP,
};

const ANSI_HL_KEYS = new Set(['Return', 'BackSlash', 'ShiftLeft']);
const ISO_HL_KEYS  = new Set(['Return', 'BackSlash', 'IntlBackslash', 'ShiftLeft']);

// ---------------------------------------------------------------------------
// First-launch wizard
// ---------------------------------------------------------------------------

const WIZARD_SIZES: { value: string; label: string; desc: string }[] = [
  { value: '60',  label: '60%',  desc: 'Compact, no arrows or fn row' },
  { value: '65',  label: '65%',  desc: 'Compact + dedicated arrow keys' },
  { value: '75',  label: '75%',  desc: 'Adds function row to 65%' },
  { value: 'tkl', label: 'TKL',  desc: 'Full keyboard minus numpad' },
  { value: '100', label: '100%', desc: 'Full keyboard with numpad' },
];
const WIZARD_STYLES: { value: string; label: string; desc: string }[] = [
  { value: 'ansi', label: 'ANSI', desc: 'Standard US layout — wide Enter key' },
  { value: 'iso',  label: 'ISO',  desc: 'European / UK layout — tall Enter key' },
];
const WIZARD_LAYOUTS: { value: string; label: string; desc: string }[] = [
  { value: 'qwerty',  label: 'QWERTY',  desc: 'Standard layout used by most keyboards' },
  { value: 'dvorak',  label: 'Dvorak',  desc: 'Alternate layout optimised for English typing' },
  { value: 'colemak', label: 'Colemak', desc: 'Ergonomic layout with minimal relearning' },
];

interface WizardProps {
  onComplete: (s: AppSettings) => void;
}

function FirstLaunchWizard({ onComplete }: WizardProps) {
  const [step, setStep] = useState(0);
  const [size, setSize] = useState('tkl');
  const [style, setStyle] = useState('ansi');
  const [layout, setLayout] = useState('qwerty');
  const [daemonAuto, setDaemonAuto] = useState(true);
  const [guiAuto, setGuiAuto] = useState(false);
  const [applying, setApplying] = useState(false);

  const STEPS = ['Standard', 'Key layout', 'Keyboard size', 'Startup'];
  const isLast = step === STEPS.length - 1;

  async function finish() {
    setApplying(true);
    try {
      await invoke('set_daemon_autostart', { enabled: daemonAuto });
      await invoke('set_gui_autostart', { enabled: guiAuto });
    } catch (_) {}
    onComplete({ first_launch: false, keyboard_size: size, keyboard_style: style, keyboard_layout: layout, auto_save_on_start: false });
    setApplying(false);
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-[520px] max-h-[90vh] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <Keyboard className="text-orange-500" size={24} />
            <h2 className="text-xl font-bold">Welcome to KeyMapper</h2>
          </div>
          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${i < step ? 'bg-orange-600 text-white' : i === step ? 'bg-orange-500 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === step ? 'text-zinc-200' : 'text-zinc-500'}`}>{s}</span>
                {i < STEPS.length - 1 && <div className={`w-6 h-px ${i < step ? 'bg-orange-600' : 'bg-zinc-700'}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {step === 0 && (
            <div>
              <p className="text-sm text-zinc-400 mb-4">Look at your Enter key and left Shift — which shape matches your keyboard?</p>
              <div className="space-y-2">
                {WIZARD_STYLES.map(o => (
                  <label key={o.value} onClick={() => setStyle(o.value)}
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${style === o.value ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${style === o.value ? 'border-orange-500' : 'border-zinc-600'}`}>
                        {style === o.value && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                      </div>
                      <div>
                        <span className="text-sm font-semibold uppercase">{o.label}</span>
                        <span className="text-xs text-zinc-400 ml-2">{o.desc}</span>
                      </div>
                    </div>
                    <div className="ml-7 overflow-x-auto pb-1">
                      <WizKb60
                        style={o.value as 'ansi' | 'iso'}
                        hl={o.value === 'ansi' ? ANSI_HL_KEYS : ISO_HL_KEYS}
                        u={18} g={2}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="text-sm text-zinc-400 mb-4">What layout are your keys arranged in?</p>
              <div className="space-y-2">
                {WIZARD_LAYOUTS.map(o => (
                  <label key={o.value} onClick={() => setLayout(o.value)}
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${layout === o.value ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${layout === o.value ? 'border-orange-500' : 'border-zinc-600'}`}>
                        {layout === o.value && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                      </div>
                      <div>
                        <span className="text-sm font-semibold">{o.label}</span>
                        <span className="text-xs text-zinc-400 ml-2">{o.desc}</span>
                      </div>
                    </div>
                    <div className="ml-7 overflow-x-auto pb-1">
                      <WizKb60
                        style={style as 'ansi' | 'iso'}
                        lmap={LAYOUT_MAPS[o.value]}
                        u={18} g={2}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm text-zinc-400 mb-4">What size is your keyboard?</p>
              <div className="space-y-2">
                {WIZARD_SIZES.map(o => (
                  <label key={o.value} onClick={() => setSize(o.value)}
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${size === o.value ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${size === o.value ? 'border-orange-500' : 'border-zinc-600'}`}>
                        {size === o.value && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                      </div>
                      <div>
                        <span className="text-sm font-semibold">{o.label}</span>
                        <span className="text-xs text-zinc-400 ml-2">{o.desc}</span>
                      </div>
                    </div>
                    <div className="ml-7 overflow-x-auto pb-1">
                      <WizKbFull
                        size={o.value as KbSize}
                        style={style as 'ansi' | 'iso'}
                        lmap={LAYOUT_MAPS[layout]}
                        u={13} g={1}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400 mb-4">Should KeyMapper start automatically when you log in?</p>
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${daemonAuto ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}
                onClick={() => setDaemonAuto(a => !a)}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 ${daemonAuto ? 'border-orange-500 bg-orange-500' : 'border-zinc-600'}`}>
                  {daemonAuto && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <div>
                  <p className="text-sm font-semibold">Start daemon on login <span className="text-xs font-normal text-orange-400">(recommended)</span></p>
                  <p className="text-xs text-zinc-400 mt-0.5">Keeps your remappings active even when the KeyMapper window is closed.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${guiAuto ? 'border-orange-500 bg-orange-600/10' : 'border-zinc-700 hover:border-zinc-600'}`}
                onClick={() => setGuiAuto(a => !a)}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 ${guiAuto ? 'border-orange-500 bg-orange-500' : 'border-zinc-600'}`}>
                  {guiAuto && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <div>
                  <p className="text-sm font-semibold">Start KeyMapper on login</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Opens the KeyMapper window automatically when you log in.</p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-zinc-800">
          <button onClick={() => setStep(s => s - 1)} disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-0 transition-all">
            <ChevronLeft size={16} /> Back
          </button>
          {isLast ? (
            <button onClick={finish} disabled={applying}
              className="flex items-center gap-1.5 px-6 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-700 disabled:opacity-50 transition-colors">
              {applying ? 'Applying…' : 'Get started'} {!applying && <ChevronRight size={16} />}
            </button>
          ) : (
            <button onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 px-6 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-700 transition-colors">
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  settings: AppSettings;
  onSettingsChange: (s: Partial<AppSettings>) => void;
  onClose: () => void;
}

function SettingsPanel({ settings, onSettingsChange, onClose }: SettingsPanelProps) {
  const [daemonAuto, setDaemonAuto] = useState(false);
  const [guiAuto, setGuiAuto] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      invoke<boolean>('get_daemon_autostart'),
      invoke<boolean>('get_gui_autostart'),
    ]).then(([d, g]) => { setDaemonAuto(d); setGuiAuto(g); setAutoLoaded(true); });
  }, []);

  async function toggleDaemon(v: boolean) {
    setDaemonAuto(v);
    try { await invoke('set_daemon_autostart', { enabled: v }); } catch (_) { setDaemonAuto(!v); }
  }
  async function toggleGui(v: boolean) {
    setGuiAuto(v);
    try { await invoke('set_gui_autostart', { enabled: v }); } catch (_) { setGuiAuto(!v); }
  }

  function ToggleRow({ label, desc, value, onChange, disabled }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
      <label className={`flex items-start justify-between gap-4 p-3 rounded-xl border transition-colors cursor-pointer ${value ? 'border-orange-500/50 bg-orange-600/5' : 'border-zinc-800 hover:border-zinc-700'} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => onChange(!value)}>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
        </div>
        <div className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${value ? 'bg-orange-500' : 'bg-zinc-700'}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-5' : 'left-0.5'}`} />
        </div>
      </label>
    );
  }

  function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{children}</h3>;
  }

  function OptionGroup({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
    return (
      <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 gap-0.5 flex-wrap">
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${value === o.value ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-end" onClick={onClose}>
      <div className="bg-zinc-900 border-l border-zinc-700 h-full w-[380px] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-orange-500" />
            <h2 className="font-semibold">Settings</h2>
          </div>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Behaviour */}
          <div>
            <SectionTitle>Behaviour</SectionTitle>
            <ToggleRow
              label="Auto-save when starting"
              desc="Automatically save unsaved changes when you press Start, instead of being asked."
              value={settings.auto_save_on_start}
              onChange={v => onSettingsChange({ auto_save_on_start: v })}
            />
          </div>

          <div className="border-t border-zinc-800" />

          {/* Keyboard defaults */}
          <div>
            <SectionTitle>Keyboard defaults</SectionTitle>
            <p className="text-xs text-zinc-500 mb-3">Sets the default display in the Layout view. Saved with the main Save button.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Size</label>
                <OptionGroup value={settings.keyboard_size}
                  options={[{value:'60',label:'60%'},{value:'65',label:'65%'},{value:'75',label:'75%'},{value:'tkl',label:'TKL'},{value:'100',label:'100%'}]}
                  onChange={v => onSettingsChange({ keyboard_size: v })} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Standard</label>
                <OptionGroup value={settings.keyboard_style}
                  options={[{value:'ansi',label:'ANSI'},{value:'iso',label:'ISO'}]}
                  onChange={v => onSettingsChange({ keyboard_style: v })} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Layout</label>
                <OptionGroup value={settings.keyboard_layout}
                  options={[{value:'qwerty',label:'QWERTY'},{value:'dvorak',label:'Dvorak'},{value:'colemak',label:'Colemak'}]}
                  onChange={v => onSettingsChange({ keyboard_layout: v })} />
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-800" />

          {/* Startup */}
          <div>
            <SectionTitle>Startup</SectionTitle>
            <div className="space-y-2">
              <ToggleRow
                label="Start daemon on login"
                desc="Keeps remappings active without opening this window."
                value={daemonAuto}
                onChange={toggleDaemon}
                disabled={!autoLoaded}
              />
              <ToggleRow
                label="Start KeyMapper on login"
                desc="Opens this window automatically when you log in."
                value={guiAuto}
                onChange={toggleGui}
                disabled={!autoLoaded}
              />
            </div>
          </div>

          <div className="border-t border-zinc-800" />

          {/* Re-run wizard */}
          <div>
            <SectionTitle>Setup</SectionTitle>
            <button onClick={() => { onSettingsChange({ first_launch: true }); onClose(); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2">
              Re-run setup wizard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daemon status dot
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: DaemonStatus }) {
  const colors: Record<DaemonStatus, string> = {
    active:'bg-green-500', inactive:'bg-zinc-500', 'not-installed':'bg-red-500', loading:'bg-yellow-500 animate-pulse', unknown:'bg-zinc-500',
  };
  const labels: Record<DaemonStatus, string> = {
    active:'Running', inactive:'Stopped', 'not-installed':'Not installed', loading:'Checking…', unknown:'Unknown',
  };
  return (
    <div className="flex items-center gap-1.5 text-sm text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${colors[status]}`} />
      {labels[status]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

function defaultProfile(name: string): Profile {
  return { name, layers: [{ name: 'base', trigger: null, mappings: [] }], socd_pairs: [] };
}

// Keys that are part of a layout preset (affected by Dvorak/Colemak/Clear)
const LAYOUT_KEYS = new Set([
  ...Object.keys(DVORAK_MAP), ...Object.keys(COLEMAK_MAP),
  'KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP',
  'KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL',
  'KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM',
  'Comma','Dot','Slash','SemiColon','Quote','LeftBracket','RightBracket','BackSlash',
  'Num1','Num2','Num3','Num4','Num5','Num6','Num7','Num8','Num9','Num0',
  'Minus','Equal','BackQuote',
]);

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveBeforeStart, setSaveBeforeStart] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>('loading');
  const [daemonInstalled, setDaemonInstalled] = useState(false);
  const [setupMsg, setSetupMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'mappings' | 'layout'>('mappings');
  const [showSettings, setShowSettings] = useState(false);

  const [profileIdx, setProfileIdx] = useState(0);
  const [layerIdx, setLayerIdx]     = useState(0);
  const [savedToken, setSavedToken] = useState(0);
  const [liveLayerIdx, setLiveLayerIdx] = useState<number | null>(null);
  const manualLayerRef = useRef(0);
  const liveLayerIdxRef = useRef<number | null>(null);
  const configRef = useRef(config);
  const profileIdxRef = useRef(profileIdx);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { profileIdxRef.current = profileIdx; }, [profileIdx]);
  useEffect(() => { liveLayerIdxRef.current = liveLayerIdx; }, [liveLayerIdx]);

  const [mappingModal, setMappingModal] = useState<{ mapping: Mapping | null; mappingIdx: number | null; prefill?: string; availableLayers?: string[] } | null>(null);
  const [socdModal, setSocdModal]       = useState<{ pair: SocdPair | null; idx: number | null } | null>(null);
  const [layerModal, setLayerModal]     = useState<{ layer: Layer | null; idx: number | null } | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  const checkDaemon = useCallback(async () => {
    const [installed, status] = await Promise.all([invoke<boolean>('is_daemon_installed'), invoke<string>('get_daemon_status')]);
    setDaemonInstalled(installed);
    setDaemonStatus(!installed ? 'not-installed' : status === 'active' ? 'active' : (status === 'inactive' || status === 'failed') ? 'inactive' : 'unknown');
  }, []);

  const loadConfig = useCallback(async () => {
    try { setLoading(true); setConfig(await invoke<Config>('get_config')); setProfileIdx(0); setLayerIdx(0); setIsDirty(false); }
    catch { setConfig(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadConfig(); checkDaemon(); const t = setInterval(checkDaemon, 5000); return () => clearInterval(t); }, [loadConfig, checkDaemon]);

  useEffect(() => {
    if (view !== 'layout' || daemonStatus !== 'active') {
      if (liveLayerIdxRef.current !== null) {
        setLiveLayerIdx(null);
        setLayerIdx(manualLayerRef.current);
      }
      return;
    }
    let lastIdx: number | null = null;
    const tick = async () => {
      try {
        const name = await invoke<string>('get_active_layer');
        const prof = configRef.current?.profiles[profileIdxRef.current];
        if (!prof) return;
        const i = (name && name !== 'base') ? prof.layers.findIndex(l => l.name === name) : -1;
        const newIdx = i >= 0 ? i : null;
        if (newIdx !== lastIdx) {
          lastIdx = newIdx;
          setLiveLayerIdx(newIdx);
          setLayerIdx(newIdx !== null ? newIdx : manualLayerRef.current);
        }
      } catch { /* daemon not available */ }
    };
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [view, daemonStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await invoke('save_config', { config });
      setIsDirty(false);
      setSavedToken(t => t + 1);
      if (daemonInstalled && daemonStatus === 'active') {
        try { await invoke('reload_daemon'); } catch (_) { /* daemon restart failed; file watcher will pick it up */ }
        await checkDaemon();
      }
    } catch (e) { alert('Save failed: ' + e); } finally { setSaving(false); }
  };

  function mutate(fn: (c: Config) => void) {
    setConfig(c => { if (!c) return c; const n = JSON.parse(JSON.stringify(c)) as Config; fn(n); return n; });
    setIsDirty(true);
  }

  function mutateSettings(patch: Partial<AppSettings>) {
    mutate(c => { c.settings = { ...c.settings, ...patch }; });
  }

  function handleWizardComplete(s: AppSettings) {
    mutate(c => { c.settings = s; });
    // Auto-save after wizard so first_launch=false persists even if user closes without saving
    setConfig(c => {
      if (!c) return c;
      const n = JSON.parse(JSON.stringify(c)) as Config;
      n.settings = s;
      invoke('save_config', { config: n }).catch(() => {});
      return n;
    });
    setIsDirty(false);
  }

  async function startDaemon() {
    setBusy(true);
    try { await invoke('start_daemon'); await checkDaemon(); } finally { setBusy(false); }
  }

  async function setActiveProfile(name: string) {
    if (!config) return;
    const updated: Config = { ...config, active_profile: name };
    try {
      await invoke('save_config', { config: updated });
      setConfig(updated);
      setIsDirty(false);
      if (daemonInstalled && daemonStatus === 'active') {
        try { await invoke('reload_daemon'); } catch (_) {}
        await checkDaemon();
      }
    } catch (e) { alert('Failed to set active profile: ' + e); }
  }

  async function handleStart() {
    if (!config) return;
    if (isDirty) {
      if (config.settings.auto_save_on_start) {
        await saveConfig();
      } else {
        setSaveBeforeStart(true);
        return;
      }
    }
    await startDaemon();
  }

  const profile = config?.profiles[profileIdx];
  const layer   = profile?.layers[layerIdx];

  // Profile operations
  function addProfile() {
    if (!newProfileName.trim() || !config) return;
    const name = newProfileName.trim();
    mutate(c => c.profiles.push(defaultProfile(name)));
    setProfileIdx(config.profiles.length);
    setLayerIdx(0); setNewProfileName(''); setAddingProfile(false);
  }
  function deleteProfile(i: number) {
    if (!config || config.profiles.length <= 1) return;
    mutate(c => {
      if (c.active_profile === c.profiles[i].name) {
        const nextIdx = i < c.profiles.length - 1 ? i + 1 : i - 1;
        c.active_profile = c.profiles[nextIdx].name;
      }
      c.profiles.splice(i, 1);
    });
    setProfileIdx(p => Math.min(p, config.profiles.length - 2)); setLayerIdx(0);
  }

  // Layer operations
  function saveLayer(name: string, trigger: string | null, editIdx: number | null) {
    mutate(c => {
      const p = c.profiles[profileIdx];
      if (editIdx !== null) {
        const oldName = p.layers[editIdx].name;
        p.layers[editIdx].name = name;
        p.layers[editIdx].trigger = trigger;
        if (oldName !== name) {
          p.layers.forEach(l => {
            l.mappings.forEach(m => {
              if (m.to.type === 'layer' && m.to.name === oldName) m.to.name = name;
            });
          });
        }
      } else {
        p.layers.push({ name, trigger, mappings: [] });
        setLayerIdx(p.layers.length - 1);
      }
    });
  }
  function deleteLayer(i: number) {
    if (!profile || profile.layers.length <= 1) return;
    mutate(c => c.profiles[profileIdx].layers.splice(i, 1));
    setLayerIdx(l => Math.min(l, (profile.layers.length - 2)));
  }

  // Mapping operations
  function saveMappingFromModal(m: Mapping, editIdx: number | null) {
    mutate(c => {
      const ms = c.profiles[profileIdx].layers[layerIdx].mappings;
      if (editIdx !== null) ms[editIdx] = m; else ms.push(m);
    });
  }
  function deleteMapping(i: number) { mutate(c => c.profiles[profileIdx].layers[layerIdx].mappings.splice(i, 1)); }

  // SOCD operations
  function saveSocd(pair: SocdPair, editIdx: number | null) {
    mutate(c => { const ps = c.profiles[profileIdx].socd_pairs; if (editIdx !== null) ps[editIdx] = pair; else ps.push(pair); });
  }
  function deleteSocd(i: number) { mutate(c => c.profiles[profileIdx].socd_pairs.splice(i, 1)); }

  // Layout view operations
  function applyPreset(map: Record<string, string>) {
    mutate(c => {
      const ms = c.profiles[profileIdx].layers[layerIdx].mappings;
      // Remove existing mappings for keys in the preset, plus handle __clear__
      const toRemove = new Set(Object.keys(map));
      const base = ms.filter(m => !toRemove.has(m.from));
      const newOnes: Mapping[] = [];
      for (const [from, to] of Object.entries(map)) {
        if (to === '__clear__') continue;
        if (to.startsWith('__layer:')) {
          newOnes.push({ from, to: { type: 'layer', name: to.slice('__layer:'.length) } });
        } else {
          newOnes.push({ from, to: { type: 'key', key: to } });
        }
      }
      c.profiles[profileIdx].layers[layerIdx].mappings = [...base, ...newOnes];
    });
  }
  function clearLayoutKeys() {
    mutate(c => {
      c.profiles[profileIdx].layers[layerIdx].mappings =
        c.profiles[profileIdx].layers[layerIdx].mappings.filter(m => !LAYOUT_KEYS.has(m.from));
    });
  }
  function resetProfileMappings() {
    mutate(c => {
      c.profiles[profileIdx].layers.forEach(l => { l.mappings = []; });
    });
  }
  function openKeyEditor(from: string) {
    if (!layer || !profile) return;
    const existingIdx = layer.mappings.findIndex(m => m.from === from);
    // Offer all layer names except the current layer and the base layer (index 0) as activation targets
    const availableLayers = profile.layers
      .map((l, i) => ({ name: l.name, i }))
      .filter(({ name, i }) => name !== layer.name && i !== 0)
      .map(({ name }) => name);
    setMappingModal({ mapping: existingIdx >= 0 ? layer.mappings[existingIdx] : null, mappingIdx: existingIdx >= 0 ? existingIdx : null, prefill: from, availableLayers });
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 font-sans select-none">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <Keyboard className="text-orange-500" size={20} />
          <h1 className="text-lg font-bold tracking-tight">KeyMapper</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setView('mappings')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'mappings' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <List size={14} /> Mappings
            </button>
            <button onClick={() => setView('layout')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'layout' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <LayoutGrid size={14} /> Layout
            </button>
          </div>

          <StatusDot status={daemonStatus} />
          {daemonInstalled && daemonStatus === 'inactive' && (
            <button onClick={handleStart}
              disabled={busy} className={`flex items-center gap-1 text-sm disabled:opacity-50 ${isDirty ? 'text-orange-400 hover:text-orange-300' : 'text-green-400 hover:text-green-300'}`}>
              <Play size={13} /> Start{isDirty ? '*' : ''}
            </button>
          )}
          {daemonInstalled && daemonStatus === 'active' && (
            <button onClick={async () => { setBusy(true); try { await invoke('stop_daemon'); await checkDaemon(); } finally { setBusy(false); } }}
              disabled={busy} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-300 disabled:opacity-50"><Square size={13} /> Stop</button>
          )}
          <button onClick={loadConfig} title="Refresh" className="p-1.5 hover:bg-zinc-800 rounded-lg"><RefreshCw size={16} /></button>
          <button onClick={() => setShowSettings(true)} title="Settings" className="p-1.5 hover:bg-zinc-800 rounded-lg"><Settings size={16} /></button>
          <button onClick={saveConfig} disabled={!config || saving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isDirty ? 'bg-orange-500 hover:bg-orange-600 ring-1 ring-orange-400' : 'bg-orange-600 hover:bg-orange-700'}`}>
            <Save size={14} /> {saving ? 'Saving…' : isDirty ? 'Save*' : 'Save'}
          </button>
        </div>
      </header>

      {/* Daemon banner */}
      {!daemonInstalled && (
        <div className="flex items-start gap-3 bg-zinc-900 border-b border-zinc-800 px-5 py-3 shrink-0">
          <AlertCircle className="text-orange-500 mt-0.5 shrink-0" size={15} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Daemon not installed</p>
            <p className="text-zinc-400 text-xs mt-0.5">The daemon intercepts key events system-wide. Install it once to get started.</p>
            {setupMsg && <p className={`text-xs mt-1 ${setupMsg.startsWith('Daemon') ? 'text-green-400' : 'text-red-400'}`}>{setupMsg}</p>}
          </div>
          <button onClick={async () => { setBusy(true); setSetupMsg(''); try { setSetupMsg(await invoke<string>('setup_daemon')); await checkDaemon(); await loadConfig(); } catch (e: any) { setSetupMsg(String(e)); } finally { setBusy(false); } }}
            disabled={busy} className="shrink-0 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium">
            {busy ? 'Installing…' : 'Install Daemon'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">Loading…</div>
      ) : !config ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">No config found. Install the daemon to create one.</div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Profile tabs */}
          <div className="flex items-center gap-0.5 px-4 pt-2 pb-0 border-b border-zinc-800 shrink-0 overflow-x-auto">
            {config.profiles.map((p, i) => (
              <div key={p.name} className="flex items-center group">
                <button onClick={() => { setProfileIdx(i); setLayerIdx(0); }}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${i === profileIdx ? 'border-orange-500 text-orange-400 bg-zinc-800/50' : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'}`}>
                  {p.name}
                  {p.name === config.active_profile && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 inline-block" title="Active" />}
                </button>
                {config.profiles.length > 1 && i === profileIdx && (
                  <button onClick={() => deleteProfile(i)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 px-0.5 transition-all"><X size={11} /></button>
                )}
              </div>
            ))}
            {addingProfile ? (
              <div className="flex items-center gap-1 ml-1">
                <input autoFocus value={newProfileName} onChange={e => setNewProfileName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addProfile(); if (e.key === 'Escape') setAddingProfile(false); }}
                  placeholder="Profile name" className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm outline-none focus:border-orange-500 w-32" />
                <button onClick={addProfile} className="text-orange-400 text-xs px-1">Add</button>
                <button onClick={() => setAddingProfile(false)} className="text-zinc-500 text-xs">✕</button>
              </div>
            ) : (
              <button onClick={() => setAddingProfile(true)} className="ml-1 px-2 py-1.5 text-zinc-500 hover:text-orange-400 transition-colors"><Plus size={14} /></button>
            )}
            {profile && profile.name !== config.active_profile && (
              <button onClick={() => setActiveProfile(profile.name)} className="ml-auto mr-2 text-xs text-zinc-500 hover:text-green-400 transition-colors whitespace-nowrap">Set active</button>
            )}
          </div>

          {profile && (
            <div className="flex-1 overflow-y-auto">
              {/* Layer tabs */}
              <div className="flex items-center gap-2 px-5 pt-4 pb-3 shrink-0">
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5">
                  {profile.layers.map((l, i) => (
                    <div key={i} className="flex items-center group">
                      <button onClick={() => { manualLayerRef.current = i; setLayerIdx(i); }}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                          i === layerIdx
                            ? liveLayerIdx === i ? 'bg-violet-600 text-white' : 'bg-orange-600 text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}>
                        {l.name}{l.trigger && <span className="ml-1 text-xs opacity-60">({dk(l.trigger)})</span>}
                        {liveLayerIdx === i && <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block animate-pulse" />}
                      </button>
                      <button onClick={() => setLayerModal({ layer: l, idx: i })} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 px-0.5 text-xs transition-all" title="Edit">⚙</button>
                      {profile.layers.length > 1 && <button onClick={() => deleteLayer(i)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"><X size={11} /></button>}
                    </div>
                  ))}
                </div>
                <button onClick={() => setLayerModal({ layer: null, idx: null })} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-orange-400 transition-colors"><Plus size={14} /> Add layer</button>
                {liveLayerIdx !== null && (
                  <span className="ml-1 text-xs text-violet-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block animate-pulse" /> Live preview
                  </span>
                )}
              </div>

              {/* Main view */}
              {view === 'layout' ? (
                <LayoutView
                  profile={profile}
                  layerIdx={layerIdx}
                  settings={config.settings}
                  savedToken={savedToken}
                  onMappingEdit={openKeyEditor}
                  onPreset={applyPreset}
                  onClearLayout={clearLayoutKeys}
                  onResetProfile={resetProfileMappings}
                />
              ) : (
                <div className="px-5 pb-5 space-y-5">
                  {/* Mappings table */}
                  {layer && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                        <h2 className="text-sm font-semibold text-zinc-300">
                          Mappings — <span className="text-orange-400">{layer.name}</span>
                          {layer.trigger && <span className="text-zinc-500 text-xs ml-2">activated by {dk(layer.trigger)}</span>}
                        </h2>
                        <button onClick={() => setMappingModal({ mapping: null, mappingIdx: null })}
                          className="flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300"><Plus size={14} /> Add</button>
                      </div>
                      {layer.mappings.length === 0 ? (
                        <div className="py-10 text-center text-zinc-600 text-sm">No mappings yet. Click Add, or switch to Layout view to edit visually.</div>
                      ) : (
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-800/50">
                            <tr>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider w-28">From</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider w-24">Behavior</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Target</th>
                              <th className="px-4 py-2.5 w-12" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800">
                            {layer.mappings.map((m, i) => (
                              <tr key={i} onClick={() => setMappingModal({ mapping: m, mappingIdx: i })} className="hover:bg-white/5 cursor-pointer transition-colors">
                                <td className="px-4 py-3 font-mono text-orange-400 font-medium">{dk(m.from)}</td>
                                <td className="px-4 py-3 text-zinc-400 capitalize">{m.to.type.replace('_', '-')}</td>
                                <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{targetSummary(m.to)}</td>
                                <td className="px-4 py-3 text-right">
                                  <button onClick={e => { e.stopPropagation(); deleteMapping(i); }} className="text-zinc-600 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* SOCD pairs */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                      <div>
                        <h2 className="text-sm font-semibold text-zinc-300">SOCD Pairs</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">Simultaneous opposing keys — applies to all layers in this profile.</p>
                      </div>
                      <button onClick={() => setSocdModal({ pair: null, idx: null })} className="flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300"><Plus size={14} /> Add</button>
                    </div>
                    {profile.socd_pairs.length === 0 ? (
                      <div className="py-8 text-center text-zinc-600 text-sm">No SOCD pairs configured.</div>
                    ) : (
                      <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-800/50">
                          <tr>
                            <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Keys</th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Mode</th>
                            <th className="px-4 py-2.5 w-12" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                          {profile.socd_pairs.map((pair, i) => (
                            <tr key={i} onClick={() => setSocdModal({ pair, idx: i })} className="hover:bg-white/5 cursor-pointer transition-colors">
                              <td className="px-4 py-3 font-mono text-orange-400 font-medium">{dk(pair.key1)} ↔ {dk(pair.key2)}</td>
                              <td className="px-4 py-3 text-zinc-300">{SOCD_MODES.find(m => m.value === pair.mode)?.label ?? pair.mode}</td>
                              <td className="px-4 py-3 text-right"><button onClick={e => { e.stopPropagation(); deleteSocd(i); }} className="text-zinc-600 hover:text-red-400 transition-colors"><Trash2 size={14} /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {mappingModal !== null && (
        <MappingModal
          initial={mappingModal.mapping}
          prefillFrom={mappingModal.prefill}
          availableLayers={mappingModal.availableLayers}
          onSave={m => saveMappingFromModal(m, mappingModal.mappingIdx)}
          onClose={() => setMappingModal(null)}
        />
      )}
      {socdModal !== null && <SocdModal initial={socdModal.pair} onSave={p => saveSocd(p, socdModal.idx)} onClose={() => setSocdModal(null)} />}
      {layerModal !== null && <LayerModal initial={layerModal.layer} onSave={(n, t) => saveLayer(n, t, layerModal.idx)} onClose={() => setLayerModal(null)} />}
      {saveBeforeStart && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setSaveBeforeStart(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[380px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold">Unsaved changes</h3>
              <button onClick={() => setSaveBeforeStart(false)}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
            </div>
            <div className="p-4">
              <p className="text-sm text-zinc-300">You have unsaved changes. Save them before starting the daemon so your remappings take effect?</p>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
              <button onClick={() => setSaveBeforeStart(false)}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
              <button onClick={async () => { setSaveBeforeStart(false); await startDaemon(); }}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700">Start anyway</button>
              <button onClick={async () => { setSaveBeforeStart(false); await saveConfig(); await startDaemon(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-600 hover:bg-orange-700 transition-colors">Save & Start</button>
            </div>
          </div>
        </div>
      )}
      {config?.settings.first_launch && <FirstLaunchWizard onComplete={handleWizardComplete} />}
      {showSettings && config && (
        <SettingsPanel
          settings={config.settings}
          onSettingsChange={mutateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
