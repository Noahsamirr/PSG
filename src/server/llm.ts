// Configurable LLM adapter. Keys are read from the server environment only and never sent to the browser.
//   LLM_PROVIDER=anthropic | openai-compatible | none (default: anthropic if ANTHROPIC_API_KEY is set, else none)
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-opus-5-5)
//   OPENAI_COMPAT_BASE_URL (e.g. http://localhost:11434/v1 for Ollama), OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_MODEL
import Anthropic from '@anthropic-ai/sdk';

export interface LlmStatus {
  provider: 'anthropic' | 'openai-compatible' | 'none';
  model: string | null;
  configured: boolean;
  note: string;
}

export interface LlmProvider {
  status(): LlmStatus;
  complete(system: string, user: string, maxTokens?: number): Promise<string>;
}

class NoProvider implements LlmProvider {
  status(): LlmStatus {
    return { provider: 'none', model: null, configured: false, note: 'No LLM configured — the offline rule-based interpreter and deterministic report are used. Set ANTHROPIC_API_KEY or OPENAI_COMPAT_BASE_URL to enable AI features.' };
  }
  async complete(): Promise<string> {
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
}

class OpenAICompatProvider implements LlmProvider {
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
  ) {}
  status(): LlmStatus {
    return { provider: 'openai-compatible', model: this.model, configured: true, note: `OpenAI-compatible endpoint at ${new URL(this.baseUrl).host}.` };
  }
  async complete(system: string, user: string, maxTokens = 8000): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }
}

export function createProvider(env = process.env): LlmProvider {
  const explicit = env.LLM_PROVIDER?.toLowerCase();
  if (explicit === 'none') return new NoProvider();
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
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(body.slice(start, end + 1)) as T;
}
