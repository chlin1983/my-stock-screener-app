import React, { useState, useEffect } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

interface EarningsCalendarProps {
  watchlists: any[];
  onSelectTicker: (ticker: string) => void;
}

export const EarningsCalendar: React.FC<EarningsCalendarProps> = ({ watchlists, onSelectTicker }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [earningsData, setEarningsData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [tickerNames, setTickerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedDateStr) {
      const tickersForDate = Object.entries(earningsData)
        .filter(([_, dateStr]) => dateStr === selectedDateStr)
        .map(([ticker]) => ticker);
        
      tickersForDate.forEach((t) => {
        setTickerNames(prev => {
          if (prev[t]) return prev;
          
          fetch(`${BACKEND_URL}/stock/${t}/details`)
            .then(res => res.json())
            .then(data => {
              if (data.name) {
                setTickerNames(p => ({ ...p, [t]: data.name }));
              }
            })
            .catch(() => console.error('Failed to fetch name for', t));
            
          return { ...prev, [t]: 'Loading...' };
        });
      });
    }
  }, [selectedDateStr, earningsData]);

  const fetchEarnings = async () => {
    setLoading(true);
    try {
      // Collect tickers from watchlists
      const tickerSet = new Set<string>();
      watchlists.forEach(wl => {
        if (Array.isArray(wl.tickers)) {
          wl.tickers.forEach((t: string) => tickerSet.add(t));
        }
      });
      
      // Also try to get portfolio tickers
      try {
        const pcfgRes = await fetch(`${BACKEND_URL}/portfolio/config`);
        if (pcfgRes.ok) {
          const pcfg = await pcfgRes.json();
          if (pcfg.holdings && Array.isArray(pcfg.holdings)) {
            pcfg.holdings.forEach((h: any) => {
              if (h.ticker) tickerSet.add(h.ticker);
            });
          }
        }
      } catch (e) {
        console.error("Failed to fetch portfolio tickers", e);
      }

      const tickers = Array.from(tickerSet).join(',');
      if (!tickers) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/earnings-calendar?tickers=${tickers}`);
      if (res.ok) {
        const data = await res.json();
        setEarningsData(data);
      }
    } catch (e) {
      console.error("Error fetching earnings calendar", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEarnings();
  }, [watchlists]);

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  // Build calendar grid
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Group tickers by date (YYYY-MM-DD)
  const tickersByDate: Record<string, string[]> = {};
  Object.entries(earningsData).forEach(([ticker, dateStr]) => {
    if (dateStr) {
      if (!tickersByDate[dateStr]) tickersByDate[dateStr] = [];
      tickersByDate[dateStr].push(ticker);
    }
  });

  const cells = [];
  // Empty cells before start of month (Mon-Fri)
  const emptyCellsCount = firstDay === 0 || firstDay === 6 ? 0 : firstDay - 1;
  for (let i = 0; i < emptyCellsCount; i++) {
    cells.push(<div key={`empty-${i}`} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', opacity: 0.3, borderRadius: 8 }} />);
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Sun/Sat
    
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tickers = tickersByDate[dateStr] || [];
    const isToday = new Date().toDateString() === d.toDateString();
    
    cells.push(
      <div key={`day-${day}`} style={{ 
        background: isToday ? 'rgba(0, 168, 255, 0.05)' : 'var(--glass-bg)', 
        border: isToday ? '1px solid rgba(0, 168, 255, 0.4)' : '1px solid var(--glass-border)',
        borderRadius: 8,
        padding: 8,
        minHeight: 120,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div 
          onClick={() => setSelectedDateStr(dateStr)}
          style={{ 
            fontWeight: 600, 
            color: isToday ? '#00a8ff' : 'var(--color-text-muted)', 
            marginBottom: 8, 
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-block',
            width: 'fit-content'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = 'var(--color-text-dark)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = isToday ? '#00a8ff' : 'var(--color-text-muted)'; }}
        >
          {day}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, flex: 1, alignContent: 'start', overflowY: 'auto' }}>
          {tickers.map(t => (
            <div 
              key={t}
              onClick={() => onSelectTicker(t)}
              style={{ 
                background: 'rgba(255,255,255,0.06)', 
                padding: '6px 8px', 
                borderRadius: 4,
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-block',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--color-text-dark)',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selectedDateStr) {
    const tickers = [...(tickersByDate[selectedDateStr] || [])].sort();
    const dParts = selectedDateStr.split('-');
    const formattedDate = `${monthNames[parseInt(dParts[1]) - 1]} ${parseInt(dParts[2])}, ${dParts[0]}`;

    return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 16 }}>
          <button 
            onClick={() => setSelectedDateStr(null)}
            style={{ 
              background: 'var(--glass-bg)', 
              border: '1px solid var(--glass-border)', 
              color: 'var(--color-text-dark)', 
              cursor: 'pointer', 
              padding: '8px 16px', 
              borderRadius: 8,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-bg)'; }}
          >
            ← Back to Calendar
          </button>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--color-text-dark)' }}>
            Earnings on {formattedDate}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {tickers.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', gridColumn: '1 / -1' }}>No earnings reports for this date.</div>
          ) : (
            tickers.map(t => (
              <div 
                key={t}
                onClick={() => onSelectTicker(t)}
                style={{ 
                  background: 'rgba(255,255,255,0.06)', 
                  padding: '16px 20px', 
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.1)',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }} title={tickerNames[t] && tickerNames[t] !== 'Loading...' ? tickerNames[t] : t}>
                  {tickerNames[t] && tickerNames[t] !== 'Loading...' ? tickerNames[t] : '...'}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-main)', textAlign: 'right' }}>
                  {t}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--color-text-dark)' }}>Earnings Calendar</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>Upcoming earnings reports for your watchlists and portfolio</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {loading && <div style={{ fontSize: 13, color: '#00a8ff', fontWeight: 500, animation: 'pulse 1.5s infinite' }}>Updating...</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--glass-bg)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
            <button onClick={prevMonth} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-dark)', cursor: 'pointer', fontSize: 16, padding: '4px 8px', fontWeight: 700 }}>&lt;</button>
            <div style={{ fontWeight: 600, width: 140, textAlign: 'center', color: 'var(--color-text-dark)' }}>{monthNames[month]} {year}</div>
            <button onClick={nextMonth} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-dark)', cursor: 'pointer', fontSize: 16, padding: '4px 8px', fontWeight: 700 }}>&gt;</button>
          </div>
        </div>
      </div>
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(5, 1fr)', 
        gap: 8,
        marginBottom: 8
      }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
        ))}
      </div>
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(5, 1fr)', 
        gap: 8,
        flex: 1
      }}>
        {cells}
      </div>
    </div>
  );
};
