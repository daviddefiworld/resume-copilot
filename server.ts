import dns from 'node:dns';
import { applyServerTimeouts, createApp } from './server/app.ts';

// Prefer IPv4 when a host resolves to both. Some networks (and openrouter.ai's
// IPv6-only DNS on certain ISPs) have slow or flaky IPv6 routing that trips
// fetch's 10s connect timeout and shows up as a bare "fetch failed".
dns.setDefaultResultOrder('ipv4first');

// Load .env if present (Node 20.6+). Optional — env vars may come from the shell.
try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the process environment.
}

const PORT = process.env.PORT || 3500;

const server = createApp().listen(PORT, () => {
  console.log(`Job Hunter Copilot API running on http://localhost:${PORT}`);
});
applyServerTimeouts(server);
