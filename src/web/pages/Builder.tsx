import { useMemo, useState } from 'react';
import { validateSpec, plannedRR } from '../../core/validation';
import { explainSpec } from '../../core/explain';
import { api, type GenerateResponse, type StrategySpec } from '../api';
import { ChartPreview } from '../components/ChartPreview';
import { PineEditor } from '../components/PineEditor';
import { SpecEditor } from '../components/SpecEditor';
import { Badge, Card, Drawer, Empty, Field, Icon, NumberInput, Spinner, useApp } from '../components/ui';

const EXAMPLES = [
  'Generate a Pine Script v6 strategy for XAUUSD on the 15-minute timeframe. Use liquidity sweeps, BOS, FVG, an EMA trend filter, RSI confirmation, ATR-based stop-loss, and a 1:2 minimum risk-to-reward ratio. Display clear buy and sell entries, stop-loss, three take-profit levels, and alerts.',
  'Indicator for EURUSD 1h where all trend strategies must agree before a STRONG entry is marked, with alerts',
  'BTCUSDT 4h Supertrend with ADX filter, risk 0.5% per trade, trailing stop, long only',
  'RSI(2) Connors mean reversion on SPY daily with a 200 SMA filter',
  'NQ 5 minute opening range breakout, VWAP filter, relative volume confirmation, New York session',
  'Bollinger band mean reversion for GBPUSD 30m in ranging markets with engulfing confirmation, 2 take profits',
];

export function Builder() {
  const { draft, setDraft, settings, catalog, toast, go } = useApp();
  const [prompt, setPrompt] = useState('');
  const [useAI, setUseAI] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<GenerateResponse | null>(null);
  const [tplPick, setTplPick] = useState('');
  const [chartOpen, setChartOpen] = useState(false);
  const aiReady = !!settings?.llm.configured;

  const diags = useMemo(() => (draft ? validateSpec(draft.spec) : []), [draft]);
  const errors = diags.filter((d) => d.severity === 'error');
  const warnings = diags.filter((d) => d.severity === 'warning');

  const interpret = async () => {
    if (!prompt.trim()) return;
    setBusy('interpret');
    try {
      const r = await api.interpret(prompt, useAI && aiReady);
      setDraft({ spec: r.spec, log: r.log, source: r.source });
      if (r.aiError) toast(r.aiError, 'bad');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const startTemplate = async (id: string, output: 'strategy' | 'indicator' = 'strategy') => {
    setBusy('template');
    try {
      const r = await api.fromTemplate(id, output);
      setDraft({ spec: r.spec, log: [`Started from template "${catalog?.templates.find((t) => t.id === id)?.name}".`], source: 'template' });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const startPreset = async (presetId: string) => {
    setBusy('preset');
    try {
      const r = await api.consensus({ presetId });
      setDraft({ spec: r.spec, log: [`Started from consensus preset "${catalog?.presets.find((p) => p.id === presetId)?.name}".`], source: 'preset' });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const doPreview = async () => {
    if (!draft) return;
    setBusy('preview');
    try {
      setPreview(await api.generate(draft.spec));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      if (draft.scriptId) {
        const note = window.prompt('Version note (what changed?)', 'Edited specification') ?? 'Edited specification';
        await api.addVersion(draft.scriptId, draft.spec, note);
        toast('New version saved.');
        const id = draft.scriptId;
        setDraft(null);
        go(`/scripts/${id}`);
      } else {
        const r = await api.createScript(draft.spec);
        toast('Script generated and saved.');
        setDraft(null);
        go(`/scripts/${r.script.id}`);
      }
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Strategy Builder</h1>
          <p>Describe a strategy in plain English, start from a library template, or combine strategies into a consensus. Your request becomes a structured specification you can review and edit before any Pine Script is generated.</p>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Card title="Describe your strategy">
          <div className="col prompt-box">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. XAUUSD 15m: liquidity sweep + BOS + FVG with EMA trend filter, RSI confirmation, ATR stop, 1:2 RR, three take profits, alerts" aria-label="Strategy description" />
            <div className="row">
              <button className="btn primary" onClick={interpret} disabled={!prompt.trim() || !!busy}>
                {busy === 'interpret' ? <Spinner /> : <Icon name="wand" size={16} />} Build specification
              </button>
              <label className="check" title={aiReady ? '' : settings?.llm.note}>
                <input type="checkbox" checked={useAI && aiReady} disabled={!aiReady} onChange={(e) => setUseAI(e.target.checked)} />
                Use AI interpreter {aiReady ? <Badge tone="info">{settings?.llm.model}</Badge> : <span className="hint">(not configured — offline rules used)</span>}
              </label>
            </div>
            <div className="row">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => setPrompt(ex)} title={ex}>
                  {ex.length > 46 ? ex.slice(0, 46) + '…' : ex}
                </button>
              ))}
            </div>
          </div>
        </Card>
        <Card title="Or start from the library">
          <div className="col">
            <Field label="Single strategy template">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={tplPick} onChange={(e) => setTplPick(e.target.value)}>
                  <option value="">Choose a template…</option>
                  {catalog?.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.category}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={!tplPick || !!busy} onClick={() => startTemplate(tplPick)}>
                  Use
                </button>
              </div>
            </Field>
            <div>
              <div className="field" style={{ marginBottom: 6 }}>
                Multi-strategy consensus (STRONG entry when strategies agree)
              </div>
              <div className="col" style={{ gap: 8 }}>
                {catalog?.presets.map((p) => (
                  <button key={p.id} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 12px', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => startPreset(p.id)} disabled={!!busy}>
                    <Icon name="layers" size={16} />
                    <span>
                      <strong>{p.name}</strong>
                      <br />
                      <span className="muted small">{p.description}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="hint">Build a custom consensus by selecting strategies in the Strategy Library.</p>
            </div>
          </div>
        </Card>
      </div>

      {!draft ? (
        <Card>
          <Empty>No specification yet. Describe a strategy or pick a template to start.</Empty>
        </Card>
      ) : (
        <div className="split">
          <div className="col">
            {draft.log && draft.log.length > 0 && (
              <Card title={draft.source === 'llm' ? 'AI interpretation' : 'How your request was interpreted'} actions={draft.scriptId ? <Badge tone="info">editing saved script</Badge> : undefined}>
                <ul className="clean">
                  {draft.log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Strategy specification" actions={<span className="muted small">Edit anything below — the code is generated from this</span>}>
              <SpecEditor spec={draft.spec} onChange={(spec) => setDraft({ ...draft, spec })} />
            </Card>
          </div>
          <div className="col" style={{ position: 'sticky', top: 16 }}>
            <Card title="Specification checks" actions={errors.length ? <Badge tone="bad">{errors.length} errors</Badge> : warnings.length ? <Badge tone="warn">{warnings.length} warnings</Badge> : <Badge tone="good">OK</Badge>}>
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                {diags.filter((d) => d.severity !== 'info').length === 0 && <p className="muted small" style={{ margin: 0 }}>No errors or warnings. Static code checks run when you generate.</p>}
                {diags
                  .filter((d) => d.severity !== 'info')
                  .map((d, i) => (
                    <div key={i} className="diag">
                      <span className={`sev ${d.severity}`}>{d.severity === 'error' ? '!' : '?'}</span>
                      <span>{d.message}</span>
                    </div>
                  ))}
                {diags
                  .filter((d) => d.severity === 'info')
                  .map((d, i) => (
                    <div key={'i' + i} className="diag">
                      <span className="sev info">i</span>
                      <span className="muted">{d.message}</span>
                    </div>
                  ))}
              </div>
            </Card>
            <RiskPreviewCard spec={draft.spec} />
            <Card title="Plain-English summary" pad>
              <div style={{ maxHeight: 260, overflow: 'auto' }} className="small">
                {explainSpec(draft.spec)
                  .slice(0, 3)
                  .map((s) => (
                    <div key={s.title} style={{ marginBottom: 8 }}>
                      <strong>{s.title}</strong>
                      <ul className="clean">
                        {s.items.map((i, k) => (
                          <li key={k}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </Card>
            <button className="btn" onClick={() => setChartOpen(true)} disabled={!!busy || errors.length > 0}>
              <Icon name="chart" size={16} /> Preview on chart
            </button>
            <div className="row">
              <button className="btn" onClick={doPreview} disabled={!!busy || errors.length > 0}>
                {busy === 'preview' ? <Spinner /> : <Icon name="code" size={16} />} Preview code
              </button>
              <button className="btn primary grow" onClick={save} disabled={!!busy || errors.length > 0}>
                {busy === 'save' ? <Spinner /> : <Icon name="check" size={16} />} {draft.scriptId ? 'Save as new version' : 'Generate & save script'}
              </button>
            </div>
            {errors.length > 0 && <p className="hint">Fix the errors above to generate.</p>}
            <button className="btn ghost sm" onClick={() => setDraft(null)}>
              Discard draft
            </button>
          </div>
        </div>
      )}

      {chartOpen && draft && (
        <Drawer wide title="Chart preview" subtitle="Signals computed in the app from this specification — check them before generating the script." onClose={() => setChartOpen(false)}>
          <ChartPreview
            spec={draft.spec}
            footer={
              <div className="notice row">
                <span className="grow">Happy with the signals? Generate the Pine script, then copy it into TradingView.</span>
                <button className="btn primary" onClick={() => (setChartOpen(false), save())} disabled={!!busy || errors.length > 0}>
                  <Icon name="check" size={16} /> {draft.scriptId ? 'Save as new version' : 'Generate & save script'}
                </button>
              </div>
            }
          />
        </Drawer>
      )}
      {preview && (
        <Drawer title="Generated Pine Script (preview)" subtitle={`${preview.stats.lines} lines · ${preview.stats.inputs} inputs · ${preview.stats.plots} plot calls · static errors: ${preview.validation.errorCount}`} onClose={() => setPreview(null)}>
          <ul className="clean small">
            {preview.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <PineEditor value={preview.code} readOnly height="70vh" />
        </Drawer>
      )}
    </div>
  );

}

function RiskPreviewCard({ spec }: { spec: StrategySpec }) {
  const [p, setP] = useState({ price: 2400, atr: 8, pointValue: 1, equity: spec.backtest.initialCapital, tick: 0.01 });
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.riskPreview>> | null>(null);
  return (
    <Card title="Risk preview" actions={<span className="muted small">Planned R:R {plannedRR(spec).toFixed(2)}</span>}>
      <div className="fields" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <Field label="Price">
          <NumberInput value={p.price} onChange={(v) => setP({ ...p, price: v })} />
        </Field>
        <Field label="ATR">
          <NumberInput value={p.atr} onChange={(v) => setP({ ...p, atr: v })} />
        </Field>
        <Field label="Point value" hint="syminfo.pointvalue">
          <NumberInput value={p.pointValue} onChange={(v) => setP({ ...p, pointValue: v })} />
        </Field>
        <Field label="Equity">
          <NumberInput value={p.equity} onChange={(v) => setP({ ...p, equity: v })} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={() => api.riskPreview(spec, p).then(setRes)}>
          Calculate
        </button>
        {res && (
          <span className="small num">
            Stop {res.stopDistance.toFixed(2)} · qty <strong>{res.qty}</strong> · risk {res.riskCash.toFixed(2)} · TPs {res.targets.map((t) => t.toFixed(2)).join(' / ')}
          </span>
        )}
      </div>
      {res && <p className="hint">{res.note}</p>}
    </Card>
  );
}
