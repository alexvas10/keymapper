// ---------------------------------------------------------------------------
// The one place the app touches the outside world.
//
// Everything the UI needs from the machine goes through a `Backend`. There is
// one implementation today — a folder the user grants us through the File
// System Access API — and a second planned (plain download/upload) for the
// browsers that lack those pickers. The UI is written against the interface so
// adding it is a new file, not a rewrite.
//
// The daemon is not a server and has no API. It reads and writes four files in
// one folder, and this module reads and writes the same four:
//
//   config.yaml        the mappings — we write, the daemon watches and reloads
//   state.json         the daemon's heartbeat and active layer — it writes
//   devices.json       connected keyboards — it writes
//   typing_stats.json  practice progress — ours alone
//
// Note the folder is `~/KeyMapper`, not `~/.config/keymapper`. Chromium
// blocklists the platform config directory from its file pickers outright
// (`~/.config`, `%APPDATA%`, `~/Library`), so a browser cannot reach a file
// there even with the user's explicit consent.
// ---------------------------------------------------------------------------

import { parseConfig, serializeConfig } from './config-io';
import * as storage from './storage';
import type { Config, DaemonStatus, KbDevice } from './types';

export const CONFIG_FILE = 'config.yaml';
const STATE_FILE = 'state.json';
const DEVICES_FILE = 'devices.json';
const STATS_FILE = 'typing_stats.json';

/// The folder the daemon uses, for the instructions the UI shows when someone
/// has to find it in a picker.
export const FOLDER_HINT = 'KeyMapper, in your home folder';

// ---------------------------------------------------------------------------
// Missing DOM types
//
// `FileSystemDirectoryHandle` is in lib.dom, but the picker that produces one
// and the permission methods that keep it usable are not.
// ---------------------------------------------------------------------------

type PermissionState = 'granted' | 'denied' | 'prompt';
interface HandlePermissionDescriptor { mode?: 'read' | 'readwrite' }

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?: (d?: HandlePermissionDescriptor) => Promise<PermissionState>;
    requestPermission?: (d?: HandlePermissionDescriptor) => Promise<PermissionState>;
  }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export interface Backend {
  /// How this backend reaches the files, for the UI's connection indicator.
  readonly kind: 'directory' | 'files';
  /// Whether reads come straight from disk. False for uploaded copies, which
  /// are a snapshot from whenever the user picked them — fine for the keyboard
  /// list, useless for a heartbeat.
  readonly live: boolean;
  readText(name: string): Promise<string | null>;
  writeText(name: string, contents: string): Promise<void>;
}

class DirectoryBackend implements Backend {
  readonly kind = 'directory' as const;
  readonly live = true;

  constructor(private readonly dir: FileSystemDirectoryHandle) {}

  async readText(name: string): Promise<string | null> {
    try {
      const handle = await this.dir.getFileHandle(name);
      return await (await handle.getFile()).text();
    } catch (e) {
      // A missing file is a normal state, not an error: devices.json does not
      // exist until the daemon has run once, and config.yaml does not exist on
      // a fresh install.
      if ((e as DOMException).name === 'NotFoundError') return null;
      throw e;
    }
  }

  async writeText(name: string, contents: string): Promise<void> {
    const handle = await this.dir.getFileHandle(name, { create: true });
    // Chromium writes to a swap file and renames it into place on close, which
    // replaces the inode. The daemon watches the containing directory rather
    // than the file for exactly this reason.
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  }
}

/// Files the user hands us, for browsers without the folder pickers — Firefox,
/// Safari, and the Gecko-based forks.
///
/// Reads come from whatever has been uploaded; writes go to memory, and reach
/// the disk when the user downloads the result. That round trip is manual, but
/// it is the only part that is: the daemon still applies the file the instant
/// it lands in the folder, because it is watching, not being told.
class FilesBackend implements Backend {
  readonly kind = 'files' as const;
  readonly live = false;

  constructor(private readonly files: Map<string, string> = new Map()) {}

  async readText(name: string): Promise<string | null> {
    return this.files.get(name) ?? null;
  }

  async writeText(name: string, contents: string): Promise<void> {
    this.files.set(name, contents);
  }

  /// Take on an uploaded file. Returns a new backend so React sees a changed
  /// identity and re-reads, rather than mutating one it is already holding.
  withFile(name: string, contents: string): FilesBackend {
    const next = new Map(this.files);
    next.set(name, contents);
    return new FilesBackend(next);
  }

  has(name: string): boolean {
    return this.files.has(name);
  }
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

export const supportsDirectAccess = () => typeof window.showDirectoryPicker === 'function';

/// Start an upload/download session. Nothing is read from disk until the user
/// hands over a file.
export const useFiles = (): Backend => new FilesBackend();

export function addFile(backend: Backend, name: string, contents: string): Backend {
  return backend instanceof FilesBackend ? backend.withFile(name, contents) : backend;
}

/// Whether an uploaded copy of one of the daemon's files is present.
export const hasFile = (backend: Backend, name: string): boolean =>
  backend instanceof FilesBackend ? backend.has(name) : true;

/// Hand the user a file to save. The browser writes it wherever downloads go;
/// moving it into the KeyMapper folder is the one manual step in this path.
export function download(name: string, contents: string, mime = 'text/yaml'): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for it to have started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/// Keep work in progress in the browser. Only meaningful on the upload path,
/// where a refresh has no file on disk to reload from.
export const saveDraft = (config: Config) => storage.saveDraft(serializeConfig(config));

/// Put a config into the session without handing the user a download. Starting
/// from scratch is not yet a save, and a file landing in Downloads before the
/// user has changed anything would be noise.
/// `persistDraft` is false for a throwaway config — the one behind "just
/// practise typing" — so that skipping setup never overwrites the draft of a
/// real config someone was part way through editing.
export async function seedConfig(
  backend: Backend,
  config: Config,
  { persistDraft = true }: { persistDraft?: boolean } = {},
): Promise<Backend> {
  const yaml = serializeConfig(config);
  await backend.writeText(CONFIG_FILE, yaml);
  if (persistDraft) await storage.saveDraft(yaml);
  return addFile(backend, CONFIG_FILE, yaml);
}

/// The same starting point the daemon writes when it finds no config, so a
/// first-time user on either path begins from the same place.
export function defaultConfig(): Config {
  return {
    profiles: [{
      name: 'default',
      device: null,
      layers: [{
        name: 'base',
        trigger: null,
        mappings: [{
          from: 'CapsLock',
          to: { type: 'mod_tap', hold: 'ControlLeft', tap: 'Escape', hold_ms: 200 },
        }],
      }],
      socd_pairs: [],
    }],
    active_profile: 'default',
    settings: {
      first_launch: true,
      keyboard_size: 'tkl',
      keyboard_style: 'ansi',
      keyboard_layout: 'qwerty',
      auto_save_on_start: false,
    },
  };
}

/// Ask for the KeyMapper folder and remember it. Returns null if the user
/// dismisses the picker, which is a normal outcome and not an error.
export async function connect(): Promise<Backend | null> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot open a folder.');
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({
      id: 'keymapper-config',
      mode: 'readwrite',
      // Chromium blocks its own config directory, so home is the useful start.
      startIn: 'home',
    });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
  await storage.saveDirHandle(dir);
  return new DirectoryBackend(dir);
}

/// Reconnect to a previously granted folder without showing a picker.
///
/// Returns null when there is no saved folder, or when the grant has lapsed —
/// permission can only be re-requested from a user gesture, so the UI has to
/// offer a button rather than this doing it silently.
export async function restore(): Promise<Backend | null> {
  const dir = await storage.loadDirHandle();
  if (!dir) return null;
  const state = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  return state === 'granted' ? new DirectoryBackend(dir) : null;
}

/// Re-request a lapsed grant. Must be called from a click or key press.
export async function reauthorize(): Promise<Backend | null> {
  const dir = await storage.loadDirHandle();
  if (!dir) return null;
  const state = (await dir.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
  return state === 'granted' ? new DirectoryBackend(dir) : null;
}

export async function disconnect(): Promise<void> {
  await storage.forgetDirHandle();
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// Read and validate the config. Returns null when the folder has none yet,
/// which is how the UI knows to offer its first-run setup instead of an error.
export async function getConfig(backend: Backend): Promise<Config | null> {
  let yaml = await backend.readText(CONFIG_FILE);
  // On the upload path there is no file to re-read on a revisit, so a saved
  // draft is what stops a refresh from throwing the work away.
  if (yaml === null && backend.kind === 'files') yaml = (await storage.loadDraft()) ?? null;
  return yaml === null ? null : parseConfig(yaml);
}

export async function saveConfig(backend: Backend, config: Config): Promise<void> {
  const yaml = serializeConfig(config);
  await backend.writeText(CONFIG_FILE, yaml);
  // Keep the draft in step so a reload after a save does not resurrect an
  // older version of the mappings.
  await storage.saveDraft(yaml);
  // With no folder to write to, saving means handing the file over — the user
  // moves it into place and the daemon takes it from there.
  if (backend.kind === 'files') download(CONFIG_FILE, yaml);
}

// ---------------------------------------------------------------------------
// What the daemon publishes
// ---------------------------------------------------------------------------

interface DaemonStateFile {
  layer?: string;
  pid?: number;
  version?: string;
  updated_at?: number;
}

export interface DaemonState {
  status: DaemonStatus;
  layer: string;
  version: string | null;
  pid: number | null;
}

/// The daemon refreshes its heartbeat every 5 seconds. Allow several missed
/// beats before calling it stopped — a machine under load, or a clock that has
/// just been adjusted, should not flip the indicator.
const STALE_AFTER_SECONDS = 20;

export async function getDaemonState(backend: Backend): Promise<DaemonState> {
  const idle: DaemonState = { status: 'inactive', layer: 'base', version: null, pid: null };
  // An uploaded state.json was true whenever it was picked; reporting it as
  // live status would be a guess dressed up as a fact.
  if (!backend.live) return { ...idle, status: 'unknown' };

  const text = await backend.readText(STATE_FILE);
  // No state file at all means the daemon has never run here.
  if (text === null) return { ...idle, status: 'not-installed' };

  let state: DaemonStateFile;
  try {
    state = JSON.parse(text) as DaemonStateFile;
  } catch {
    return idle;
  }

  const age = Date.now() / 1000 - (state.updated_at ?? 0);
  return {
    status: age < STALE_AFTER_SECONDS ? 'active' : 'inactive',
    layer: state.layer ?? 'base',
    version: state.version ?? null,
    pid: state.pid ?? null,
  };
}

/// Keyboards the daemon has grabbed, for pinning a profile to one board.
/// Empty on Windows and macOS, where per-device profiles do not exist.
export async function listKeyboards(backend: Backend): Promise<KbDevice[]> {
  // Works on either path: a keyboard list does not go stale the way a
  // heartbeat does, so an uploaded devices.json is perfectly good.
  const text = await backend.readText(DEVICES_FILE);
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is KbDevice =>
        typeof d === 'object' && d !== null && typeof (d as KbDevice).id === 'string',
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Typing-trainer progress
//
// Kept in the browser, and mirrored into the KeyMapper folder when we have it
// so that progress survives clearing site data and moves with the config.
// ---------------------------------------------------------------------------

export async function getTypingStats(backend: Backend | null): Promise<unknown> {
  const local = await storage.loadStats();
  if (local !== undefined) return local;
  if (!backend) return null;
  const text = await backend.readText(STATS_FILE);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveTypingStats(backend: Backend | null, stats: unknown): Promise<void> {
  await storage.saveStats(stats);
  if (backend) {
    try {
      await backend.writeText(STATS_FILE, JSON.stringify(stats));
    } catch {
      // The browser copy is the one that matters; a failed mirror is not worth
      // interrupting a practice session over.
    }
  }
}
