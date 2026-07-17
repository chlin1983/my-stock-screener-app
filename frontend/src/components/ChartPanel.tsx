import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartPanelProps {
  ticker: string;
  candles: Candle[];
  highlightDate?: string; // Optional date to highlight (e.g. trigger date)
  vcpContractions?: Array<{ peak_idx: number; trough_idx: number; depth_pct: number }>;
  gmmaData?: {
    showByDefault?: boolean;
    crossoverDaysAgo?: number | null;
    isBullishAligned?: boolean;
  };
  theme?: 'light' | 'dark';
}

// GMMA short-term palette: 6 blue shades (traders)
const GMMA_SHORT_COLORS = [
  '#0000FF', // EMA 3  — pure blue
  '#1a1aff', // EMA 5
  '#3333ff', // EMA 8
  '#4d4dff', // EMA 10
  '#6666ff', // EMA 12
  '#8080ff', // EMA 15 — lightest blue
];

// GMMA long-term palette: 6 red shades (investors)
const GMMA_LONG_COLORS = [
  '#FF0000', // EMA 30  — pure red
  '#ff1a1a', // EMA 35
  '#ff3333', // EMA 40
  '#ff4d4d', // EMA 45
  '#ff6666', // EMA 50
  '#ff8080', // EMA 60 — lightest red
];

const GMMA_SHORT_PERIODS = [3, 5, 8, 10, 12, 15];
const GMMA_LONG_PERIODS = [30, 35, 40, 45, 50, 60];

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

const formatMarketCap = (num: number | null) => {
  if (num === null || num === undefined) return '—';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)} T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)} B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)} M`;
  return `$${num.toLocaleString()}`;
};

const formatCurrency = (num: number | null) => {
  if (num === null || num === undefined) return '—';
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  let formatted = '';
  if (absNum >= 1e12) formatted = `$${(absNum / 1e12).toFixed(2)} T`;
  else if (absNum >= 1e9) formatted = `$${(absNum / 1e9).toFixed(2)} B`;
  else if (absNum >= 1e6) formatted = `$${(absNum / 1e6).toFixed(2)} M`;
  else formatted = `$${absNum.toLocaleString()}`;
  return isNegative ? `(${formatted})` : formatted;
};

const formatDateLabel = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear().toString().slice(-2)}`;
  } catch (e) {
    return dateStr;
  }
};

interface StockDetails {
  ticker: string;
  name: string;
  summary: string;
  sector: string;
  industry: string;
  website: string;
  market_cap: number | null;
  financials: Array<{
    quarter: string;
    revenue: number | null;
    net_income: number | null;
    eps: number | null;
  }>;
}

interface FinancialsTrendChartProps {
  financials: Array<{
    quarter: string;
    revenue: number | null;
    net_income: number | null;
    eps: number | null;
  }>;
}

const FinancialsTrendChart: React.FC<FinancialsTrendChartProps> = ({ financials }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // 1. Primary Y-axis bounds (Revenue & Net Income combined)
  const primaryVals = financials
    .reduce((acc, f) => {
      if (f.revenue !== null && f.revenue !== undefined) acc.push(f.revenue);
      if (f.net_income !== null && f.net_income !== undefined) acc.push(f.net_income);
      return acc;
    }, [] as number[]);

  let minPrimary = primaryVals.length > 0 ? Math.min(...primaryVals) : 0;
  let maxPrimary = primaryVals.length > 0 ? Math.max(...primaryVals) : 100;
  const primaryRange = maxPrimary - minPrimary;
  if (primaryRange === 0) {
    maxPrimary += 1;
    minPrimary -= 1;
  } else {
    maxPrimary += primaryRange * 0.15;
    minPrimary -= primaryRange * 0.15;
  }

  // 2. Secondary Y-axis bounds (EPS)
  const epsVals = financials
    .map(f => f.eps)
    .filter(v => v !== null && v !== undefined) as number[];

  let minEps = epsVals.length > 0 ? Math.min(...epsVals) : 0;
  let maxEps = epsVals.length > 0 ? Math.max(...epsVals) : 1;
  const epsRange = maxEps - minEps;
  if (epsRange === 0) {
    maxEps += 0.1;
    minEps -= 0.1;
  } else {
    maxEps += epsRange * 0.15;
    minEps -= epsRange * 0.15;
  }

  // Dimensions
  const svgWidth = 500;
  const svgHeight = 240;
  const paddingLeft = 65;
  const paddingRight = 55;
  const paddingTop = 30;
  const paddingBottom = 35;

  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const getX = (index: number) => {
    if (financials.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (index / (financials.length - 1)) * plotWidth;
  };

  const getY = (val: number, key: 'revenue' | 'net_income' | 'eps') => {
    if (key === 'eps') {
      const norm = (val - minEps) / (maxEps - minEps);
      return paddingTop + plotHeight - norm * plotHeight;
    } else {
      const norm = (val - minPrimary) / (maxPrimary - minPrimary);
      return paddingTop + plotHeight - norm * plotHeight;
    }
  };

  const getPathD = (key: 'revenue' | 'net_income' | 'eps') => {
    let d = '';
    financials.forEach((f, idx) => {
      const val = f[key];
      if (val !== null && val !== undefined) {
        const x = getX(idx);
        const y = getY(val, key);
        if (d === '') {
          d = `M ${x} ${y}`;
        } else {
          d += ` L ${x} ${y}`;
        }
      }
    });
    return d;
  };

  const formatLabelValue = (num: number, key: 'revenue' | 'net_income' | 'eps') => {
    if (key === 'eps') return `$${num.toFixed(2)}`;
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    let valStr = '';
    if (absNum >= 1e12) valStr = `$${(absNum / 1e12).toFixed(1)}T`;
    else if (absNum >= 1e9) valStr = `$${(absNum / 1e9).toFixed(1)}B`;
    else if (absNum >= 1e6) valStr = `$${(absNum / 1e6).toFixed(1)}M`;
    else valStr = `$${absNum.toLocaleString()}`;
    return isNegative ? `(${valStr})` : valStr;
  };

  const formatAxisPrimary = (num: number) => {
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    let valStr = '';
    if (absNum >= 1e12) valStr = `$${(absNum / 1e12).toFixed(0)}T`;
    else if (absNum >= 1e9) valStr = `$${(absNum / 1e9).toFixed(0)}B`;
    else if (absNum >= 1e6) valStr = `$${(absNum / 1e6).toFixed(0)}M`;
    else valStr = `$${absNum.toLocaleString()}`;
    return isNegative ? `-${valStr}` : valStr;
  };

  const metricsConfig = {
    revenue: { color: '#3b82f6', label: 'Revenue' },
    net_income: { color: '#10b981', label: 'Net Income' },
    eps: { color: '#a855f7', label: 'EPS (Right Axis)' }
  };

  const gridLevels = [0, 0.25, 0.5, 0.75, 1];
  const primaryTicks = gridLevels.map(lvl => minPrimary + lvl * (maxPrimary - minPrimary));
  const epsTicks = gridLevels.map(lvl => minEps + lvl * (maxEps - minEps));

  return (
    <div className="financial-chart-wrapper" style={{ position: 'relative', width: '100%' }}>
      {/* Legend row */}
      <div className="chart-legend-row" style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '12px', fontSize: '11px', fontWeight: 600 }}>
        {Object.entries(metricsConfig).map(([key, cfg]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cfg.color }} />
            <span style={{ color: 'var(--color-text-main)' }}>{cfg.label}</span>
          </span>
        ))}
      </div>

      <svg 
        width="100%" 
        height={svgHeight} 
        viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = ((e.clientX - rect.left) / rect.width) * svgWidth;
          
          let closestIdx = 0;
          let minDiff = Infinity;
          for (let i = 0; i < financials.length; i++) {
            const x = getX(i);
            const diff = Math.abs(clickX - x);
            if (diff < minDiff) {
              minDiff = diff;
              closestIdx = i;
            }
          }
          setHoveredIndex(closestIdx);
        }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Vertical line indicator on hover */}
        {hoveredIndex !== null && (
          <line
            x1={getX(hoveredIndex)}
            y1={paddingTop}
            x2={getX(hoveredIndex)}
            y2={paddingTop + plotHeight}
            stroke="var(--glass-border)"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
        )}

        {/* Horizontal gridlines and Y-axes */}
        {gridLevels.map((lvl, idx) => {
          const y = paddingTop + plotHeight - lvl * plotHeight;
          return (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="var(--glass-border)"
                strokeDasharray="4 4"
                strokeWidth="0.8"
              />
              {/* Left Axis: Primary (Revenue & Net Income) */}
              <text
                x={paddingLeft - 8}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-text-muted)"
                style={{ fontSize: '9px', fontFamily: 'monospace' }}
              >
                {formatAxisPrimary(primaryTicks[idx])}
              </text>
              {/* Right Axis: Secondary (EPS) */}
              <text
                x={svgWidth - paddingRight + 8}
                y={y + 3}
                textAnchor="start"
                fill="#a855f7"
                style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 600 }}
              >
                {`$${epsTicks[idx].toFixed(2)}`}
              </text>
            </g>
          );
        })}

        {/* Draw Line Paths */}
        {(['revenue', 'net_income', 'eps'] as const).map(key => {
          const d = getPathD(key);
          if (!d) return null;
          return (
            <path
              key={key}
              d={d}
              fill="none"
              stroke={metricsConfig[key].color}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Draw Point Circles */}
        {(['revenue', 'net_income', 'eps'] as const).map(key => {
          return financials.map((f, idx) => {
            const val = f[key];
            if (val === null || val === undefined) return null;
            const x = getX(idx);
            const y = getY(val, key);
            const isHovered = hoveredIndex === idx;
            return (
              <circle
                key={`${key}-${idx}`}
                cx={x}
                cy={y}
                r={isHovered ? 5.5 : 3.5}
                fill={isHovered ? "#ffffff" : metricsConfig[key].color}
                stroke={metricsConfig[key].color}
                strokeWidth="1.8"
                style={{ transition: 'r 0.15s ease, fill 0.15s ease' }}
              />
            );
          });
        })}

        {/* Draw value labels: simple black text, clearly offset per metric */}
        {financials.map((f, idx) =>
          (['revenue', 'net_income', 'eps'] as const).map(key => {
            const val = f[key];
            if (val === null || val === undefined) return null;
            const x = getX(idx);
            const y = getY(val, key);

            let textX = x;
            let textY = y;
            let anchor: 'start' | 'end' | 'middle' = 'middle';

            const isFirst = idx === 0;
            const isLast = idx === financials.length - 1;

            if (isFirst) {
              if (key === 'revenue') {
                textY = y - 12;
              } else if (key === 'net_income') {
                textY = y + 18;
              } else {
                textX = x + 12;
                textY = y + 4;
                anchor = 'start';
              }
            } else if (isLast) {
              if (key === 'revenue') {
                textY = y - 12;
              } else if (key === 'net_income') {
                textY = y + 18;
              } else {
                textX = x - 12;
                textY = y + 4;
                anchor = 'end';
              }
            } else {
              if (key === 'revenue') {
                textX = x - 12;
                textY = y + 4;
                anchor = 'end';
              } else if (key === 'net_income') {
                textX = x + 12;
                textY = y + 4;
                anchor = 'start';
              } else {
                textY = y - 12;
              }
            }

            return (
              <text
                key={`val-${key}-${idx}`}
                x={textX}
                y={textY}
                textAnchor={anchor}
                fill="#1e293b"
                style={{ fontSize: '14px', fontFamily: 'Inter, sans-serif', fontWeight: 600, pointerEvents: 'none' }}
              >
                {formatLabelValue(val, key)}
              </text>
            );
          })
        )}

        {/* X-axis labels */}
        {financials.map((f, idx) => {
          const x = getX(idx);
          const date = new Date(f.quarter);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const label = `${months[date.getMonth()]}-${date.getFullYear().toString().slice(-2)}`;
          return (
            <text
              key={idx}
              x={x}
              y={svgHeight - paddingBottom + 18}
              textAnchor="middle"
              fill={hoveredIndex === idx ? "var(--color-text-main)" : "var(--color-text-muted)"}
              style={{ fontSize: '9px', fontFamily: 'Inter, sans-serif', fontWeight: hoveredIndex === idx ? 600 : 400, transition: 'fill 0.15s' }}
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Multi-metric Tooltip Overlay */}
      {hoveredIndex !== null && financials[hoveredIndex] && (
        <div 
          className="financial-chart-tooltip"
          style={{
            position: 'absolute',
            left: `${(getX(hoveredIndex) / svgWidth) * 100}%`,
            top: '40px',
            transform: hoveredIndex > financials.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
            background: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid var(--glass-border)',
            borderRadius: '8px',
            padding: '10px 14px',
            zIndex: 100,
            pointerEvents: 'none',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            fontSize: '11.5px',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(4px)',
            transition: 'left 0.1s ease, top 0.1s ease'
          }}
        >
          <div style={{ fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px', marginBottom: '2px' }}>
            {formatDateLabel(financials[hoveredIndex].quarter)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#94a3b8' }}>Revenue:</span>
            <span style={{ fontWeight: 600, color: metricsConfig.revenue.color }}>
              {formatCurrency(financials[hoveredIndex].revenue)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#94a3b8' }}>Net Income:</span>
            <span style={{ fontWeight: 600, color: metricsConfig.net_income.color }}>
              {formatCurrency(financials[hoveredIndex].net_income)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#94a3b8' }}>EPS:</span>
            <span style={{ fontWeight: 600, color: metricsConfig.eps.color }}>
              {financials[hoveredIndex].eps !== null ? `$${financials[hoveredIndex].eps.toFixed(2)}` : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const ChartPanel: React.FC<ChartPanelProps> = ({
  ticker,
  candles,
  highlightDate,
  vcpContractions,
  gmmaData,
  theme = 'light'
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<'1Y' | '2Y' | '3Y'>('1Y');
  const [showGMMA, setShowGMMA] = useState<boolean>(gmmaData?.showByDefault ?? false);
  const [showMA20, setShowMA20] = useState<boolean>(true);
  const [showMA50, setShowMA50] = useState<boolean>(true);
  const [showMA150, setShowMA150] = useState<boolean>(true);
  const [showMA200, setShowMA200] = useState<boolean>(true);

  const [details, setDetails] = useState<StockDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [financialsView, setFinancialsView] = useState<'table' | 'chart'>('chart');

  useEffect(() => {
    if (!ticker) {
      setDetails(null);
      return;
    }
    const fetchDetails = async () => {
      setLoadingDetails(true);
      try {
        const res = await fetch(`${BACKEND_URL}/stock/${ticker}/details`);
        if (!res.ok) throw new Error('Failed to fetch details');
        const data = await res.json();
        setDetails(data);
      } catch (e) {
        console.error("Error fetching stock details:", e);
        setDetails(null);
      } finally {
        setLoadingDetails(false);
      }
    };
    fetchDetails();
  }, [ticker]);

  // Color Pickers state (persistent with localStorage & backend GCS settings)
  const [ma20Color, setMa20Color] = useState<string>(() => localStorage.getItem('ma20Color') || '#eab308');
  const [ma50Color, setMa50Color] = useState<string>(() => localStorage.getItem('ma50Color') || '#3b82f6');
  const [ma150Color, setMa150Color] = useState<string>(() => localStorage.getItem('ma150Color') || '#f97316');
  const [ma200Color, setMa200Color] = useState<string>(() => localStorage.getItem('ma200Color') || '#ec4899');

  // Moving Average Period states (persistent with localStorage & backend)
  const [ma20Period, setMa20Period] = useState<number>(() => Number(localStorage.getItem('ma20Period')) || 20);
  const [ma50Period, setMa50Period] = useState<number>(() => Number(localStorage.getItem('ma50Period')) || 50);
  const [ma150Period, setMa150Period] = useState<number>(() => Number(localStorage.getItem('ma150Period')) || 150);
  const [ma200Period, setMa200Period] = useState<number>(() => Number(localStorage.getItem('ma200Period')) || 200);

  // Load custom settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/user-settings`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ma20Color) {
          setMa20Color(data.ma20Color);
          localStorage.setItem('ma20Color', data.ma20Color);
        }
        if (data.ma50Color) {
          setMa50Color(data.ma50Color);
          localStorage.setItem('ma50Color', data.ma50Color);
        }
        if (data.ma150Color) {
          setMa150Color(data.ma150Color);
          localStorage.setItem('ma150Color', data.ma150Color);
        }
        if (data.ma200Color) {
          setMa200Color(data.ma200Color);
          localStorage.setItem('ma200Color', data.ma200Color);
        }
        if (data.ma20Period) {
          setMa20Period(data.ma20Period);
          localStorage.setItem('ma20Period', String(data.ma20Period));
        }
        if (data.ma50Period) {
          setMa50Period(data.ma50Period);
          localStorage.setItem('ma50Period', String(data.ma50Period));
        }
        if (data.ma150Period) {
          setMa150Period(data.ma150Period);
          localStorage.setItem('ma150Period', String(data.ma150Period));
        }
        if (data.ma200Period) {
          setMa200Period(data.ma200Period);
          localStorage.setItem('ma200Period', String(data.ma200Period));
        }
      } catch (e) {
        console.error("Failed to load user settings from backend:", e);
      }
    };
    loadSettings();
  }, []);

  // Sync showGMMA and disable MAs when gmmaData prop changes (e.g. switching tabs)
  useEffect(() => {
    const isGMMA = gmmaData?.showByDefault ?? false;
    setShowGMMA(isGMMA);
    if (isGMMA) {
      setShowMA20(false);
      setShowMA50(false);
      setShowMA150(false);
      setShowMA200(false);
    } else {
      setShowMA20(true);
      setShowMA50(true);
      setShowMA150(true);
      setShowMA200(true);
    }
  }, [gmmaData?.showByDefault]);

  const handleColorChange = async (ma: 'MA20' | 'MA50' | 'MA150' | 'MA200', color: string) => {
    localStorage.setItem(`${ma.toLowerCase()}Color`, color);
    if (ma === 'MA20') setMa20Color(color);
    else if (ma === 'MA50') setMa50Color(color);
    else if (ma === 'MA150') setMa150Color(color);
    else if (ma === 'MA200') setMa200Color(color);

    try {
      await fetch(`${BACKEND_URL}/user-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`${ma.toLowerCase()}Color`]: color
        })
      });
    } catch (e) {
      console.error("Failed to save color change to backend:", e);
    }
  };

  const handlePeriodChange = async (ma: 'MA20' | 'MA50' | 'MA150' | 'MA200', period: number) => {
    if (isNaN(period) || period <= 0) return;
    localStorage.setItem(`${ma.toLowerCase()}Period`, String(period));
    if (ma === 'MA20') setMa20Period(period);
    else if (ma === 'MA50') setMa50Period(period);
    else if (ma === 'MA150') setMa150Period(period);
    else if (ma === 'MA200') setMa200Period(period);

    try {
      await fetch(`${BACKEND_URL}/user-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`${ma.toLowerCase()}Period`]: period
        })
      });
    } catch (e) {
      console.error("Failed to save period change to backend:", e);
    }
  };

  // Helper to calculate Simple Moving Average (SMA)
  const calculateSMA = (data: Candle[], period: number) => {
    const sma: { time: string; value: number }[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) continue;
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      sma.push({ time: data[i].time, value: sum / period });
    }
    return sma;
  };

  // Helper to calculate Exponential Moving Average (EMA)
  const calculateEMA = (data: Candle[], period: number) => {
    const ema: { time: string; value: number }[] = [];
    const k = 2 / (period + 1);
    let emaPrev: number | null = null;

    for (let i = 0; i < data.length; i++) {
      const close = data[i].close;
      if (emaPrev === null) {
        // Seed with SMA of first `period` bars
        if (i < period - 1) continue;
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        emaPrev = sum / period;
        ema.push({ time: data[i].time, value: emaPrev });
      } else {
        emaPrev = close * k + emaPrev * (1 - k);
        ema.push({ time: data[i].time, value: emaPrev });
      }
    }
    return ema;
  };

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;


    const isDark = theme === 'dark';
    // 1. Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDark ? 'rgba(21, 23, 30, 0.7)' : '#ffffff' },
        textColor: isDark ? '#d1d4dc' : '#334155',
        fontSize: 12,
        fontFamily: 'Outfit, Inter, sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(42, 46, 57, 0.3)' : 'rgba(226, 232, 240, 0.8)' },
        horzLines: { color: isDark ? 'rgba(42, 46, 57, 0.3)' : 'rgba(226, 232, 240, 0.8)' },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(197, 203, 206, 0.2)' : 'rgba(226, 232, 240, 0.8)',
        visible: true,
      },
      timeScale: {
        borderColor: isDark ? 'rgba(197, 203, 206, 0.2)' : 'rgba(226, 232, 240, 0.8)',
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 80,
      },
      crosshair: {
        vertLine: {
          color: '#758696',
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      width: chartContainerRef.current.clientWidth,
      height: 450,
    });

    // 2. Add Candlestick Series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#10b981',
      wickDownColor: '#ef4444',
      wickUpColor: '#10b981',
    });

    const chartCandles = candles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    candlestickSeries.setData(chartCandles);

    // 3. Add Moving Average Lines (SMA)
    if (showMA20) {
      const sma20Data = calculateSMA(candles, ma20Period);
      const sma20Line = chart.addSeries(LineSeries, {
        color: ma20Color,
        lineWidth: 2,
        title: `MA${ma20Period}`,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma20Line.setData(sma20Data);
    }

    if (showMA50) {
      const sma50Data = calculateSMA(candles, ma50Period);
      const sma50Line = chart.addSeries(LineSeries, {
        color: ma50Color,
        lineWidth: 2,
        title: `MA${ma50Period}`,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma50Line.setData(sma50Data);
    }

    if (showMA150) {
      const sma150Data = calculateSMA(candles, ma150Period);
      const sma150Line = chart.addSeries(LineSeries, {
        color: ma150Color,
        lineWidth: 2,
        title: `MA${ma150Period}`,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma150Line.setData(sma150Data);
    }

    if (showMA200) {
      const sma200Data = calculateSMA(candles, ma200Period);
      const sma200Line = chart.addSeries(LineSeries, {
        color: ma200Color,
        lineWidth: 2,
        title: `MA${ma200Period}`,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma200Line.setData(sma200Data);
    }

    // 4. Add GMMA EMA Lines (12 lines, shown only when showGMMA is true)
    if (showGMMA) {
      // Short-term group (traders) — teal/cyan palette
      GMMA_SHORT_PERIODS.forEach((period, idx) => {
        const emaData = calculateEMA(candles, period);
        const line = chart.addSeries(LineSeries, {
          color: GMMA_SHORT_COLORS[idx],
          lineWidth: 1,
          title: `G${period}`,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(emaData);
      });

      // Long-term group (investors) — amber/red palette
      GMMA_LONG_PERIODS.forEach((period, idx) => {
        const emaData = calculateEMA(candles, period);
        const line = chart.addSeries(LineSeries, {
          color: GMMA_LONG_COLORS[idx],
          lineWidth: 1,
          title: `G${period}`,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(emaData);
      });
    }

    // 5. Add Volume Series (Lower 20% of the chart)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume_scale',
    });

    chart.priceScale('volume_scale').applyOptions({
      scaleMargins: {
        top: 0.8, // volume will occupy only the bottom 20%
        bottom: 0,
      },
    });

    const volumeData = candles.map(c => {
      const isUp = c.close >= c.open;
      return {
        time: c.time,
        value: c.volume,
        color: isUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
      };
    });
    volumeSeries.setData(volumeData);

    // 6. Add Markers for buy alerts or contraction peaks/valleys
    const markers: any[] = [];

    if (highlightDate) {
      markers.push({
        time: highlightDate,
        position: 'belowBar',
        color: '#eab308',
        shape: 'arrowUp',
        text: 'MA20 Pullback',
        size: 1.5
      });
    }

    if (vcpContractions && vcpContractions.length > 0) {
      // Find historical index from contractions and map to time
      const lookbackStartIdx = candles.length - 100;

      vcpContractions.forEach((c, index) => {
        const peakCandleIdx = lookbackStartIdx + c.peak_idx;
        const troughCandleIdx = lookbackStartIdx + c.trough_idx;

        if (peakCandleIdx >= 0 && peakCandleIdx < candles.length) {
          markers.push({
            time: candles[peakCandleIdx].time,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: `Peak T${index + 1} (-${c.depth_pct}%)`
          });
        }

        if (troughCandleIdx >= 0 && troughCandleIdx < candles.length) {
          markers.push({
            time: candles[troughCandleIdx].time,
            position: 'belowBar',
            color: '#10b981',
            shape: 'arrowUp',
            text: `Low T${index + 1}`
          });
        }
      });

      // Also mark final breakout setup on the very last candle
      markers.push({
        time: candles[candles.length - 1].time,
        position: 'belowBar',
        color: '#a855f7',
        shape: 'arrowUp',
        text: 'VCP Buy Setup',
        size: 1.5
      });
    }

    // GMMA crossover marker
    if (gmmaData && showGMMA) {
      if (gmmaData.crossoverDaysAgo !== null && gmmaData.crossoverDaysAgo !== undefined) {
        const crossoverIdx = candles.length - gmmaData.crossoverDaysAgo;
        if (crossoverIdx >= 0 && crossoverIdx < candles.length) {
          markers.push({
            time: candles[crossoverIdx].time,
            position: 'belowBar',
            color: '#0000FF',
            shape: 'arrowUp',
            text: 'GMMA Crossover',
            size: 1.5
          });
        }
      }
    }

    if (markers.length > 0) {
      createSeriesMarkers(candlestickSeries, markers);
    }

    // 7. Fit time scale to show all data
    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({
      rightOffset: 18,
    });

    let visibleBars = 252;
    if (timeframe === '2Y') visibleBars = 504;
    else if (timeframe === '3Y') visibleBars = 756;

    // Safety timeout to ensure space is created on the right after initial paint cycle
    const timerId = setTimeout(() => {
      try {
        const timeScale = chart.timeScale();
        const fromIndex = Math.max(0, candles.length - visibleBars);
        const toIndex = candles.length - 1 + 18; // Keep a small space on right
        timeScale.setVisibleLogicalRange({
          from: fromIndex,
          to: toIndex,
        });
      } catch (e) {
        console.error("Error setting logical range:", e);
      }
    }, 60);

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const { width } = entries[0].contentRect;
      if (width > 0) {
        chart.resize(width, 450);
      }
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timerId);
      chart.remove();
    };
  }, [candles, highlightDate, vcpContractions, gmmaData, theme, timeframe, showGMMA, showMA20, showMA50, showMA150, showMA200, ma20Color, ma50Color, ma150Color, ma200Color, ma20Period, ma50Period, ma150Period, ma200Period]);

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <div className="chart-header-left" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h3 className="chart-title">{ticker} Daily Chart</h3>
          <div className="chart-legend">
            <span className={`legend-item ${showMA20 ? 'active' : 'inactive'}`}>
              <input
                type="checkbox"
                checked={showMA20}
                onChange={(e) => setShowMA20(e.target.checked)}
                className="legend-checkbox"
                id="checkbox-ma20"
              />
              <input
                type="color"
                value={ma20Color}
                onChange={(e) => handleColorChange('MA20', e.target.value)}
                className="legend-color-picker"
                title="Change MA20 color"
              />
              <span className="legend-ma-wrapper">
                <label htmlFor="checkbox-ma20" style={{ cursor: 'pointer' }}>MA</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={ma20Period}
                  onChange={(e) => handlePeriodChange('MA20', parseInt(e.target.value) || 20)}
                  className="legend-period-input"
                  title="Change MA20 period"
                  style={{ width: `${String(ma20Period).length}ch` }}
                />
              </span>
            </span>
            <span className={`legend-item ${showMA50 ? 'active' : 'inactive'}`}>
              <input
                type="checkbox"
                checked={showMA50}
                onChange={(e) => setShowMA50(e.target.checked)}
                className="legend-checkbox"
                id="checkbox-ma50"
              />
              <input
                type="color"
                value={ma50Color}
                onChange={(e) => handleColorChange('MA50', e.target.value)}
                className="legend-color-picker"
                title="Change MA50 color"
              />
              <span className="legend-ma-wrapper">
                <label htmlFor="checkbox-ma50" style={{ cursor: 'pointer' }}>MA</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={ma50Period}
                  onChange={(e) => handlePeriodChange('MA50', parseInt(e.target.value) || 50)}
                  className="legend-period-input"
                  title="Change MA50 period"
                  style={{ width: `${String(ma50Period).length}ch` }}
                />
              </span>
            </span>
            <span className={`legend-item ${showMA150 ? 'active' : 'inactive'}`}>
              <input
                type="checkbox"
                checked={showMA150}
                onChange={(e) => setShowMA150(e.target.checked)}
                className="legend-checkbox"
                id="checkbox-ma150"
              />
              <input
                type="color"
                value={ma150Color}
                onChange={(e) => handleColorChange('MA150', e.target.value)}
                className="legend-color-picker"
                title="Change MA150 color"
              />
              <span className="legend-ma-wrapper">
                <label htmlFor="checkbox-ma150" style={{ cursor: 'pointer' }}>MA</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={ma150Period}
                  onChange={(e) => handlePeriodChange('MA150', parseInt(e.target.value) || 150)}
                  className="legend-period-input"
                  title="Change MA150 period"
                  style={{ width: `${String(ma150Period).length}ch` }}
                />
              </span>
            </span>
            <span className={`legend-item ${showMA200 ? 'active' : 'inactive'}`}>
              <input
                type="checkbox"
                checked={showMA200}
                onChange={(e) => setShowMA200(e.target.checked)}
                className="legend-checkbox"
                id="checkbox-ma200"
              />
              <input
                type="color"
                value={ma200Color}
                onChange={(e) => handleColorChange('MA200', e.target.value)}
                className="legend-color-picker"
                title="Change MA200 color"
              />
              <span className="legend-ma-wrapper">
                <label htmlFor="checkbox-ma200" style={{ cursor: 'pointer' }}>MA</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={ma200Period}
                  onChange={(e) => handlePeriodChange('MA200', parseInt(e.target.value) || 200)}
                  className="legend-period-input"
                  title="Change MA200 period"
                  style={{ width: `${String(ma200Period).length}ch` }}
                />
              </span>
            </span>
            {/* GMMA Toggle Button */}
            <button
              className={`gmma-toggle-btn ${showGMMA ? 'active' : ''}`}
              onClick={() => setShowGMMA(prev => !prev)}
              title={showGMMA ? 'Hide GMMA lines' : 'Show GMMA (12 EMA lines)'}
            >
              <span className="gmma-short-dot" />
              <span className="gmma-long-dot" />
              GMMA
            </button>
          </div>
        </div>
        <div className="chart-timeframe-selector">
          {(['1Y', '2Y', '3Y'] as const).map((tf) => (
            <button
              key={tf}
              className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf === '1Y' ? '1 Year' : tf === '2Y' ? '2 Years' : '3 Years'}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} style={{ width: '100%', height: '450px' }} />

      {/* New Company Details & Financials Section */}
      {loadingDetails ? (
        <div className="details-loading">
          <div className="loading-spinner"></div>
          <p>Loading company financial details...</p>
        </div>
      ) : details ? (
        <div className="stock-details-section">
          {/* Divider */}
          <div className="details-divider" />
          
          <div className="details-header-row">
            <h3 className="details-section-title">🏢 Company Profile &amp; Financials</h3>
            <span className="details-ticker-badge">{details.ticker}</span>
          </div>

          <div className="details-grid">
            {/* Left Box: Profile & Summary */}
            <div className="profile-column">
              <div className="profile-meta-grid">
                <div className="meta-card">
                  <span className="meta-label">Sector</span>
                  <span className="meta-val" title={details.sector}>{details.sector}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-label">Industry</span>
                  <span className="meta-val" title={details.industry}>{details.industry}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-label">Market Cap</span>
                  <span className="meta-val">{formatMarketCap(details.market_cap)}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-label">Website</span>
                  {details.website ? (
                    <a href={details.website} target="_blank" rel="noopener noreferrer" className="meta-val link" title={details.website}>
                      {details.website.replace(/^https?:\/\/(www\.)?/, '')} 🔗
                    </a>
                  ) : (
                    <span className="meta-val">—</span>
                  )}
                </div>
              </div>

              <div className="summary-box">
                <h4 className="box-title">Business Description</h4>
                <p className="summary-text">{details.summary}</p>
              </div>
            </div>

            {/* Right Box: Quarterly Financials Table or Chart */}
            <div className="financials-column">
              <div className="financials-table-container">
                <div className="financials-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h4 className="box-title" style={{ margin: 0 }}>Quarterly Financials</h4>
                  <div className="financials-view-toggle">
                    <button 
                      className={`view-toggle-btn ${financialsView === 'table' ? 'active' : ''}`}
                      onClick={() => setFinancialsView('table')}
                    >
                      📋 Table
                    </button>
                    <button 
                      className={`view-toggle-btn ${financialsView === 'chart' ? 'active' : ''}`}
                      onClick={() => setFinancialsView('chart')}
                    >
                      📈 Trend Chart
                    </button>
                  </div>
                </div>

                {details.financials.length === 0 ? (
                  <div className="financials-empty">
                    <p>No quarterly financials available for this symbol.</p>
                  </div>
                ) : financialsView === 'table' ? (
                  <table className="financials-table">
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th>Revenue</th>
                        <th>Net Income</th>
                        <th>EPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.financials.map((fin) => (
                        <tr key={fin.quarter}>
                          <td className="fin-date">{formatDateLabel(fin.quarter)}</td>
                          <td className="fin-val">{formatCurrency(fin.revenue)}</td>
                          <td className={`fin-val ${fin.net_income !== null && fin.net_income > 0 ? 'pos' : fin.net_income !== null && fin.net_income < 0 ? 'neg' : ''}`}>
                            {formatCurrency(fin.net_income)}
                          </td>
                          <td className={`fin-val ${fin.eps !== null && fin.eps > 0 ? 'pos' : fin.eps !== null && fin.eps < 0 ? 'neg' : ''}`}>
                            {fin.eps !== null ? `$${fin.eps.toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="financials-chart-view" style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
                    <FinancialsTrendChart financials={details.financials} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
