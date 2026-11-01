import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Diagnostic, type ExplainSection, type ScriptRow, type VersionRow } from '../api';
import { Markdown } from '../components/Markdown';
import { ChartPreview } from '../components/ChartPreview';
import { PineDiff, PineEditor } from '../components/PineEditor';
import { ago, Badge, Card, copyText, Empty, Icon, Spinner, Tabs, useApp, validationTone } from '../components/ui';
import { rangeLabel, tfLabel } from '../../core/timeframe';
import { useI18n } from '../i18n';

type Tab = 'chart' | 'code' | 'launch' | 'validation' | 'explain' | 'versions' | 'log';

export function Workspace({ scriptId }: { scriptId?: string }) {
  const { go } = useApp();
  const { t, tx } = useI18n();
  const [scripts, setScripts] = useState<ScriptRow[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => api.scripts().then(setScripts), []);
  useEffect(() => {
    load();
  }, [load]);
  const list = (scripts ?? []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('Scripts & Launcher')}</h1>
          <p>{t('Every generated script with its specification, validation report and version history. Copy or download a script, then follow the launch steps to run it in TradingView.')}</p>
        </div>
        <a className="btn primary" href="#/builder">
          <Icon name="plus" size={16} /> {t('New script')}
        </a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card pad={false}>
          <div style={{ padding: 10 }}>
            <input type="search" placeholder={t('Filter scripts…')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="list" style={{ maxHeight: '75vh', overflow: 'auto' }}>
            {scripts === null && (
              <div className="empty">
                <Spinner />
              </div>
            )}
            {scripts?.length === 0 && <Empty>{t('No scripts yet.')}</Empty>}
            {list.map((s) => (
              <a key={s.id} href={`#/scripts/${s.id}`} className="list-item" style={{ background: s.id === scriptId ? 'var(--accent-soft)' : undefined, color: 'var(--ink)', textDecoration: 'none' }}>
                <div className="grow">
                  <div dir="auto" style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>
                    {s.favorite && '★ '}
                    {s.name}
                  </div>
                  <div className="muted small">
                    {t(s.output)} · v{s.latestVersion} · {tx(ago(s.updatedAt))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </Card>
        {scriptId ? <ScriptDetail key={scriptId} id={scriptId} onChanged={load} onDeleted={() => (load(), go('/scripts'))} /> : <Card><Empty>{t('Select a script, or create one in the Strategy Builder.')}</Empty></Card>}
      </div>
    </div>
  );
}

function ScriptDetail({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const { toast, setDraft, go } = useApp();
  const { t, tx, lang } = useI18n();
  const ar = lang === 'ar';
  const [data, setData] = useState<{ script: ScriptRow; versions: VersionRow[] } | null>(null);
  const [vNum, setVNum] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('chart');
  const [code, setCode] = useState('');
  const [gotoLine, setGotoLine] = useState<number | null>(null);
  const reload = useCallback(
    () =>
      api
        .script(id)
        .then((d) => {
          setData(d);
          setVNum((v) => v ?? d.versions[0]?.version ?? null);
        })
        .catch((e) => toast(e.message, 'bad')),
    [id, toast],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const version = data?.versions.find((v) => v.version === vNum) ?? data?.versions[0];
  useEffect(() => {
    if (version) setCode(version.code);
  }, [version]);
  if (!data || !version) return <Card><div className="empty"><Spinner /></div></Card>;
  const dirty = code !== version.code;
  const vt = validationTone(version.validation);

  const copy = async () => toast(t((await copyText(code)) ? 'Script copied — paste it into the TradingView Pine Editor.' : 'Copy failed.'), 'ok');
  const download = () => {
    if (dirty) {
      const blob = new Blob([code], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data.script.name.replace(/[^\w.-]+/g, '_')}_edited.pine`;
      a.click();
      URL.revokeObjectURL(a.href);
    } else location.href = `/api/scripts/${id}/versions/${version.version}/download`;
  };
  const jump = (line?: number) => {
    if (!line) return;
    setTab('code');
    setGotoLine(null);
    setTimeout(() => setGotoLine(line), 0);
  };
  return (
    <div className="col" style={{ minWidth: 0 }}>
      <Card pad={false}>
        <div className="card-body">
          <div className="row">
            <h2 className="grow" style={{ minWidth: 200 }} dir="auto">
              {data.script.name}
            </h2>
            <Badge tone={vt.tone} dot>
              {tx(vt.label)}
            </Badge>
            <Badge tone="info">{t(version.spec.output)}</Badge>
            <Badge tone="good">
              ⏱ {t('{tf} chart', { tf: tfLabel(version.spec.market.timeframe) })}
              {version.spec.market.timeframeRange ? ` · ${rangeLabel(version.spec.market.timeframeRange)}` : ''}
            </Badge>
            <select value={version.version} onChange={(e) => setVNum(Number(e.target.value))} style={{ width: 'auto' }} aria-label={t('Version')}>
              {data.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} — {v.note || t('no note')}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={copy}>
              <Icon name="copy" size={16} /> {t('Copy script')}
            </button>
            <button className="btn" onClick={download}>
              <Icon name="download" size={16} /> {t('Download .pine file')}
            </button>
            <a className="btn" href="https://www.tradingview.com/chart/" target="_blank" rel="noopener noreferrer" onClick={() => copyText(code)}>
              <Icon name="external" size={16} /> {t('Copy & open TradingView')}
            </a>
            <button
              className="btn"
              onClick={() => {
                setDraft({ spec: version.spec, scriptId: id, baseVersion: version.version, log: [`Editing ${data.script.name} (based on v${version.version}). Saving creates a new version.`], source: 'edit' });
                go('/builder');
              }}
            >
              <Icon name="wand" size={16} /> {t('Edit specification')}
            </button>
            <span className="spacer" />
            <button className="btn icon ghost" title={t(data.script.favorite ? 'Unfavourite' : 'Favourite')} onClick={() => api.updateScript(id, { favorite: !data.script.favorite }).then(() => (reload(), onChanged()))}>
              <span style={{ color: data.script.favorite ? '#eda100' : undefined }}>
                <Icon name="star" />
              </span>
            </button>
            <button
              className="btn icon ghost"
              title={t('Rename')}
              onClick={() => {
                const n = prompt(t('Script name'), data.script.name);
                if (n) api.updateScript(id, { name: n }).then(() => (reload(), onChanged()));
              }}
            >
              <Icon name="wand" />
            </button>
            <button
              className="btn icon ghost danger"
              title={t('Delete script')}
              onClick={() => {
                if (confirm(t('Delete "{name}" and all its versions? This cannot be undone.', { name: data.script.name }))) api.deleteScript(id).then(onDeleted);
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </Card>
      <Tabs
        tabs={[
          { id: 'chart', label: t('Chart preview') },
          { id: 'code', label: dirty ? `${t('Code')} •` : t('Code') },
          { id: 'launch', label: t('Launch in TradingView') },
          { id: 'validation', label: t('Validation'), count: version.validation.errorCount + version.validation.warningCount },
          { id: 'explain', label: t('Explanation') },
          { id: 'versions', label: t('Versions & diff'), count: data.versions.length },
          { id: 'log', label: t('Generation log') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'code' && (
        <div className="col">
          {dirty && (
            <div className="notice warn row">
              <span className="grow">{t('You edited the generated code. Hand edits are not reflected in the specification — prefer editing the specification and regenerating.')}</span>
              <button className="btn sm" onClick={() => setCode(version.code)}>
                {t('Revert')}
              </button>
              <button
                className="btn sm primary"
                onClick={async () => {
                  const note = prompt(t('Version note'), t('Manual code edit'));
                  if (note === null) return;
                  const r = await api.addManualVersion(id, version.spec, code, note);
                  toast(t('Saved v{v} (static checks: {n} errors).', { v: r.version.version, n: r.version.validation.errorCount }));
                  await reload();
                  setVNum(r.version.version);
                  onChanged();
                }}
              >
                {t('Save as new version')}
              </button>
            </div>
          )}
          <PineEditor value={code} onChange={setCode} gotoLine={gotoLine} height="68vh" />
          <div className="muted small">
            {t('{n} lines · Pine Script v6 · generated {when}', { n: code.split('\n').length, when: tx(ago(version.createdAt)) })}
          </div>
        </div>
      )}
      {tab === 'chart' && (
        <ChartPreview
          key={version.id}
          spec={version.spec}
          footer={
            <div className="notice row">
              <span className="grow">
                {ar ? (
                  <>
                    هل الإشارات صحيحة؟ انسخ السكربت وأضفه إلى TradingView. تذكّر أن تُفرغ محرر Pine أولًا، وأن تضبط الرسم على <strong>{tfLabel(version.spec.market.timeframe)}</strong>.
                  </>
                ) : (
                  <>
                    Signals look right? Copy the script and add it to TradingView. Remember to empty the Pine Editor first, and set the chart to <strong>{tfLabel(version.spec.market.timeframe)}</strong>.
                  </>
                )}
              </span>
              <button className="btn primary" onClick={copy}>
                <Icon name="copy" size={16} /> {t('Looks right — copy script')}
              </button>
              <button className="btn" onClick={() => setTab('launch')}>
                {t('Launch steps')}
              </button>
            </div>
          }
        />
      )}
      {tab === 'launch' && <Launch version={version} copy={copy} download={download} />}
      {tab === 'validation' && <Validation id={id} version={version} code={code} onUpdated={reload} jump={jump} />}
      {tab === 'explain' && <Explain id={id} v={version.version} />}
      {tab === 'versions' && <Versions versions={data.versions} />}
      {tab === 'log' && (
        <Card title={t('Generation log')}>
          <ul className="clean" dir="ltr">
            {version.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="muted small">{t('Version {v} created {when} · note: {note}', { v: version.version, when: new Date(version.createdAt).toLocaleString(), note: version.note || '—' })}</p>
        </Card>
      )}
    </div>
  );
}

function Launch({ version, copy, download }: { version: VersionRow; copy: () => void; download: () => void }) {
  const { t, lang } = useI18n();
  const ar = lang === 'ar';
  const isStrat = version.spec.output === 'strategy';
  const sym = version.spec.market.symbol;
  const tfName = tfLabel(version.spec.market.timeframe);
  const checklistAr = [
    'السكربت يُجمَّع بدون أخطاء في محرر Pine (سجّل النتيجة في تبويب التحقق).',
    `الرسم على ${sym || 'الرمز المطلوب'} بإطار ${tfName} — صف "Timeframe" في لوحة السكربت يظهر ✓ ولا يظهر شريط أحمر للإطار الزمني.`,
    'علامات BUY/SELL تظهر فقط على الشموع المغلقة؛ مرّر المؤشر فوق العلامة لترى القواعد التي أطلقتها.',
    'خطوط الوقف والأهداف تبدأ من شمعة الإشارة وتطابق القيم في لوحة السكربت.',
    ...(isStrat
      ? [
          'Strategy Tester ← List of trades: يتم الدخول عند افتتاح الشمعة التالية؛ والخروج مكتوب TP1/TP2/TP3/SL/BE/Trail.',
          'Strategy Tester ← Properties: العمولة والانزلاق ورأس المال والهامش واقعية بالنسبة لوسيطك.',
          'الخروج الجزئي يغلق النسب المحددة (تحقق من أحجام الصفقات في القائمة).',
        ]
      : ['الخروج المحاكى يُرسم عند المستوى الذي لُمس؛ ترتيب القمة والقاع داخل الشمعة غير معروف (يُفترض الوقف أولًا).']),
    'الإشارات منطقية على عدة أسواق وأطر زمنية، وليس فقط على السوق الذي ضبطته عليه.',
    'عناصر الإطار الأكبر والقمم/القيعان تعمل كما هو موثق (بدون إعادة رسم على الشموع المغلقة).',
  ];
  const checklistEn = [
    'Script compiles with no errors in the Pine Editor (record the result in the Validation tab).',
    `Chart is on ${version.spec.market.symbol || 'the intended symbol'} at ${tfLabel(version.spec.market.timeframe)} — the dashboard "Timeframe" row shows ✓ and no red timeframe banner appears.`,
    'BUY/SELL labels appear only on closed bars; hover a label to see the rules that triggered it.',
    'Stop and target lines start at the signal bar and match the dashboard values.',
    ...(isStrat
      ? [
          'Strategy Tester → List of trades: entries fill at the next bar open; exits are labelled TP1/TP2/TP3/SL/BE/Trail.',
          'Strategy Tester → Properties: commission, slippage, initial capital and margin are realistic for your broker.',
          'Partial exits close the configured percentages (check trade sizes in the trade list).',
        ]
      : ['Simulated exits are drawn at the level touched; intrabar order of high/low is unknown (stop assumed first).']),
    'Signals look sensible on several markets and timeframes, not just the one you tuned.',
    'Higher-timeframe and pivot-based elements behave as documented (no repainting on closed bars).',
  ];
  const checklist = ar ? checklistAr : checklistEn;
  const [done, setDone] = useState<boolean[]>(() => checklist.map(() => false));
  const sample = useMemo(
    () =>
      JSON.stringify(
        { id: '<strategy-id>', event: isStrat ? 'ENTRY_LONG_ORDER' : 'ENTRY_LONG', symbol: 'EXCHANGE:SYMBOL', tf: version.spec.market.timeframe, price: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0, qty: 0, time: '2026-01-01T00:00:00Z' },
        null,
        2,
      ),
    [isStrat, version.spec.market.timeframe],
  );
  return (
    <div className="grid g2">
      <Card title={t('Add the script to TradingView')}>
        {ar ? (
          <ol className="steps">
            <li>
              <div>
                <strong>انسخ السكربت</strong> (أو نزّل ملف Pine).
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn sm primary" onClick={copy}>
                    {t('Copy script')}
                  </button>
                  <button className="btn sm" onClick={download}>
                    {t('Download .pine file')}
                  </button>
                </div>
              </div>
            </li>
            <li>
              <div>
                <strong>افتح رسمًا بيانيًا</strong> على tradingview.com، واختر {sym ? <strong>{sym}</strong> : 'رمزك'} واضبط الإطار الزمني على <strong>{tfName}</strong>
                {version.spec.market.timeframeRange && <> (مصمم لـ {rangeLabel(version.spec.market.timeframeRange)}؛ الأطر الأخرى تُظهر شريط تحذير)</>}.{' '}
                <a href="https://www.tradingview.com/chart/" target="_blank" rel="noopener noreferrer">
                  فتح TradingView ↗
                </a>
              </div>
            </li>
            <li>
              <div>
                افتح <strong>Pine Editor</strong> (اللوحة السفلية أو أيقونة Pine) وأنشئ سكربتًا جديدًا. يفتح بقالب صغير — اضغط داخل المحرر ثم <strong>Cmd/Ctrl+A</strong> و<strong>احذف كل شيء</strong> حتى يصبح المحرر فارغًا، ثم <strong>الصق</strong>. ترك القالب يسبب الخطأ “Your script has 2 declaration statements (CE10243)”.
              </div>
            </li>
            <li>
              <div>
                اضغط <strong>Save</strong> وأعطه اسمًا، ثم <strong>Add to chart</strong>. إذا ظهرت أخطاء في المحرر، انسخها إلى تبويب التحقق ← “تسجيل نتيجة TradingView”.
              </div>
            </li>
            {isStrat ? (
              <li>
                <div>
                  افتح تبويب <strong>Strategy Tester</strong>. راجع Overview وPerformance Summary وList of trades. استخدم <em>Properties</em> لضبط رأس المال والعمولة والانزلاق الفعلية لديك.
                </div>
              </li>
            ) : (
              <li>
                <div>
                  افتح <strong>Settings</strong> الخاصة بالسكربت (أيقونة الترس) لتشغيل/إيقاف العناصر المرئية والجلسات والتنبيهات. جدول اللوحة يعرض حالة القواعد مباشرة.
                </div>
              </li>
            )}
            {isStrat && (
              <li>
                <div>
                  صدّر النتائج: في Strategy Tester صدّر <strong>List of trades</strong> بصيغة CSV، ثم استوردها في <a href="#/backtests">تحليل الاختبار التاريخي</a> لفحوص خارج العينة والاختبار المتدرج وضغط التكاليف ومونت كارلو.
                </div>
              </li>
            )}
          </ol>
        ) : (
        <ol className="steps">
          <li>
            <div>
              <strong>Copy the script</strong> (or download the .pine file).
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm primary" onClick={copy}>
                  Copy script
                </button>
                <button className="btn sm" onClick={download}>
                  Download .pine
                </button>
              </div>
            </div>
          </li>
          <li>
            <div>
              <strong>Open a chart</strong> on tradingview.com, select {version.spec.market.symbol ? <strong>{version.spec.market.symbol}</strong> : 'your symbol'} and set the timeframe to{' '}
              <strong>{tfLabel(version.spec.market.timeframe)}</strong>
              {version.spec.market.timeframeRange && <> (designed for {rangeLabel(version.spec.market.timeframeRange)}; other timeframes show a warning banner)</>}.{' '}
              <a href="https://www.tradingview.com/chart/" target="_blank" rel="noopener noreferrer">
                Open TradingView ↗
              </a>
            </div>
          </li>
          <li>
            <div>
              Open the <strong>Pine Editor</strong> (bottom panel or the Pine icon) and create a new script. It opens with a small template — click in the editor, press <strong>Cmd/Ctrl+A</strong> and <strong>delete everything</strong> so the editor is empty, then <strong>paste</strong>. Leaving the template in causes “Your script has 2 declaration statements (CE10243)”.
            </div>
          </li>
          <li>
            <div>
              Click <strong>Save</strong>, give it a name, then <strong>Add to chart</strong>. If the editor shows errors, copy them into the Validation tab → “Record TradingView result”.
            </div>
          </li>
          {isStrat ? (
            <li>
              <div>
                Open the <strong>Strategy Tester</strong> tab. Review Overview, Performance Summary and List of trades. Use <em>Properties</em> to set capital, commission and slippage you actually pay.
              </div>
            </li>
          ) : (
            <li>
              <div>
                Open the script <strong>Settings</strong> (gear) to toggle visuals, sessions and alerts. The dashboard table shows live rule status.
              </div>
            </li>
          )}
          {isStrat && (
            <li>
              <div>
                Export results: in the Strategy Tester, use the export option for the <strong>List of trades</strong> (CSV), then import it under{' '}
                <a href="#/backtests">Backtest Analysis</a> for out-of-sample, walk-forward, cost-stress and Monte Carlo checks.
              </div>
            </li>
          )}
        </ol>
        )}
        <p className="muted small">{t('TradingView has no public API for creating or compiling scripts, so this launcher uses the supported manual workflow. Your TradingView credentials are never requested or stored.')}</p>
      </Card>
      <div className="col">
        <Card title={t('Verification checklist')} actions={<span className="muted small">{done.filter(Boolean).length}/{checklist.length}</span>}>
          <div className="col" style={{ gap: 8 }}>
            {checklist.map((c, i) => (
              <label key={i} className="check" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={done[i]} onChange={(e) => setDone(done.map((d, k) => (k === i ? e.target.checked : d)))} />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </Card>
        <Card title={t('Alerts & webhooks')}>
          {ar ? (
            <ol className="clean" style={{ paddingInlineStart: 18, margin: 0 }}>
              <li>اضغط بالزر الأيمن على الرسم ← Add alert. الشرط (Condition): هذا السكربت.</li>
              {isStrat ? (
                <li>
                  اختر <em>alert() function calls only</em> لأحداث الإعداد والدخول والخروج، أو <em>Order fills only</em> وضع <code>{'{{strategy.order.alert_message}}'}</code> في الرسالة لاستقبال JSON لكل أمر.
                </li>
              ) : (
                <li>
                  اختر شرطًا مسمّى (مثل “Confirmed long entry”) أو <em>Any alert() function call</em> لرسائل JSON.
                </li>
              )}
              <li>للأتمتة، فعّل Webhook URL (يحتاج اشتراك TradingView يدعم webhooks). الرسائل بصيغة JSON عند تفعيل “JSON alert messages”:</li>
            </ol>
          ) : (
          <ol className="clean" style={{ paddingInlineStart: 18, margin: 0 }}>
            <li>Right-click the chart → Add alert. Condition: this script.</li>
            {isStrat ? (
              <li>
                Choose <em>alert() function calls only</em> for setup/entry/exit events, or <em>Order fills only</em> and put <code>{'{{strategy.order.alert_message}}'}</code> in the message to receive the per-order JSON.
              </li>
            ) : (
              <li>
                Choose a named condition (e.g. “Confirmed long entry”) or <em>Any alert() function call</em> for the JSON messages.
              </li>
            )}
            <li>For automation, enable Webhook URL (requires a TradingView plan that supports webhooks). Messages are JSON when “JSON alert messages” is on:</li>
          </ol>
          )}
          <pre className="code-box" style={{ marginTop: 10 }}>
            {sample}
          </pre>
          <p className="muted small">{t('Strategy alerts evaluate on bar close. No order is ever sent to a broker by this app; any execution integration is your own and should be paper-traded first.')}</p>
        </Card>
      </div>
    </div>
  );
}

function Validation({ id, version, code, onUpdated, jump }: { id: string; version: VersionRow; code: string; onUpdated: () => void; jump: (l?: number) => void }) {
  const { toast } = useApp();
  const { t, tx } = useI18n();
  const [ok, setOk] = useState<'ok' | 'err'>('ok');
  const [msgs, setMsgs] = useState('');
  const [fix, setFix] = useState<Awaited<ReturnType<typeof api.fix>> | null>(null);
  const [busy, setBusy] = useState(false);
  const v = version.validation;
  const icon = (d: Diagnostic) => <span className={`sev ${d.severity}`}>{d.severity === 'error' ? '!' : d.severity === 'warning' ? '?' : 'i'}</span>;
  return (
    <div className="split">
      <div>
        {v.stages.map((s) => (
          <details key={s.stage} className="stage" open={s.status === 'fail' || s.status === 'warn'}>
            <summary>
              <Badge tone={s.status === 'pass' ? 'good' : s.status === 'warn' ? 'warn' : s.status === 'fail' ? 'bad' : 'neutral'} dot>
                {t(s.status === 'not_run' ? 'not run' : s.status)}
              </Badge>
              <strong dir="auto">{t(s.title)}</strong>
              <span className="muted small">{s.checksRun.length ? t('{n} checks', { n: s.checksRun.length }) : ''}</span>
            </summary>
            <div className="stage-body">
              {s.note && (
                <p className="muted small" style={{ marginTop: 0 }} dir="auto">
                  {s.note}
                </p>
              )}
              {s.diagnostics.length === 0 && s.status !== 'not_run' && <p className="small" style={{ margin: 0 }}>{t('All checks passed.')}</p>}
              {s.diagnostics.map((d, i) => (
                <div key={i} className="diag" dir="ltr">
                  {icon(d)}
                  <span>
                    {d.message}
                    {d.line && (
                      <>
                        {' '}
                        <a href="#" onClick={(e) => (e.preventDefault(), jump(d.line))}>
                          line {d.line}
                        </a>
                      </>
                    )}
                    <span className="muted small"> · {d.check}</span>
                  </span>
                </div>
              ))}
              {s.checksRun.length > 0 && (
                <p className="muted small" dir="auto">
                  {t('Checks:')} <span dir="ltr">{s.checksRun.join(', ')}</span>
                </p>
              )}
            </div>
          </details>
        ))}
        <p className="muted small">{t('The static analyzer is not TradingView’s compiler. A script is only “compiled” once you record a TradingView result.')}</p>
      </div>
      <div className="col">
        <Card title={t('Record TradingView result')}>
          <div className="col">
            {version.compile && (
              <div className={`notice ${version.compile.ok ? 'good' : 'bad'}`}>
                {t('Recorded {when}: {res}', { when: tx(ago(version.compile.at)), res: t(version.compile.ok ? 'compiled OK' : 'errors') })}
              </div>
            )}
            <div className="row">
              <label className="check">
                <input type="radio" checked={ok === 'ok'} onChange={() => setOk('ok')} /> {t('Compiled & added to chart')}
              </label>
              <label className="check">
                <input type="radio" checked={ok === 'err'} onChange={() => setOk('err')} /> {t('Had errors')}
              </label>
            </div>
            <textarea rows={5} placeholder={t(ok === 'ok' ? 'Optional notes (warnings shown by TradingView…)' : 'Paste the error lines from the Pine Editor console, e.g. "line 412: Undeclared identifier…"')}
              dir="auto" value={msgs} onChange={(e) => setMsgs(e.target.value)} />
            <div className="row">
              <button
                className="btn primary"
                disabled={busy || (ok === 'err' && !msgs.trim())}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.recordCompile(id, version.version, ok === 'ok', msgs);
                    toast(t('Result recorded.'));
                    onUpdated();
                  } catch (e) {
                    toast((e as Error).message, 'bad');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Save result')}
              </button>
              {ok === 'err' && (
                <button
                  className="btn"
                  disabled={busy || !msgs.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setFix(await api.fix(code, msgs));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Analyze errors')}
                </button>
              )}
            </div>
          </div>
        </Card>
        {fix && (
          <Card title={t('Error analysis')}>
            {fix.hints.map((h) => (
              <div key={h.title} className="notice warn" style={{ marginBottom: 10 }} dir="auto">
                <strong>{h.title}.</strong> {h.fix}
              </div>
            ))}
            {fix.context.length === 0 && !fix.hints.length && <p className="muted small">{t('No line numbers recognised in the pasted errors.')}</p>}
            {fix.context.map((c) => (
              <div key={c.line} style={{ marginBottom: 8 }}>
                <a href="#" onClick={(e) => (e.preventDefault(), jump(c.line))}>
                  {t('Line {n}', { n: c.line })}
                </a>
                <pre className="code-box">{c.text}</pre>
              </div>
            ))}
            {fix.suggestion ? (
              <div dir="auto">
                <Markdown text={fix.suggestion} />
              </div>
            ) : (
              <p className="muted small">{fix.aiError ? t('AI analysis failed: {e}', { e: fix.aiError }) : t('Configure an LLM in Settings for AI fix suggestions.')}</p>
            )}
            <p className="muted small" dir="auto">
              {fix.note}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Explain({ id, v }: { id: string; v: number }) {
  const [sections, setSections] = useState<ExplainSection[] | null>(null);
  useEffect(() => {
    api.explain(id, v).then(setSections);
  }, [id, v]);
  if (!sections) return <Spinner />;
  return (
    <div className="grid g2">
      {sections.map((s) => (
        <Card key={s.title} title={<span dir="auto">{s.title}</span>}>
          <ul className="clean" dir="auto">
            {s.items.map((i, k) => (
              <li key={k}>{i}</li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Versions({ versions }: { versions: VersionRow[] }) {
  const { t, tx } = useI18n();
  const [a, setA] = useState(versions[1]?.version ?? versions[0].version);
  const [b, setB] = useState(versions[0].version);
  const va = versions.find((v) => v.version === a)!;
  const vb = versions.find((v) => v.version === b)!;
  return (
    <div className="col">
      <Card pad={false}>
        <table>
          <thead>
            <tr>
              <th>{t('Version')}</th>
              <th>{t('Note')}</th>
              <th>{t('Status')}</th>
              <th>{t('Created')}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const vt = validationTone(v.validation);
              return (
                <tr key={v.version}>
                  <td>v{v.version}</td>
                  <td dir="auto">{v.note || '—'}</td>
                  <td>
                    <Badge tone={vt.tone}>{tx(vt.label)}</Badge>
                  </td>
                  <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {versions.length > 1 ? (
        <Card
          title={t('Compare versions')}
          actions={
            <div className="row">
              <select value={a} onChange={(e) => setA(Number(e.target.value))} style={{ width: 'auto' }}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select value={b} onChange={(e) => setB(Number(e.target.value))} style={{ width: 'auto' }}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <PineDiff a={va.code} b={vb.code} />
        </Card>
      ) : (
        <Card>
          <Empty>{t('Only one version so far. Edit the specification to create another.')}</Empty>
        </Card>
      )}
    </div>
  );
}
