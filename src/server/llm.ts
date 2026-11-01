// Configurable LLM adapter. Keys are read from the server environment only and never sent to the browser.
//   LLM_PROVIDER=gemini | anthropic | openai-compatible | none
//   (default: gemini if GEMINI_API_KEY is set, else anthropic if ANTHROPIC_API_KEY is set, else none)
//   GEMINI_API_KEY, GEMINI_MODEL (default gemini-3.5-flash; fast on the free tier), GEMINI_BACKUP_MODEL (default
//   gemini-3.1-flash-lite, used once when the main model is overloaded) — Google AI Studio key, free tier available
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-opus-5-5)
//   OPENAI_COMPAT_BASE_URL (e.g. http://localhost:11434/v1 for Ollama), OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_MODEL
import Anthropic from '@anthropic-ai/sdk';

export interface LlmStatus {
  provider: 'anthropic' | 'gemini' | 'openai-compatible' | 'none';
  model: string | null;
  configured: boolean;
  note: string;
}

export interface LlmProvider {
  status(): LlmStatus;
  complete(system: string, user: string, maxTokens?: number): Promise<string>;
  /** Returns JSON matching `schema` (structured output where the provider supports it). */
  completeJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T>;
}

class NoProvider implements LlmProvider {
  status(): LlmStatus {
    return { provider: 'none', model: null, configured: false, note: 'No LLM configured — the offline rule-based interpreter and deterministic report are used. Set ANTHROPIC_API_KEY or OPENAI_COMPAT_BASE_URL to enable AI features.' };
  }
  async complete(): Promise<string> {
    throw new Error('No LLM provider configured');
  }
  async completeJson<T>(): Promise<T> {
    throw new Error('No LLM provider configured');
  }
}

class AnthropicProvider implements LlmProvider {
  private client = new Anthropic();
  constructor(private model: string) {}
  status(): LlmStatus {
    return { provider: 'anthropic', model: this.model, configured: true, note: 'Anthropic Messages API (server-side refusal fallback enabled).' };
  }
  async complete(system: string, user: string, maxTokens = 16000): Promise<string> {
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user' as const, content: user }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
    const res = await this.client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }
  async completeJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
    // Streaming avoids request timeouts while the model thinks; finalMessage() collects the full reply.
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    } as unknown as Anthropic.MessageStreamParams);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (msg.stop_reason === 'max_tokens') throw new Error('The model ran out of output space before finishing.');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return JSON.parse(text) as T;
  }
}

interface CompatOptions {
  /** Status label, e.g. "Groq". */
  label?: string;
  /** Model-name patterns in order of preference, used to pick a model when none is set or the set one is retired. */
  prefer?: RegExp[];
  /** Only models whose id matches can be picked (e.g. OpenRouter's free ":free" models). */
  only?: RegExp;
  timeoutMs?: number;
}

class OpenAICompatProvider implements LlmProvider {
  /** Model that answered the last request (differs from `model` when a backup was used). */
  lastModel: string | null = null;
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
    private kind: 'openai-compatible' | 'gemini' = 'openai-compatible',
    private backupModel?: string,
    private opts: CompatOptions = {},
  ) {}
  status(): LlmStatus {
    return this.kind === 'gemini'
      ? { provider: 'gemini', model: this.model, configured: true, note: 'Google Gemini API (OpenAI-compatible endpoint, free tier available).' }
      : { provider: 'openai-compatible', model: this.model || 'auto', configured: true, note: `${this.opts.label ?? 'OpenAI-compatible endpoint'} at ${new URL(this.baseUrl).host}.` };
  }
  /** Asks the endpoint which models it serves and picks the preferred one (free providers rename models often). */
  private async discoverModel(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { id: string }[] };
      const ids = (j.data ?? []).map((m) => m.id).filter((id) => !/embed|whisper|tts|guard|audio|image|moderation|rerank|transcribe|vision-only/i.test(id) && (!this.opts.only || this.opts.only.test(id)));
      for (const re of this.opts.prefer ?? []) {
        const hit = ids.find((id) => re.test(id));
        if (hit) return hit;
      }
      return ids[0] ?? null;
    } catch {
      return null;
    }
  }
  private async chat(system: string, user: string, maxTokens: number, extra: Record<string, unknown> = {}): Promise<string> {
    if (!this.model) {
      const found = await this.discoverModel();
      if (!found) throw new Error(`${this.opts.label ?? 'The endpoint'} did not list any usable model`);
      this.model = found;
    }
    try {
      return await this.send(system, user, maxTokens, extra);
    } catch (e) {
      const msg = (e as Error).message;
      const retired = /\b404\b|no longer available|not found|does not exist|decommissioned|model_not_found|invalid model/i.test(msg);
      // Google retires Gemini model versions regularly; switch to the current Flash alias once and remember it.
      if (this.kind === 'gemini' && this.model !== 'gemini-flash-latest' && retired) {
        this.model = 'gemini-flash-latest';
        return this.send(system, user, maxTokens, extra);
      }
      // Other free providers rename models too: pick the best one they list now, once.
      if (this.kind !== 'gemini' && retired && this.opts.prefer) {
        const found = await this.discoverModel();
        if (found && found !== this.model) {
          this.model = found;
          return this.send(system, user, maxTokens, extra);
        }
      }
      // Free-tier models are sometimes overloaded (503): use the lighter backup model once for this request, or,
      // without one, wait a few seconds and ask the same model once more.
      if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
        if (this.kind === 'gemini' && this.backupModel && this.backupModel !== this.model) return this.send(system, user, maxTokens, extra, this.backupModel);
        await new Promise((r) => setTimeout(r, 4000));
        return this.send(system, user, maxTokens, extra);
      }
      throw e;
    }
  }
  private async send(system: string, user: string, maxTokens: number, extra: Record<string, unknown>, model = this.model): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...extra }),
      // Free-tier models can queue for minutes under load; give up after 90 s (the app then uses the rule-based analyst).
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? (this.kind === 'gemini' ? 90_000 : 180_000)),
    });
    if (!res.ok) {
      // Keep the provider's own message (e.g. quota or invalid key) so it can be shown in plain words.
      const body = await res.text().catch(() => '');
      throw new Error(`LLM endpoint returned ${res.status} ${body.slice(0, 400)}`);
    }
    const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    this.lastModel = model;
    return j.choices?.[0]?.message?.content ?? '';
  }
  async complete(system: string, user: string, maxTokens = 8000): Promise<string> {
    return this.chat(system, user, maxTokens);
  }
  async completeJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
    const prompt = `${system}\n\nReply with ONE JSON object only, matching this JSON schema:\n${JSON.stringify(schema)}`;
    try {
      // Structured output where the endpoint supports it (Gemini and OpenAI do).
      return extractJson<T>(await this.chat(prompt, user, 16000, { response_format: { type: 'json_schema', json_schema: { name: 'decision', schema, strict: true } } }));
    } catch (e) {
      // Some models reject response_format (or the large max_tokens); retry once with the schema in the prompt only.
      if (!/\b(400|422)\b/.test((e as Error).message)) throw e;
      return extractJson<T>(await this.chat(prompt, user, 4000));
    }
  }
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export function createProvider(env = process.env): LlmProvider {
  const explicit = env.LLM_PROVIDER?.toLowerCase();
  if (explicit === 'none') return new NoProvider();
  const gemini = env.GEMINI_API_KEY?.trim();
  if (explicit === 'gemini' || (!explicit && gemini)) {
    if (!gemini) return new NoProvider();
    return new OpenAICompatProvider(GEMINI_BASE_URL, env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash', gemini, 'gemini', env.GEMINI_BACKUP_MODEL?.trim() || 'gemini-3.1-flash-lite');
  }
  if (explicit === 'openai-compatible' || (!explicit && env.OPENAI_COMPAT_BASE_URL && !env.ANTHROPIC_API_KEY)) {
    if (!env.OPENAI_COMPAT_BASE_URL || !env.OPENAI_COMPAT_MODEL) return new NoProvider();
    return new OpenAICompatProvider(env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_MODEL, env.OPENAI_COMPAT_API_KEY);
  }
  if (explicit === 'anthropic' || env.ANTHROPIC_API_KEY) {
    if (!env.ANTHROPIC_API_KEY) return new NoProvider();
    return new AnthropicProvider(env.ANTHROPIC_MODEL || 'claude-opus-5-5');
  }
  return new NoProvider();
}

/** Extracts the first JSON object from a model reply (tolerates ```json fences and prose). */
export function extractJson<T>(text: string): T {
  // Reasoning models (DeepSeek R1, Qwen) may put their thinking in <think> tags before the answer.
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(clean);
  const body = fenced ? fenced[1] : clean;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(body.slice(start, end + 1)) as T;
}

// ─── AI analyst panel ───
// Every provider below has a free tier (Anthropic is the paid exception). Each one whose key is set in .env becomes
// one more analyst; they all see the same evidence and vote. Model names are optional: when unset (or retired) the
// app asks the provider which models it serves and picks the preferred one.

export interface AnalystMember {
  id: string;
  name: string;
  llm: LlmProvider;
  /** Smaller prompt for providers whose free tier allows only a few thousand tokens per minute. */
  compact: boolean;
}

export interface AnalystProviderInfo {
  id: string;
  name: string;
  envKey: string;
  modelEnv: string;
  signupUrl: string;
  free: string;
  configured: boolean;
}

interface ProviderDef {
  id: string;
  name: string;
  envKey: string;
  modelEnv: string;
  signupUrl: string;
  free: string;
  baseUrl: string | ((env: NodeJS.ProcessEnv) => string);
  defaultModel: string;
  prefer?: RegExp[];
  only?: RegExp;
  compact: boolean;
  /** Configured without a key (local Ollama needs only a model name). */
  keyless?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'groq', name: 'Groq', envKey: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', signupUrl: 'https://console.groq.com/keys', free: 'Free tier, no card. Very fast Llama / GPT-OSS / Qwen models.', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: '', prefer: [/gpt-oss-120b/, /^llama-3\.3-70b/, /llama-4-maverick/, /qwen.*32b/, /70b/], compact: true },
  { id: 'cerebras', name: 'Cerebras', envKey: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', signupUrl: 'https://cloud.cerebras.ai', free: 'Free tier, no card. Very fast open models.', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: '', prefer: [/gpt-oss-120b/, /qwen-3-235b/, /llama-3\.3-70b/, /llama/], compact: true },
  { id: 'mistral', name: 'Mistral', envKey: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', signupUrl: 'https://console.mistral.ai/api-keys', free: 'Free "Experiment" plan (phone number needed).', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', prefer: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /^mistral-large-latest$/], compact: false },
  { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', signupUrl: 'https://openrouter.ai/keys', free: 'Free models (ids ending in ":free"), about 50 requests a day.', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', only: /:free$/, prefer: [/deepseek.*(chat|v3)/i, /llama-3\.3-70b/i, /qwen.*(235b|72b)/i, /gemma/i], compact: true },
  { id: 'github', name: 'GitHub Models', envKey: 'GITHUB_MODELS_TOKEN', modelEnv: 'GITHUB_MODELS_MODEL', signupUrl: 'https://github.com/settings/personal-access-tokens', free: 'Free with any GitHub account (token with the "models" permission).', baseUrl: 'https://models.github.ai/inference', defaultModel: 'openai/gpt-4.1-mini', compact: true },
  { id: 'huggingface', name: 'Hugging Face', envKey: 'HF_TOKEN', modelEnv: 'HF_MODEL', signupUrl: 'https://huggingface.co/settings/tokens', free: 'Small free monthly credit with a free account.', baseUrl: 'https://router.huggingface.co/v1', defaultModel: '', prefer: [/Llama-3\.3-70B-Instruct/i, /Qwen3.*(235B|32B)/i, /DeepSeek-V3/i], compact: true },
  { id: 'ollama', name: 'Ollama (on this computer)', envKey: 'OLLAMA_MODEL', modelEnv: 'OLLAMA_MODEL', signupUrl: 'https://ollama.com/download', free: 'Free and private; runs a model on your own computer (set OLLAMA_MODEL, e.g. qwen3:8b).', baseUrl: (env) => env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434/v1', defaultModel: '', compact: true, keyless: true },
];

const key = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim().replace(/^["']|["']$/g, '') || '';
const off = (env: NodeJS.ProcessEnv) => new Set((env.AI_ANALYSTS_OFF ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean));

/** Which analyst providers exist, how to get a free key, and which ones are set up (never exposes key values). */
export function analystCatalog(env = process.env): AnalystProviderInfo[] {
  const disabled = off(env);
  const list: AnalystProviderInfo[] = [
    { id: 'gemini', name: 'Google Gemini (2 analysts)', envKey: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL, GEMINI_SECOND_MODEL', signupUrl: 'https://aistudio.google.com/apikey', free: 'Free tier, no card. Two different Gemini models vote separately.', configured: !!key(env, 'GEMINI_API_KEY') && !disabled.has('gemini') },
    ...PROVIDERS.map((p) => ({ id: p.id, name: p.name, envKey: p.envKey, modelEnv: p.modelEnv, signupUrl: p.signupUrl, free: p.free, configured: !!key(env, p.envKey) && !disabled.has(p.id) })),
    { id: 'anthropic', name: 'Anthropic Claude', envKey: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', signupUrl: 'https://platform.claude.com', free: 'Paid (needs account credit). Strongest reasoning.', configured: !!key(env, 'ANTHROPIC_API_KEY') && !disabled.has('anthropic') },
  ];
  if (env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_MODEL) list.push({ id: 'custom', name: 'Custom endpoint', envKey: 'OPENAI_COMPAT_BASE_URL', modelEnv: 'OPENAI_COMPAT_MODEL', signupUrl: '', free: 'Any OpenAI-compatible endpoint.', configured: !disabled.has('custom') });
  return list;
}

/** One analyst per configured provider (two for Gemini). Disable any with AI_ANALYSTS_OFF=anthropic,groq,… */
export function analystsFromEnv(env = process.env): AnalystMember[] {
  const disabled = off(env);
  const out: AnalystMember[] = [];
  const gemini = key(env, 'GEMINI_API_KEY');
  if (gemini && !disabled.has('gemini')) {
    const main = env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';
    const second = env.GEMINI_SECOND_MODEL?.trim() || 'gemini-3.1-flash-lite';
    // The first analyst does not fall back to the second's model, so the two votes stay independent.
    out.push({ id: 'gemini', name: 'Gemini', llm: new OpenAICompatProvider(GEMINI_BASE_URL, main, gemini, 'gemini'), compact: false });
    if (second !== 'off' && second !== main) out.push({ id: 'gemini-2', name: 'Gemini (second model)', llm: new OpenAICompatProvider(GEMINI_BASE_URL, second, gemini, 'gemini'), compact: false });
  }
  for (const p of PROVIDERS) {
    const k = key(env, p.envKey);
    if (!k || disabled.has(p.id)) continue;
    const base = typeof p.baseUrl === 'function' ? p.baseUrl(env) : p.baseUrl;
    const model = p.keyless ? k : env[p.modelEnv]?.trim() || p.defaultModel;
    out.push({ id: p.id, name: p.name, llm: new OpenAICompatProvider(base, model, p.keyless ? undefined : k, 'openai-compatible', undefined, { label: p.name, prefer: p.prefer, only: p.only, timeoutMs: p.keyless ? 300_000 : 90_000 }), compact: p.compact });
  }
  if (env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_MODEL && !disabled.has('custom')) {
    out.push({ id: 'custom', name: 'Custom AI', llm: new OpenAICompatProvider(env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_MODEL, env.OPENAI_COMPAT_API_KEY, 'openai-compatible', undefined, { label: 'Custom endpoint' }), compact: true });
  }
  if (key(env, 'ANTHROPIC_API_KEY') && !disabled.has('anthropic')) out.push({ id: 'anthropic', name: 'Claude', llm: new AnthropicProvider(env.ANTHROPIC_MODEL || 'claude-opus-5-5'), compact: false });
  return out;
}

/** The model that actually answered (a backup model may have stepped in). */
export const usedModel = (llm: LlmProvider) => (llm as { lastModel?: string | null }).lastModel ?? llm.status().model;
