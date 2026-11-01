import { useEffect, useState } from 'react';
import { api, type BacktestSummary, type ResearchReport, type ScriptRow, type VersionRow } from '../api';
import { ago, Badge, Card, Empty, fmt, fmtPct, Icon, Spinner, useApp, validationTone } from '../components/ui';
import { tfLabel } from '../../core/timeframe';
import { useI18n } from '../i18n';

export function Dashboard() {
  const { catalog, settings } = useApp();
  const [scripts, setScripts] = useState<ScriptRow[] | null>(null);
  const [latest, setLatest] = useState<Record<string, VersionRow>>({});
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [research, setResearch] = useState<{ createdAt: string; report: ResearchReport } | null>(null);
  useEffect(() => {
    api.scripts().then(async (s) => {
      setScripts(s);
      const top = s.slice(0, 8);
      const details = await Promise.all(top.map((x) => api.script(x.id).catch(() => null)));
      const map: Record<string, VersionRow> = {};
      details.forEach((d) => d && d.versions[0] && (map[d.script.id] = d.versions[0]));
      setLatest(map);
    });
    api.backtests().then(setBacktests);
    api.latestResearch().then(setResearch);
  }, []);
  const favs = (scripts ?? []).filter((s) => s.favorite);
  const statuses = Object.values(latest).map((v) => validationTone(v.validation).tone);
  const { t, tx, lang } = useI18n();
  const ar = lang === 'ar';
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('Scripts Overview')}</h1>
          <p>{t('Generate Pine Script v6 indicators and strategies from researched templates, validate them, and launch them in TradingView. Transparent rules, realistic testing, explicit limitations — not a profit-prediction machine.')}</p>
        </div>
        <div className="hero-cta">
          <a className="btn" href="#/research">
            <Icon name="globe" size={16} /> {t('Market Research')}
          </a>
          <a className="btn primary" href="#/builder">
            <Icon name="wand" size={16} /> {t('New strategy')}
          </a>
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">{t('Scripts')}</div>
          <div className="value">{scripts?.length ?? '—'}</div>
          <div className="sub">{t('{n} favourite(s)', { n: favs.length })}</div>
        </div>
        <div className="card stat">
          <div className="label">{t('Validation (recent scripts)')}</div>
          <div className="value">
            {statuses.filter((s) => s === 'good').length}
            <span className="muted" style={{ fontSize: 15 }}> / {t('{n} clean', { n: statuses.length })}</span>
          </div>
          <div className="sub">{t('{e} with errors · {w} with warnings', { e: statuses.filter((s) => s === 'bad').length, w: statuses.filter((s) => s === 'warn').length })}</div>
        </div>
        <div className="card stat">
          <div className="label">{t('Imported results')}</div>
          <div className="value">{backtests.length}</div>
          <div className="sub">{t('{n} out-of-sample / paper / live', { n: backtests.filter((b) => b.kind !== 'backtest').length })}</div>
        </div>
        <div className="card stat">
          <div className="label">{t('Library')}</div>
          <div className="value">{catalog?.templates.length ?? '—'}</div>
          <div className="sub">{t('strategies · {n} indicator modules · AI: {ai}', { n: catalog?.components.length ?? '—', ai: settings?.llm.configured ? (settings.llm.model ?? '') : t('off') })}</div>
        </div>
      </div>
      <div className="split">
        <div className="col">
          <Card title={t('Recent scripts')} actions={<a href="#/scripts" className="small">{t('All scripts →')}</a>} pad={false}>
            {scripts === null ? (
              <div className="empty">
                <Spinner />
              </div>
            ) : scripts.length === 0 ? (
              <Empty>
                {ar ? (
                  <>
                    لا توجد سكربتات بعد. <a href="#/builder">صف استراتيجية</a> أو اختر واحدة من <a href="#/library">المكتبة</a>.
                  </>
                ) : (
                  <>
                    No scripts yet. <a href="#/builder">Describe a strategy</a> or pick one from the <a href="#/library">library</a>.
                  </>
                )}
              </Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Chart')}</th>
                    <th>{t('Version')}</th>
                    <th>{t('Validation')}</th>
                    <th>{t('Updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scripts.slice(0, 8).map((s) => {
                    const v = latest[s.id];
                    const vt = v ? validationTone(v.validation) : null;
                    return (
                      <tr key={s.id} className="clickable" onClick={() => (location.hash = `/scripts/${s.id}`)}>
                        <td dir="auto">
                          {s.favorite && '★ '}
                          {s.name}
                        </td>
                        <td>{t(s.output)}</td>
                        <td>{v ? `${v.spec.market.symbol ? v.spec.market.symbol + ' ' : ''}${tfLabel(v.spec.market.timeframe)}` : '—'}</td>
                        <td>v{s.latestVersion}</td>
                        <td>{vt ? <Badge tone={vt.tone} dot>{tx(vt.label)}</Badge> : <Spinner />}</td>
                        <td className="muted">{tx(ago(s.updatedAt))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={t('Recent backtest imports')} actions={<a href="#/backtests" className="small">{t('Analyse →')}</a>} pad={false}>
            {backtests.length === 0 ? (
              <Empty>{t('Import a TradingView “List of trades” export to analyse robustness.')}</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('Run')}</th>
                    <th>{t('Type')}</th>
                    <th className="num">{t('Trades')}</th>
                    <th className="num">{t('Profit factor')}</th>
                    <th className="num">{t('Win rate')}</th>
                    <th className="num">{t('Net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {backtests.slice(0, 6).map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => (location.hash = `/backtests/${b.id}`)}>
                      <td dir="auto">{b.label}</td>
                      <td>
                        <Badge>{b.kind.replace('_', '-')}</Badge>
                      </td>
                      <td className="num">{b.tradeCount}</td>
                      <td className="num">{fmt(b.metrics.profitFactor)}</td>
                      <td className="num">{fmtPct(b.metrics.winRate, 1, false)}</td>
                      <td className="num">{fmt(b.metrics.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="col">
          <Card title={t('Market pulse')} actions={<a href="#/research" className="small">{t('Open research →')}</a>}>
            {!research ? (
              <Empty>
                {ar ? (
                  <>
                    لا توجد أبحاث بعد. <a href="#/research">شغّل أبحاث السوق</a> لجلب آخر الأخبار والأجندة وحالات السوق.
                  </>
                ) : (
                  <>
                    No research yet. <a href="#/research">Run market research</a> to pull the latest news, calendar and regimes.
                  </>
                )}
              </Empty>
            ) : (
              <div className="col">
                <span className="muted small">{t('Updated {when}', { when: tx(ago(research.createdAt)) })}</span>
                {research.report.markets
                  .filter((m) => m.ok && m.regime)
                  .slice(0, 6)
                  .map((m) => (
                    <div key={m.symbol} className="row small">
                      <strong style={{ width: 70 }}>{m.symbol}</strong>
                      <Badge tone={m.regime!.regime === 'Uptrend' ? 'good' : m.regime!.regime === 'Downtrend' ? 'bad' : 'neutral'}>{t(m.regime!.regime)}</Badge>
                      <span className="muted num">1W {fmtPct(m.regime!.change.w1)}</span>
                    </div>
                  ))}
                <div className="small">
                  <strong>{t('Top themes:')}</strong> <span dir="auto">{research.report.topics.slice(0, 4).map((x) => x.topic).join(', ')}</span>
                </div>
                {research.report.calendar && research.report.calendar.events.length > 0 && (
                  <div className="small">
                    <strong>{t('Next high-impact:')}</strong>{' '}
                    {research.report.calendar.events
                      .filter((e) => e.impact === 'High')
                      .slice(0, 2)
                      .map((e) => `${e.country} ${e.title} (${new Date(e.time).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`)
                      .join(' · ') || t('none this week')}
                  </div>
                )}
              </div>
            )}
          </Card>
          <Card title={t('Favourite strategies')}>
            {favs.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {t('Star a script in Scripts & Launcher to pin it here.')}
              </p>
            ) : (
              <ul className="clean">
                {favs.map((s) => (
                  <li key={s.id} dir="auto">
                    <a href={`#/scripts/${s.id}`}>{s.name}</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('Workflow')}>
            {ar ? (
              <ol className="steps small">
                <li>
                  <span>
                    <a href="#/research">ابحث</a> في حالات السوق الحالية والمواضيع ومخاطر الأحداث.
                  </span>
                </li>
                <li>
                  <span>
                    <a href="#/builder">صِف</a> استراتيجية، أو اختر <a href="#/library">قالبًا</a>، أو ابنِ توافقًا من عدة استراتيجيات.
                  </span>
                </li>
                <li>
                  <span>راجع المواصفات، ثم أنشئ السكربت وافحص تقرير التحقق.</span>
                </li>
                <li>
                  <span>
                    <a href="#/scripts">شغّله</a> في TradingView، وسجّل نتيجة التجميع، وشغّل Strategy Tester.
                  </span>
                </li>
                <li>
                  <span>
                    <a href="#/backtests">استورد</a> الصفقات واختبرها تحت الضغط قبل أي تداول تجريبي أو حقيقي.
                  </span>
                </li>
              </ol>
            ) : (
            <ol className="steps small">
              <li>
                <span>
                  <a href="#/research">Research</a> current regimes, themes and event risk.
                </span>
              </li>
              <li>
                <span>
                  <a href="#/builder">Describe</a> a strategy, pick a <a href="#/library">template</a>, or build a multi-strategy consensus.
                </span>
              </li>
              <li>
                <span>Review the specification, generate, and check the validation report.</span>
              </li>
              <li>
                <span>
                  <a href="#/scripts">Launch</a> in TradingView, record the compile result, run the Strategy Tester.
                </span>
              </li>
              <li>
                <span>
                  <a href="#/backtests">Import</a> trades and stress-test before any paper or live use.
                </span>
              </li>
            </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
