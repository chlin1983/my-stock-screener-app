import React, { useEffect, useState, useRef } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

// Vibrant, distinct color palette matching the reference image style
const PALETTE = [
  '#5C6BC0', // Indigo blue
  '#26A69A', // Teal green
  '#F57C00', // Orange
  '#00ACC1', // Cyan
  '#E53935', // Red
  '#8E24AA', // Purple
  '#43A047', // Green
  '#FB8C00', // Amber
  '#1E88E5', // Blue
  '#F4511E', // Deep orange
  '#00897B', // Dark teal
  '#7B1FA2', // Dark purple
];

interface Holding {
  ticker: string;
  name: string;
  market_value: number;
  gain_loss_pct: number;
  current_price: number;
  qty: number;
}

interface TreeNode {
  ticker: string;
  name: string;
  area: number;      // normalized to container px²
  pct: number;
  market_value: number;
  gain_loss_pct: number;
  color: string;
}

interface LayoutNode extends TreeNode {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ── Squarified treemap algorithm (Bruls, Huizing, van Wijk) ──────────────────
function worstAspect(row: { area: number }[], rowSum: number, l: number): number {
  if (l <= 0 || rowSum <= 0) return Infinity;
  let worst = 0;
  for (const item of row) {
    if (item.area <= 0) continue;
    const s2 = rowSum * rowSum;
    const l2 = l * l;
    const r = Math.max(s2 / (item.area * l2), (item.area * l2) / s2);
    if (r > worst) worst = r;
  }
  return worst;
}

function squarify(nodes: TreeNode[], x0: number, y0: number, x1: number, y1: number): LayoutNode[] {
  const result: LayoutNode[] = [];
  let remaining = [...nodes];
  let cx0 = x0, cy0 = y0, cx1 = x1, cy1 = y1;

  while (remaining.length > 0) {
    const cw = cx1 - cx0;
    const ch = cy1 - cy0;
    if (cw <= 0 || ch <= 0) break;
    const l = Math.min(cw, ch);

    let row: TreeNode[] = [];
    let rowSum = 0;
    let prevWorst = Infinity;

    for (const item of remaining) {
      const newRow = [...row, item];
      const newSum = rowSum + item.area;
      const newWorst = worstAspect(newRow, newSum, l);
      if (row.length === 0 || newWorst <= prevWorst) {
        row = newRow;
        rowSum = newSum;
        prevWorst = newWorst;
      } else {
        break;
      }
    }

    if (cw >= ch) {
      // Landscape → column strip on the left
      const stripW = rowSum / ch;
      let cy = cy0;
      for (const item of row) {
        const itemH = (item.area / rowSum) * ch;
        result.push({ ...item, x0: cx0, y0: cy, x1: cx0 + stripW, y1: cy + itemH });
        cy += itemH;
      }
      cx0 += stripW;
    } else {
      // Portrait → horizontal strip on top
      const stripH = rowSum / cw;
      let cx = cx0;
      for (const item of row) {
        const itemW = (item.area / rowSum) * cw;
        result.push({ ...item, x0: cx, y0: cy0, x1: cx + itemW, y1: cy0 + stripH });
        cx += itemW;
      }
      cy0 += stripH;
    }

    remaining = remaining.slice(row.length);
  }

  return result;
}
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  node: LayoutNode | null;
}

interface AssetAllocationMapProps {
  refreshKey?: number;
}

export const AssetAllocationMap: React.FC<AssetAllocationMapProps> = ({ refreshKey = 0 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(800);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, node: null });

  const MAP_HEIGHT = 440;
  const GAP = 4; // px gap between tiles

  // Observe container width for responsive SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerW(Math.floor(entry.contentRect.width) || 800);
      }
    });
    obs.observe(containerRef.current);
    setContainerW(containerRef.current.clientWidth || 800);
    return () => obs.disconnect();
  }, []);

  // Fetch holdings data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${BACKEND_URL}/portfolio/holdings`);
        if (!res.ok) throw new Error('Failed to fetch holdings');
        const data = await res.json();
        setHoldings(data.holdings || []);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Error loading holdings');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshKey]);

  // Build treemap data
  const totalValue = holdings.reduce((s, h) => s + h.market_value, 0);
  const sorted = [...holdings].sort((a, b) => b.market_value - a.market_value);

  const treeNodes: TreeNode[] = sorted.map((h, i) => ({
    ticker: h.ticker,
    name: h.name,
    area: totalValue > 0 ? (h.market_value / totalValue) * containerW * MAP_HEIGHT : 0,
    pct: totalValue > 0 ? (h.market_value / totalValue) * 100 : 0,
    market_value: h.market_value,
    gain_loss_pct: h.gain_loss_pct,
    color: PALETTE[i % PALETTE.length],
  }));

  const layout = (treeNodes.length > 0 && containerW > 0)
    ? squarify(treeNodes, 0, 0, containerW, MAP_HEIGHT)
    : [];

  return (
    <div className="portfolio-dashboard-wrapper">

      {/* Title card */}
      <div className="glass-panel" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ fontSize: '2rem' }}>📊</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '18px' }}>Portfolio Asset Allocation Map</div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
            Treemap view of holdings weighted by current market value · Hover for details
          </div>
        </div>
        {!loading && totalValue > 0 && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Equity Value</div>
            <div style={{ fontWeight: 800, fontSize: '20px', color: 'var(--accent-primary)' }}>{fmtMoney(totalValue)}</div>
          </div>
        )}
      </div>

      {/* Treemap SVG */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '80px' }}>
            <div className="loading-spinner" />
            <p style={{ color: 'var(--color-text-muted)' }}>Loading portfolio map…</p>
          </div>
        ) : error ? (
          <div style={{ padding: '64px', textAlign: 'center', color: '#ef4444' }}>⚠️ {error}</div>
        ) : holdings.length === 0 ? (
          <div style={{ padding: '80px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📊</div>
            <p style={{ fontWeight: 600 }}>No holdings to map.</p>
            <p style={{ fontSize: '13px' }}>Add positions via Portfolio Monitoring first.</p>
          </div>
        ) : (
          <div ref={containerRef} style={{ position: 'relative', width: '100%', lineHeight: 0 }}>
            <svg width={containerW} height={MAP_HEIGHT} style={{ display: 'block' }}>
              <defs>
                <linearGradient id="tile-shine" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
                </linearGradient>
              </defs>

              {layout.map(node => {
                const w = node.x1 - node.x0;
                const h = node.y1 - node.y0;
                const pad = GAP / 2;
                const rw = Math.max(0, w - GAP);
                const rh = Math.max(0, h - GAP);
                const rx = node.x0 + pad;
                const ry = node.y0 + pad;

                // Adaptive font sizes
                const area = rw * rh;
                const tickerSize = Math.min(18, Math.max(10, Math.sqrt(area) / 7));
                const pctSize = Math.min(13, Math.max(9, tickerSize - 3));
                const showTicker = rw > 36 && rh > 28;
                const showPct = rw > 55 && rh > 50;
                const showValue = rw > 90 && rh > 75;

                return (
                  <g
                    key={node.ticker}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({ visible: true, x: e.clientX - rect.left, y: e.clientY - rect.top, node });
                    }}
                    onMouseMove={e => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setTooltip(prev => ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }));
                    }}
                    onMouseLeave={() => setTooltip(prev => ({ ...prev, visible: false }))}
                  >
                    {/* Base fill */}
                    <rect x={rx} y={ry} width={rw} height={rh} fill={node.color} rx={5} />
                    {/* Gradient shine overlay */}
                    <rect x={rx} y={ry} width={rw} height={rh} fill="url(#tile-shine)" rx={5} />

                    {/* Ticker label */}
                    {showTicker && (
                      <text
                        x={rx + 10} y={ry + tickerSize + 8}
                        fill="white" fontSize={tickerSize} fontWeight="800"
                        fontFamily="inherit" style={{ userSelect: 'none' }}
                        paintOrder="stroke"
                        stroke="rgba(0,0,0,0.15)" strokeWidth={2}
                      >
                        {node.ticker}
                      </text>
                    )}

                    {/* Percentage label */}
                    {showPct && (
                      <text
                        x={rx + 10} y={ry + tickerSize + 8 + pctSize + 5}
                        fill="rgba(255,255,255,0.85)" fontSize={pctSize} fontWeight="600"
                        fontFamily="inherit" style={{ userSelect: 'none' }}
                      >
                        {node.pct.toFixed(1)}%
                      </text>
                    )}

                    {/* Market value label */}
                    {showValue && (
                      <text
                        x={rx + 10} y={ry + tickerSize + 8 + pctSize + 5 + pctSize + 4}
                        fill="rgba(255,255,255,0.65)" fontSize={pctSize - 1} fontWeight="500"
                        fontFamily="inherit" style={{ userSelect: 'none' }}
                      >
                        {fmtMoney(node.market_value)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Hover tooltip */}
            {tooltip.visible && tooltip.node && (() => {
              const n = tooltip.node;
              const ttW = 175;
              const left = Math.min(tooltip.x + 14, containerW - ttW - 8);
              const top = Math.max(tooltip.y - 95, 8);
              return (
                <div style={{
                  position: 'absolute', left, top,
                  pointerEvents: 'none', zIndex: 20,
                  background: 'rgba(10, 10, 20, 0.94)',
                  border: `2px solid ${n.color}`,
                  borderRadius: '10px', padding: '11px 15px',
                  width: `${ttW}px`,
                  backdropFilter: 'blur(10px)',
                  boxShadow: `0 8px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)`,
                }}>
                  <div style={{ fontWeight: 800, fontSize: '16px', color: n.color }}>{n.ticker}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {n.name}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Market Value</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'white' }}>{fmtMoney(n.market_value)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Allocation</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: n.color }}>{n.pct.toFixed(2)}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Return</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: n.gain_loss_pct >= 0 ? '#10b981' : '#ef4444' }}>
                        {n.gain_loss_pct >= 0 ? '+' : ''}{n.gain_loss_pct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Allocation legend */}
      {!loading && !error && layout.length > 0 && (
        <div className="glass-panel" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            Allocation Breakdown
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            {layout.map(node => (
              <div key={node.ticker} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '4px', backgroundColor: node.color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>{node.ticker}</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    {node.pct.toFixed(1)}% · {fmtMoney(node.market_value)}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 600, color: node.gain_loss_pct >= 0 ? '#10b981' : '#ef4444' }}>
                  {node.gain_loss_pct >= 0 ? '+' : ''}{node.gain_loss_pct.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
