// Curated reference library for market analysis and strategy research.
// Entries without a URL are books or papers best found by title.

export interface Resource {
  category: string;
  title: string;
  url?: string;
  description: string;
  cost: 'free' | 'freemium' | 'paid';
}

const r = (category: string, title: string, url: string | undefined, description: string, cost: Resource['cost'] = 'free'): Resource => ({ category, title, url, description, cost });

const PINE = 'Pine Script & TradingView';
const NEWS = 'News & market coverage';
const CAL = 'Economic & earnings calendars';
const CB = 'Central banks & official statistics';
const POS = 'Positioning, sentiment & volatility';
const DATA = 'Market data & APIs';
const TOOLS = 'Screeners & analysis tools';
const QUANT = 'Backtesting & quant libraries';
const PAPERS = 'Research evidence (academic)';
const BOOKS = 'Books';
const REG = 'Regulators & investor protection';
const COMM = 'Communities & research blogs';

export const RESOURCES: Resource[] = [
  r(PINE, 'Pine Script v6 User Manual', 'https://www.tradingview.com/pine-script-docs/', 'Official language manual: concepts, writing, FAQ.'),
  r(PINE, 'Pine Script v6 Reference Manual', 'https://www.tradingview.com/pine-script-reference/v6/', 'Every built-in function, variable and constant.'),
  r(PINE, 'Migrating to Pine Script v6', 'https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/', 'Breaking changes from v5 (bool na, lazy and/or, removed when/transp...).'),
  r(PINE, 'Strategies (orders, fills, Strategy Tester)', 'https://www.tradingview.com/pine-script-docs/concepts/strategies/', 'How the broker emulator fills orders, partial exits, commissions, margin.'),
  r(PINE, 'Repainting', 'https://www.tradingview.com/pine-script-docs/concepts/repainting/', 'Why scripts repaint and how to avoid it (confirmed bars, HTF requests).'),
  r(PINE, 'Other timeframes and data (request.security)', 'https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/', 'Non-repainting multi-timeframe requests.'),
  r(PINE, 'Alerts', 'https://www.tradingview.com/pine-script-docs/concepts/alerts/', 'alert(), alertcondition(), order-fill alerts and placeholders.'),
  r(PINE, 'Limitations', 'https://www.tradingview.com/pine-script-docs/writing/limitations/', 'Plot counts, drawing limits, execution time, loops.'),
  r(PINE, 'Style guide', 'https://www.tradingview.com/pine-script-docs/writing/style-guide/', 'Naming and layout conventions for readable scripts.'),
  r(PINE, 'TradingView community scripts', 'https://www.tradingview.com/scripts/', 'Open-source indicators and strategies (check licences before reuse).'),
  r(PINE, "TradingView Editors' Picks", 'https://www.tradingview.com/scripts/editors-picks/', 'Moderator-selected open-source scripts.'),
  r(PINE, 'TradingView Help Center', 'https://www.tradingview.com/support/', 'Strategy Tester, alerts, webhooks and account help.'),
  r(PINE, 'Pine Script questions on Stack Overflow', 'https://stackoverflow.com/questions/tagged/pine-script', 'Community Q&A, many answers by PineCoders.'),

  r(NEWS, 'Reuters — Markets', 'https://www.reuters.com/markets/', 'Global markets wire coverage.', 'freemium'),
  r(NEWS, 'Bloomberg — Markets', 'https://www.bloomberg.com/markets', 'Markets news and data.', 'paid'),
  r(NEWS, 'Financial Times — Markets', 'https://www.ft.com/markets', 'Markets and economics coverage.', 'paid'),
  r(NEWS, 'CNBC — Markets', 'https://www.cnbc.com/markets/', 'US-centric markets news (RSS used by the research engine).'),
  r(NEWS, 'MarketWatch', 'https://www.marketwatch.com/', 'Markets headlines (RSS used by the research engine).', 'freemium'),
  r(NEWS, 'Yahoo Finance', 'https://finance.yahoo.com/', 'Quotes, news, financial statements.'),
  r(NEWS, 'Investing.com', 'https://www.investing.com/', 'Multi-asset news, quotes and calendars.'),
  r(NEWS, 'FXStreet', 'https://www.fxstreet.com/', 'FX and gold news and analysis.'),
  r(NEWS, 'ForexLive', 'https://www.forexlive.com/', 'Real-time FX news flow.'),
  r(NEWS, 'Kitco', 'https://www.kitco.com/', 'Precious-metals prices and news.'),
  r(NEWS, 'CoinDesk', 'https://www.coindesk.com/', 'Crypto markets news.'),
  r(NEWS, 'Cointelegraph', 'https://cointelegraph.com/', 'Crypto news.'),
  r(NEWS, 'The Block', 'https://www.theblock.co/', 'Crypto industry news and data.', 'freemium'),
  r(NEWS, 'Seeking Alpha — Market Currents', 'https://seekingalpha.com/', 'Equity news and analysis.', 'freemium'),
  r(NEWS, 'TradingView News', 'https://www.tradingview.com/news/', 'Aggregated headlines by symbol.'),
  r(NEWS, 'BBC Business', 'https://www.bbc.com/news/business', 'General business and economy news.'),

  r(CAL, 'Forex Factory calendar', 'https://www.forexfactory.com/calendar', 'Macro events with impact ratings (weekly feed used by the research engine).'),
  r(CAL, 'Investing.com economic calendar', 'https://www.investing.com/economic-calendar/', 'Global macro calendar with forecasts.'),
  r(CAL, 'TradingView economic calendar', 'https://www.tradingview.com/economic-calendar/', 'Macro calendar inside TradingView.'),
  r(CAL, 'FOMC meeting calendar', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'Fed meeting dates, statements and minutes.'),
  r(CAL, 'BLS release calendar', 'https://www.bls.gov/schedule/news_release/', 'CPI, payrolls, PPI release schedule.'),
  r(CAL, 'BEA release schedule', 'https://www.bea.gov/news/schedule', 'GDP and PCE release dates.'),
  r(CAL, 'CME FedWatch', 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html', 'Market-implied probabilities of Fed rate decisions.'),
  r(CAL, 'Nasdaq earnings calendar', 'https://www.nasdaq.com/market-activity/earnings', 'US company earnings dates.'),

  r(CB, 'Federal Reserve', 'https://www.federalreserve.gov/', 'US monetary policy, speeches, data (press RSS used by the research engine).'),
  r(CB, 'European Central Bank', 'https://www.ecb.europa.eu/', 'Euro-area policy and reference FX rates.'),
  r(CB, 'Bank of England', 'https://www.bankofengland.co.uk/', 'UK monetary policy.'),
  r(CB, 'Bank of Japan', 'https://www.boj.or.jp/en/', 'Japanese monetary policy.'),
  r(CB, 'FRED (St. Louis Fed)', 'https://fred.stlouisfed.org/', '800k+ economic time series; free API key available.'),
  r(CB, 'US Bureau of Labor Statistics', 'https://www.bls.gov/', 'Inflation and labour statistics.'),
  r(CB, 'US Bureau of Economic Analysis', 'https://www.bea.gov/', 'GDP, PCE, trade.'),
  r(CB, 'US Treasury interest-rate data', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', 'Daily yield curve rates.'),
  r(CB, 'US Energy Information Administration', 'https://www.eia.gov/', 'Oil, gas and inventory data (weekly petroleum status report).'),
  r(CB, 'Eurostat', 'https://ec.europa.eu/eurostat', 'EU statistics.'),
  r(CB, 'IMF Data', 'https://www.imf.org/en/Data', 'Global macro datasets.'),
  r(CB, 'World Bank Open Data', 'https://data.worldbank.org/', 'Development and macro indicators.'),
  r(CB, 'OECD Data', 'https://www.oecd.org/en/data.html', 'OECD economic indicators and leading indicators.'),
  r(CB, 'World Gold Council — Goldhub', 'https://www.gold.org/goldhub', 'Gold supply/demand, ETF flows and central-bank purchases.'),

  r(POS, 'CFTC Commitments of Traders', 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm', 'Weekly futures positioning by trader category (official, free).'),
  r(POS, 'AAII Sentiment Survey', 'https://www.aaii.com/sentimentsurvey', 'Weekly retail investor sentiment.'),
  r(POS, 'CNN Fear & Greed Index', 'https://edition.cnn.com/markets/fear-and-greed', 'Composite US equity sentiment gauge.'),
  r(POS, 'Crypto Fear & Greed Index', 'https://alternative.me/crypto/fear-and-greed-index/', 'Crypto sentiment gauge (API used by the research engine).'),
  r(POS, 'Cboe VIX', 'https://www.cboe.com/tradable_products/vix/', 'S&P 500 implied volatility index.'),
  r(POS, 'Cboe options market statistics', 'https://www.cboe.com/us/options/market_statistics/daily/', 'Daily put/call ratios and volumes.'),

  r(DATA, 'Binance public market data API', 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api', 'Free crypto OHLCV (used by the research engine via data-api.binance.vision).'),
  r(DATA, 'Frankfurter (ECB reference rates)', 'https://frankfurter.dev/', 'Free daily FX rates since 1999 (used by the research engine).'),
  r(DATA, 'CoinGecko API', 'https://www.coingecko.com/en/api', 'Crypto prices and market caps.', 'freemium'),
  r(DATA, 'FRED API', 'https://fred.stlouisfed.org/docs/api/fred/', 'Programmatic access to FRED series (free key).'),
  r(DATA, 'Alpha Vantage', 'https://www.alphavantage.co/', 'Stocks, FX, crypto and indicators API.', 'freemium'),
  r(DATA, 'Twelve Data', 'https://twelvedata.com/', 'Multi-asset market data API.', 'freemium'),
  r(DATA, 'Nasdaq Data Link', 'https://data.nasdaq.com/', 'Financial and alternative datasets.', 'freemium'),
  r(DATA, 'SEC EDGAR full-text search', 'https://www.sec.gov/edgar/search/', 'Company filings (10-K, 10-Q, 8-K).'),
  r(DATA, 'DefiLlama', 'https://defillama.com/', 'DeFi TVL, stablecoin and chain data.'),

  r(TOOLS, 'TradingView Screener', 'https://www.tradingview.com/screener/', 'Stock, crypto and FX screener.', 'freemium'),
  r(TOOLS, 'Finviz', 'https://finviz.com/', 'US stock screener and heatmaps.', 'freemium'),
  r(TOOLS, 'Koyfin', 'https://www.koyfin.com/', 'Macro and equity dashboards.', 'freemium'),
  r(TOOLS, 'Portfolio Visualizer', 'https://www.portfoliovisualizer.com/', 'Asset-allocation backtests and factor analysis.', 'freemium'),

  r(QUANT, 'Backtesting.py', 'https://kernc.github.io/backtesting.py/', 'Lightweight Python backtester — useful to cross-check Strategy Tester results.'),
  r(QUANT, 'vectorbt', 'https://vectorbt.dev/', 'Vectorised backtesting and parameter sweeps in Python.'),
  r(QUANT, 'backtrader', 'https://www.backtrader.com/', 'Event-driven Python backtesting framework.'),
  r(QUANT, 'QuantConnect / LEAN', 'https://www.quantconnect.com/', 'Open-source LEAN engine and cloud research platform.', 'freemium'),
  r(QUANT, 'NautilusTrader', 'https://nautilustrader.io/', 'High-performance backtesting and live trading platform.'),
  r(QUANT, 'Zipline Reloaded', 'https://github.com/stefan-jansen/zipline-reloaded', 'Maintained fork of the Quantopian backtester.'),
  r(QUANT, 'Freqtrade', 'https://www.freqtrade.io/', 'Open-source crypto trading bot with backtesting and hyperopt.'),
  r(QUANT, 'TA-Lib', 'https://ta-lib.org/', 'Reference implementations of technical indicators.'),
  r(QUANT, 'pandas-ta', 'https://github.com/twopirllc/pandas-ta', 'Technical indicators for pandas.'),
  r(QUANT, 'QuantStats', 'https://github.com/ranaroussi/quantstats', 'Portfolio performance and risk tear-sheets.'),
  r(QUANT, 'Machine Learning for Trading (code)', 'https://github.com/stefan-jansen/machine-learning-for-trading', 'Notebooks accompanying Stefan Jansen’s book.'),

  r(PAPERS, 'Brock, Lakonishok & LeBaron (1992) — Simple technical trading rules', 'https://doi.org/10.1111/j.1540-6261.1992.tb04681.x', 'Moving-average and breakout rules on the DJIA, 1897–1986.'),
  r(PAPERS, 'Sullivan, Timmermann & White (1999) — Data-snooping and technical rules', 'https://doi.org/10.1111/0022-1082.00184', 'Best rules lose significance after correcting for data snooping.'),
  r(PAPERS, 'Lo, Mamaysky & Wang (2000) — Foundations of Technical Analysis', 'https://doi.org/10.1111/0022-1082.00265', 'Statistical test of chart patterns.'),
  r(PAPERS, 'Park & Irwin (2007) — Profitability of technical analysis survey', 'https://doi.org/10.1111/j.1467-6419.2007.00519.x', 'Review of 95 modern studies; flags data-snooping and cost issues.'),
  r(PAPERS, 'Jegadeesh & Titman (1993) — Returns to buying winners and selling losers', 'https://doi.org/10.1111/j.1540-6261.1993.tb04702.x', 'Cross-sectional momentum.'),
  r(PAPERS, 'Moskowitz, Ooi & Pedersen (2012) — Time Series Momentum', 'https://doi.org/10.1016/j.jfineco.2011.11.003', 'Trend persistence across 58 futures markets.'),
  r(PAPERS, 'Hurst, Ooi & Pedersen (2017) — A Century of Evidence on Trend-Following', 'https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing', 'Trend-following since 1880 across asset classes.'),
  r(PAPERS, 'Engle (1982) — ARCH', 'https://doi.org/10.2307/1912773', 'Volatility clustering — basis for volatility filters.'),
  r(PAPERS, 'Bailey, Borwein, López de Prado & Zhu (2014) — Pseudo-Mathematics and Financial Charlatanism', 'https://www.ams.org/notices/201405/rnoti-p458.pdf', 'How backtest overfitting produces false discoveries.'),
  r(PAPERS, 'Bailey & López de Prado (2014) — The Deflated Sharpe Ratio', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551', 'Adjusting performance for multiple testing.'),
  r(PAPERS, 'Harvey & Liu (2015) — Backtesting', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2345489', 'Haircutting Sharpe ratios for multiple testing.'),
  r(PAPERS, 'Harvey, Liu & Zhu (2016) — …and the Cross-Section of Expected Returns', 'https://doi.org/10.1093/rfs/hhv059', 'Why t > 3 is a better bar for new factors.'),
  r(PAPERS, 'Osler (2000) — Support for Resistance', undefined, 'FRBNY Economic Policy Review: S/R levels and intraday FX.'),
  r(PAPERS, 'Zarattini & Aziz (2023) — Opening Range Breakout day trading', undefined, 'SSRN working paper on ORB in US stocks/QQQ.'),

  r(BOOKS, 'J. Welles Wilder — New Concepts in Technical Trading Systems (1978)', undefined, 'Original RSI, ATR, ADX/DMI, Parabolic SAR.', 'paid'),
  r(BOOKS, 'David Aronson — Evidence-Based Technical Analysis (2006)', undefined, 'Scientific method and data-mining bias in TA.', 'paid'),
  r(BOOKS, 'Robert Pardo — The Evaluation and Optimization of Trading Strategies (2008)', undefined, 'Walk-forward analysis and robustness.', 'paid'),
  r(BOOKS, 'Perry Kaufman — Trading Systems and Methods (6th ed.)', undefined, 'Encyclopedic reference of systems and indicators.', 'paid'),
  r(BOOKS, 'Marcos López de Prado — Advances in Financial Machine Learning (2018)', undefined, 'Backtest overfitting, labelling, cross-validation for finance.', 'paid'),
  r(BOOKS, 'Ernest Chan — Algorithmic Trading (2013) / Quantitative Trading (2nd ed.)', undefined, 'Mean reversion and momentum strategies with code.', 'paid'),
  r(BOOKS, 'Andreas Clenow — Following the Trend (2013)', undefined, 'Diversified trend-following in practice.', 'paid'),
  r(BOOKS, 'Curtis Faith — Way of the Turtle (2007)', undefined, 'The Turtle rules from a participant.', 'paid'),
  r(BOOKS, 'John Murphy — Technical Analysis of the Financial Markets (1999)', undefined, 'Standard TA textbook.', 'paid'),
  r(BOOKS, 'Steve Nison — Japanese Candlestick Charting Techniques', undefined, 'Candlestick patterns reference.', 'paid'),
  r(BOOKS, 'John Bollinger — Bollinger on Bollinger Bands (2001)', undefined, 'The bands, by their inventor.', 'paid'),
  r(BOOKS, 'Connors & Alvarez — Short Term Trading Strategies That Work (2008)', undefined, 'RSI(2) and short-term mean reversion.', 'paid'),
  r(BOOKS, 'Van K. Tharp — Trade Your Way to Financial Freedom', undefined, 'Expectancy and position sizing (R multiples).', 'paid'),

  r(REG, 'Investor.gov (SEC)', 'https://www.investor.gov/', 'US investor education and fraud alerts.'),
  r(REG, 'CFTC — Learn & Protect', 'https://www.cftc.gov/LearnAndProtect', 'Futures/forex fraud advisories.'),
  r(REG, 'FINRA for investors', 'https://www.finra.org/investors', 'Broker checks and investor alerts.'),
  r(REG, 'NFA BASIC', 'https://www.nfa.futures.org/basicnet/', 'Check registration of futures/forex firms.'),
  r(REG, 'UK FCA — consumers', 'https://www.fca.org.uk/consumers', 'Scam warnings and the FCA register.'),
  r(REG, 'ESMA', 'https://www.esma.europa.eu/', 'EU securities regulator (CFD product rules).'),

  r(COMM, 'r/algotrading', 'https://www.reddit.com/r/algotrading/', 'Systematic trading community.'),
  r(COMM, 'Quantitative Finance Stack Exchange', 'https://quant.stackexchange.com/', 'Q&A on quant methods.'),
  r(COMM, 'Quantocracy', 'https://quantocracy.com/', 'Aggregator of quant research blogs.'),
  r(COMM, 'Alpha Architect blog', 'https://alphaarchitect.com/blog/', 'Evidence-based investing research summaries.'),
  r(COMM, 'AQR research', 'https://www.aqr.com/Insights/Research', 'Papers on trend, value, momentum, risk premia.'),
  r(COMM, 'Robot Wealth', 'https://robotwealth.com/', 'Practical systematic trading research.'),
];

export const RESOURCE_CATEGORIES = [...new Set(RESOURCES.map((x) => x.category))];
