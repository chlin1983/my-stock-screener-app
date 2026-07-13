import React, { useState } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

interface TradeLogSidebarProps {
  onTradeSaved: () => void;
  onHide: () => void;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export const TradeLogSidebar: React.FC<TradeLogSidebarProps> = ({ onTradeSaved, onHide }) => {
  const [date, setDate] = useState(todayStr());
  const [ticker, setTicker] = useState('');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchLivePrice = async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setFetchingPrice(true);
    try {
      // Use portfolio/holdings as a proxy — or just show hint
      const res = await fetch(`${BACKEND_URL}/stock/${sym}/history?period=1d`);
      if (res.ok) {
        const data = await res.json();
        const candles = data.candles || data;
        if (Array.isArray(candles) && candles.length > 0) {
          const last = candles[candles.length - 1];
          setPrice(String(last.close ?? last.value ?? ''));
        }
      }
    } catch {
      // Silently ignore — user can type manually
    } finally {
      setFetchingPrice(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !shares || !price) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`${BACKEND_URL}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          ticker: ticker.toUpperCase().trim(),
          trade_type: tradeType,
          shares: parseInt(shares),
          price: parseFloat(price),
          notes: notes.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to log trade');
      }

      const data = await res.json();
      setMessage({
        text: `✅ ${tradeType} logged! ${data.trade?.realized_pnl != null
          ? `Realized P&L: ${data.trade.realized_pnl >= 0 ? '+' : ''}$${data.trade.realized_pnl.toFixed(2)}`
          : ''}`,
        type: 'success'
      });

      // Reset form
      setTicker('');
      setShares('');
      setPrice('');
      setNotes('');
      setDate(todayStr());
      setTradeType('BUY');

      onTradeSaved();

      setTimeout(() => setMessage(null), 4000);
    } catch (err: any) {
      setMessage({ text: err.message || 'Error saving trade', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="sidebar-top-header">
        <h2 className="sidebar-title">Log Trade</h2>
        <button className="sidebar-hide-btn" onClick={onHide} title="Hide Panel">
          ◀ Hide
        </button>
      </div>

      <div className="sidebar-content-scrollable" style={{ padding: '15px 0' }}>
        <div className="sidebar-params-column" style={{ gap: '14px' }}>

          {/* Message */}
          {message && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              lineHeight: '1.5',
              backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${message.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: message.type === 'success' ? '#10b981' : '#ef4444',
            }}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* Trade Type Toggle */}
            <div className="sidebar-section" style={{ padding: '12px 16px' }}>
              <h3 className="section-title">Trade Type</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setTradeType('BUY')}
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    border: `2px solid ${tradeType === 'BUY' ? '#10b981' : 'var(--glass-border)'}`,
                    backgroundColor: tradeType === 'BUY' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    color: tradeType === 'BUY' ? '#10b981' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  🟢 BUY
                </button>
                <button
                  type="button"
                  onClick={() => setTradeType('SELL')}
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    border: `2px solid ${tradeType === 'SELL' ? '#ef4444' : 'var(--glass-border)'}`,
                    backgroundColor: tradeType === 'SELL' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    color: tradeType === 'SELL' ? '#ef4444' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  🔴 SELL
                </button>
              </div>
            </div>

            {/* Trade Date */}
            <div className="sidebar-section" style={{ padding: '12px 16px' }}>
              <h3 className="section-title">Trade Details</h3>
              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                />
              </div>

              {/* Ticker */}
              <div className="form-group">
                <label>Symbol</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="e.g. AMD"
                    value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    style={{ flex: 1 }}
                    required
                  />
                  <button
                    type="button"
                    title="Fetch live price for this ticker"
                    onClick={fetchLivePrice}
                    disabled={fetchingPrice || !ticker.trim()}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--glass-border)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: 'var(--color-text-muted)'
                    }}
                  >
                    {fetchingPrice ? '…' : '💲'}
                  </button>
                </div>
                <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
                  Press 💲 to auto-fill latest price
                </p>
              </div>

              {/* Shares */}
              <div className="form-group">
                <label>Shares</label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 50"
                  value={shares}
                  onChange={e => setShares(e.target.value)}
                  required
                />
              </div>

              {/* Price */}
              <div className="form-group">
                <label>Price Per Share ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 464.00"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  required
                />
              </div>

              {/* Notes */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Notes (optional)</label>
                <textarea
                  placeholder="e.g. VCP breakout, stop loss triggered…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--glass-border)',
                    background: 'var(--glass-bg)',
                    color: 'var(--color-text-main)',
                    fontSize: '13px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Preview */}
            {ticker && shares && price && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: tradeType === 'BUY' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${tradeType === 'BUY' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                fontSize: '12px'
              }}>
                <div style={{ fontWeight: 700, marginBottom: '4px', color: tradeType === 'BUY' ? '#10b981' : '#ef4444' }}>
                  {tradeType} Preview
                </div>
                <div style={{ color: 'var(--color-text-muted)' }}>
                  {shares} shares × ${parseFloat(price || '0').toFixed(2)} ={' '}
                  <strong style={{ color: 'var(--color-text-main)' }}>
                    ${(parseFloat(shares || '0') * parseFloat(price || '0')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
                {tradeType === 'BUY' && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    ↳ Portfolio will be updated automatically
                  </div>
                )}
                {tradeType === 'SELL' && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    ↳ FIFO P&L will be calculated on save
                  </div>
                )}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={saving}
              className="btn btn-scan sidebar-scan-btn"
              style={{
                background: tradeType === 'BUY'
                  ? 'linear-gradient(135deg, #059669, #10b981)'
                  : 'linear-gradient(135deg, #b91c1c, #ef4444)',
                border: 'none',
                width: '100%',
                padding: '12px'
              }}
            >
              {saving ? 'Saving…' : `📝 Log ${tradeType}`}
            </button>

          </form>
        </div>
      </div>
    </>
  );
};
