// Server entry: API + (in production) the built web UI. Development uses Vite's proxy (see vite.config.ts).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';
import { Store } from './db';
import { analystsFromEnv, createProvider } from './llm';

const port = Number(process.env.API_PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const store = new Store(process.env.DB_PATH ?? resolve('data/pine-forge.db'));
const llm = createProvider();
const analysts = analystsFromEnv();
const { app, research } = createApp(store, llm, analysts);

const dist = resolve('dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

// Optional scheduled research refresh (Settings → auto-refresh). Checks every minute.
let lastAuto = 0;
setInterval(() => {
  const minutes = store.getSetting('research.autoRefreshMinutes', 0);
  if (!minutes || Date.now() - lastAuto < minutes * 60_000) return;
  lastAuto = Date.now();
  research('quick').catch((e) => console.error('Scheduled research failed:', e.message));
}, 60_000).unref();

app.listen(port, host, () => {
  const s = llm.status();
  console.log(`Pine Forge API on http://${host}:${port}  ·  LLM: ${s.provider}${s.model ? ` (${s.model})` : ''}`);
  console.log(`Trade analyst panel: rule-based${analysts.map((a) => ` + ${a.name} (${a.llm.status().model})`).join('')}`);
});
