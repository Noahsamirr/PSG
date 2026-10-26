// Strategy discovery: published methodologies of well-known traders and educators, each linked to this app's
// independent implementation (or marked as not implemented). No originator returns or win rates are shown.
import { useEffect, useState } from 'react';
import { api, type MethodProfile } from '../api';
import { Badge, Card, Spinner, useApp } from '../components/ui';

const FIDELITY: Record<MethodProfile['fidelity'], { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  close: { tone: 'good', label: 'Independent implementation — close to published rules' },
  approximation: { tone: 'warn', label: 'Independent implementation — approximation' },
  'not-implemented': { tone: 'neutral', label: 'Not implemented yet' },
};

export function Discovery() {
  const { go, toast } = useApp();
  const [list, setList] = useState<MethodProfile[] | null>(null);
  const [followed, setFollowed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pf-followed') ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    api.discovery().then(setList).catch((e) => toast((e as Error).message, 'bad'));
  }, [toast]);
  const follow = (p: MethodProfile) => {
    const next = followed.includes(p.id) ? followed.filter((x) => x !== p.id) : [...followed, p.id];
    setFollowed(next);
    try {
      localStorage.setItem('pf-followed', JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  // Adds the linked strategy to the dashboard's active set and opens the dashboard.
  const activate = (p: MethodProfile) => {
    if (!p.templateId) return;
    try {
      const slots = JSON.parse(localStorage.getItem('pf-an-slots') ?? '{}') as Record<string, number>;
      if (!(p.templateId in slots)) {
        const used = new Set(Object.values(slots));
        const free = [0, 1, 2, 3, 4, 5].find((k) => !used.has(k));
        if (free === undefined) {
          toast('Six strategies are already active — deactivate one on the dashboard first.', 'bad');
          return;
        }
        slots[p.templateId] = free;
        localStorage.setItem('pf-an-slots', JSON.stringify(slots));
      }
    } catch {
      /* storage unavailable */
    }
    go('/');
  };
  const sorted = list ? [...list].sort((a, b) => Number(followed.includes(b.id)) - Number(followed.includes(a.id))) : null;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Strategy discovery</h1>
          <p>
            Methodologies published by well-known traders and educators. No platform offers verified trading records for these people through an official API, so no returns or win rates are shown for them. What you see is the published rule set, its source, and how faithfully this app re-implements it.
            Test an implementation on the dashboard to see its results on your market.
          </p>
        </div>
      </div>
      {!sorted ? (
        <Spinner />
      ) : (
        <div className="signal-grid">
          {sorted.map((p) => {
            const f = FIDELITY[p.fidelity];
            const on = followed.includes(p.id);
            return (
              <Card key={p.id} title={p.name} actions={<Badge tone={f.tone}>{p.fidelity === 'not-implemented' ? 'not implemented' : p.fidelity}</Badge>}>
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <div>
                    <b>{p.originator}</b>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Source: {p.source} · {p.published}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {p.style} · {p.markets} · {p.timeframe}
                  </div>
                  <div>
                    <b>Entry:</b> {p.entry}
                  </div>
                  <div>
                    <b>Exit:</b> {p.exit}
                  </div>
                  <div>
                    <b>Risk:</b> {p.risk}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Badge tone="neutral">Originator results: {p.evidence}</Badge>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {p.verification}
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary className="sum">
                      {f.label} — {p.differences.length} difference{p.differences.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="checks">
                      {p.differences.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.licensing}
                    </div>
                  </details>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn sm primary" disabled={!p.templateId} onClick={() => activate(p)}>
                      Test on dashboard
                    </button>
                    <button className="btn sm" onClick={() => follow(p)}>
                      {on ? 'Following ✓' : 'Follow'}
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
