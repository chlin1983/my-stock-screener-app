import React, { useState, useRef, useEffect } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  risk_flags?: string[];
}

interface AIChatbotProps {
  theme?: 'dark' | 'light';
}

export const AIChatbot: React.FC<AIChatbotProps> = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('ag_chat_messages');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        role: 'model',
        content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
      }
    ];
  });
  
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeRiskFlags, setActiveRiskFlags] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Save chat to localStorage
  useEffect(() => {
    localStorage.setItem('ag_chat_messages', JSON.stringify(messages));
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: textToSend
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Build history payload for backend
      const payloadHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history: payloadHistory
        })
      });

      if (!res.ok) {
        throw new Error('Failed to get response from AI');
      }

      const data = await res.json();
      
      const assistantMessage: ChatMessage = {
        role: 'model',
        content: data.reply,
        risk_flags: data.risk_flags || []
      };

      setMessages(prev => [...prev, assistantMessage]);
      if (data.risk_flags && data.risk_flags.length > 0) {
        setActiveRiskFlags(data.risk_flags);
      }
    } catch (e: any) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          content: "❌ **Error connecting to AI Advisor.** Please check that the backend server is running and your Gemini API key is correct."
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (actionText: string) => {
    handleSendMessage(actionText);
  };

  const handleClearChat = () => {
    if (window.confirm("Are you sure you want to reset the chat conversation?")) {
      const defaultState: ChatMessage[] = [
        {
          role: 'model',
          content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
        }
      ];
      setMessages(defaultState);
      setActiveRiskFlags([]);
    }
  };

  const renderMessageContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      let content = line;
      
      // Headers
      if (line.startsWith('### ')) {
        return <h3 key={idx} style={{ marginTop: '14px', marginBottom: '8px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-secondary)' }}>{line.replace('### ', '')}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={idx} style={{ marginTop: '18px', marginBottom: '10px', fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{line.replace('## ', '')}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={idx} style={{ marginTop: '20px', marginBottom: '12px', fontSize: '1.35rem', fontWeight: 800 }}>{line.replace('# ', '')}</h1>;
      }
      
      // List items
      const isListItem = line.startsWith('- ') || line.startsWith('* ');
      if (isListItem) {
        content = line.substring(2);
      }

      // Regex for **bold**
      const parts = [];
      let currentIdx = 0;
      const regex = /\*\*(.*?)\*\*/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match.index > currentIdx) {
          parts.push(content.substring(currentIdx, match.index));
        }
        parts.push(<strong key={match.index} style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{match[1]}</strong>);
        currentIdx = regex.lastIndex;
      }
      if (currentIdx < content.length) {
        parts.push(content.substring(currentIdx));
      }

      if (isListItem) {
        return (
          <li key={idx} style={{ marginLeft: '16px', listStyleType: 'disc', marginBottom: '6px', color: 'var(--color-text-main)', fontSize: '14px', lineHeight: '1.6' }}>
            {parts.length > 0 ? parts : content}
          </li>
        );
      }

      return (
        <p key={idx} style={{ marginBottom: '8px', minHeight: '1.1em', fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
          {parts.length > 0 ? parts : content}
        </p>
      );
    });
  };

  const quickPrompts = [
    "📊 Analyse my current portfolio risk",
    "💡 What is my biggest investment risk right now?",
    "📈 Should I buy more of my current holdings?",
    "📒 Review my recent trade activities"
  ];

  return (
    <div className="portfolio-dashboard-wrapper" style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Risk Alert Header (if any warning flags from the last turn) */}
      {activeRiskFlags.length > 0 && (
        <div className="glass-panel" style={{ borderLeft: '4px solid var(--color-warning)', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)', fontWeight: 700 }}>
            <span>🚨 Risk Advisory Warnings:</span>
            <button 
              onClick={() => setActiveRiskFlags([])} 
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-text-dark)', cursor: 'pointer', fontSize: '11px' }}
            >
              Clear Warnings ✕
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {activeRiskFlags.map((flag, idx) => (
              <div key={idx} style={{ fontSize: '13px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--color-warning)' }}>•</span> {flag}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat Area Panel */}
      <div className="glass-panel" style={{ flex: 1, padding: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Chat Title bar */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--glass-highlight)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🤖</span>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Antigravity AI Advisor</h3>
              <p style={{ fontSize: '11px', color: 'var(--color-text-dark)' }}>Powered by Gemini 2.0 Flash · Risk Guardian</p>
            </div>
          </div>
          <button
            onClick={handleClearChat}
            style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: '6px', color: 'var(--color-text-main)', transition: 'var(--transition-smooth)' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-danger-glow)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
          >
            Reset Chat 🔄
          </button>
        </div>

        {/* Message Logs */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg, i) => (
            <div 
              key={i} 
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                alignItems: 'flex-start',
                gap: '8px'
              }}
            >
              {msg.role !== 'user' && (
                <div style={{ fontSize: '1.3rem', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--glass-border)' }}>
                  🤖
                </div>
              )}
              <div 
                className="chat-bubble"
                style={{
                  maxWidth: '80%',
                  padding: '12px 16px',
                  borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--glass-border)',
                  boxShadow: msg.role === 'user' ? '0 4px 14px var(--accent-primary-glow)' : 'none',
                  color: msg.role === 'user' ? '#ffffff' : 'var(--color-text-main)'
                }}
              >
                {/* Adjust text colors inside user bubble for readability */}
                {msg.role === 'user' ? (
                  <p style={{ fontSize: '14px', margin: '0', color: '#ffffff', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{msg.content}</p>
                ) : (
                  <div>{renderMessageContent(msg.content)}</div>
                )}

                {/* Specific Risk chips inside the AI bubble if present */}
                {msg.risk_flags && msg.risk_flags.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {msg.risk_flags.map((flag, idx) => (
                      <span 
                        key={idx} 
                        style={{ fontSize: '11px', background: 'var(--color-warning-glow)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}
                      >
                        ⚠️ {flag.split(' ').slice(0, 3).join(' ')}...
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '1.3rem', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--glass-border)' }}>
                🤖
              </div>
              <div 
                style={{
                  padding: '12px 20px',
                  borderRadius: '18px 18px 18px 4px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--glass-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <div className="typing-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-primary)', animation: 'typingBounce 1.4s infinite ease-in-out' }}></div>
                <div className="typing-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-primary)', animation: 'typingBounce 1.4s infinite ease-in-out 0.2s' }}></div>
                <div className="typing-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-primary)', animation: 'typingBounce 1.4s infinite ease-in-out 0.4s' }}></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick action prompts */}
        <div style={{ padding: '8px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid var(--glass-border)' }}>
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              disabled={loading}
              onClick={() => handleQuickAction(qp.substring(2))}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: '20px',
                color: 'var(--color-text-muted)',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'var(--transition-smooth)'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.borderColor = 'var(--accent-primary)';
                  e.currentTarget.style.color = 'var(--accent-primary)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--glass-border)';
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }}
            >
              {qp}
            </button>
          ))}
        </div>

        {/* Input area */}
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }}
          style={{ padding: '16px 20px', display: 'flex', gap: '10px', background: 'var(--glass-highlight)' }}
        >
          <input
            type="text"
            placeholder={loading ? "AI is thinking..." : "Type your investment question (e.g. Should I sell ASML?)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: 'var(--bg-primary)',
              color: 'var(--color-text-main)',
              fontSize: '14px',
              outline: 'none'
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent-primary)',
              color: '#ffffff',
              fontWeight: 600,
              cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
              opacity: (loading || !input.trim()) ? 0.6 : 1,
              transition: 'var(--transition-smooth)'
            }}
          >
            Send ⚡
          </button>
        </form>
      </div>

      {/* Typing animation style injected */}
      <style>{`
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
};
