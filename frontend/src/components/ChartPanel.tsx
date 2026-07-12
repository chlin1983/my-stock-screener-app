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

  // Color Pickers state (persistent with localStorage)
  const [ma20Color, setMa20Color] = useState<string>(() => localStorage.getItem('ma20Color') || '#eab308');
  const [ma50Color, setMa50Color] = useState<string>(() => localStorage.getItem('ma50Color') || '#3b82f6');
  const [ma150Color, setMa150Color] = useState<string>(() => localStorage.getItem('ma150Color') || '#f97316');
  const [ma200Color, setMa200Color] = useState<string>(() => localStorage.getItem('ma200Color') || '#ec4899');

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

  const handleColorChange = (ma: 'MA20' | 'MA50' | 'MA150' | 'MA200', color: string) => {
    localStorage.setItem(`${ma.toLowerCase()}Color`, color);
    if (ma === 'MA20') setMa20Color(color);
    else if (ma === 'MA50') setMa50Color(color);
    else if (ma === 'MA150') setMa150Color(color);
    else if (ma === 'MA200') setMa200Color(color);
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
      const sma20Data = calculateSMA(candles, 20);
      const sma20Line = chart.addSeries(LineSeries, {
        color: ma20Color,
        lineWidth: 2,
        title: 'MA20',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma20Line.setData(sma20Data);
    }

    if (showMA50) {
      const sma50Data = calculateSMA(candles, 50);
      const sma50Line = chart.addSeries(LineSeries, {
        color: ma50Color,
        lineWidth: 2,
        title: 'MA50',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma50Line.setData(sma50Data);
    }

    if (showMA150) {
      const sma150Data = calculateSMA(candles, 150);
      const sma150Line = chart.addSeries(LineSeries, {
        color: ma150Color,
        lineWidth: 2,
        title: 'MA150',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma150Line.setData(sma150Data);
    }

    if (showMA200) {
      const sma200Data = calculateSMA(candles, 200);
      const sma200Line = chart.addSeries(LineSeries, {
        color: ma200Color,
        lineWidth: 2,
        title: 'MA200',
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
  }, [candles, highlightDate, vcpContractions, gmmaData, theme, timeframe, showGMMA, showMA20, showMA50, showMA150, showMA200, ma20Color, ma50Color, ma150Color, ma200Color]);

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
              <label htmlFor="checkbox-ma20" style={{ cursor: 'pointer' }}>MA20</label>
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
              <label htmlFor="checkbox-ma50" style={{ cursor: 'pointer' }}>MA50</label>
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
              <label htmlFor="checkbox-ma150" style={{ cursor: 'pointer' }}>MA150</label>
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
              <label htmlFor="checkbox-ma200" style={{ cursor: 'pointer' }}>MA200</label>
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
    </div>
  );
};
