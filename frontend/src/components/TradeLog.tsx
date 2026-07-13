import React, { useEffect, useState, useCallback } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

interface Trade {
  id: string;
  date: string;
  ticker: string;
  name: string;
  type: 'BUY' | 'SELL';
  shares: number;
  price: number;
  total_value: number;
  notes: string;
  realized_pnl: number | null;
}

interface TradeLogProps {
  refreshKey?: number;
  onSwitchToPortfolio?: () => void;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function fmtPnl(n: number) {
  const sign = n >= 0 ? '+' : '';
  return sign + fmtMoney(n);
}

export const TradeLog: React.FC<TradeLogProps> = ({ refreshKey = 0, onSwitchToPortfolio }) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/trades`);
      if (!res.ok) throw new Error('Failed to fetch trades');
      const data = await res.json();
      setTrades(data.trades || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading trade log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades, refreshKey]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this trade entry? Note: portfolio holdings will NOT be automatically reversed.')) return;
    setDeleting(id);
    try {
      const res = await fetch(`${BACKEND_URL}/trades/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete trade');
      setTrades(prev => prev.filter(t => t.id !== id));
    } catch (err: any) {
      alert(err.message || 'Error deleting trade');
    } finally {
      setDeleting(null);
    }
  };

  const filtered = trades.filter(t => {
    const matchType = filter === 'ALL' || t.type === filter;
    const matchSearch = !search || t.ticker.includes(search.toUpperCase()) || t.name?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  // Summary calculations
  const totalBuyValue = trades.filter(t => t.type === 'BUY').reduce((s, t) => s + t.total_value, 0);
  const totalSellValue = trades.filter(t => t.type === 'SELL').reduce((s, t) => s + t.total_value, 0);
  const totalRealizedPnl = trades
    .filter(t => t.type === 'SELL' && t.realized_pnl != null)
    .reduce((s, t) => s + (t.realized_pnl ?? 0), 0);

  return (
    <div className="portfolio-dashboard-wrapper">
      {/* Summary Cards — 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div className="glass-panel portfolio-metric-card">
          <div className="metric-label">Total Trades</div>
          <div className="metric-value" style={{ fontSize: '2rem' }}>{trades.length}</div>
          <div className="metric-sub">{trades.filter(t => t.type === 'BUY').length} buys · {trades.filter(t => t.type === 'SELL').length} sells</div>
        </div>
        <div className="glass-panel portfolio-metric-card" style={{ borderTop: '3px solid #10b981' }}>
          <div className="metric-label">Total Invested</div>
          <div className="metric-value" style={{ fontSize: '1.6rem' }}>{fmtMoney(totalBuyValue)}</div>
          <div className="metric-sub">Cumulative BUY cost</div>
        </div>
        <div className="glass-panel portfolio-metric-card" style={{ borderTop: '3px solid #6366f1' }}>
          <div className="metric-label">Total Proceeds</div>
          <div className="metric-value" style={{ fontSize: '1.6rem' }}>{fmtMoney(totalSellValue)}</div>
          <div className="metric-sub">Cumulative SELL receipts</div>
        </div>
        <div className="glass-panel portfolio-metric-card" style={{ borderTop: totalRealizedPnl >= 0 ? '3px solid #10b981' : '3px solid #ef4444' }}>
          <div className="metric-label">Net Realized P&L</div>
          <div className="metric-value" style={{ fontSize: '1.6rem', color: totalRealizedPnl >= 0 ? '#10b981' : '#ef4444' }}>
            {fmtPnl(totalRealizedPnl)}
          </div>
          <div className="metric-sub">FIFO method across all sells</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: '15px' }}>📒 Trade History</span>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '4px' }}>
          {(['ALL', 'BUY', 'SELL'] as const).map(f => (
            <button
              key={f}
              className={`trade-filter-pill ${filter === f ? 'active' : ''} ${f === 'BUY' ? 'buy' : f === 'SELL' ? 'sell' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'BUY' ? '🟢 BUY' : f === 'SELL' ? '🔴 SELL' : 'All'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search ticker or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="trade-search-input"
        />
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          {filtered.length} of {trades.length} entries
        </span>
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '48px' }}>
            <div className="loading-spinner" />
            <p style={{ color: 'var(--color-text-muted)' }}>Loading trade history…</p>
          </div>
        ) : error ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>⚠️ {error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📋</div>
            <p style={{ fontWeight: 600 }}>{trades.length === 0 ? 'No trades logged yet.' : 'No trades match your filter.'}</p>
            <p style={{ fontSize: '13px', marginTop: '6px' }}>
              {trades.length === 0 ? 'Use the sidebar form to log your first BUY or SELL.' : 'Try adjusting the filter or search.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="trade-log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th>Shares</th>
                  <th>Price</th>
                  <th>Total Value</th>
                  <th>Realized P&L</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className={`trade-row trade-row-${t.type.toLowerCase()}`}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: '13px' }}>{t.date}</td>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{t.ticker}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{t.name}</div>
                    </td>
                    <td>
                      <span className={`trade-type-badge badge-${t.type.toLowerCase()}`}>
                        {t.type === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.shares.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(t.price)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(t.total_value)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {t.realized_pnl != null ? (
                        <span style={{ color: t.realized_pnl >= 0 ? '#10b981' : '#ef4444' }}>
                          {fmtPnl(t.realized_pnl)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td style={{ maxWidth: '180px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {t.notes || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>no notes</span>}
                    </td>
                    <td>
                      <button
                        className="trade-delete-btn"
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        title="Delete this trade entry"
                      >
                        {deleting === t.id ? '…' : '🗑️'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Portfolio link */}
      {onSwitchToPortfolio && (
        <div style={{ textAlign: 'center', paddingBottom: '8px' }}>
          <button
            className="btn-dash-manage"
            onClick={onSwitchToPortfolio}
            style={{ fontSize: '13px' }}
          >
            💼 View Portfolio Monitoring →
          </button>
        </div>
      )}
    </div>
  );
};
