import { useEffect, useState, useCallback, useRef } from 'react';
import { Keyboard, Save, RefreshCw, Plus, Trash2, AlertCircle, X, LayoutGrid, List, Settings, ChevronLeft, ChevronRight, GraduationCap, FolderOpen, Terminal, Copy, Check, Upload, Download } from 'lucide-react';
import * as api from './api';
import type { Backend } from './api';
import { ConfigError, commandMappings, type CommandUse } from './config-io';
import type {
  AppSettings, Config, DaemonStatus, KbDevice, KbSize, Layer, Mapping,
  MacroAction, MacroStep, Profile, SocdMode, SocdPair, Target,
} from './types';
import {
  ALL_KEYS, ANSI_ROWS, ARROW_ROWS, COLEMAK_MAP, DVORAK_MAP, FN_ROW, ISO_HOME_ROW,
  ISO_QWERTY_ROW, ISO_SHIFT_ROW, KEY_DISPLAY, KeyboardVisual, NAV_ROWS,
  NUMPAD_ROWS, dk, type KD,
} from './keyboard';
import TypingView from './TypingView';

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
        <div className={`flex items-center bg-white/[0.04] border border-white/[0.07] rounded-lg p-0.5 gap-0.5 transition-opacity ${overrideDisplay ? '' : 'opacity-40'}`}>
          {KB_SIZES.map(s => (
            <button key={s.value} onClick={() => overrideDisplay && setLocalSize(s.value as KbSize)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${kbSize === s.value ? 'btn-primary text-white' : overrideDisplay ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 cursor-default'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className={`flex items-center bg-white/[0.04] border border-white/[0.07] rounded-lg p-0.5 gap-0.5 transition-opacity ${overrideDisplay ? '' : 'opacity-40'}`}>
          {(['ansi','iso'] as const).map(s => (
            <button key={s} onClick={() => overrideDisplay && setLocalStyle(s)}
              className={`px-3 py-1 rounded-md text-sm font-medium uppercase transition-colors ${kbStyle === s ? 'btn-primary text-white' : overrideDisplay ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 cursor-default'}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={handleOverrideToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${overrideDisplay ? 'bg-white/[0.08] border-white/20 text-zinc-200' : 'bg-transparent border-white/[0.07] text-zinc-500 hover:border-white/20 hover:text-zinc-400'}`}>
          <Settings size={12} />
          {overrideDisplay ? 'Using custom display' : 'Override display'}
        </button>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Presets</span>
          <button onClick={() => setShowResetConfirm(true)}
            className="px-3 py-1.5 text-sm font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 rounded-lg transition-colors">QWERTY</button>
          <button onClick={() => { onPreset(DVORAK_MAP); setSelected(null); }}
            className="px-3 py-1.5 text-sm font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 rounded-lg transition-colors">Dvorak</button>
          <button onClick={() => { onPreset(COLEMAK_MAP); setSelected(null); }}
            className="px-3 py-1.5 text-sm font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 rounded-lg transition-colors">Colemak</button>
          <button onClick={() => { onClearLayout(); setSelected(null); }}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 border border-white/[0.07] hover:border-white/15 rounded-lg transition-colors">Clear layout</button>
        </div>
      </div>

      {/* Keyboard + key pool */}
      <div className="flex gap-4 items-start">
        {/* Left: keyboard */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="overflow-x-auto pb-1">
            <div className="inline-block kb-plate p-5">
              <KeyboardVisual size={kbSize} style={kbStyle} mappings={mappings} selected={selected} onClick={handleClick}
                layerTriggers={layerTriggers} dragOverKey={dragOverKey}
                onDropKey={handleKeyDrop} onDragOverKey={setDragOverKey} />
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-orange-500/60 bg-orange-500/15 inline-block"/> Remapped</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-sky-500/60 bg-sky-500/15 inline-block"/> Mod-tap</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-purple-500/60 bg-purple-500/15 inline-block"/> Special</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border border-violet-500/70 bg-violet-500/15 inline-block"/> Layer trigger</span>
            <span className="ml-auto text-zinc-600">Click to edit · Drag from pool to remap</span>
          </div>

          {selected && (
            <div className="panel rounded-2xl p-4 flex items-center justify-between animate-pop-in">
              <div>
                <span className="text-sm text-zinc-400">Selected: </span>
                <span className="font-mono font-semibold text-orange-400">{dk(selected)}</span>
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
                    className="btn-primary px-3.5 py-1.5 text-sm font-medium rounded-lg text-white">
                    {selectedMapping ? 'Edit mapping' : 'Add mapping'}
                  </button>
                )}
                {selectedMapping && (
                  <button onClick={() => { onPreset({ [selected]: '__clear__' }); setSelected(null); }}
                    className="px-3.5 py-1.5 text-sm bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg text-zinc-400 transition-colors">Clear</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: key pool */}
        <div className="w-64 shrink-0 panel rounded-2xl flex flex-col" style={{ maxHeight: 560 }}>
          <div className="px-3 pt-3 pb-2 border-b border-white/[0.06] shrink-0">
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Key Pool</p>
            <input value={poolSearch} onChange={e => setPoolSearch(e.target.value)}
              placeholder="Search keys…"
              className="w-full bg-black/30 border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/40 transition-colors placeholder:text-zinc-600" />
          </div>
          {!poolSearch && (
            <div className="flex gap-1 p-2 border-b border-white/[0.06] flex-wrap shrink-0">
              {[...Object.keys(ALL_KEYS), 'Layers'].map(c => (
                <button key={c} onClick={() => setPoolCat(c)}
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                    poolCat === c
                      ? c === 'Layers' ? 'bg-violet-600 text-white shadow-[0_0_10px_rgba(139,92,246,0.4)]' : 'btn-primary text-white'
                      : 'bg-white/[0.05] text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-200'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2.5">
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
                      className="pool-chip !border-violet-500/40 !bg-none !bg-violet-500/10 hover:!border-violet-400 px-2 py-1 text-xs font-mono text-violet-300 cursor-grab active:cursor-grabbing select-none">
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
                      className="pool-chip px-2 py-1 text-xs font-mono text-zinc-300 cursor-grab active:cursor-grabbing select-none">
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-[#141418] border border-white/10 rounded-2xl animate-pop-in w-[400px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
              <h3 className="font-semibold">Reset all mappings?</h3>
              <button onClick={() => setShowResetConfirm(false)}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
            </div>
            <div className="p-4">
              <p className="text-sm text-zinc-300">
                This will permanently clear <span className="font-semibold text-white">all keybind mappings</span> in the <span className="font-semibold text-orange-400">{profile.name}</span> profile, across every layer.
              </p>
              <p className="text-xs text-zinc-500 mt-2">This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-white/[0.06]">
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-[#141418] border border-white/10 rounded-2xl animate-pop-in w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
          <h3 className="font-semibold">Pick a key</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="p-3 border-b border-white/[0.06]">
          <input autoFocus className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/40 placeholder:text-zinc-600 transition-colors"
            placeholder="Search keys…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {!search && (
          <div className="flex gap-1 p-2 border-b border-white/[0.06] flex-wrap">
            {Object.keys(ALL_KEYS).map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${cat === c ? 'btn-primary text-white' : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1]'}`}>{c}</button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-wrap gap-1.5">
            {filtered.map(k => (
              <button key={k} onClick={() => { onChange(k); onClose(); }}
                className={`px-2.5 py-1.5 rounded-md text-sm font-mono transition-colors border ${value === k ? 'btn-primary text-white border-transparent' : 'bg-white/[0.05] border-white/[0.08] hover:border-orange-500/60 text-zinc-200'}`}>
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
        className="pool-chip px-2.5 py-1 text-sm font-mono text-zinc-200">
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-[#141418] border border-white/10 rounded-2xl animate-pop-in w-[480px] max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
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
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${toType === t ? (t === 'layer' ? 'bg-violet-600 text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]' : 'btn-primary text-white') : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1]'}`}>
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
                  className="w-24 bg-black/30 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-orange-500" />
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
                placeholder="e.g. firefox" className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 font-mono" />
            </div>
          )}
          {toType === 'macro' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Steps</label>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg p-2">
                    <select value={step.action.type}
                      onChange={e => setSteps(s => s.map((st, idx) => idx === i ? { ...st, action: { type: e.target.value as MacroAction['type'], key: (st.action as any).key ?? '' } } : st))}
                      className="bg-black/40 border border-white/10 rounded-md px-2 py-1 text-sm outline-none focus:border-orange-500/60">
                      <option value="tap">Tap</option>
                      <option value="press">Press</option>
                      <option value="release">Release</option>
                    </select>
                    <KeyButton value={(step.action as any).key ?? ''} onPick={k => setSteps(s => s.map((st, idx) => idx === i ? { ...st, action: { ...st.action, key: k } } : st))} />
                    <input type="number" min={0} max={5000} placeholder="ms" value={step.delay_ms ?? ''}
                      onChange={e => setSteps(s => s.map((st, idx) => idx === i ? { ...st, delay_ms: e.target.value ? Number(e.target.value) : null } : st))}
                      className="w-16 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs outline-none focus:border-orange-500/60" />
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
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${layerName === n ? 'bg-violet-600 border-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]' : 'bg-white/[0.05] border-white/[0.08] text-zinc-300 hover:border-violet-500/70'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (from && (toType !== 'layer' || layerName)) { onSave({ from, to: buildTarget() }); onClose(); } }}
            disabled={!from || (toType === 'layer' && !layerName)} className="px-4 py-2 rounded-lg text-sm font-medium btn-primary text-white disabled:opacity-40 transition-colors">Save</button>
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-[#141418] border border-white/10 rounded-2xl animate-pop-in w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
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
                <label key={m.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === m.value ? 'border-orange-500/70 bg-orange-500/[0.08] shadow-[0_0_16px_rgba(249,115,22,0.12)]' : 'border-white/[0.08] hover:border-white/25'}`}>
                  <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5" />
                  <div><p className="text-sm font-medium">{m.label}</p><p className="text-xs text-zinc-400 mt-0.5">{m.desc}</p></div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (key1 && key2) { onSave({ key1, key2, mode }); onClose(); } }}
            disabled={!key1 || !key2} className="px-4 py-2 rounded-lg text-sm font-medium btn-primary text-white disabled:opacity-40 transition-colors">Save</button>
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-[#141418] border border-white/10 rounded-2xl animate-pop-in w-[360px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
          <h3 className="font-semibold">{initial ? 'Edit Layer' : 'Add Layer'}</h3>
          <button onClick={onClose}><X size={18} className="text-zinc-400 hover:text-zinc-100" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Layer name</label>
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. fn, gaming"
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
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
        <div className="flex justify-end gap-2 p-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => { if (name) { onSave(name, trigger || null); onClose(); } }}
            disabled={!name} className="px-4 py-2 rounded-lg text-sm font-medium btn-primary text-white disabled:opacity-40 transition-colors">Save</button>
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
      className={`border rounded-[2px] flex items-center justify-center ${hl ? 'border-orange-400 bg-orange-500/25' : 'border-white/15 bg-zinc-800'}`}>
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
  const [applying, setApplying] = useState(false);

  const STEPS = ['Standard', 'Key layout', 'Keyboard size', 'Startup'];
  const isLast = step === STEPS.length - 1;

  async function finish() {
    setApplying(true);
    onComplete({ first_launch: false, keyboard_size: size, keyboard_style: style, keyboard_layout: layout, auto_save_on_start: false });
    setApplying(false);
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-[#141418] border border-white/10 rounded-2xl w-[520px] max-h-[90vh] shadow-2xl flex flex-col animate-pop-in overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]">
              <Keyboard className="text-white" size={21} />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Welcome to KeyMapper</h2>
          </div>
          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${i < step ? 'btn-primary text-white' : i === step ? 'btn-primary text-white' : 'bg-white/[0.07] text-zinc-500'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === step ? 'text-zinc-200' : 'text-zinc-500'}`}>{s}</span>
                {i < STEPS.length - 1 && <div className={`w-6 h-px ${i < step ? 'bg-orange-500' : 'bg-white/10'}`} />}
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
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${style === o.value ? 'border-orange-500/70 bg-orange-500/[0.08] shadow-[0_0_16px_rgba(249,115,22,0.12)]' : 'border-white/[0.08] hover:border-white/25'}`}>
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
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${layout === o.value ? 'border-orange-500/70 bg-orange-500/[0.08] shadow-[0_0_16px_rgba(249,115,22,0.12)]' : 'border-white/[0.08] hover:border-white/25'}`}>
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
                    className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${size === o.value ? 'border-orange-500/70 bg-orange-500/[0.08] shadow-[0_0_16px_rgba(249,115,22,0.12)]' : 'border-white/[0.08] hover:border-white/25'}`}>
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
              <p className="text-sm text-zinc-400">
                This editor runs in your browser; the remapping is done by a small daemon on your
                computer. Once it is running you can close this tab and your keys keep working.
              </p>
              <p className="text-sm text-zinc-400">
                Run this once to start it now and at every login:
              </p>
              <CopyableCommand cmd="systemctl --user enable --now keymapper" />
              <p className="text-xs text-zinc-500 leading-relaxed pt-1">
                A web page cannot start a background service itself, so this is the one step that
                belongs in a terminal. Everything after it happens here.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-white/[0.06]">
          <button onClick={() => setStep(s => s - 1)} disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-0 transition-all">
            <ChevronLeft size={16} /> Back
          </button>
          {isLast ? (
            <button onClick={finish} disabled={applying}
              className="flex items-center gap-1.5 px-6 py-2 rounded-lg text-sm font-semibold btn-primary text-white disabled:opacity-50 transition-colors">
              {applying ? 'Applying…' : 'Get started'} {!applying && <ChevronRight size={16} />}
            </button>
          ) : (
            <button onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 px-6 py-2 rounded-lg text-sm font-semibold btn-primary text-white transition-colors">
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
  onDisconnect: () => void;
  backendKind: Backend['kind'];
}

function SettingsPanel({ settings, onSettingsChange, onClose, onDisconnect, backendKind }: SettingsPanelProps) {
  function ToggleRow({ label, desc, value, onChange, disabled }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
      <label className={`flex items-start justify-between gap-4 p-3 rounded-xl border transition-colors cursor-pointer ${value ? 'border-orange-500/50 bg-orange-500/[0.06]' : 'border-white/[0.07] hover:border-white/15'} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => onChange(!value)}>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
        </div>
        <div className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${value ? 'bg-gradient-to-b from-orange-400 to-orange-600 shadow-[0_0_10px_rgba(249,115,22,0.4)]' : 'bg-white/10'}`}>
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
      <div className="flex items-center bg-black/30 border border-white/[0.08] rounded-lg p-0.5 gap-0.5 flex-wrap">
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${value === o.value ? 'btn-primary text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-end animate-fade-in" onClick={onClose}>
      <div className="bg-zinc-950/85 backdrop-blur-2xl border-l border-white/10 h-full w-[380px] flex flex-col shadow-2xl animate-slide-in-right" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06] shrink-0">
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

          <div className="border-t border-white/[0.06]" />

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

          <div className="border-t border-white/[0.06]" />

          {/* Startup — a web page cannot enable a login service, so it hands
              over the commands that do. */}
          <div>
            <SectionTitle>Startup</SectionTitle>
            <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
              Run the daemon at every login, so your remappings are there before you open anything.
            </p>
            <div className="space-y-2">
              <CopyableCommand cmd="systemctl --user enable --now keymapper" />
              <CopyableCommand cmd="systemctl --user disable keymapper" />
            </div>
          </div>

          <div className="border-t border-white/[0.06]" />

          {/* Where the config comes from */}
          <div>
            <SectionTitle>{backendKind === 'directory' ? 'Config folder' : 'Config file'}</SectionTitle>
            <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
              {backendKind === 'directory'
                ? <>This page reads and writes <code className="text-zinc-400">{api.CONFIG_FILE}</code> in
                   the folder you granted. Forgetting it does not delete anything — you will just be
                   asked to pick it again.</>
                : <>This page is working on an uploaded copy of <code className="text-zinc-400">{api.CONFIG_FILE}</code>.
                   Starting over lets you open a different one — download anything you want to keep first.</>}
            </p>
            <button onClick={onDisconnect}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2">
              {backendKind === 'directory' ? 'Forget this folder' : 'Open a different config'}
            </button>
          </div>

          <div className="border-t border-white/[0.06]" />

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
  const glow: Record<DaemonStatus, string> = {
    active:'shadow-[0_0_8px_rgba(34,197,94,0.9)]', inactive:'', 'not-installed':'shadow-[0_0_8px_rgba(239,68,68,0.8)]', loading:'', unknown:'',
  };
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.07] rounded-full px-3 py-1.5">
      <span className={`w-2 h-2 rounded-full ${colors[status]} ${glow[status]}`} />
      {labels[status]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

function defaultProfile(name: string): Profile {
  return { name, device: null, layers: [{ name: 'base', trigger: null, mappings: [] }], socd_pairs: [] };
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

// ---------------------------------------------------------------------------
// Talking to the machine
//
// The editor runs in a browser and the daemon runs on the computer; they meet
// only through the files in the KeyMapper folder. Everything in this section
// covers the seam — granting the folder, and the few things a website cannot
// do for you (installing a service, starting one) where instructions are the
// honest answer.
// ---------------------------------------------------------------------------

function CopyableCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-black/40 border border-white/[0.07] rounded-lg px-3 py-2 font-mono text-xs">
      <Terminal size={13} className="text-zinc-600 shrink-0" />
      <code className="flex-1 text-zinc-300 overflow-x-auto whitespace-pre">{cmd}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        title="Copy" className="shrink-0 p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/// Shown until we have somewhere to read and write.
///
/// Two ways in. Chromium browsers can be given the folder itself, which makes
/// saving instant. Everywhere else the config is uploaded and downloaded by
/// hand — slower, but it reaches the same file, and the daemon cannot tell the
/// difference.
function ConnectScreen({
  onConnect, onUseFiles, onDropFiles, onSkipToPractice, error,
}: {
  onConnect: () => void;
  onUseFiles: () => void;
  onDropFiles: (files: FileList) => void;
  onSkipToPractice: () => void;
  error: string | null;
}) {
  const supported = api.supportsDirectAccess();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-[560px] bg-[#141418] border border-white/10 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]">
            <Keyboard className="text-white" size={21} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {supported ? 'Open your KeyMapper folder' : 'Open your config'}
          </h2>
        </div>

        {supported && (
          <>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Your mappings live in a file on your computer, and the daemon watches it. Grant this
              page access to the <strong className="text-zinc-200">{FOLDER_NAME}</strong> folder in
              your home directory and every change you save applies straight away.
            </p>
            <button onClick={onConnect}
              className="mt-5 w-full btn-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              <FolderOpen size={15} /> Choose folder
            </button>
            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-white/[0.07]" />
              <span className="text-xs text-zinc-600">or</span>
              <div className="flex-1 h-px bg-white/[0.07]" />
            </div>
          </>
        )}

        {!supported && (
          <p className="text-sm text-zinc-400 leading-relaxed mb-4">
            This browser cannot hand a page a folder to write to — only Chromium browsers implement
            that. Upload your <code className="text-zinc-300">{api.CONFIG_FILE}</code> instead, edit
            it here, and download it back when you are done.
          </p>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); onDropFiles(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          className={`rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${dragging ? 'border-orange-500 bg-orange-500/[0.06]' : 'border-white/15 hover:border-white/30'}`}>
          <Upload className="mx-auto mb-2 text-zinc-500" size={18} />
          <p className="text-sm text-zinc-300">Drop {api.CONFIG_FILE} here, or click to choose</p>
          <p className="text-xs text-zinc-500 mt-1">
            From <code>{FOLDER_NAME}</code> in your home folder. You can add{' '}
            <code>devices.json</code> too, to fill in the keyboard list.
          </p>
          <input ref={fileInput} type="file" multiple hidden
            accept=".yaml,.yml,.json"
            onChange={e => { if (e.target.files) onDropFiles(e.target.files); }} />
        </div>

        <button onClick={onUseFiles}
          className="mt-3 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2">
          Start from a blank config instead
        </button>

        {/* The typing trainer needs no config and no daemon — it can drill the
            board exactly as its keycaps are printed. Someone who came only to
            practise should not have to set up a remapper first. */}
        <div className="mt-6 pt-5 border-t border-white/[0.06]">
          <button onClick={onSkipToPractice}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.08] hover:border-white/25 transition-colors text-left group">
            <GraduationCap size={18} className="text-zinc-500 group-hover:text-orange-400 transition-colors shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Just practise typing</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Skip the setup. Drills your keyboard as its keycaps read — no config, no daemon.
              </p>
            </div>
          </button>
        </div>

        <div className="mt-5 pt-5 border-t border-white/[0.06]">
          <p className="text-xs text-zinc-500 mb-2">
            No config yet? Install the daemon and run it once — it creates one for you.
          </p>
          <DaemonSetupSteps />
        </div>
      </div>
    </div>
  );
}

/// The commands the Tauri app used to run for you. A page in a browser cannot
/// install a service or start a process, so it hands them over instead.
function DaemonSetupSteps() {
  return (
    <div className="space-y-2">
      <CopyableCommand cmd="cargo build --release -p daemon" />
      <CopyableCommand cmd="systemctl --user enable --now keymapper" />
    </div>
  );
}

function DaemonHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#141418] border border-white/10 rounded-2xl w-[520px] shadow-2xl animate-pop-in"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h3 className="font-semibold">Running the daemon</h3>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-5 text-sm">
          <p className="text-zinc-400 leading-relaxed">
            The daemon does the remapping and runs independently of this page — once it is going you
            can close the browser and your keys keep working.
          </p>
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Start it, and at every login</p>
            <CopyableCommand cmd="systemctl --user enable --now keymapper" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Stop it</p>
            <CopyableCommand cmd="systemctl --user stop keymapper" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Don't start it at login</p>
            <CopyableCommand cmd="systemctl --user disable keymapper" />
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Saving in this editor never needs a restart — the daemon watches the config file and
            picks changes up as you make them.
          </p>
        </div>
      </div>
    </div>
  );
}

/// Configs can run shell commands, so an imported one is somebody else's
/// script. This is the gate in front of saving it.
function CommandWarning({ uses, onAccept, onCancel }: { uses: CommandUse[]; onAccept: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-[#141418] border border-red-500/30 rounded-2xl w-[560px] shadow-2xl animate-pop-in">
        <div className="flex items-center gap-3 p-5 border-b border-white/[0.06]">
          <AlertCircle className="text-red-400 shrink-0" size={18} />
          <h3 className="font-semibold">This config runs shell commands</h3>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-zinc-400 leading-relaxed">
            The daemon executes these with your account's full permissions whenever the key is
            pressed. Only continue if you trust where this config came from.
          </p>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {uses.map((u, i) => (
              <div key={i} className="bg-black/40 border border-white/[0.07] rounded-lg px-3 py-2">
                <p className="text-xs text-zinc-500">{u.profile} · {u.layer} · {dk(u.from)}</p>
                <code className="text-xs text-red-300 font-mono break-all">{u.cmd}</code>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:bg-white/[0.07] transition-colors">Cancel</button>
            <button onClick={onAccept}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/90 hover:bg-red-500 text-white transition-colors">
              I trust this, save it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FOLDER_NAME = 'KeyMapper';

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [showDaemonHelp, setShowDaemonHelp] = useState(false);
  /// Came in through "just practise typing", so the config is a throwaway and
  /// the trainer defaults to drilling the physical keycaps.
  const [practiceOnly, setPracticeOnly] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<{ uses: CommandUse[]; config: Config } | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>('loading');
  const [daemonLayer, setDaemonLayer] = useState('base');
  const [configError, setConfigError] = useState<string | null>(null);
  /// Set once the user has vouched for this config's shell commands, so the
  /// warning is a gate on importing someone else's rather than a nag on every save.
  const [trustedCommands, setTrustedCommands] = useState(false);
  const [view, setView] = useState<'mappings' | 'layout' | 'practice'>('mappings');
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
  const [devices, setDevices] = useState<KbDevice[]>([]);

  // Reconnect to a folder granted on an earlier visit. Chromium remembers the
  // grant, so the common case is that this succeeds and no picker is shown.
  useEffect(() => {
    api.restore()
      .then(setBackend)
      .catch(() => setBackend(null))
      .finally(() => setConnecting(false));
  }, []);

  const connect = useCallback(async () => {
    setConnectError(null);
    try {
      // A previously granted folder whose permission has lapsed can be
      // reclaimed without making the user find it again.
      const b = (await api.reauthorize()) ?? (await api.connect());
      if (b) setBackend(b);
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  /// Take on files the user dropped or picked. Recognised by name, because
  /// that is how they sit in the KeyMapper folder — anything else is ignored
  /// rather than guessed at.
  const takeFiles = useCallback(async (files: FileList) => {
    setConnectError(null);
    let next = backend ?? api.useFiles();
    let matched = false;
    for (const file of Array.from(files)) {
      const name = file.name === 'config.yml' ? api.CONFIG_FILE : file.name;
      if (!['config.yaml', 'devices.json', 'state.json', 'typing_stats.json'].includes(name)) continue;
      next = api.addFile(next, name, await file.text());
      matched = true;
    }
    if (!matched) {
      setConnectError(`Expected ${api.CONFIG_FILE} — that file was not recognised.`);
      return;
    }
    setBackend(next);
  }, [backend]);

  const startBlank = useCallback(async () => {
    setBackend(await api.seedConfig(api.useFiles(), api.defaultConfig()));
  }, []);

  /// Straight to the typing trainer. It needs a profile to describe a layout,
  /// but not a real one — in Raw mode it drills the board as its keycaps are
  /// printed, which is exactly what someone who skipped the setup wants. The
  /// wizard is marked done so nothing stands between the click and typing.
  const startPractice = useCallback(async () => {
    const cfg = api.defaultConfig();
    cfg.settings.first_launch = false;
    setPracticeOnly(true);
    setView('practice');
    setBackend(await api.seedConfig(api.useFiles(), cfg, { persistDraft: false }));
  }, []);

  useEffect(() => {
    if (!backend) { setDevices([]); return; }
    api.listKeyboards(backend).then(setDevices).catch(() => setDevices([]));
  }, [backend]);

  const checkDaemon = useCallback(async () => {
    if (!backend) { setDaemonStatus('unknown'); return; }
    try {
      const state = await api.getDaemonState(backend);
      setDaemonStatus(state.status);
      setDaemonLayer(state.layer);
    } catch {
      setDaemonStatus('unknown');
    }
  }, [backend]);

  const loadConfig = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setConfigError(null);
    // Trusting one config's shell commands says nothing about the next one's.
    setTrustedCommands(false);
    try {
      setConfig(await api.getConfig(backend));
      setProfileIdx(0);
      setLayerIdx(0);
      setIsDirty(false);
    } catch (e) {
      // A config the daemon would refuse should be reported precisely rather
      // than shown as a blank editor — ConfigError carries the offending path.
      setConfig(null);
      setConfigError(e instanceof ConfigError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    loadConfig();
    checkDaemon();
  }, [backend, loadConfig, checkDaemon]);

  // The daemon republishes state.json on a heartbeat; poll it faster while the
  // layout view is showing live layer changes, and slowly the rest of the time
  // just to keep the status dot honest.
  useEffect(() => {
    if (!backend) return;
    const period = view === 'layout' && daemonStatus === 'active' ? 250 : 3000;
    const id = setInterval(checkDaemon, period);
    return () => clearInterval(id);
  }, [backend, view, daemonStatus, checkDaemon]);

  useEffect(() => {
    if (view !== 'layout' || daemonStatus !== 'active') {
      if (liveLayerIdxRef.current !== null) {
        setLiveLayerIdx(null);
        setLayerIdx(manualLayerRef.current);
      }
      return;
    }
    const prof = configRef.current?.profiles[profileIdxRef.current];
    if (!prof) return;
    const i = daemonLayer && daemonLayer !== 'base' ? prof.layers.findIndex(l => l.name === daemonLayer) : -1;
    const newIdx = i >= 0 ? i : null;
    if (newIdx !== liveLayerIdxRef.current) {
      setLiveLayerIdx(newIdx);
      setLayerIdx(newIdx !== null ? newIdx : manualLayerRef.current);
    }
  }, [view, daemonStatus, daemonLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // On the upload path an unsaved edit exists nowhere but this tab, so keep a
  // draft current. Debounced, because it runs on every keystroke in a modal.
  useEffect(() => {
    if (!config || backend?.kind !== 'files') return;
    const id = setTimeout(() => { api.saveDraft(config).catch(() => {}); }, 500);
    return () => clearTimeout(id);
  }, [config, backend]);

  /// The single path from the editor to disk. The daemon is watching the file,
  /// so there is nothing to restart and no reload to trigger — writing *is*
  /// applying, and that is exactly why the shell-command gate lives here
  /// rather than on the Save button. Switching profile and finishing the
  /// wizard both write too, and neither may be a way around it.
  const writeConfig = useCallback(async (c: Config, force = false) => {
    if (!backend) return;
    if (!force && !trustedCommands) {
      const uses = commandMappings(c);
      if (uses.length > 0) { setPendingCommands({ uses, config: c }); return; }
    }
    setSaving(true);
    try {
      await api.saveConfig(backend, c);
      setConfig(c);
      setIsDirty(false);
      setSavedToken(t => t + 1);
    } catch (e) {
      alert('Save failed: ' + e);
    } finally {
      setSaving(false);
    }
  }, [backend, trustedCommands]);

  const saveConfig = async () => {
    if (config) await writeConfig(config);
  };

  function mutate(fn: (c: Config) => void) {
    setConfig(c => { if (!c) return c; const n = JSON.parse(JSON.stringify(c)) as Config; fn(n); return n; });
    setIsDirty(true);
  }

  function mutateSettings(patch: Partial<AppSettings>) {
    mutate(c => { c.settings = { ...c.settings, ...patch }; });
  }

  function handleWizardComplete(s: AppSettings) {
    // On a granted folder, save immediately so first_launch=false sticks even
    // if the tab is closed without a further save. On the upload path that
    // would mean a download the moment the wizard closes, which is not what
    // finishing a wizard should do — the draft in IndexedDB covers the reload
    // case there instead.
    const toFiles = backend?.kind === 'files';
    if (!config) return;
    const n: Config = { ...config, settings: s };
    setConfig(n);
    setIsDirty(toFiles);
    if (!toFiles) writeConfig(n).catch(() => {});
  }

  async function setActiveProfile(name: string) {
    if (!config || !backend) return;
    const updated: Config = { ...config, active_profile: name };
    // Writing to a granted folder is invisible, so do it immediately. On the
    // upload path it would fire off a download from a dropdown change, so mark
    // it dirty and let the user choose when to take the file.
    if (backend.kind === 'files') {
      setConfig(updated);
      setIsDirty(true);
      return;
    }
    await writeConfig(updated);
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

  // Per-device profile assignment (Linux). Matcher is "vendor:product" or a
  // device-name substring; empty = profile follows the global active switch.
  function setProfileDevice(v: string) {
    mutate(c => { c.profiles[profileIdx].device = v || null; });
  }

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

  // Nothing can be shown until we have a folder to read: the config, the
  // device list and the daemon's status all come out of it.
  if (connecting) {
    return (
      <div className="app-bg flex h-screen items-center justify-center text-zinc-500 font-sans">
        Loading…
      </div>
    );
  }
  if (!backend) {
    return (
      <div className="app-bg flex h-screen flex-col text-zinc-100 font-sans select-none">
        <ConnectScreen
          onConnect={connect}
          onUseFiles={startBlank}
          onDropFiles={takeFiles}
          onSkipToPractice={startPractice}
          error={connectError}
        />
      </div>
    );
  }

  return (
    <div className="app-bg flex h-screen flex-col text-zinc-100 font-sans select-none">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/[0.06] bg-zinc-950/50 backdrop-blur-xl px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-[0_0_16px_rgba(249,115,22,0.35),inset_0_1px_0_rgba(255,255,255,0.3)]">
            <Keyboard className="text-white" size={17} />
          </div>
          <h1 className="text-lg font-bold tracking-tight">KeyMapper</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-white/[0.04] border border-white/[0.07] rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setView('mappings')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'mappings' ? 'bg-white/[0.1] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <List size={14} /> Mappings
            </button>
            <button onClick={() => setView('layout')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'layout' ? 'bg-white/[0.1] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <LayoutGrid size={14} /> Layout
            </button>
            <button onClick={() => setView('practice')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'practice' ? 'bg-white/[0.1] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <GraduationCap size={14} /> Practice
            </button>
          </div>

          {/* The daemon's own lifecycle belongs to the machine, not to this
              page — the status is read from its heartbeat, and the button
              hands over the commands to change it. */}
          <button onClick={() => setShowDaemonHelp(true)}
            title={daemonStatus === 'unknown'
              ? 'Upload state.json to see whether the daemon is running'
              : daemonStatus === 'active' ? 'Daemon running' : 'Daemon not running'}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            <StatusDot status={daemonStatus} />
            {daemonStatus === 'active' ? 'Running'
              : daemonStatus === 'loading' ? ''
              // Without live files we genuinely do not know, and saying
              // "Not running" would be a guess presented as a fact.
              : daemonStatus === 'unknown' ? 'Daemon'
              : 'Not running'}
          </button>
          <button onClick={loadConfig} title="Reload from disk" className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.07] rounded-lg transition-colors"><RefreshCw size={16} /></button>
          <button onClick={() => setShowSettings(true)} title="Settings" className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.07] rounded-lg transition-colors"><Settings size={16} /></button>
          {/* On the upload path there is no folder to write to, so saving
              means handing the file back. Label it for what it does. */}
          <button onClick={saveConfig} disabled={!config || saving}
            title={backend.kind === 'files' ? `Download ${api.CONFIG_FILE} to put in your ${FOLDER_NAME} folder` : undefined}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isDirty ? 'btn-primary text-white ring-1 ring-orange-300/70' : 'btn-primary text-white'}`}>
            {backend.kind === 'files' ? <Download size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : backend.kind === 'files' ? (isDirty ? 'Download*' : 'Download') : (isDirty ? 'Save*' : 'Save')}
          </button>
        </div>
      </header>

      {/* The upload path cannot see the daemon or write to it, so it says
          plainly what the extra step is instead of pretending otherwise. */}
      {backend.kind === 'files' && (
        <div className="flex items-start gap-3 bg-white/[0.03] border-b border-white/[0.07] px-5 py-2.5 shrink-0">
          <Download className="text-zinc-500 mt-0.5 shrink-0" size={14} />
          <p className="text-xs text-zinc-400 flex-1 leading-relaxed">
            This browser cannot write to your folder, so <strong className="text-zinc-200">Download</strong>{' '}
            saves <code className="text-zinc-300">{api.CONFIG_FILE}</code> and you move it into{' '}
            <code className="text-zinc-300">{FOLDER_NAME}</code> in your home folder. The daemon
            applies it the moment it lands — no restart.
          </p>
        </div>
      )}

      {/* Daemon banner. "Not installed" here means the daemon has never run in
          this folder — it publishes state.json on startup, so its absence is
          the signal. */}
      {daemonStatus === 'not-installed' && (
        <div className="flex items-start gap-3 bg-orange-500/[0.05] border-b border-orange-500/20 px-5 py-3 shrink-0">
          <AlertCircle className="text-orange-500 mt-0.5 shrink-0" size={15} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">The daemon has not run yet</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              You can build your mappings here regardless — they take effect the moment it starts.
            </p>
          </div>
          <button onClick={() => setShowDaemonHelp(true)}
            className="shrink-0 btn-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium">
            How to start it
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">Loading…</div>
      ) : configError ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg text-center">
            <AlertCircle className="text-red-400 mx-auto mb-3" size={22} />
            <p className="text-sm font-medium mb-1">This config file cannot be read</p>
            <p className="text-xs text-zinc-500 font-mono break-words">{configError}</p>
            <p className="text-xs text-zinc-500 mt-3">
              Fix it by hand, or start over — the daemon writes a fresh {api.CONFIG_FILE} if you
              remove the broken one.
            </p>
          </div>
        </div>
      ) : !config ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          No {api.CONFIG_FILE} in this folder yet — start the daemon once and it will create one.
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Profile tabs */}
          <div className="flex items-center gap-0.5 px-4 pt-2 pb-0 border-b border-white/[0.06] shrink-0 overflow-x-auto">
            {config.profiles.map((p, i) => (
              <div key={p.name} className="flex items-center group">
                <button onClick={() => { setProfileIdx(i); setLayerIdx(0); }}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${i === profileIdx ? 'border-orange-500 text-orange-400 bg-gradient-to-b from-white/[0.05] to-transparent' : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'}`}>
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
                  placeholder="Profile name" className="bg-black/30 border border-white/[0.1] rounded-lg px-2 py-1 text-sm outline-none focus:border-orange-500/60 placeholder:text-zinc-600 w-32" />
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
                <div className="flex items-center bg-white/[0.04] border border-white/[0.07] rounded-lg p-0.5 gap-0.5">
                  {profile.layers.map((l, i) => (
                    <div key={i} className="flex items-center group">
                      <button onClick={() => { manualLayerRef.current = i; setLayerIdx(i); }}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                          i === layerIdx
                            ? liveLayerIdx === i ? 'bg-violet-600 text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]' : 'btn-primary text-white'
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
                <div className="ml-auto flex items-center gap-2" title="Pin this profile to one keyboard (e.g. a QMK board). Its bindings then apply only to that device; other keyboards keep using the active profile.">
                  <span className="text-xs text-zinc-500">Keyboard</span>
                  <select value={profile.device ?? ''} onChange={e => setProfileDevice(e.target.value)}
                    className="bg-white/[0.04] border border-white/[0.07] rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-orange-500 max-w-[240px]">
                    <option value="">All keyboards</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
                    {profile.device && !devices.some(d => d.id === profile.device) && (
                      <option value={profile.device}>{profile.device} (not connected)</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Main view */}
              {view === 'practice' ? (
                <TypingView
                  backend={backend}
                  initialMode={practiceOnly ? 'raw' : 'auto'}
                  profile={profile}
                  layerIdx={layerIdx}
                  settings={config.settings}
                  daemonStatus={daemonStatus}
                  active={view === 'practice' && !mappingModal && !socdModal && !layerModal && !showSettings && !config.settings.first_launch}
                />
              ) : view === 'layout' ? (
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
                    <div className="panel rounded-2xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
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
                          <thead className="bg-white/[0.03]">
                            <tr>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider w-28">From</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider w-24">Behavior</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Target</th>
                              <th className="px-4 py-2.5 w-12" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.05]">
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
                  <div className="panel rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
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
                        <thead className="bg-white/[0.03]">
                          <tr>
                            <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Keys</th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Mode</th>
                            <th className="px-4 py-2.5 w-12" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
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
      {showDaemonHelp && <DaemonHelp onClose={() => setShowDaemonHelp(false)} />}
      {pendingCommands && (
        <CommandWarning
          uses={pendingCommands.uses}
          onCancel={() => setPendingCommands(null)}
          onAccept={async () => {
            const { config: pending } = pendingCommands;
            setPendingCommands(null);
            setTrustedCommands(true);
            await writeConfig(pending, true);
          }}
        />
      )}
      {config?.settings.first_launch && <FirstLaunchWizard onComplete={handleWizardComplete} />}
      {showSettings && config && (
        <SettingsPanel
          settings={config.settings}
          onSettingsChange={mutateSettings}
          onClose={() => setShowSettings(false)}
          backendKind={backend.kind}
          onDisconnect={async () => {
            await api.disconnect();
            setBackend(null);
            setConfig(null);
            setPracticeOnly(false);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
