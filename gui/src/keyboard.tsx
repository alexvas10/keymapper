import type { ReactNode } from 'react';
import type { KbSize, KbStyle, Target } from './types';

// ---------------------------------------------------------------------------
// Key catalogue
// ---------------------------------------------------------------------------

export const KEY_DISPLAY: Record<string, string> = {
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
  PlayPause:'Play', MediaStop:'Stop', MediaNext:'Next', MediaPrevious:'Prev',
  Menu:'Menu', BrightnessUp:'Brt+', BrightnessDown:'Brt-',
  Calculator:'Calc', Mail:'Mail', WWWHome:'Web', WWWSearch:'Srch',
  Eject:'Eject', Sleep:'Sleep',
  KpPlus:'N+', KpMinus:'N-', KpMultiply:'N*',
  KpDivide:'N/', KpReturn:'NEntr', KpDelete:'N.',
  Kp0:'N0', Kp1:'N1', Kp2:'N2', Kp3:'N3', Kp4:'N4',
  Kp5:'N5', Kp6:'N6', Kp7:'N7', Kp8:'N8', Kp9:'N9',
  IntlBackslash:'\\|',
};

export const ALL_KEYS: Record<string, string[]> = {
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
  Media: ['VolumeUp','VolumeDown','VolumeMute','PlayPause','MediaStop','MediaNext','MediaPrevious',
    'Menu','BrightnessUp','BrightnessDown','Calculator','Mail','WWWHome','WWWSearch','Eject','Sleep'],
};

export function dk(key: string) { return KEY_DISPLAY[key] ?? key; }

// ---------------------------------------------------------------------------
// Keyboard layout data
// ---------------------------------------------------------------------------

export interface KD { id: string; label: string; sub?: string; w?: number; }

// KD shorthand helpers
const k = (id: string, label: string, sub?: string, w?: number): KD => ({ id, label, sub, w });
const sp = (w = 0.5): KD => ({ id: `__sp${Math.random().toString(36).slice(2)}`, label: '', w });

/// Spacers are layout padding, not real keys — renderers skip them.
export function isSpacer(def: KD) { return def.id.startsWith('__sp'); }

export const FN_ROW: KD[] = [
  k('Escape','Esc'), sp(), k('F1','F1'), k('F2','F2'), k('F3','F3'), k('F4','F4'),
  sp(), k('F5','F5'), k('F6','F6'), k('F7','F7'), k('F8','F8'),
  sp(), k('F9','F9'), k('F10','F10'), k('F11','F11'), k('F12','F12'),
];

// ANSI main block (each row = 15u)
export const ANSI_ROWS: KD[][] = [
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
export const ISO_QWERTY_ROW: KD[] = [
  k('Tab','Tab',undefined,1.5), k('KeyQ','Q'), k('KeyW','W'), k('KeyE','E'), k('KeyR','R'),
  k('KeyT','T'), k('KeyY','Y'), k('KeyU','U'), k('KeyI','I'), k('KeyO','O'), k('KeyP','P'),
  k('LeftBracket','[','{'), k('RightBracket',']','}'),
  k('Return','↵',undefined,1.5), // ISO upper-enter (same key id, visual only)
];
export const ISO_HOME_ROW: KD[] = [
  k('CapsLock','Caps',undefined,1.75), k('KeyA','A'), k('KeyS','S'), k('KeyD','D'),
  k('KeyF','F'), k('KeyG','G'), k('KeyH','H'), k('KeyJ','J'), k('KeyK','K'), k('KeyL','L'),
  k('SemiColon',';',':'), k('Quote',"'",'"'), k('BackSlash','#','~'),
  k('Return','↵',undefined,1.25),
];
export const ISO_SHIFT_ROW: KD[] = [
  k('ShiftLeft','⇧',undefined,1.25), k('IntlBackslash','\\','|'),
  k('KeyZ','Z'), k('KeyX','X'), k('KeyC','C'), k('KeyV','V'), k('KeyB','B'),
  k('KeyN','N'), k('KeyM','M'), k('Comma',',','<'), k('Dot','.', '>'), k('Slash','/','?'),
  k('ShiftRight','⇧',undefined,2.75),
];
export const ISO_ROWS: KD[][] = [
  ANSI_ROWS[0], ISO_QWERTY_ROW, ISO_HOME_ROW, ISO_SHIFT_ROW, ANSI_ROWS[4],
];

// Navigation cluster: 6 rows × 3 keys
export const NAV_ROWS: KD[][] = [
  [ k('PrintScreen','PrtSc'), k('ScrollLock','ScrLk'), k('Pause','Pause') ],
  [ k('Insert','Ins'), k('Home','Home'), k('PageUp','PgUp') ],
  [ k('Delete','Del'), k('End','End'), k('PageDown','PgDn') ],
  [ sp(3) ], // blank spacer row for alignment
  [ sp(), k('UpArrow','↑'), sp() ],
  [ k('LeftArrow','←'), k('DownArrow','↓'), k('RightArrow','→') ],
];

// Arrow-only cluster (65%, 75%)
export const ARROW_ROWS: KD[][] = [
  [ sp(), k('UpArrow','↑'), sp() ],
  [ k('LeftArrow','←'), k('DownArrow','↓'), k('RightArrow','→') ],
];

// Numpad
export const NUMPAD_ROWS: KD[][] = [
  [ k('NumLock','Num\nLk'), k('KpDivide','N/'), k('KpMultiply','N*'), k('KpMinus','N-') ],
  [ k('Kp7','7'), k('Kp8','8'), k('Kp9','9'), k('KpPlus','N+') ],
  [ k('Kp4','4'), k('Kp5','5'), k('Kp6','6'), sp() ],
  [ k('Kp1','1'), k('Kp2','2'), k('Kp3','3'), k('KpReturn','↵') ],
  [ k('Kp0','0',undefined,2), sp(), k('KpDelete','.'), sp() ],
];

// ---------------------------------------------------------------------------
// Preset remapping tables (QWERTY physical key → output key)
// ---------------------------------------------------------------------------

export const DVORAK_MAP: Record<string, string> = {
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

export const COLEMAK_MAP: Record<string, string> = {
  KeyE:'KeyF', KeyR:'KeyP', KeyT:'KeyG', KeyY:'KeyJ', KeyU:'KeyL',
  KeyI:'KeyU', KeyO:'KeyY', KeyP:'SemiColon',
  KeyS:'KeyR', KeyD:'KeyS', KeyF:'KeyT', KeyG:'KeyD',
  KeyJ:'KeyN', KeyK:'KeyE', KeyL:'KeyI', SemiColon:'KeyO',
  KeyN:'KeyK', CapsLock:'Backspace',
};

// ---------------------------------------------------------------------------
// Keyboard visual components
// ---------------------------------------------------------------------------

export const UNIT = 40; // px per 1u key
export const GAP  = 5;  // px gap between keys (keycaps carry drop shadows)

export function keyW(w: number) { return w * UNIT + (w - 1) * GAP; }

interface KeyCapProps {
  def: KD; mapping?: Target; selected: boolean; onClick: (id: string) => void;
  layerTrigger?: string;
  isDragOver?: boolean;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
}

export function KeyCap({ def, mapping, selected, onClick, layerTrigger, isDragOver, onDropKey, onDragOverKey }: KeyCapProps) {
  const w = def.w ?? 1;
  if (isSpacer(def)) return <div style={{ width: keyW(w), height: UNIT, flexShrink: 0 }} />;

  const isModTap      = mapping?.type === 'mod_tap';
  const isSpecial     = mapping?.type === 'toggle' || mapping?.type === 'command' || mapping?.type === 'macro';
  const isRemap       = mapping?.type === 'key';
  const isLayerTrig   = !!layerTrigger;
  const isLayerMap    = mapping?.type === 'layer';
  const isAnyLayer    = isLayerTrig || isLayerMap;

  let variant = '';
  if (isDragOver)        variant = 'keycap-dragover';
  else if (isAnyLayer)   variant = 'keycap-layer';
  else if (isModTap)     variant = 'keycap-modtap';
  else if (isSpecial)    variant = 'keycap-special';
  else if (isRemap)      variant = 'keycap-remap';

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
      className={`keycap ${variant} ${selected ? 'keycap-selected' : ''} flex flex-col items-center justify-center select-none`}
    >
      <span className="text-[10px] font-semibold text-zinc-200 leading-tight tracking-tight">{def.label}</span>
      {def.sub && !mapping && !isAnyLayer && (
        <span className="text-[8px] text-zinc-500 leading-none">{def.sub}</span>
      )}
      {sub && (
        <span className={`text-[8px] leading-none mt-px font-semibold truncate max-w-full px-0.5 ${
          isAnyLayer ? 'text-violet-300' : isModTap ? 'text-sky-300' : isSpecial ? 'text-purple-300' : 'text-orange-300'
        }`}>{sub}</span>
      )}
    </div>
  );
}

interface KeyRowProps {
  row: KD[]; mappings?: Record<string, Target>; selected?: string | null; onClick?: (id: string) => void;
  layerTriggers?: Record<string, string>;
  dragOverKey?: string | null;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
  /// Escape hatch: render each position yourself (used by the typing trainer,
  /// which needs a different keycap face than the mapping editor).
  renderCap?: (def: KD, idx: number) => ReactNode;
}

export function KeyRow({ row, mappings = {}, selected = null, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey, renderCap }: KeyRowProps) {
  return (
    <div className="flex" style={{ gap: GAP }}>
      {row.map((def, i) => renderCap
        ? <div key={def.id + i}>{renderCap(def, i)}</div>
        : <KeyCap key={def.id + i} def={def} mapping={mappings[def.id]} selected={selected === def.id} onClick={onClick ?? (() => {})}
            layerTrigger={layerTriggers?.[def.id]}
            isDragOver={dragOverKey === def.id}
            onDropKey={onDropKey}
            onDragOverKey={onDragOverKey} />
      )}
    </div>
  );
}

interface KbVisualProps {
  size: KbSize; style: KbStyle;
  mappings?: Record<string, Target>; selected?: string | null;
  onClick?: (id: string) => void;
  layerTriggers?: Record<string, string>;
  dragOverKey?: string | null;
  onDropKey?: (physicalId: string, targetKey: string) => void;
  onDragOverKey?: (keyId: string | null) => void;
  renderCap?: (def: KD, idx: number) => ReactNode;
}

export function KeyboardVisual({ size, style, mappings, selected, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey, renderCap }: KbVisualProps) {
  const mainRows = style === 'iso' ? ISO_ROWS : ANSI_ROWS;
  const showFn    = size !== '60' && size !== '65';
  const showNav   = size === 'tkl' || size === '100';
  const showArrows = size === '65' || size === '75';
  const showNum   = size === '100';
  const fnOffset = showFn ? (UNIT + GAP + 6) : 0;

  const rowProps = { mappings, selected, onClick, layerTriggers, dragOverKey, onDropKey, onDragOverKey, renderCap };

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
