import React, { useState, useRef, useEffect } from 'react';

export interface Watchlist {
  id: string;
  name: string;
  emoji: string;
  tickers: string[];
}

interface WatchlistManagerProps {
  watchlists: Watchlist[];
  activeId: string;
  onWatchlistsChange: (watchlists: Watchlist[]) => void;
  onActiveIdChange: (id: string) => void;
}

export const WatchlistManager: React.FC<WatchlistManagerProps> = ({
  watchlists,
  activeId,
  onWatchlistsChange,
  onActiveIdChange,
}) => {
  // ── Category editing state ──────────────────────────────────────────
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editingName,  setEditingName]  = useState('');
  const [editingEmoji, setEditingEmoji] = useState('');
  const [showNewForm,  setShowNewForm]  = useState(false);
  const [newName,      setNewName]      = useState('');
  const [newEmoji,     setNewEmoji]     = useState('📋');

  // ── Ticker addition state ───────────────────────────────────────────
  const [addTickerInput, setAddTickerInput] = useState('');
  const [tickerError,    setTickerError]    = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const activeWatchlist = watchlists.find(w => w.id === activeId) ?? watchlists[0];

  // Auto focus input when active watchlist changes
  useEffect(() => {
    setAddTickerInput('');
    setTickerError('');
    addInputRef.current?.focus();
  }, [activeId]);

  // ── Category actions ────────────────────────────────────────────────
  const handleSelectWatchlist = (id: string) => {
    onActiveIdChange(id);
    setEditingId(null);
  };

  const handleCreateWatchlist = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = `wl_${Date.now()}`;
    const newWl: Watchlist = { id, name: trimmed, emoji: newEmoji || '📋', tickers: [] };
    const updated = [...watchlists, newWl];
    onWatchlistsChange(updated);
    onActiveIdChange(id);
    setNewName('');
    setNewEmoji('📋');
    setShowNewForm(false);
  };

  const handleDeleteWatchlist = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (watchlists.length <= 1) return;
    const updated = watchlists.filter(w => w.id !== id);
    onWatchlistsChange(updated);
    if (activeId === id) onActiveIdChange(updated[0].id);
  };

  const handleStartRename = (wl: Watchlist, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(wl.id);
    setEditingName(wl.name);
    setEditingEmoji(wl.emoji);
  };

  const handleSaveRename = () => {
    if (!editingName.trim()) { setEditingId(null); return; }
    const updated = watchlists.map(w => w.id === editingId
      ? { ...w, name: editingName.trim(), emoji: editingEmoji || '📋' }
      : w
    );
    onWatchlistsChange(updated);
    setEditingId(null);
  };

  // ── Ticker actions ─────────────────────────────────────────────────
  const handleAddTicker = () => {
    const ticker = addTickerInput.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    if (!ticker || !activeWatchlist) return;

    if (activeWatchlist.tickers.includes(ticker)) {
      setTickerError(`${ticker} is already in this list`);
      return;
    }

    const updated = watchlists.map(w => w.id === activeId 
      ? { ...w, tickers: [...w.tickers, ticker] } 
      : w
    );
    onWatchlistsChange(updated);
    setAddTickerInput('');
    setTickerError('');
    addInputRef.current?.focus();
  };

  const handleRemoveTicker = (ticker: string) => {
    const updated = watchlists.map(w => w.id === activeId 
      ? { ...w, tickers: w.tickers.filter(t => t !== ticker) } 
      : w
    );
    onWatchlistsChange(updated);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="wl-sidebar-view">
      {/* Categories section */}
      <div className="wl-sidebar-categories">
        <h4 className="wl-pane-title">Watchlists</h4>
        <div className="watchlist-list">
          {watchlists.map(wl => (
            <div
              key={wl.id}
              className={`watchlist-row ${activeId === wl.id ? 'active' : ''}`}
              onClick={() => handleSelectWatchlist(wl.id)}
            >
              {editingId === wl.id ? (
                <div className="wl-edit-form" onClick={e => e.stopPropagation()}>
                  <input
                    className="wl-emoji-input"
                    value={editingEmoji}
                    onChange={e => setEditingEmoji(e.target.value)}
                    maxLength={2}
                  />
                  <input
                    className="wl-name-input"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                  />
                  <button className="wl-action-btn wl-save-btn"   onClick={handleSaveRename}        title="Save">✓</button>
                  <button className="wl-action-btn wl-cancel-btn" onClick={() => setEditingId(null)} title="Cancel">✕</button>
                </div>
              ) : (
                <>
                  <span className="wl-emoji">{wl.emoji}</span>
                  <span className="wl-name">{wl.name}</span>
                  <span className="wl-count">{wl.tickers.length}</span>
                  <div className="wl-row-actions">
                    <button className="wl-action-btn wl-edit-btn"   onClick={e => handleStartRename(wl, e)}         title="Rename">✏️</button>
                    <button className="wl-action-btn wl-delete-btn" onClick={e => handleDeleteWatchlist(wl.id, e)}  title="Delete" disabled={watchlists.length <= 1}>🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))}

          {showNewForm ? (
            <div className="wl-new-form">
              <input className="wl-emoji-input" value={newEmoji} onChange={e => setNewEmoji(e.target.value)} maxLength={2} placeholder="📋" />
              <input
                className="wl-name-input"
                placeholder="Category name..."
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateWatchlist(); if (e.key === 'Escape') setShowNewForm(false); }}
                autoFocus
              />
              <button className="wl-action-btn wl-save-btn"   onClick={handleCreateWatchlist}         title="Create">✓</button>
              <button className="wl-action-btn wl-cancel-btn" onClick={() => setShowNewForm(false)}   title="Cancel">✕</button>
            </div>
          ) : (
            <button className="wl-new-category-btn" onClick={() => setShowNewForm(true)}>
              + New Category
            </button>
          )}
        </div>
      </div>

      {/* Tickers section directly below */}
      {activeWatchlist && (
        <div className="wl-sidebar-tickers">
          <div className="wl-detail-header-full">
            <span className="wl-detail-emoji-full">{activeWatchlist.emoji}</span>
            <div>
              <h4 className="wl-detail-name-full">{activeWatchlist.name} Stocks</h4>
              <p className="wl-detail-subtitle-full">{activeWatchlist.tickers.length} configured</p>
            </div>
          </div>

          <div className="wl-tickers-grid-full">
            {activeWatchlist.tickers.length === 0 ? (
              <div className="ticker-chips-empty-full">
                No stocks. Type symbol below.
              </div>
            ) : (
              <div className="ticker-chips-container-full">
                {activeWatchlist.tickers.map(ticker => (
                  <span key={ticker} className="ticker-chip-full">
                    {ticker}
                    <button className="chip-remove-btn-full" onClick={() => handleRemoveTicker(ticker)} title={`Remove ${ticker}`}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="wl-add-row-full">
            <input
              ref={addInputRef}
              className="ticker-add-input-full"
              placeholder="e.g. AAPL"
              value={addTickerInput}
              onChange={e => { setAddTickerInput(e.target.value.toUpperCase()); setTickerError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAddTicker()}
            />
            <button className="ticker-add-btn-full" onClick={handleAddTicker}>Add</button>
          </div>
          {tickerError && <div className="ticker-error-full">{tickerError}</div>}
        </div>
      )}
    </div>
  );
};
