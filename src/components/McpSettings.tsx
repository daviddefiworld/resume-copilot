import { useEffect, useState } from 'react';
import { Check, ClipboardPaste, Pencil, Plug, Plus, RefreshCw, Trash2, Wrench, X } from 'lucide-react';
import { api } from '../api.ts';
import type { McpCatalogEntry, McpServerInput, McpServerView, McpTransport } from '../../shared/types.ts';

const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\you\\\\Documents"]
    },
    "remote-example": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}`;

// Settings → Tools. Install MCP servers (from a catalog or by hand) and manage
// the ones you have. Whatever is enabled here becomes tools the chat agent can
// call. The API key and connections live on the server; this view only configures.
type AddTab = 'catalog' | 'paste' | 'local' | 'remote';

export default function McpSettings() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Every way to add a tool — catalog, pasted JSON, and the manual local/remote
  // forms — lives behind one row of tabs instead of stacked sections.
  const [addTab, setAddTab] = useState<AddTab>('catalog');

  async function reload(): Promise<void> {
    setServers(await api.getMcpServers());
  }

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    api.getMcpCatalog().then(setCatalog).catch(() => {});
  }, []);

  async function run(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setError('');
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function add(input: McpServerInput): Promise<void> {
    setError('');
    const created = await api.addMcpServer(input);
    setServers((prev) => [...prev, created]);
  }

  // Save edits to an already-installed server. Throws on failure so the inline
  // edit form can surface the error and stay open with the user's changes.
  async function save(id: string, input: McpServerInput): Promise<void> {
    setBusyId(id);
    setError('');
    try {
      await api.updateMcpServer(id, input);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  const installedIds = new Set(servers.map((s) => s.name.toLowerCase()));

  return (
    <div className="mcpSettings">
      {error && <p className="error">{error}</p>}

      <section>
        <h3 className="mcpHeading">Installed tools</h3>
        {servers.length === 0 ? (
          <p className="hint">No tools yet. Install one from the catalog below, or add your own.</p>
        ) : (
          <div className="mcpList">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                busy={busyId === server.id}
                onToggle={() => run(server.id, () => api.updateMcpServer(server.id, { ...toInput(server), enabled: !server.enabled }))}
                onTest={() => run(server.id, () => api.testMcpServer(server.id))}
                onDelete={() => run(server.id, () => api.deleteMcpServer(server.id))}
                onSave={(input) => save(server.id, input)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mcpHeading">Add a tool</h3>
        <div className="mcpTabs" role="tablist">
          <button role="tab" className={addTab === 'catalog' ? 'on' : ''} onClick={() => setAddTab('catalog')}>Catalog</button>
          <button role="tab" className={addTab === 'paste' ? 'on' : ''} onClick={() => setAddTab('paste')}>Paste config</button>
          <button role="tab" className={addTab === 'local' ? 'on' : ''} onClick={() => setAddTab('local')}>Local</button>
          <button role="tab" className={addTab === 'remote' ? 'on' : ''} onClick={() => setAddTab('remote')}>Remote</button>
        </div>

        <div className="mcpTabBody">
          {addTab === 'catalog' && (
            <>
              <p className="hint">
                One-click installs. Local tools run through <code>npx</code>, so they need Node installed on this machine.
              </p>
              <div className="mcpCatalog">
                {catalog.map((entry) => (
                  <CatalogCard
                    key={entry.id}
                    entry={entry}
                    installed={installedIds.has(entry.name.toLowerCase())}
                    onInstall={(input) => add(input)}
                  />
                ))}
              </div>
            </>
          )}

          {addTab === 'paste' && <JsonImport onImported={reload} />}

          {addTab === 'local' && (
            <ServerForm key="add-local" lockTransport="stdio" submitLabel="Add tool" onSubmit={add} />
          )}

          {addTab === 'remote' && (
            <ServerForm key="add-remote" lockTransport="http" submitLabel="Add tool" onSubmit={add} />
          )}
        </div>
      </section>
    </div>
  );
}

function JsonImport({ onImported }: { onImported: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function importNow(): Promise<void> {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const result = await api.importMcpConfig(text);
      const skipped = result.errors.length ? ` Skipped: ${result.errors.join('; ')}` : '';
      setOk(`Imported ${result.added} server${result.added === 1 ? '' : 's'}.${skipped}`);
      setText('');
      await onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mcpImport">
      <p className="hint">
        Paste a Claude Desktop / VS Code <code>mcpServers</code> block. Servers are matched by name, so
        re-pasting updates them instead of duplicating.
      </p>
      {error && <p className="error">{error}</p>}
      {ok && <p className="ok">{ok}</p>}
      <textarea
        className="mcpJson"
        value={text}
        rows={9}
        spellCheck={false}
        placeholder={JSON_PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="pillBtn" onClick={importNow} disabled={busy || !text.trim()}>
        <ClipboardPaste size={15} /> Import config
      </button>
    </div>
  );
}

function ServerRow({
  server,
  busy,
  onToggle,
  onTest,
  onDelete,
  onSave
}: {
  server: McpServerView;
  busy: boolean;
  onToggle: () => void;
  onTest: () => void;
  onDelete: () => void;
  onSave: (input: McpServerInput) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const status = server.status;
  return (
    <div className={`mcpRow ${server.enabled ? '' : 'off'}`}>
      <div className="mcpRowMain">
        <div className="mcpRowTop">
          <Plug size={15} />
          <strong>{server.name}</strong>
          <span className="mcpPill">{server.transport === 'http' ? 'Remote' : 'Local'}</span>
        </div>
        <div className="mcpRowSub">
          {!server.enabled ? (
            <span className="mcpMuted">Disabled</span>
          ) : status.error ? (
            <span className="mcpErr">Error: {status.error}</span>
          ) : status.connected ? (
            <span className="mcpOk">{status.toolCount} tool{status.toolCount === 1 ? '' : 's'} available</span>
          ) : (
            <span className="mcpMuted">Not connected yet — click Test</span>
          )}
        </div>
        {server.enabled && status.connected && status.tools.length > 0 && (
          <div className="mcpTools">
            {status.tools.slice(0, 12).map((t) => (
              <span key={t} className="mcpToolChip"><Wrench size={11} /> {t}</span>
            ))}
            {status.tools.length > 12 && <span className="mcpToolChip">+{status.tools.length - 12} more</span>}
          </div>
        )}
        {server.enabled && status.connected && status.instructions && (
          <details className="mcpInstructions">
            <summary>Usage guidance received from this server</summary>
            <pre>{status.instructions}</pre>
          </details>
        )}
        {editing && (
          <div className="mcpRowEdit">
            <ServerForm
              initial={toInput(server)}
              submitLabel="Save changes"
              onSubmit={async (input) => {
                await onSave(input);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        )}
      </div>
      <div className="mcpRowActions">
        <button className="pillBtn ghost" onClick={() => setEditing((e) => !e)} disabled={busy}>
          <Pencil size={14} /> Edit
        </button>
        <button className="pillBtn ghost" onClick={onToggle} disabled={busy}>
          {server.enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="pillBtn ghost" onClick={onTest} disabled={busy}>
          <RefreshCw size={14} /> Test
        </button>
        <button className="iconBtn danger" onClick={onDelete} disabled={busy} aria-label="Delete">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function CatalogCard({
  entry,
  installed,
  onInstall
}: {
  entry: McpCatalogEntry;
  installed: boolean;
  onInstall: (input: McpServerInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = entry.requires ?? [];
  const ready = fields.every((f) => (values[f.key] ?? '').trim().length > 0);

  async function install(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await onInstall(buildFromCatalog(entry, values));
      setOpen(false);
      setValues({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function start(): void {
    if (fields.length === 0) {
      void install();
    } else {
      setOpen((o) => !o);
    }
  }

  return (
    <div className="mcpCard">
      <div className="mcpCardTop">
        <strong>{entry.name}</strong>
        <span className="mcpPill">{entry.transport === 'http' ? 'Remote' : 'Local'}</span>
      </div>
      <p className="mcpCardDesc">{entry.description}</p>
      {open && fields.length > 0 && (
        <div className="mcpCardForm">
          {fields.map((f) => (
            <label key={f.key} className="mcpField">
              <span>{f.label}</span>
              <input
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="mcpCardActions">
        {entry.docsUrl && (
          <a className="mcpDocs" href={entry.docsUrl} target="_blank" rel="noreferrer">Docs</a>
        )}
        {open && fields.length > 0 ? (
          <button className="pillBtn" onClick={install} disabled={busy || !ready}>
            <Check size={14} /> Install
          </button>
        ) : (
          <button className="pillBtn" onClick={start} disabled={busy}>
            {installed ? <><Plus size={14} /> Add again</> : <><Plus size={14} /> Install</>}
          </button>
        )}
      </div>
    </div>
  );
}

// One form for both adding a tool by hand and editing an installed one. When
// `initial` is given it's edit mode (fields prefilled, transport switchable);
// `lockTransport` pins it to a single transport for the Local/Remote add tabs.
function ServerForm({
  initial,
  lockTransport,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: McpServerInput;
  lockTransport?: McpTransport;
  submitLabel: string;
  onSubmit: (input: McpServerInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [transport, setTransport] = useState<McpTransport>(lockTransport ?? initial?.transport ?? 'stdio');
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command || 'npx');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'));
  const [envText, setEnvText] = useState(toKeyVals(initial?.env));
  const [url, setUrl] = useState(initial?.url ?? '');
  const [headersText, setHeadersText] = useState(toKeyVals(initial?.headers));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const input: McpServerInput =
        transport === 'http'
          ? { name, transport, url, headers: parseKeyVals(headersText), enabled: initial?.enabled }
          : { name, transport, command, args: parseLines(argsText), env: parseKeyVals(envText), enabled: initial?.enabled };
      await onSubmit(input);
      // Adding: clear the form for the next tool. Editing: the parent closes it.
      if (!initial) {
        setName('');
        setArgsText('');
        setEnvText('');
        setUrl('');
        setHeadersText('');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mcpManual">
      {error && <p className="error">{error}</p>}
      {!lockTransport && (
        <div className="mcpTransportToggle">
          <button className={transport === 'stdio' ? 'on' : ''} onClick={() => setTransport('stdio')}>Local (command)</button>
          <button className={transport === 'http' ? 'on' : ''} onClick={() => setTransport('http')}>Remote (URL)</button>
        </div>
      )}

      <label className="mcpField">
        <span>Name</span>
        <input value={name} placeholder="My tool" onChange={(e) => setName(e.target.value)} />
      </label>

      {transport === 'stdio' ? (
        <>
          <label className="mcpField">
            <span>Command</span>
            <input value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} />
          </label>
          <label className="mcpField">
            <span>Arguments <small>(one per line)</small></span>
            <textarea value={argsText} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\Users\\you\\Documents'} onChange={(e) => setArgsText(e.target.value)} />
          </label>
          <label className="mcpField">
            <span>Environment <small>(KEY=value, one per line)</small></span>
            <textarea value={envText} rows={2} placeholder={'API_KEY=...'} onChange={(e) => setEnvText(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <label className="mcpField">
            <span>Server URL</span>
            <input value={url} placeholder="https://example.com/mcp" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="mcpField">
            <span>Headers <small>(KEY=value, one per line)</small></span>
            <textarea value={headersText} rows={2} placeholder={'Authorization=Bearer ...'} onChange={(e) => setHeadersText(e.target.value)} />
          </label>
        </>
      )}

      <div className="mcpFormActions">
        <button className="pillBtn" onClick={submit} disabled={busy || !name.trim()}>
          {initial ? <Check size={15} /> : <Plus size={15} />} {submitLabel}
        </button>
        {onCancel && (
          <button className="pillBtn ghost" onClick={onCancel} disabled={busy}>
            <X size={15} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ---- helpers ----

function toInput(server: McpServerView): McpServerInput {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
    enabled: server.enabled
  };
}

function buildFromCatalog(entry: McpCatalogEntry, values: Record<string, string>): McpServerInput {
  const args = [...(entry.args ?? [])];
  const env: Record<string, string> = {};
  for (const field of entry.requires ?? []) {
    const value = (values[field.key] ?? '').trim();
    if (!value) continue;
    if (field.target === 'arg') args.push(value);
    else env[field.key] = value;
  }
  return { name: entry.name, transport: entry.transport, command: entry.command, args, url: entry.url, env };
}

function parseLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Render a KEY=value map back into the editable "one per line" textarea form.
function toKeyVals(map?: Record<string, string>): string {
  return Object.entries(map ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

function parseKeyVals(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key) out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}
