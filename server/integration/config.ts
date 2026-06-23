// Loopback port the desktop app exposes its tiny integration bridge on, so the
// Lazybidder dashboard (a web page) can detect this app and ask it to start a job
// hunt. MUST stay in sync with the dashboard's copilotBridge.ts (COPILOT_PORT).
// Chosen high and uncommon to avoid colliding with other local dev servers.
export const INTEGRATION_PORT = 47615;
