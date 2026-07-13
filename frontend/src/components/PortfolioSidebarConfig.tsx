import React, { useEffect, useState } from 'react';

interface PortfolioSidebarConfigProps {
  refreshDashboard: () => void;
}

interface HoldingFormItem {
  ticker: string;
  name: string;
  qty: number;
  avg_cost: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

export const PortfolioSidebarConfig: React.FC<PortfolioSidebarConfigProps> = ({
  refreshDashboard
}) => {
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [holdings, setHoldings] = useState<HoldingFormItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Form state for adding new position
  const [newTicker, setNewTicker] = useState<string>('');
  const [newQty, setNewQty] = useState<string>('');
  const [newAvgCost, setNewAvgCost] = useState<string>('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${BACKEND_URL}/portfolio/holdings`);
        if (!res.ok) throw new Error('Failed to fetch holdings');
        const data = await res.json();
        setCashBalance(data.summary.cash_balance);
        setHoldings(data.holdings.map((h: any) => ({
          ticker: h.ticker,
          name: h.name,
          qty: h.qty,
          avg_cost: h.avg_cost
        })));
      } catch (err: any) {
        console.error('Failed to load portfolio configurator state:', err);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleUpdateHolding = (index: number, field: 'qty' | 'avg_cost', value: number) => {
    const updated = [...holdings];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setHoldings(updated);
  };

  const handleDeleteHolding = (index: number) => {
    const updated = holdings.filter((_, i) => i !== index);
    setHoldings(updated);
  };

  const handleAddPosition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker.trim()) return;

    const tickerUpper = newTicker.toUpperCase().trim();
    if (holdings.some(h => h.ticker === tickerUpper)) {
      setMessage({ text: `${tickerUpper} already exists in holdings`, type: 'error' });
      return;
    }

    const qty = parseInt(newQty) || 0;
    const avgCost = parseFloat(newAvgCost) || 0;

    const newPosition: HoldingFormItem = {
      ticker: tickerUpper,
      name: tickerUpper, // Backend will enrich name on save
      qty,
      avg_cost: avgCost
    };

    setHoldings([...holdings, newPosition]);
    setNewTicker('');
    setNewQty('');
    setNewAvgCost('');
    setMessage(null);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch(`${BACKEND_URL}/portfolio/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cash_balance: cashBalance,
          holdings: holdings.map(h => ({
            ticker: h.ticker,
            name: h.name,
            qty: h.qty,
            avg_cost: h.avg_cost
          }))
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save portfolio configuration');
      }

      setMessage({ text: 'Portfolio saved successfully!', type: 'success' });
      
      // Trigger dashboard reload
      refreshDashboard();
      
      // Clear message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      console.error(err);
      setMessage({ text: err.message || 'Error saving portfolio', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px', gap: '8px' }}>
        <div className="loading-spinner" style={{ width: '25px', height: '25px' }}></div>
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Loading holdings config...</p>
      </div>
    );
  }

  return (
    <div className="sidebar-params-column" style={{ gap: '14px' }}>
      {/* Save Status Message */}
      {message && (
        <div className={`all-usa-badge`} style={{
          backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          borderColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
          color: message.type === 'success' ? '#10b981' : '#ef4444',
          width: '100%',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          {message.text}
        </div>
      )}

      {/* Cash Balance Section */}
      <div className="sidebar-section">
        <h3 className="section-title">Cash Allocation</h3>
        <div className="form-group">
          <label>Cash Balance ($)</label>
          <input
            type="number"
            value={cashBalance}
            onChange={(e) => setCashBalance(parseFloat(e.target.value) || 0)}
            placeholder="e.g. 15000"
          />
        </div>
      </div>

      {/* Current Positions */}
      <div className="sidebar-section">
        <h3 className="section-title">Current Positions</h3>
        {holdings.length === 0 ? (
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '0' }}>No positions held.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '260px', overflowY: 'auto', paddingRight: '4px' }}>
            {holdings.map((h, index) => (
              <div key={h.ticker} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '10px', borderBottom: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--accent-primary)' }}>{h.ticker}</span>
                  <button 
                    style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer', padding: '0' }}
                    onClick={() => handleDeleteHolding(index)}
                    title="Remove position"
                  >
                    🗑️ Remove
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div className="form-group" style={{ marginBottom: '0' }}>
                    <label style={{ fontSize: '10px' }}>Shares</label>
                    <input
                      type="number"
                      style={{ padding: '4px 6px', fontSize: '12px' }}
                      value={h.qty}
                      onChange={(e) => handleUpdateHolding(index, 'qty', parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: '0' }}>
                    <label style={{ fontSize: '10px' }}>Avg Cost ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      style={{ padding: '4px 6px', fontSize: '12px' }}
                      value={h.avg_cost}
                      onChange={(e) => handleUpdateHolding(index, 'avg_cost', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Position Form */}
      <div className="sidebar-section">
        <h3 className="section-title">Add Position</h3>
        <form onSubmit={handleAddPosition} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="form-group" style={{ marginBottom: '0' }}>
            <label style={{ fontSize: '10px' }}>Symbol</label>
            <input
              type="text"
              style={{ padding: '4px 6px', fontSize: '12px' }}
              placeholder="e.g. NVDA"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label style={{ fontSize: '10px' }}>Shares</label>
              <input
                type="number"
                style={{ padding: '4px 6px', fontSize: '12px' }}
                placeholder="Qty"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label style={{ fontSize: '10px' }}>Avg Cost ($)</label>
              <input
                type="number"
                step="0.01"
                style={{ padding: '4px 6px', fontSize: '12px' }}
                placeholder="Cost"
                value={newAvgCost}
                onChange={(e) => setNewAvgCost(e.target.value)}
                required
              />
            </div>
          </div>
          <button 
            type="submit" 
            className="btn-dash-manage" 
            style={{ width: '100%', marginTop: '6px', padding: '6px' }}
          >
            ➕ Add Position
          </button>
        </form>
      </div>

      {/* Save Button */}
      <button
        className="btn btn-scan sidebar-scan-btn"
        style={{ width: '100%', padding: '10px', marginTop: '4px' }}
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving...' : '💾 Save Portfolio Settings'}
      </button>
    </div>
  );
};
