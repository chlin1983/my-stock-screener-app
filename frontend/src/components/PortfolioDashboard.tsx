import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, AreaSeries, LineStyle } from 'lightweight-charts';
import { ChartPanel } from './ChartPanel';

interface PortfolioDashboardProps {
  theme?: 'light' | 'dark';
  onSelectTicker: (ticker: string) => void;
  onSwitchToScreener: () => void;
  refreshKey?: number;
}

interface Holding {
  ticker: string;
  name: string;
  qty: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  gain_loss: number;
  gain_loss_pct: number;
}

interface PortfolioSummary {
  total_cost: number;
  total_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  cash_balance: number;
}

interface PerformanceData {
  dates: string[];
  values: number[];
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

const fmt = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

// ── Metric pill shown in the holding card header ──────────────────────────────
const MetricPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
      {label}
    </div>
    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>{value}</div>
  </div>
);

// ── One card per holding: metrics header + auto-loaded embedded GMMA chart ────
const HoldingChartCard: React.FC<{ holding: Holding; theme: 'light' | 'dark' }> = ({ holding: h, theme }) => {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
      const res = await fetch(`${BACKEND_URL}/stock/${h.ticker}/history`);
        if (!res.ok) throw new Error(`Could not load chart for ${h.ticker}`);
        const data = await res.json();
        // Backend returns { dates, open, high, low, close, volume } arrays
        const formatted: Candle[] = (data.dates || []).map((date: string, i: number) => ({
          time: date,
          open: data.open[i],
          high: data.high[i],
          low: data.low[i],
          close: data.close[i],
          volume: data.volume[i],
        }));
        if (!cancelled) setCandles(formatted);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Error loading chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [h.ticker]);

  const isPositive = h.gain_loss >= 0;
  const pnlColor = isPositive ? '#10b981' : '#ef4444';

  return (
    <div
      className="glass-panel"
      style={{ padding: 0, overflow: 'hidden', animation: 'fadeIn 0.4s ease-out' }}
    >
      {/* ── Metrics header ─────────────────────────────────────────── */}
      <div style={{
        padding: '14px 22px',
        borderBottom: '1px solid var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '28px',
        flexWrap: 'wrap',
        background: `linear-gradient(90deg, ${isPositive ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)'} 0%, transparent 60%)`,
      }}>
        {/* Ticker + name */}
        <div style={{ minWidth: '120px' }}>
          <div style={{ fontWeight: 900, fontSize: '22px', color: 'var(--accent-primary)', letterSpacing: '-0.5px' }}>
            {h.ticker}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {h.name}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '40px', background: 'var(--glass-border)', flexShrink: 0 }} />

        {/* Metric pills */}
        <MetricPill label="Shares" value={h.qty.toLocaleString()} />
        <MetricPill label="Avg Cost" value={fmt(h.avg_cost)} />
        <MetricPill label="Current Price" value={fmt(h.current_price)} />
        <MetricPill label="Market Value" value={fmt(h.market_value)} />

        {/* Divider */}
        <div style={{ width: '1px', height: '40px', background: 'var(--glass-border)', flexShrink: 0 }} />

        {/* P&L — right-aligned, large */}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: '20px', color: pnlColor }}>
            {isPositive ? '+' : ''}{fmt(h.gain_loss)}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            marginTop: '2px', padding: '2px 8px', borderRadius: '12px',
            background: isPositive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${isPositive ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: pnlColor }}>
              {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{h.gain_loss_pct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Embedded GMMA chart ────────────────────────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px 20px' }}>
          <div className="loading-spinner" />
          <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Loading {h.ticker} GMMA chart…</span>
        </div>
      ) : error ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444', fontSize: '13px' }}>
          ⚠️ {error}
        </div>
      ) : candles.length > 0 ? (
        <ChartPanel
          ticker={h.ticker}
          candles={candles}
          gmmaData={{ showByDefault: true }}
          theme={theme}
        />
      ) : null}
    </div>
  );
};

// ── Main PortfolioDashboard component ─────────────────────────────────────────
export const PortfolioDashboard: React.FC<PortfolioDashboardProps> = ({
  theme = 'light',
  onSelectTicker: _onSelectTicker,
  onSwitchToScreener: _onSwitchToScreener,
  refreshKey = 0,
}) => {
  const yieldChartRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch holdings + performance
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [holdingsRes, perfRes] = await Promise.all([
          fetch(`${BACKEND_URL}/portfolio/holdings`),
          fetch(`${BACKEND_URL}/portfolio/performance`),
        ]);
        if (!holdingsRes.ok || !perfRes.ok) throw new Error('Failed to fetch portfolio data');
        const holdingsData = await holdingsRes.json();
        const perfData = await perfRes.json();
        setHoldings(holdingsData.holdings);
        setSummary(holdingsData.summary);
        setPerformance(perfData);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Error loading portfolio data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshKey]);

  // Portfolio Yield Curve chart
  useEffect(() => {
    if (!yieldChartRef.current || !performance || performance.dates.length === 0) return;
    const isDark = theme === 'dark';
    const chart = createChart(yieldChartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? 'rgba(21,23,30,0.7)' : '#ffffff' },
        textColor: isDark ? '#d1d4dc' : '#334155',
        fontSize: 12,
        fontFamily: 'Outfit, Inter, sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(42,46,57,0.2)' : 'rgba(226,232,240,0.6)' },
        horzLines: { color: isDark ? 'rgba(42,46,57,0.2)' : 'rgba(226,232,240,0.6)' },
      },
      rightPriceScale: { borderColor: isDark ? 'rgba(197,203,206,0.2)' : 'rgba(226,232,240,0.6)', visible: true },
      timeScale: {
        borderColor: isDark ? 'rgba(197,203,206,0.2)' : 'rgba(226,232,240,0.6)',
        timeVisible: false, secondsVisible: false, rightOffset: 20,
      },
      crosshair: {
        vertLine: { color: '#818cf8', width: 1, style: LineStyle.Dashed },
        horzLine: { color: '#818cf8', width: 1, style: LineStyle.Dashed },
      },
      width: yieldChartRef.current.clientWidth,
      height: 360,
    });
    chartRef.current = chart;

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#6366f1',
      topColor: 'rgba(99,102,241,0.4)',
      bottomColor: 'rgba(99,102,241,0.0)',
      lineWidth: 3,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` },
      priceLineVisible: false,
      lastValueVisible: true,
    });
    areaSeries.setData(performance.dates.map((d, i) => ({ time: d, value: performance.values[i] })));
    chart.timeScale().fitContent();

    const onResize = () => {
      if (yieldChartRef.current) chart.applyOptions({ width: yieldChartRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); chartRef.current = null; };
  }, [performance, theme]);

  if (loading) {
    return (
      <div className="portfolio-loading-container">
        <div className="loading-spinner" style={{ width: '40px', height: '40px' }} />
        <p>Loading portfolio data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel empty-state" style={{ height: '300px' }}>
        <div className="empty-state-icon">⚠️</div>
        <h4>Failed to Load Portfolio</h4>
        <p>{error}</p>
      </div>
    );
  }

  const dayReturn = 1250.50;
  const dayReturnPct = 1.02;

  return (
    <div className="portfolio-dashboard-wrapper">

      {/* ── Row 1: 4 Summary Cards ──────────────────────────────────── */}
      <div className="summary-grid">
        <div className="glass-panel card card-blue">
          <div className="card-title">Portfolio Value</div>
          <div className="card-value-container">
            <span className="card-value">{summary ? fmt(summary.total_value) : '—'}</span>
            <span className="pnl-badge positive" style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '12px' }}>
              +108.26% YTD
            </span>
          </div>
          <div className="card-desc">Total assets value (Holdings + Cash)</div>
        </div>
        <div className="glass-panel card card-teal">
          <div className="card-title">Today's Return</div>
          <div className="card-value" style={{ color: '#10b981' }}>+{fmt(dayReturn)}</div>
          <div className="card-desc" style={{ color: '#10b981', fontWeight: 'bold' }}>+{dayReturnPct.toFixed(2)}% today</div>
        </div>
        <div className="glass-panel card card-purple">
          <div className="card-title">Unrealized P&L</div>
          <div className="card-value" style={{ color: summary && summary.unrealized_pnl >= 0 ? '#10b981' : '#ef4444' }}>
            {summary && summary.unrealized_pnl >= 0 ? '+' : ''}{summary ? fmt(summary.unrealized_pnl) : '—'}
          </div>
          <div className="card-desc" style={{ color: summary && summary.unrealized_pnl >= 0 ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
            {summary && summary.unrealized_pnl >= 0 ? '+' : ''}{summary ? summary.unrealized_pnl_pct.toFixed(2) : '—'}% total return
          </div>
        </div>
        <div className="glass-panel card card-amber">
          <div className="card-title">Cash Balance</div>
          <div className="card-value">{summary ? fmt(summary.cash_balance) : '—'}</div>
          <div className="card-desc">Liquidity available for stock purchases</div>
        </div>
      </div>

      {/* ── Row 2: Portfolio Yield Curve — full width ────────────────── */}
      <div className="glass-panel portfolio-chart-card">
        <div className="portfolio-chart-header">
          <div>
            <h3 className="card-title" style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Portfolio Yield Curve</h3>
            <p className="card-desc" style={{ margin: '2px 0 0' }}>Cumulative account returns (YTD)</p>
          </div>
          <div className="chart-legend-row">
            <span className="legend-badge-ytd">YTD</span>
            <div className="legend-indicator">
              <span className="legend-dot" />
              <span>Settlement</span>
            </div>
          </div>
        </div>
        <div ref={yieldChartRef} className="portfolio-chart-container" style={{ height: '360px' }} />
      </div>

      {/* ── Row 3+: Per-holding GMMA cards ──────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
        {/* Section label */}
        <div style={{ padding: '4px 0 14px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-text-main)' }}>
            Holdings &amp; Asset Performance
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            GMMA charts embedded per holding — scroll down to review all positions
          </p>
        </div>

        {holdings.length === 0 ? (
          <div className="glass-panel empty-state" style={{ height: '200px' }}>
            <div className="empty-state-icon">📋</div>
            <p>No holdings configured. Add positions in the Portfolio Config sidebar.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {holdings.map(h => (
              <HoldingChartCard key={h.ticker} holding={h} theme={theme} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
