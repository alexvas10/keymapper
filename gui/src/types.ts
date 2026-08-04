// ---------------------------------------------------------------------------
// Config schema — mirrors shared/src/lib.rs
// ---------------------------------------------------------------------------

export interface AppSettings {
  first_launch: boolean;
  keyboard_size: string;
  keyboard_style: string;
  keyboard_layout: string;
  auto_save_on_start: boolean;
}

export interface Config {
  profiles: Profile[];
  active_profile: string;
  settings: AppSettings;
}

export interface Profile { name: string; device?: string | null; layers: Layer[]; socd_pairs: SocdPair[]; }
export interface KbDevice { name: string; id: string; }
export interface Layer { name: string; trigger: string | null; mappings: Mapping[]; }
export interface SocdPair { key1: string; key2: string; mode: SocdMode; }
export type SocdMode = 'last_input_priority' | 'neutral' | 'key1_priority' | 'key2_priority';
export interface Mapping { from: string; to: Target; }

export type Target =
  | { type: 'key'; key: string }
  | { type: 'mod_tap'; hold: string; tap: string; hold_ms: number }
  | { type: 'toggle'; key: string }
  | { type: 'command'; cmd: string }
  | { type: 'macro'; steps: MacroStep[] }
  | { type: 'layer'; name: string };

export interface MacroStep { action: MacroAction; delay_ms?: number | null; }
export type MacroAction = { type: 'press'; key: string } | { type: 'release'; key: string } | { type: 'tap'; key: string };

export type DaemonStatus = 'active' | 'inactive' | 'not-installed' | 'loading' | 'unknown';

export type KbSize = '60' | '65' | '75' | 'tkl' | '100';
export type KbStyle = 'ansi' | 'iso';
