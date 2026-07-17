import React, { useState, useCallback } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FilterParams {
  min_price: number;
  require_above_sma200: boolean;
  min_volume_ratio: number;   // today vol / 50d avg vol
  min_separation_pct: number;
  max_separation_pct: number;
  require_crossover: boolean;
  max_crossover_days: number;
  max_ema3_to_ema60_ratio: number; // investor group compression (lower = tighter formation)
  top_n: number;
}

interface Candidate {
  ticker: string;
  name: string;
  close: number;
  separation_pct: number;
  volume_ratio: number;
  sma200_distance_pct: number;
  crossover_days_ago: number | null;
  ema3_to_ema60_ratio: number;
  bet_score: number;
  entry_zone_low: number;
  entry_zone_high: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  risk_reward: number;
  position_size_pct: number;
  conviction: 'VERY HIGH' | 'HIGH' | 'MODERATE';
}

interface ProposalResponse {
  candidates: Candidate[];
  ai_proposal: string;
  filter_params: FilterParams;
  generated_at: string;
  mode: 'ai' | 'rule_based';
}

// ─── Default Filters ──────────────────────────────────────────────────────────

const DEFAULT_FILTERS: FilterParams = {
  min_price: 5,
  require_above_sma200: true,
  min_volume_ratio: 0.8,
  min_separation_pct: 0.5,
  max_separation_pct: 30.0,
  require_crossover: false,
  max_crossover_days: 10,
  max_ema3_to_ema60_ratio: 20.0,
  top_n: 5,
};

// ─── Conviction colour ────────────────────────────────────────────────────────

function convictionColor(c: string) {
  if (c === 'VERY HIGH') return '#10b981';
  if (c === 'HIGH') return '#6366f1';
  return '#eab308';
}

// ─── Simple Markdown Renderer ─────────────────────────────────────────────────

function MarkdownBlock({ text }: { text: string }) {
  const html = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#a855f7;margin:12px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:1px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#6366f1;margin:16px 0 6px;font-size:15px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="color:#f3f4f6;margin:0 0 12px;font-size:18px">$1</h2>')
    .replace(/^[-•] (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, m => `<ul style="padding-left:18px;margin:6px 0">${m}</ul>`)
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ lineHeight: 1.7, fontSize: '13.5px', color: 'var(--color-text-main)' }} />;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AIStrategyProposalProps {
  theme?: 'dark' | 'light';
}

export const AIStrategyProposal: React.FC<AIStrategyProposalProps> = () => {
  const [filters, setFilters] = useState<FilterParams>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  const runProposal = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProposal(null);
    setSelectedCandidate(null);
    try {
      const res = await fetch(`${BACKEND_URL}/ai/strategy/gmma-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error ${res.status}`);
      }
      const data: ProposalResponse = await res.json();
      setProposal(data);
      if (data.candidates.length > 0) setSelectedCandidate(data.candidates[0]);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const setFilter = (k: keyof FilterParams, v: any) =>
    setFilters(prev => ({ ...prev, [k]: v }));

  const copyProposal = () => {
    if (proposal?.ai_proposal) navigator.clipboard.writeText(proposal.ai_proposal);
  };

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '80vh' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0, boxShadow: '0 4px 16px rgba(99,102,241,0.4)'
        }}>🧠</div>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, background: 'linear-gradient(90deg,#6366f1,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AI GMMA Strategy Proposal
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
            Tightened GMMA criteria · AI-guided Entry, Stop Loss &amp; Target zones
          </p>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, flex: 1 }}>

        {/* ── Left: Filters ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="glass-panel" style={{ padding: 16, borderRadius: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 14 }}>
              🎯 Tightening Criteria
            </div>

            <FilterRow label="Min. Price ($)">
              <input type="number" value={filters.min_price} min={1}
                onChange={e => setFilter('min_price', +e.target.value)}
                style={inputStyle} />
            </FilterRow>

            <FilterRow label="Require Above SMA200">
              <ToggleSwitch
                value={filters.require_above_sma200}
                onChange={v => setFilter('require_above_sma200', v)}
              />
            </FilterRow>

            <FilterRow label="Min Volume Ratio" hint="today/50d avg">
              <input type="number" value={filters.min_volume_ratio} min={0.5} step={0.1}
                onChange={e => setFilter('min_volume_ratio', +e.target.value)}
                style={inputStyle} />
            </FilterRow>

            <div style={{ margin: '10px 0 6px', fontSize: 11, color: 'var(--color-text-dark)', letterSpacing: '0.5px' }}>GROUP SEPARATION %</div>

            <FilterRow label="Min Sep. (%)">
              <input type="number" value={filters.min_separation_pct} min={0} step={0.5}
                onChange={e => setFilter('min_separation_pct', +e.target.value)}
                style={inputStyle} />
            </FilterRow>

            <FilterRow label="Max Sep. (%)">
              <input type="number" value={filters.max_separation_pct} min={0} step={1}
                onChange={e => setFilter('max_separation_pct', +e.target.value)}
                style={inputStyle} />
            </FilterRow>

            <div style={{ margin: '10px 0 6px', fontSize: 11, color: 'var(--color-text-dark)', letterSpacing: '0.5px' }}>CROSSOVER FILTER</div>

            <FilterRow label="Require Recent Crossover">
              <ToggleSwitch
                value={filters.require_crossover}
                onChange={v => setFilter('require_crossover', v)}
              />
            </FilterRow>

            {filters.require_crossover && (
              <FilterRow label="Within (days)">
                <input type="number" value={filters.max_crossover_days} min={1} max={30}
                  onChange={e => setFilter('max_crossover_days', +e.target.value)}
                  style={inputStyle} />
              </FilterRow>
            )}

            <div style={{ margin: '10px 0 6px', fontSize: 11, color: 'var(--color-text-dark)', letterSpacing: '0.5px' }}>FORMATION TIGHTNESS</div>

            <FilterRow label="Max EMA3/EMA60 Ratio (%)" hint="smaller = tighter">
              <input type="number" value={filters.max_ema3_to_ema60_ratio} min={1} step={0.5}
                onChange={e => setFilter('max_ema3_to_ema60_ratio', +e.target.value)}
                style={inputStyle} />
            </FilterRow>

            <FilterRow label="Top Candidates">
              <input type="number" value={filters.top_n} min={1} max={10}
                onChange={e => setFilter('top_n', +e.target.value)}
                style={{ ...inputStyle, width: 55 }} />
            </FilterRow>

            <button
              onClick={runProposal}
              disabled={loading}
              style={{
                marginTop: 16, width: '100%', padding: '12px', borderRadius: 10,
                background: loading ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #a855f7)',
                border: 'none', color: '#fff', fontWeight: 700, fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.35)',
                transition: 'all 0.25s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}
            >
              {loading
                ? <><span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Analyzing...</>
                : '🚀 Generate Best Bets'}
            </button>
          </div>

          {/* Legend */}
          <div className="glass-panel" style={{ padding: 14, borderRadius: 14, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 6 }}>📘 How It Works</div>
            <div>The <strong>Bet Score</strong> (0–100) combines:</div>
            <ul style={{ paddingLeft: 14, margin: '4px 0' }}>
              <li>SMA200 trend alignment</li>
              <li>Volume expansion ratio</li>
              <li>GMMA group separation</li>
              <li>Formation tightness</li>
              <li>Recent crossover freshness</li>
            </ul>
            <div style={{ marginTop: 6 }}>Stop Loss is set at <strong>1 ATR below</strong> the investor group top (EMA30). Target 1 = 1:2 R/R, Target 2 = 1:3.5 R/R.</div>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Error */}
          {error && (
            <div style={{ padding: 14, borderRadius: 12, background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 13 }}>
              ❌ {error}
            </div>
          )}

          {/* Loading Skeleton */}
          {loading && !proposal && (
            <div className="glass-panel" style={{ padding: 24, borderRadius: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 8 }}>Running multi-layer GMMA analysis...</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-dark)' }}>Computing Bet Scores · Checking SMA200 · Analysing Volume · Calling AI...</div>
            </div>
          )}

          {/* Empty State */}
          {!loading && !proposal && !error && (
            <div className="glass-panel" style={{ padding: 40, borderRadius: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ready to Find Your Best Bets</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Configure the tightening criteria on the left, then click <strong>Generate Best Bets</strong> to run the AI-powered GMMA analysis.</div>
            </div>
          )}

          {proposal && (
            <>
              {/* Mode Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: proposal.mode === 'ai' ? 'rgba(16,185,129,0.15)' : 'rgba(234,179,8,0.15)',
                  color: proposal.mode === 'ai' ? '#10b981' : '#eab308',
                  border: `1px solid ${proposal.mode === 'ai' ? 'rgba(16,185,129,0.3)' : 'rgba(234,179,8,0.3)'}`
                }}>
                  {proposal.mode === 'ai' ? '✨ AI-Powered' : '📋 Rule-Based Fallback'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-dark)' }}>
                  {proposal.candidates.length} candidate(s) found · {new Date(proposal.generated_at).toLocaleTimeString()}
                </span>
              </div>

              {/* Candidates Grid */}
              {proposal.candidates.length === 0 ? (
                <div className="glass-panel" style={{ padding: 24, borderRadius: 14, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                  No candidates passed all filters. Try relaxing the criteria.
                </div>
              ) : (
                <div className="glass-panel" style={{ borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>🏆 Top Candidates by Bet Score</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                          {['Rank','Symbol','Price','Bet Score','Conviction','Sep%','Vol×','SMA200 Dist%','Crossover','Entry Zone','Stop','T1','T2','R/R'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--color-text-dark)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--glass-border)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {proposal.candidates.map((c, i) => {
                          const isSelected = selectedCandidate?.ticker === c.ticker;
                          return (
                            <tr
                              key={c.ticker}
                              onClick={() => setSelectedCandidate(c)}
                              style={{
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                                borderLeft: isSelected ? '3px solid #6366f1' : '3px solid transparent',
                                transition: 'background 0.15s'
                              }}
                            >
                              <td style={{ padding: '9px 10px', color: 'var(--color-text-muted)', fontWeight: 700 }}>#{i + 1}</td>
                              <td style={{ padding: '9px 10px' }}>
                                <div style={{ fontWeight: 700, fontSize: 13 }}>{c.ticker}</div>
                                <div style={{ fontSize: 10.5, color: 'var(--color-text-dark)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                              </td>
                              <td style={{ padding: '9px 10px', fontWeight: 600 }}>${c.close.toFixed(2)}</td>
                              <td style={{ padding: '9px 10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 46, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                    <div style={{ width: `${c.bet_score}%`, height: '100%', borderRadius: 3, background: c.bet_score >= 75 ? '#10b981' : c.bet_score >= 55 ? '#6366f1' : '#eab308' }} />
                                  </div>
                                  <span style={{ fontWeight: 700, color: c.bet_score >= 75 ? '#10b981' : c.bet_score >= 55 ? '#6366f1' : '#eab308' }}>{c.bet_score}</span>
                                </div>
                              </td>
                              <td style={{ padding: '9px 10px' }}>
                                <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, background: `${convictionColor(c.conviction)}20`, color: convictionColor(c.conviction) }}>
                                  {c.conviction}
                                </span>
                              </td>
                              <td style={{ padding: '9px 10px', color: '#10b981' }}>{c.separation_pct.toFixed(1)}%</td>
                              <td style={{ padding: '9px 10px' }}>{c.volume_ratio.toFixed(2)}×</td>
                              <td style={{ padding: '9px 10px', color: c.sma200_distance_pct > 0 ? '#10b981' : '#f43f5e' }}>
                                {c.sma200_distance_pct > 0 ? '+' : ''}{c.sma200_distance_pct.toFixed(1)}%
                              </td>
                              <td style={{ padding: '9px 10px', color: 'var(--color-text-muted)', fontSize: 11 }}>
                                {c.crossover_days_ago !== null ? `${c.crossover_days_ago}d ago` : '—'}
                              </td>
                              <td style={{ padding: '9px 10px', color: '#6366f1', fontWeight: 600, fontSize: 11 }}>
                                ${c.entry_zone_low.toFixed(2)}–${c.entry_zone_high.toFixed(2)}
                              </td>
                              <td style={{ padding: '9px 10px', color: '#f43f5e', fontWeight: 600 }}>${c.stop_loss.toFixed(2)}</td>
                              <td style={{ padding: '9px 10px', color: '#10b981' }}>${c.target_1.toFixed(2)}</td>
                              <td style={{ padding: '9px 10px', color: '#a855f7' }}>${c.target_2.toFixed(2)}</td>
                              <td style={{ padding: '9px 10px', fontWeight: 700, color: c.risk_reward >= 2.5 ? '#10b981' : '#eab308' }}>{c.risk_reward.toFixed(1)}:1</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Selected Candidate – Guided Trade Plan */}
              {selectedCandidate && (
                <div className="glass-panel" style={{ borderRadius: 14, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.08))', borderBottom: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 800, fontSize: 16 }}>{selectedCandidate.ticker}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selectedCandidate.name}</span>
                      <span style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${convictionColor(selectedCandidate.conviction)}20`, color: convictionColor(selectedCandidate.conviction) }}>
                        {selectedCandidate.conviction} CONVICTION
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
                    <TradePlanBox label="📍 Entry Zone" color="#6366f1" sublabel="Ideal buy range">
                      ${selectedCandidate.entry_zone_low.toFixed(2)} – ${selectedCandidate.entry_zone_high.toFixed(2)}
                    </TradePlanBox>
                    <TradePlanBox label="🛑 Stop Loss" color="#f43f5e" sublabel={`1 ATR buffer · ~${(((selectedCandidate.entry_zone_low - selectedCandidate.stop_loss) / selectedCandidate.entry_zone_low) * 100).toFixed(1)}% risk`}>
                      ${selectedCandidate.stop_loss.toFixed(2)}
                    </TradePlanBox>
                    <TradePlanBox label="📐 Position Size" color="#10b981" sublabel="% of capital (1–2% risk rule)">
                      {selectedCandidate.position_size_pct.toFixed(1)}% of portfolio
                    </TradePlanBox>
                    <TradePlanBox label="🎯 Target 1 (1:2 R/R)" color="#10b981" sublabel="First profit zone – take 50%">
                      ${selectedCandidate.target_1.toFixed(2)}
                    </TradePlanBox>
                    <TradePlanBox label="🚀 Target 2 (1:3.5 R/R)" color="#a855f7" sublabel="Second profit zone – let ride 50%">
                      ${selectedCandidate.target_2.toFixed(2)}
                    </TradePlanBox>
                    <TradePlanBox label="⚖️ Risk/Reward" color={selectedCandidate.risk_reward >= 2.5 ? '#10b981' : '#eab308'} sublabel="Based on T1">
                      {selectedCandidate.risk_reward.toFixed(2)}:1
                    </TradePlanBox>
                  </div>
                  <div style={{ padding: '10px 16px', background: 'rgba(16,185,129,0.05)', borderTop: '1px solid var(--glass-border)', fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                    <strong style={{ color: 'var(--color-text-main)' }}>📋 Trade Rules:</strong>{' '}
                    Enter in the Entry Zone only when price action is constructive (tight candles, low volume consolidation near entry).
                    Place hard stop at <strong style={{ color: '#f43f5e' }}>${selectedCandidate.stop_loss.toFixed(2)}</strong> immediately.
                    At Target 1, sell 50% and move stop to breakeven.
                    Let the remaining 50% ride to Target 2 or trail the EMA15.
                  </div>
                </div>
              )}

              {/* AI Proposal Text */}
              {proposal.ai_proposal && (
                <div className="glass-panel" style={{ borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--glass-border)' }}>
                    <span style={{ fontSize: 15 }}>{proposal.mode === 'ai' ? '✨' : '📋'}</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      {proposal.mode === 'ai' ? 'AI Strategic Recommendation' : 'Rule-Based Strategic Report'}
                    </span>
                    <button
                      onClick={copyProposal}
                      title="Copy to clipboard"
                      style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)', fontSize: 11, cursor: 'pointer' }}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <div style={{ padding: '16px 20px', maxHeight: 480, overflowY: 'auto' }}>
                    <MarkdownBlock text={proposal.ai_proposal} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: 80, padding: '5px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)',
  color: 'var(--color-text-main)', outline: 'none',
};

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-main)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--color-text-dark)' }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: value ? 'linear-gradient(135deg, #6366f1, #a855f7)' : 'var(--bg-tertiary)',
        position: 'relative', transition: 'background 0.25s',
        boxShadow: value ? '0 2px 8px rgba(99,102,241,0.4)' : 'none',
        flexShrink: 0
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 23 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left 0.25s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
      }} />
    </button>
  );
}

function TradePlanBox({ label, color, sublabel, children }: { label: string; color: string; sublabel?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderRight: '1px solid var(--glass-border)', borderBottom: '1px solid var(--glass-border)' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color, letterSpacing: '-0.3px' }}>{children}</div>
      {sublabel && <div style={{ fontSize: 10.5, color: 'var(--color-text-dark)', marginTop: 2 }}>{sublabel}</div>}
    </div>
  );
}

export default AIStrategyProposal;
