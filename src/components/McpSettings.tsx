import { useEffect, useState } from 'react';
import { Check, ClipboardPaste, Plug, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
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
export default function McpSettings() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mcpHeading">Add from catalog</h3>
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
      </section>

      <section>
        <h3 className="mcpHeading">Paste config (JSON)</h3>
        <JsonImport onImported={reload} />
      </section>

      <section>
        <h3 className="mcpHeading">Add manually</h3>
        <ManualForm onAdd={add} />
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
  onDelete
}: {
  server: McpServerView;
  busy: boolean;
  onToggle: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
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
      </div>
      <div className="mcpRowActions">
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

function ManualForm({ onAdd }: { onAdd: (input: McpServerInput) => Promise<void> }) {
  const [transport, setTransport] = useState<McpTransport>('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const input: McpServerInput =
        transport === 'http'
          ? { name, transport, url, headers: parseKeyVals(headersText) }
          : { name, transport, command, args: parseLines(argsText), env: parseKeyVals(envText) };
      await onAdd(input);
      setName('');
      setArgsText('');
      setEnvText('');
      setUrl('');
      setHeadersText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mcpManual">
      {error && <p className="error">{error}</p>}
      <div className="mcpTransportToggle">
        <button className={transport === 'stdio' ? 'on' : ''} onClick={() => setTransport('stdio')}>Local (command)</button>
        <button className={transport === 'http' ? 'on' : ''} onClick={() => setTransport('http')}>Remote (URL)</button>
      </div>

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

      <button className="pillBtn" onClick={submit} disabled={busy || !name.trim()}>
        <Plus size={15} /> Add tool
      </button>
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
