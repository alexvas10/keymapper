import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Keyboard, Settings, Save, RefreshCw, Plus, Trash2 } from 'lucide-react';

interface KeyConfig {
  profiles: Profile[];
  active_profile: string;
}

interface Profile {
  name: string;
  mappings: Mapping[];
}

interface Mapping {
  from: string;
  to: any;
}

function App() {
  const [config, setConfig] = useState<KeyConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const res = await invoke<KeyConfig>('get_config');
      setConfig(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    try {
      await invoke('save_config', { config });
      alert('Config saved!');
    } catch (e) {
      alert('Error saving config: ' + e);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Loading...</div>;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <Keyboard className="text-orange-500" />
          <h1 className="text-xl font-bold">KeyMapper</h1>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={loadConfig} className="p-2 hover:bg-zinc-800 rounded-lg">
            <RefreshCw size={20} />
          </button>
          <button onClick={saveConfig} className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg font-medium transition-colors">
            <Save size={18} />
            Save
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Profiles</h2>
            <button className="text-orange-500 hover:text-orange-400">
              <Plus size={18} />
            </button>
          </div>
          <div className="space-y-1">
            {config?.profiles.map(profile => (
              <button
                key={profile.name}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  config.active_profile === profile.name ? 'bg-orange-600/20 text-orange-500' : 'hover:bg-zinc-800'
                }`}
              >
                {profile.name}
              </button>
            ))}
          </div>
        </aside>

        {/* Content */}
        <section className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-2">Visual Mapping</h2>
              <p className="text-zinc-400">Select a key to remap or create a macro.</p>
            </div>

            {/* Visual Keyboard Placeholder */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 mb-8 shadow-2xl">
              <div className="grid grid-cols-10 gap-2">
                {Array.from({ length: 30 }).map((_, i) => (
                  <div key={i} className="aspect-square bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center hover:border-orange-500 cursor-pointer transition-all">
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              </div>
            </div>

            {/* Mappings List */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-zinc-800/50 border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-3 text-sm font-semibold text-zinc-400">From</th>
                    <th className="px-6 py-3 text-sm font-semibold text-zinc-400">To</th>
                    <th className="px-6 py-3 text-sm font-semibold text-zinc-400 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {config?.profiles.find(p => p.name === config.active_profile)?.mappings.map((m, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 font-mono text-orange-400">{m.from}</td>
                      <td className="px-6 py-4 font-mono text-zinc-300">{typeof m.to === 'string' ? m.to : 'Macro'}</td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-zinc-500 hover:text-red-500 transition-colors">
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
