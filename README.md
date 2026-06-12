# Agentic Resume Builder

A chat-first resume builder. It learns your real professional background as
long-term **memory**, then writes truthful, tailored resumes for specific jobs
and exports them as ATS-friendly PDFs. Built per [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).

## Stack

- **Language:** TypeScript end to end (shared domain types in `shared/types.ts`)
- **Frontend:** React + Vite (port 3501)
- **Backend:** Node.js + Express + SQLite (built-in `node:sqlite`), port 3500. Node
  runs the `.ts` files directly via native type-stripping — no backend build step,
  and no native module to compile or rebuild per runtime.
- **AI:** OpenRouter (the backend owns all AI calls; the API key never reaches the browser)
- **PDF:** `pdfkit`, deterministic code-defined templates

Requires Node 22.6+ (Node 24 recommended) for native TypeScript execution.
Run `npm run typecheck` to type-check the whole project.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Configure the OpenRouter key — either copy `.env.example` to `.env` and fill
   `OPENROUTER_API_KEY`, or set it later in the app's **Settings** screen.
3. Run both servers:
   ```
   npm run dev
   ```
   Open http://localhost:3501. The Vite dev server proxies `/api` to the backend.
   The backend runs under `node --watch`, so it **auto-restarts when you edit
   server code** — no manual restart needed. (`npm start` runs it without watch.)

   Use `npm run dev:stable` to run the same two servers **without** the backend
   `--watch` restart. Prefer this when working with MCP tools: a restart drops
   live MCP connections and kills any stdio servers (re-spawned, and re-downloaded
   on first `npx`, on the next request). Restart the backend by hand to pick up
   server-code changes.

SQLite data is stored in `data/resume-builder.sqlite` (created on first run).

## How it works

1. **Memory Chat** — interview with the selected agent personality. The agent
   never saves anything itself; press **Review updates** to extract candidate
   facts and confirm which to save. Long-term memory is written *only* here.
2. **Memory Profile** — view, edit, or delete saved memory by category.
3. **Resume Sessions** — create a session per job (title, company, job
   description). Inside a session: chat about fit, **Analyze job**, **Generate
   draft** (mapped from confirmed memory), and **Revise** via feedback.
4. **Export** — pick a template, preview, and download a PDF. Mark a version final.

## Guardrails

The AI is instructed never to invent companies, roles, metrics, or tools. Resume
content is generated only from confirmed memory; gaps are surfaced as
`missingSignals` rather than fabricated. Resume chats cannot modify long-term memory.

## Project layout

The backend follows a layered architecture — a request flows
**route → controller → service → repository → database**, each layer with one
responsibility:

```
server.ts                  Entry: load env, bind port
server/
  app.ts                   Express app assembly (middleware + router)
  routes/                  Endpoint → controller wiring (one file per domain)
  controllers/             HTTP layer: parse request, call service, send response
  services/                Business logic + AI orchestration (+ prompts.ts)
  repositories/            Data access only (prepared statements, raw rows)
  database/connection.ts   SQLite connection + schema
  middleware/              asyncHandler (error handling) + param helper
  data/                    Static config: personalities, templates
shared/types.ts            Domain types shared by backend and frontend
src/                       React app: api client, App shell, views/, components/ (.tsx)
docs/                      Product requirements and code rules
```

Dependencies point downward only: controllers know services, services know
repositories, repositories know the database. The OpenRouter API key never
leaves the service layer.
