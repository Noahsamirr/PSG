import { describe, expect, it } from 'vitest';
import { analyzeRegime, blackoutWindow, dedupe, tone, topicsOf, topicStats, type Bar } from '../src/core';
import { parseFeed } from '../src/server/research';

const series = (f: (i: number) => number, n = 260): Bar[] => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * 86400000, o: f(i), h: f(i) * 1.002, l: f(i) * 0.998, c: f(i) }));

describe('regime analysis', () => {
  it('labels a steady rise as an uptrend', () => {
    expect(analyzeRegime(series((i) => 100 + i * 0.5 + Math.sin(i) * 0.2)).regime).toBe('Uptrend');
  });
  it('labels a choppy oscillation as a range', () => {
    expect(analyzeRegime(series((i) => 100 + Math.sin(i * 1.3) * 3)).regime).toBe('Range');
  });
  it('refuses to classify short histories', () => {
    expect(analyzeRegime(series((i) => 100 + i, 30)).regime).toBe('Insufficient data');
  });
});

describe('headline analysis', () => {
  it('detects topics and tone', () => {
    expect(topicsOf('Fed signals rate cut as inflation eases')).toEqual(expect.arrayContaining(['Central banks & rates', 'Inflation']));
    expect(tone('Stocks rally to record high')).toBeGreaterThan(0);
    expect(tone('Bitcoin plunges as fears grow')).toBeLessThan(0);
  });
  it('de-duplicates syndicated headlines', () => {
    const items = [
      { title: 'Gold hits record as dollar slides - Reuters', link: 'a', source: 'x', category: 'c', published: 1 },
      { title: 'Gold hits record as dollar slides - MarketWatch', link: 'b', source: 'y', category: 'c', published: 2 },
    ];
    expect(dedupe(items)).toHaveLength(1);
    expect(topicStats(items)[0].count).toBeGreaterThan(0);
  });
  it('builds a blackout window around an event in New York time', () => {
    const w = blackoutWindow({ title: 'CPI', country: 'USD', time: Date.UTC(2026, 0, 13, 13, 30), impact: 'High' });
    expect(w.session).toBe('0815-0845');
  });
  it('parses RSS and Atom feeds', () => {
    const rss = '<rss><channel><item><title>Oil &amp; gas &#x2013; update</title><link>https://e.com/1</link><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Body&lt;/p&gt;</description></item></channel></rss>';
    const atom = '<feed><entry><title>Atom title</title><link href="https://e.com/2"/><updated>2026-10-23T10:00:00Z</updated></entry></feed>';
    expect(parseFeed(rss, 'S', 'C')[0]).toMatchObject({ title: 'Oil & gas – update', link: 'https://e.com/1', summary: 'Body' });
    expect(parseFeed(atom, 'S', 'C')[0]).toMatchObject({ title: 'Atom title', link: 'https://e.com/2' });
  });
});
