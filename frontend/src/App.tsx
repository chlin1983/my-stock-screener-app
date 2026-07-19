import { useState, useEffect } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { WatchlistManager } from './components/WatchlistManager';
import { PortfolioDashboard } from './components/PortfolioDashboard';
import { PortfolioSidebarConfig } from './components/PortfolioSidebarConfig';
import { TradeLog } from './components/TradeLog';
import { TradeLogSidebar } from './components/TradeLogSidebar';
import { AssetAllocationMap } from './components/AssetAllocationMap';
import { AIChatbot } from './components/AIChatbot';
import { NewsPanel } from './components/NewsPanel';
import { AIStrategyProposal } from './components/AIStrategyProposal';

interface MA20Alert {

  ticker: string;
  name?: string;
  close: number;
  volume: number;
  ma20: number;
  low: number;
  distance_pct: number;
}

interface VCPContraction {
  peak_idx: number;
  trough_idx: number;
  peak_val: number;
  trough_val: number;
  depth_pct: number;
}

interface VCPAlert {
  ticker: string;
  name?: string;
  close: number;
  volume: number;
  depths: number[];
  final_tightness: number;
  volume_dryup_ratio: number;
  last_10d_range: number;
  contractions: VCPContraction[];
}

interface GMMAAlert {
  ticker: string;
  name?: string;
  close: number;
  volume: number;
  is_bullish_aligned: boolean;
  had_recent_crossover: boolean;
  crossover_days_ago: number | null;
  separation_pct: number;
  short_ema_values: Record<string, number>;
  long_ema_values: Record<string, number>;
}

interface ScanResults {
  timestamp: string | null;
  universe: string | null;
  scanned_count: number;
  ma20_alerts: MA20Alert[];
  vcp_alerts: VCPAlert[];
  gmma_alerts: GMMAAlert[];
  gmma_all?: GMMAAlert[];
  message?: string;
}

interface ScanStatus {
  is_running: boolean;
  last_completed: string | null;
  current_universe: string | null;
  error: string | null;
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

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [activeTab, setActiveTab] = useState<'ma20' | 'vcp' | 'gmma' | 'gmma_all'>('ma20');
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [dashboardMode, setDashboardMode] = useState<'screener' | 'portfolio' | 'assetmap' | 'tradelog' | 'chatbot' | 'news' | 'ai-strategy'>('screener');
  const [portfolioRefreshTrigger, setPortfolioRefreshTrigger] = useState<number>(0);
  const [tradeLogRefreshTrigger, setTradeLogRefreshTrigger] = useState<number>(0);

  useEffect(() => {
    document.body.className = `${theme}-theme`;
  }, [theme]);
  const [results, setResults] = useState<ScanResults>({
    timestamp: null,
    universe: null,
    scanned_count: 0,
    ma20_alerts: [],
    vcp_alerts: [],
    gmma_alerts: [],
    gmma_all: []
  });
  const [status, setStatus] = useState<ScanStatus>({
    is_running: false,
    last_completed: null,
    current_universe: null,
    error: null
  });
  
  // Selected Stock states
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [history, setHistory] = useState<Candle[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [selectedAlertDetails, setSelectedAlertDetails] = useState<any>(null);

  // Settings view tab: 'screener' or 'watchlists'
  const [settingsTab, setSettingsTab] = useState<'screener' | 'watchlists'>('screener');

  // Lifted watchlist states
  const [watchlists, setWatchlists] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem('ag_watchlists');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.map((wl: any) => ({
            ...wl,
            tickers: Array.isArray(wl.tickers) ? [...wl.tickers].sort((a, b) => a.localeCompare(b)) : []
          }));
        }
      }
    } catch {}
    const defaults = [
      {
        id: 'semiconductor',
        name: 'Semiconductor',
        emoji: '🔬',
        tickers: ['NVDA', 'AMD', 'INTC', 'TSM', 'ASML', 'QCOM', 'AVGO', 'MU', 'AMAT', 'LRCX'],
      },
      {
        id: 'space',
        name: 'Space',
        emoji: '🚀',
        tickers: ['RKLB', 'ASTS', 'LUNR', 'BA', 'LMT', 'NOC', 'RTX'],
      },
      {
        id: 'biotech',
        name: 'Biotech',
        emoji: '💊',
        tickers: ['MRNA', 'BNTX', 'REGN', 'VRTX', 'AMGN', 'GILD', 'BIIB'],
      },
    ];
    return defaults.map(wl => ({
      ...wl,
      tickers: wl.tickers.sort((a, b) => a.localeCompare(b))
    }));
  });

  const [activeWatchlistId, setActiveWatchlistId] = useState<string>(() => {
    return localStorage.getItem('ag_watchlist_active') || 'semiconductor';
  });

  const [universeMode, setUniverseMode] = useState<
    'watchlist' | 'all_index' | 'dow30' | 'nasdaq100' | 'sp500' | 'nasdaq' | 'nyse' | 'amex' | 'all_usa'
  >('nasdaq100');

  const activeWatchlist = activeWatchlistId === 'all'
    ? {
        id: 'all',
        name: 'All Watchlists',
        emoji: '📁',
        tickers: Array.from(new Set(watchlists.flatMap(w => w.tickers || [])))
      }
    : (watchlists.find(w => w.id === activeWatchlistId) ?? watchlists[0]);

  // Filtered results for custom watchlist mode
  const isWatchlist = universeMode === 'watchlist';
  
  const getFilteredAlerts = <T extends { ticker: string }>(alerts: T[]): T[] => {
    if (!isWatchlist) return alerts || [];
    if (activeWatchlistId === 'all') return alerts || [];
    const currentTickers = activeWatchlist?.tickers || [];
    return (alerts || []).filter(a => currentTickers.includes(a.ticker));
  };

  const filteredMa20Alerts = getFilteredAlerts(results.ma20_alerts);
  const filteredVcpAlerts = getFilteredAlerts(results.vcp_alerts);
  const filteredGmmaAlerts = getFilteredAlerts(results.gmma_alerts);
  const filteredGmmaAll = getFilteredAlerts(results.gmma_all ?? []);

  const filteredScannedCount = isWatchlist
    ? (activeWatchlistId === 'all'
        ? Array.from(new Set(watchlists.flatMap(w => w.tickers || []))).length
        : (activeWatchlist?.tickers?.length ?? 0))
    : results.scanned_count;


  // Save watchlist states to localStorage when edited
  useEffect(() => {
    localStorage.setItem('ag_watchlists', JSON.stringify(watchlists));
  }, [watchlists]);

  useEffect(() => {
    localStorage.setItem('ag_watchlist_active', activeWatchlistId);
  }, [activeWatchlistId]);
  
  // MA20 Strategy Parameters
  const [ma20TolerancePct, setMa20TolerancePct] = useState<number>(0.5);
  const [ma20MinPullbackDays, setMa20MinPullbackDays] = useState<number>(2);
  const [ma20TrendFilter, setMa20TrendFilter] = useState<boolean>(true);
  
  // VCP Strategy Parameters
  const [vcpTrendTemplate, setVcpTrendTemplate] = useState<boolean>(true);
  const [vcpMaxTightnessPct, setVcpMaxTightnessPct] = useState<number>(8.0);
  const [vcpVolumeDryupPct, setVcpVolumeDryupPct] = useState<number>(65.0);
  const [vcpMinContractions, setVcpMinContractions] = useState<number>(2);
  const [vcpMaxContractions, setVcpMaxContractions] = useState<number>(4);
  const [vcpConsolidationDays, setVcpConsolidationDays] = useState<number>(100);

  // GMMA Strategy Parameters
  const [gmmaRequireBullishAlignment, setGmmaRequireBullishAlignment] = useState<boolean>(true);
  const [gmmaCrossoverLookbackDays, setGmmaCrossoverLookbackDays] = useState<number>(10);
  const [gmmaMinSeparationPct, setGmmaMinSeparationPct] = useState<number>(0.5);

  // Fetch scan status
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/scan/status`);
      const data = await res.json();
      setStatus(data);
      return data;
    } catch (e) {
      console.error("Error fetching scan status:", e);
    }
  };

  // Fetch latest scan results
  const fetchLatestResults = async (universe?: string) => {
    try {
      const target = universe || universeMode;
      const res = await fetch(`${BACKEND_URL}/scan/latest?universe=${target}`);
      const data = await res.json();
      if (data && !data.message) {
        setResults(data);
        
        // Auto select first stock in current tab if exists (filtered based on selected active watchlist)
        const getFiltered = <T extends { ticker: string }>(alerts: T[]): T[] => {
          if (target !== 'watchlist') return alerts || [];
          if (activeWatchlistId === 'all') return alerts || [];
          const currentTickers = activeWatchlist?.tickers || [];
          return (alerts || []).filter(a => currentTickers.includes(a.ticker));
        };
        const alertsList = activeTab === 'ma20' ? getFiltered(data.ma20_alerts) :
                           activeTab === 'vcp'  ? getFiltered(data.vcp_alerts)  :
                           activeTab === 'gmma' ? getFiltered(data.gmma_alerts ?? []) :
                                                  getFiltered(data.gmma_all ?? []);
        if (alertsList.length > 0) {
          handleSelectStock(alertsList[0].ticker, alertsList[0]);
        }
      } else {
        // Clear results if no scan done for this universe
        setResults({
          timestamp: null,
          universe: target,
          scanned_count: 0,
          ma20_alerts: [],
          vcp_alerts: [],
          gmma_alerts: [],
          gmma_all: [],
          message: data.message || `No scan results found for ${target}`
        });
        setSelectedTicker('');
        setHistory([]);
        setSelectedAlertDetails(null);
      }
    } catch (e) {
      console.error("Error fetching latest results:", e);
    }
  };

  // Run initial loads
  useEffect(() => {
    fetchStatus();
    fetchLatestResults(universeMode);
  }, []);

  // Update tab toggle and watchlist selection behavior
  useEffect(() => {
    const list = activeTab === 'ma20' ? filteredMa20Alerts :
                 activeTab === 'vcp'  ? filteredVcpAlerts  :
                 activeTab === 'gmma' ? filteredGmmaAlerts :
                                        filteredGmmaAll;
    if (list && list.length > 0) {
      // Only reset selection if the current selected ticker is not in the filtered list
      const found = list.some(alert => alert.ticker === selectedTicker);
      if (!found) {
        handleSelectStock(list[0].ticker, list[0]);
      }
    } else {
      setSelectedTicker('');
      setHistory([]);
      setSelectedAlertDetails(null);
    }
  }, [activeTab, activeWatchlistId, results]);

  // Keyboard navigation for stock list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in form fields
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const list = activeTab === 'ma20' ? filteredMa20Alerts :
                   activeTab === 'vcp'  ? filteredVcpAlerts  :
                   activeTab === 'gmma' ? filteredGmmaAlerts :
                                          filteredGmmaAll;

      if (!list || list.length === 0) return;

      e.preventDefault(); // Stop default scroll

      const currentIndex = list.findIndex(alert => alert.ticker === selectedTicker);
      let nextIndex = currentIndex;

      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, list.length - 1);
      } else if (e.key === 'ArrowUp') {
        nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
      }

      if (nextIndex !== currentIndex && list[nextIndex]) {
        handleSelectStock(list[nextIndex].ticker, list[nextIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, filteredMa20Alerts, filteredVcpAlerts, filteredGmmaAlerts, filteredGmmaAll, selectedTicker]);

  // Auto-scroll selected row into view (only inside the scrollable table container, to prevent window jump)
  useEffect(() => {
    if (!selectedTicker) return;
    const timer = setTimeout(() => {
      const container = document.querySelector('.table-wrapper') as HTMLElement;
      const selectedRow = document.querySelector('.table-wrapper tr.selected') as HTMLElement;
      if (container && selectedRow) {
        const containerTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const containerBottom = containerTop + containerHeight;

        const rowTop = selectedRow.offsetTop;
        const rowHeight = selectedRow.offsetHeight;
        const rowBottom = rowTop + rowHeight;

        // If row is above container viewport, scroll up to rowTop
        if (rowTop < containerTop) {
          container.scrollTop = rowTop;
        }
        // If row is below container viewport, scroll down so row is fully visible at bottom
        else if (rowBottom > containerBottom) {
          container.scrollTop = rowBottom - containerHeight;
        }
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [selectedTicker]);

  // Poll status when scan is running
  useEffect(() => {
    let interval: any;
    if (status.is_running) {
      interval = setInterval(async () => {
        const curStatus = await fetchStatus();
        if (curStatus && !curStatus.is_running) {
          // Scan just completed
          clearInterval(interval);
          fetchLatestResults(universeMode);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [status.is_running]);

  const handleSelectStock = async (ticker: string, alertDetails: any) => {
    setSelectedTicker(ticker);
    setSelectedAlertDetails(alertDetails);
    setLoadingHistory(true);
    try {
      const res = await fetch(`${BACKEND_URL}/stock/${ticker}/history`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      
      // Structure into candles format
      const formattedCandles: Candle[] = data.dates.map((date: string, i: number) => ({
        time: date,
        open: data.open[i],
        high: data.high[i],
        low: data.low[i],
        close: data.close[i],
        volume: data.volume[i]
      }));
      setHistory(formattedCandles);
    } catch (e) {
      console.error(`Error loading stock history for ${ticker}:`, e);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleRunScan = async () => {
    let payload: Record<string, any>;

    if (universeMode === 'watchlist') {
      // Gather and deduplicate tickers from ALL custom watchlists
      const allTickers = watchlists.flatMap(wl => wl.tickers || []);
      const uniqueTickers = Array.from(new Set(allTickers));
      payload = {
        universe: 'custom',
        custom_tickers: uniqueTickers.length > 0 ? uniqueTickers : null,
      };
    } else {
      // Scan standard universe
      payload = {
        universe: universeMode,
        custom_tickers: null,
      };
    }

    // Merge strategy parameters
    payload = {
      ...payload,
      ma20_tolerance_pct: ma20TolerancePct,
      ma20_min_pullback_days: ma20MinPullbackDays,
      ma20_trend_filter: ma20TrendFilter,
      vcp_trend_template: vcpTrendTemplate,
      vcp_max_tightness_pct: vcpMaxTightnessPct,
      vcp_volume_dryup_pct: vcpVolumeDryupPct,
      vcp_min_contractions: vcpMinContractions,
      vcp_max_contractions: vcpMaxContractions,
      vcp_consolidation_days: vcpConsolidationDays,
      gmma_require_bullish_alignment: gmmaRequireBullishAlignment,
      gmma_crossover_lookback_days: gmmaCrossoverLookbackDays,
      gmma_min_separation_pct: gmmaMinSeparationPct,
    };

    try {
      const isLocal = BACKEND_URL.includes('localhost') || BACKEND_URL.includes('127.0.0.1');
      const url = isLocal ? `${BACKEND_URL}/scan/run` : `${BACKEND_URL}/scan/run?sync=true`;
      
      // Set status to running while waiting
      setStatus({
        is_running: true,
        last_completed: status.last_completed,
        current_universe: universeMode === 'watchlist' ? 'ALL WATCHLISTS' : universeMode.toUpperCase(),
        error: null
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (!isLocal) {
        // For synchronous cloud calls, the results are returned directly
        if (data && data.timestamp) {
          setResults(data);
          setStatus({
            is_running: false,
            last_completed: data.timestamp,
            current_universe: null,
            error: data.error || null
          });
          
          const currentTickers = activeWatchlist?.tickers || [];
          const getFiltered = <T extends { ticker: string }>(alerts: T[]): T[] => {
            if (universeMode !== 'watchlist') return alerts || [];
            if (activeWatchlistId === 'all') return alerts || [];
            return (alerts || []).filter(a => currentTickers.includes(a.ticker));
          };
          const list = activeTab === 'ma20' ? getFiltered(data.ma20_alerts) :
                       activeTab === 'vcp'  ? getFiltered(data.vcp_alerts)  :
                       activeTab === 'gmma' ? getFiltered(data.gmma_alerts ?? []) :
                                              getFiltered(data.gmma_all ?? []);
          if (list && list.length > 0) {
            handleSelectStock(list[0].ticker, list[0]);
          }
        } else {
          // Fallback if cloud call returned something else
          setStatus({
            is_running: false,
            last_completed: status.last_completed,
            current_universe: null,
            error: data.message || 'Scan completed with no results.'
          });
        }
      }
    } catch (e) {
      console.error("Failed to run scan:", e);
      setStatus({
        is_running: false,
        last_completed: status.last_completed,
        current_universe: null,
        error: "Failed to run scan. Connection error."
      });
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toString();
  };

  const formatDateTime = (isoStr: string | null) => {
    if (!isoStr) return 'Never';
    const date = new Date(isoStr);
    return date.toLocaleString();
  };

  // Derive GMMA chart props from the selected alert (if on GMMA/GMMA_all tab)
  const gmmaChartData = (activeTab === 'gmma' || activeTab === 'gmma_all') && selectedAlertDetails
    ? {
        showByDefault: true,
        crossoverDaysAgo: (selectedAlertDetails as GMMAAlert).crossover_days_ago,
        isBullishAligned: (selectedAlertDetails as GMMAAlert).is_bullish_aligned,
      }
    : undefined;

  return (
    <div className={`app-container ${theme}-theme ${showSidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
      <div className="app-layout-wrapper">
        
        {/* Collapsible Left Sidebar */}
        {showSidebar && (
          <aside className="app-sidebar">
            {dashboardMode === 'screener' ? (
              <>
                <div className="sidebar-top-header">
            <h2 className="sidebar-title">Screener Config</h2>
            <button className="sidebar-hide-btn" onClick={() => setShowSidebar(false)} title="Hide Panel">
              ◀ Hide
            </button>
          </div>

          {/* Big Run Scan Button at Top of Left Panel */}
          <div className="sidebar-scan-container">
            <button 
              className="btn btn-scan sidebar-scan-btn" 
              onClick={handleRunScan} 
              disabled={status.is_running}
            >
              {status.is_running ? 'Scanning...' : '🚀 Run Daily Scan'}
            </button>
          </div>

          {/* Sidebar Tabs */}
          <div className="sidebar-tabs-header">
            <button 
              className={`sidebar-tab-btn ${settingsTab === 'screener' ? 'active' : ''}`}
              onClick={() => setSettingsTab('screener')}
            >
              🖥️ Dashboard
            </button>
            <button 
              className={`sidebar-tab-btn ${settingsTab === 'watchlists' ? 'active' : ''}`}
              onClick={() => setSettingsTab('watchlists')}
            >
              📋 Watchlists
            </button>
          </div>

          {/* Scrollable Sidebar Content */}
          <div className="sidebar-content-scrollable">
            {settingsTab === 'screener' ? (
              <div className="sidebar-params-column">
                {/* Section 1: Universe Selection */}
                <div className="sidebar-section">
                  <h3 className="section-title">Universe Selection</h3>
                  <div className="form-group">
                    <label style={{ marginBottom: '4px' }}>Select Universe</label>
                    <select
                      value={universeMode}
                      onChange={(e) => {
                        const newMode = e.target.value as any;
                        setUniverseMode(newMode);
                        fetchLatestResults(newMode);
                      }}
                    >
                      <option value="watchlist">📋 Custom Watchlist</option>
                      <option value="all_index">🇺🇸 All Index (Dow Jones 30 + Nasdaq 100 + S&P 500)</option>
                      <option value="all_usa">🇺🇸 All USA (NASDAQ + NYSE + AMEX)</option>
                      <option value="dow30">🇺🇸 Dow Jones 30</option>
                      <option value="nasdaq100">🇺🇸 Nasdaq 100</option>
                      <option value="sp500">🇺🇸 S&P 500</option>
                      <option value="nasdaq">🇺🇸 Full NASDAQ Exchange</option>
                      <option value="nyse">🇺🇸 Full NYSE Exchange</option>
                      <option value="amex">🇺🇸 AMEX Exchange</option>
                    </select>
                  </div>

                  {universeMode === 'watchlist' ? (
                    <div className="watchlist-dash-selector">
                      <div className="form-group" style={{ marginBottom: '0' }}>
                        <label>Active Watchlist</label>
                        <select 
                          value={activeWatchlistId} 
                          onChange={(e) => setActiveWatchlistId(e.target.value)}
                        >
                          <option value="all">📁 All Watchlists</option>
                          {watchlists.map(wl => (
                            <option key={wl.id} value={wl.id}>
                              {wl.emoji} {wl.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button 
                        className="btn-dash-manage"
                        onClick={() => setSettingsTab('watchlists')}
                        style={{ marginTop: '8px', width: '100%' }}
                      >
                        ✏️ Edit Watchlist Tickers
                      </button>
                    </div>
                  ) : (
                    <div className="all-usa-info">
                      <div className="all-usa-badge">
                        {universeMode === 'all_index' && 'All Index (~630 stocks)'}
                        {universeMode === 'dow30' && 'Dow Jones 30 (~30 stocks)'}
                        {universeMode === 'nasdaq100' && 'Nasdaq 100 (~100 stocks)'}
                        {universeMode === 'sp500' && 'S&P 500 (~500 stocks)'}
                        {universeMode === 'nasdaq' && 'NASDAQ Exchange (~4,000 stocks)'}
                        {universeMode === 'nyse' && 'NYSE Exchange (~2,500 stocks)'}
                        {universeMode === 'amex' && 'AMEX Exchange (~500 stocks)'}
                        {universeMode === 'all_usa' && 'NASDAQ + NYSE + AMEX (~8,000 stocks)'}
                      </div>
                      <p className="all-usa-desc">
                        {universeMode === 'all_index' && 'Moderate scan (~4-6 minutes).'}
                        {universeMode === 'dow30' && 'Very fast scan (~30 seconds).'}
                        {universeMode === 'nasdaq100' && 'Fast scan (~1-2 minutes).'}
                        {universeMode === 'sp500' && 'Moderate scan (~3-5 minutes).'}
                        {universeMode === 'nasdaq' && 'Slow scan (~10-15 minutes).'}
                        {universeMode === 'nyse' && 'Slow scan (~8-12 minutes).'}
                        {universeMode === 'amex' && 'Moderate scan (~2-3 minutes).'}
                        {universeMode === 'all_usa' && 'Very slow scan (~20-40 minutes on first run).'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Section 2: MA20 Params */}
                <div className="sidebar-section">
                  <h3 className="section-title">MA20 Parameters</h3>
                  <div className="form-group">
                    <label>MA20 Touch Tolerance (%)</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={ma20TolerancePct} 
                      onChange={(e) => setMa20TolerancePct(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Min Pullback Days</label>
                    <input 
                      type="number" 
                      value={ma20MinPullbackDays} 
                      onChange={(e) => setMa20MinPullbackDays(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="checkbox-group" onClick={() => setMa20TrendFilter(!ma20TrendFilter)}>
                    <input type="checkbox" checked={ma20TrendFilter} onChange={() => {}} />
                    <label>Filter for Long-term Uptrend</label>
                  </div>
                </div>

                {/* Section 3: VCP Contractions */}
                <div className="sidebar-section">
                  <h3 className="section-title">VCP Contractions</h3>
                  <div className="form-group">
                    <label>Min Contractions (T's)</label>
                    <input 
                      type="number" 
                      value={vcpMinContractions} 
                      onChange={(e) => setVcpMinContractions(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Max Contractions (T's)</label>
                    <input 
                      type="number" 
                      value={vcpMaxContractions} 
                      onChange={(e) => setVcpMaxContractions(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Max Final Tightness (%)</label>
                    <input 
                      type="number" 
                      step="0.5" 
                      value={vcpMaxTightnessPct} 
                      onChange={(e) => setVcpMaxTightnessPct(parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                {/* Section 4: VCP Trend & Volume */}
                <div className="sidebar-section">
                  <h3 className="section-title">VCP Trend &amp; Volume</h3>
                  <div className="form-group">
                    <label>Max Volume Dry-up (%)</label>
                    <input 
                      type="number" 
                      value={vcpVolumeDryupPct} 
                      onChange={(e) => setVcpVolumeDryupPct(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Consolidation Period (Days)</label>
                    <input 
                      type="number" 
                      value={vcpConsolidationDays} 
                      onChange={(e) => setVcpConsolidationDays(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="checkbox-group" onClick={() => setVcpTrendTemplate(!vcpTrendTemplate)}>
                    <input type="checkbox" checked={vcpTrendTemplate} onChange={() => {}} />
                    <label>Enforce Stage 2 Template</label>
                  </div>
                </div>

                {/* Section 5: GMMA Parameters */}
                <div className="sidebar-section">
                  <h3 className="section-title" style={{ color: '#0000FF' }}>GMMA Parameters</h3>
                  <div className="form-group">
                    <label>Crossover Lookback (Days)</label>
                    <input 
                      type="number" 
                      value={gmmaCrossoverLookbackDays} 
                      onChange={(e) => setGmmaCrossoverLookbackDays(parseInt(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Min Group Separation (%)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={gmmaMinSeparationPct} 
                      onChange={(e) => setGmmaMinSeparationPct(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="checkbox-group" onClick={() => setGmmaRequireBullishAlignment(!gmmaRequireBullishAlignment)}>
                    <input type="checkbox" checked={gmmaRequireBullishAlignment} onChange={() => {}} />
                    <label>Require Bullish Alignment</label>
                  </div>
                </div>
              </div>
            ) : (
              /* Dedicated Watchlist Manager tab in sidebar */
              <WatchlistManager 
                watchlists={watchlists}
                activeId={activeWatchlistId === 'all' ? (watchlists[0]?.id || '') : activeWatchlistId}
                onWatchlistsChange={setWatchlists}
                onActiveIdChange={setActiveWatchlistId}
              />
            )}
          </div>
          </>
          ) : dashboardMode === 'portfolio' ? (
            <>
              <div className="sidebar-top-header">
                <h2 className="sidebar-title">Portfolio Config</h2>
                <button className="sidebar-hide-btn" onClick={() => setShowSidebar(false)} title="Hide Panel">
                  ◀ Hide
                </button>
              </div>
              <div className="sidebar-content-scrollable" style={{ padding: '15px 0' }}>
                <PortfolioSidebarConfig refreshDashboard={() => setPortfolioRefreshTrigger(prev => prev + 1)} />
              </div>
            </>
          ) : (
            <TradeLogSidebar
              onTradeSaved={() => {
                setTradeLogRefreshTrigger(prev => prev + 1);
                setPortfolioRefreshTrigger(prev => prev + 1);
              }}
              onHide={() => setShowSidebar(false)}
            />
          )}
        </aside>
      )}

        {/* Right Main Content Panel */}
        <div className="app-main-content">
          {/* Header */}
          <header>
            <div className="header-title-container">
              {/* Show toggle sidebar button only when sidebar is hidden */}
              {!showSidebar && (
                <button className="sidebar-show-btn" onClick={() => setShowSidebar(true)} title="Show Config Panel">
                  ☰ Config
                </button>
              )}
              <div className="logo-icon">S</div>
              <div className="logo-text">
                <h1>My Stock Screener App</h1>
                <p>Stage 2 Uptrends, MA20 Pullbacks, Minervini VCP &amp; GMMA</p>
              </div>
            </div>
            
            <div className="header-controls">
              <button 
                className="theme-toggle-btn"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>

              <div className="scan-status-indicator">
                {status.is_running ? (
                  <>
                    <span className="status-dot running"></span>
                    <span>Scanning {status.current_universe?.toUpperCase()}...</span>
                    <div className="loading-spinner"></div>
                  </>
                ) : (
                  <>
                    <span className="status-dot idle"></span>
                    <span>Ready. Last scan: {formatDateTime(results.timestamp)}</span>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Main Dashboard Navigation Tabs */}
          <div className="dashboard-navigation-tabs">
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'screener' ? 'active' : ''}`}
              onClick={() => setDashboardMode('screener')}
            >
              🔍 Screener Dashboard
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'portfolio' ? 'active' : ''}`}
              onClick={() => setDashboardMode('portfolio')}
            >
              💼 Portfolio Monitoring
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'assetmap' ? 'active' : ''}`}
              onClick={() => setDashboardMode('assetmap')}
            >
              📊 Asset Map
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'tradelog' ? 'active' : ''}`}
              onClick={() => setDashboardMode('tradelog')}
            >
              📒 Trade Log
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'chatbot' ? 'active' : ''}`}
              onClick={() => {
                setDashboardMode('chatbot');
                setShowSidebar(false);
              }}
            >
              🤖 AI Advisor
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'news' ? 'active' : ''}`}
              onClick={() => {
                setDashboardMode('news');
                setShowSidebar(false);
              }}
            >
              📰 News Feed
            </button>
            <button 
              className={`dashboard-nav-tab ${dashboardMode === 'ai-strategy' ? 'active' : ''}`}
              onClick={() => {
                setDashboardMode('ai-strategy');
                setShowSidebar(false);
              }}
              style={{ background: dashboardMode === 'ai-strategy' ? 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.2))' : undefined, borderColor: dashboardMode === 'ai-strategy' ? '#6366f1' : undefined }}
            >
              🧠 AI Strategy
            </button>
          </div>

          {dashboardMode === 'screener' ? (
            <>
              {/* Stats Summary Grid */}
          <div className="summary-grid">
            <div className="glass-panel card card-blue">
              <div className="card-title">Stocks Scanned</div>
              <div className="card-value">{filteredScannedCount}</div>
              <div className="card-desc">Active tickers in selected universe</div>
            </div>
            <div className="glass-panel card card-amber">
              <div className="card-title">MA20 Pullback Alerts</div>
              <div className="card-value">{filteredMa20Alerts.length}</div>
              <div className="card-desc">Touching MA20 support in uptrend</div>
            </div>
            <div className="glass-panel card card-purple">
              <div className="card-title">VCP Pattern Alerts</div>
              <div className="card-value">{filteredVcpAlerts.length}</div>
              <div className="card-desc">Volatility contractions &amp; dry-up</div>
            </div>
            <div className="glass-panel card card-teal">
              <div className="card-title">GMMA Alerts</div>
              <div className="card-value">{filteredGmmaAlerts.length}</div>
              <div className="card-desc">Guppy EMA group crossovers</div>
            </div>
          </div>

          {/* Main Workspace (sticky left results, right chart) */}
          <div className="workspace-grid">
            {/* Left Column: Results Lists */}
            <div className="left-results-panel">
              <div className="glass-panel tabs-container">
                <div className="tabs-header">
                  <button 
                    className={`tab-btn ${activeTab === 'ma20' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ma20')}
                  >
                    MA20 Alerts ({filteredMa20Alerts.length})
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'vcp' ? 'active' : ''}`}
                    onClick={() => setActiveTab('vcp')}
                  >
                    VCP Alerts ({filteredVcpAlerts.length})
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'gmma' ? 'active gmma-active' : ''}`}
                    onClick={() => setActiveTab('gmma')}
                  >
                    GMMA ({filteredGmmaAlerts.length})
                  </button>
                  {filteredGmmaAll && filteredGmmaAll.length > 0 && (
                    <button 
                      className={`tab-btn ${activeTab === 'gmma_all' ? 'active gmma-active' : ''}`}
                      onClick={() => setActiveTab('gmma_all')}
                    >
                      GMMA (all) ({filteredGmmaAll.length})
                    </button>
                  )}
                </div>

                {/* Alert List Table */}
                {activeTab === 'ma20' ? (
                  filteredMa20Alerts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">🔔</div>
                      <h4>No MA20 Pullbacks Found</h4>
                      <p>No stocks fit the pullback setup.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Dist</th>
                            <th>Volume</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMa20Alerts.map((alert) => (
                            <tr 
                              key={alert.ticker}
                              className={selectedTicker === alert.ticker ? 'selected' : ''}
                              onClick={() => handleSelectStock(alert.ticker, alert)}
                            >
                              <td className="ticker-cell">
                                <div className="ticker-symbol">{alert.ticker}</div>
                                {alert.name && <div className="ticker-name">{alert.name}</div>}
                              </td>
                              <td>${alert.close.toFixed(2)}</td>
                              <td className={alert.distance_pct >= 0 ? 'metric-positive' : 'metric-negative'}>
                                {alert.distance_pct >= 0 ? '+' : ''}{alert.distance_pct.toFixed(2)}%
                              </td>
                              <td>{formatNumber(alert.volume)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : activeTab === 'vcp' ? (
                  filteredVcpAlerts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">📈</div>
                      <h4>No VCP Setups Found</h4>
                      <p>No stocks match VCP setup.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Contractions</th>
                            <th>Tight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredVcpAlerts.map((alert) => (
                            <tr 
                              key={alert.ticker}
                              className={selectedTicker === alert.ticker ? 'selected' : ''}
                              onClick={() => handleSelectStock(alert.ticker, alert)}
                            >
                              <td className="ticker-cell">
                                <div className="ticker-symbol">{alert.ticker}</div>
                                {alert.name && <div className="ticker-name">{alert.name}</div>}
                              </td>
                              <td>${alert.close.toFixed(2)}</td>
                              <td style={{ fontSize: '12px' }}>
                                {alert.depths.map(d => `${d.toFixed(0)}%`).join('→')}
                              </td>
                              <td className="metric-positive">{alert.final_tightness.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : activeTab === 'gmma' ? (
                  /* GMMA Tab */
                  filteredGmmaAlerts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">〽️</div>
                      <h4>No GMMA Signals Found</h4>
                      <p>No bullish GMMA crossovers or alignments detected.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Signal</th>
                            <th>Sep%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredGmmaAlerts.map((alert) => (
                            <tr 
                              key={alert.ticker}
                              className={selectedTicker === alert.ticker ? 'selected' : ''}
                              onClick={() => handleSelectStock(alert.ticker, alert)}
                            >
                              <td className="ticker-cell">
                                <div className="ticker-symbol">{alert.ticker}</div>
                                {alert.name && <div className="ticker-name">{alert.name}</div>}
                              </td>
                              <td>${alert.close.toFixed(2)}</td>
                              <td style={{ fontSize: '11px' }}>
                                {alert.had_recent_crossover && (
                                  <span className="gmma-badge gmma-badge-crossover" title={`Crossed ${alert.crossover_days_ago}d ago`}>
                                    ✦ X-over
                                  </span>
                                )}
                                {alert.is_bullish_aligned && (
                                  <span className="gmma-badge gmma-badge-aligned" title="Short group above long group">
                                    ▲ Aligned
                                  </span>
                                )}
                              </td>
                              <td className="metric-positive">{alert.separation_pct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  /* GMMA (all) Tab */
                  filteredGmmaAll.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon">〽️</div>
                      <h4>No Tickers Found</h4>
                      <p>No custom watchlist tickers found or no scan has been performed yet.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Signal</th>
                            <th>Sep%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredGmmaAll.map((alert) => (
                            <tr 
                              key={alert.ticker}
                              className={selectedTicker === alert.ticker ? 'selected' : ''}
                              onClick={() => handleSelectStock(alert.ticker, alert)}
                            >
                              <td className="ticker-cell">
                                <div className="ticker-symbol">{alert.ticker}</div>
                                {alert.name && <div className="ticker-name">{alert.name}</div>}
                              </td>
                              <td>${alert.close.toFixed(2)}</td>
                              <td style={{ fontSize: '11px' }}>
                                {alert.had_recent_crossover && (
                                  <span className="gmma-badge gmma-badge-crossover" title={`Crossed ${alert.crossover_days_ago}d ago`}>
                                    ✦ X-over
                                  </span>
                                )}
                                {alert.is_bullish_aligned && (
                                  <span className="gmma-badge gmma-badge-aligned" title="Short group above long group">
                                    ▲ Aligned
                                  </span>
                                )}
                                {!alert.is_bullish_aligned && !alert.had_recent_crossover && (
                                  <span className="gmma-badge gmma-badge-bearish" title="Short group below long group">
                                    ▼ Bearish
                                  </span>
                                )}
                              </td>
                              <td className={alert.separation_pct >= 0 ? 'metric-positive' : 'metric-negative'}>
                                {alert.separation_pct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Right Column: Chart */}
            <div className="right-chart-panel">
              {selectedTicker ? (
                <div className="chart-panel-container">
                  {/* GMMA Detail Card — shown on both GMMA and GMMA (all) tabs when selectedAlertDetails is a real GMMA alert */}
                  {(activeTab === 'gmma' || activeTab === 'gmma_all') && selectedAlertDetails && 'short_ema_values' in selectedAlertDetails && (
                    <div className="glass-panel gmma-detail-card">
                      <div className="gmma-detail-top-row">
                        <div className="gmma-detail-header">
                          <span className="gmma-detail-ticker">{selectedAlertDetails.ticker}</span>
                          <span className="gmma-detail-name">{selectedAlertDetails.name}</span>
                        </div>
                        <div className="gmma-detail-row">
                          <div className="gmma-detail-item">
                            <span className="gmma-detail-label">Alignment</span>
                            <span className={`gmma-detail-value ${selectedAlertDetails.is_bullish_aligned ? 'metric-positive' : 'metric-negative'}`}>
                              {selectedAlertDetails.is_bullish_aligned ? '▲ Bullish' : '▼ Bearish'}
                            </span>
                          </div>
                          <div className="gmma-detail-item">
                            <span className="gmma-detail-label">Crossover</span>
                            <span className="gmma-detail-value" style={{ color: '#0000FF' }}>
                              {selectedAlertDetails.had_recent_crossover
                                ? `${selectedAlertDetails.crossover_days_ago}d ago`
                                : '—'}
                            </span>
                          </div>
                          <div className="gmma-detail-item">
                            <span className="gmma-detail-label">Group Sep.</span>
                            <span className={`gmma-detail-value ${selectedAlertDetails.separation_pct >= 0 ? 'metric-positive' : 'metric-negative'}`}>
                              {selectedAlertDetails.separation_pct?.toFixed(2) ?? '—'}%
                            </span>
                          </div>
                          <div className="gmma-detail-item">
                            <span className="gmma-detail-label">Volume</span>
                            <span className="gmma-detail-value">
                              {formatNumber(selectedAlertDetails.volume)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* EMA group value pills */}
                      <div className="gmma-ema-groups">
                        <div className="gmma-ema-group">
                          <span className="gmma-group-label" style={{ color: '#0000FF' }}>Short (Traders)</span>
                          <div className="gmma-ema-pills">
                            {selectedAlertDetails.short_ema_values && Object.entries(selectedAlertDetails.short_ema_values).map(([period, val]) => (
                              <span key={period} className="gmma-ema-pill gmma-pill-short">
                                EMA{period}: ${(val as number).toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="gmma-ema-group">
                          <span className="gmma-group-label" style={{ color: '#FF0000' }}>Long (Investors)</span>
                          <div className="gmma-ema-pills">
                            {selectedAlertDetails.long_ema_values && Object.entries(selectedAlertDetails.long_ema_values).map(([period, val]) => (
                              <span key={period} className="gmma-ema-pill gmma-pill-long">
                                EMA{period}: ${(val as number).toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ position: 'relative' }}>
                    {loadingHistory && (
                      <div className="chart-loading-overlay">
                        <div className="loading-spinner" style={{ width: '35px', height: '35px' }}></div>
                      </div>
                    )}
                    {history.length > 0 && (
                      <ChartPanel
                        ticker={selectedTicker}
                        candles={history}
                        highlightDate={activeTab === 'ma20' ? history[history.length - 1]?.time : undefined}
                        vcpContractions={activeTab === 'vcp' ? selectedAlertDetails?.contractions : undefined}
                        gmmaData={gmmaChartData}
                        theme={theme}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-panel empty-state" style={{ height: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div className="empty-state-icon">📊</div>
                  <h4>No Stock Selected</h4>
                  <p>Select a stock from the left list to load the chart.</p>
                </div>
              )}
            </div>
          </div>
          </>
          ) : dashboardMode === 'portfolio' ? (
            <PortfolioDashboard 
              theme={theme}
              refreshKey={portfolioRefreshTrigger}
              onSelectTicker={(ticker) => {
                const allAlerts = [
                  ...results.ma20_alerts,
                  ...results.vcp_alerts,
                  ...(results.gmma_alerts ?? [])
                ];
                const matchingAlert = allAlerts.find(a => a.ticker === ticker);
                if (matchingAlert) {
                  const isMa20 = results.ma20_alerts.some(a => a.ticker === ticker);
                  const isVcp = results.vcp_alerts.some(a => a.ticker === ticker);
                  const isGmma = (results.gmma_alerts ?? []).some(a => a.ticker === ticker);
                  if (isMa20) setActiveTab('ma20');
                  else if (isVcp) setActiveTab('vcp');
                  else if (isGmma) setActiveTab('gmma');
                  handleSelectStock(ticker, matchingAlert);
                } else {
                  handleSelectStock(ticker, { ticker });
                }
              }}
              onSwitchToScreener={() => setDashboardMode('screener')}
            />
          ) : dashboardMode === 'assetmap' ? (
            <AssetAllocationMap refreshKey={portfolioRefreshTrigger} />
          ) : dashboardMode === 'tradelog' ? (
            <TradeLog
              refreshKey={tradeLogRefreshTrigger}
              onSwitchToPortfolio={() => setDashboardMode('portfolio')}
            />
          ) : dashboardMode === 'news' ? (
            <NewsPanel theme={theme} />
          ) : dashboardMode === 'ai-strategy' ? (
            <AIStrategyProposal theme={theme} />
          ) : (
            <AIChatbot theme={theme} />
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
