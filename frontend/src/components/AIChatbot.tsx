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

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeRiskFlags: string[];
  createdAt: number;
}

const EMPTY_MESSAGES: ChatMessage[] = [];

export const AIChatbot: React.FC<AIChatbotProps> = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Active session helper derived values
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession ? activeSession.messages : EMPTY_MESSAGES;
  const activeRiskFlags = activeSession ? activeSession.activeRiskFlags : [];

  // Load chat sessions from backend, with legacy migration
  useEffect(() => {
    const loadSessions = async () => {
      setLoadingSessions(true);
      try {
        const res = await fetch(`${BACKEND_URL}/ai/chat/sessions`);
        if (res.ok) {
          const data = await res.json();
          let loadedSessions = data.sessions || [];

          // Migrate legacy localStorage messages if backend has no sessions
          if (loadedSessions.length === 0) {
            const legacyChat = localStorage.getItem('ag_chat_messages');
            if (legacyChat) {
              try {
                const parsedMessages = JSON.parse(legacyChat);
                if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
                  const firstUserMsg = parsedMessages.find((m: any) => m.role === 'user');
                  const title = firstUserMsg
                    ? (firstUserMsg.content.length > 30 ? firstUserMsg.content.substring(0, 30) + '...' : firstUserMsg.content)
                    : "Migrated Conversation";

                  const newSession: ChatSession = {
                    id: Date.now().toString(),
                    title,
                    messages: parsedMessages,
                    activeRiskFlags: [],
                    createdAt: Date.now()
                  };
                  loadedSessions = [newSession];

                  // Sync to backend immediately
                  await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessions: loadedSessions })
                  });
                  localStorage.removeItem('ag_chat_messages');
                }
              } catch (err) {
                console.error("Error migrating legacy chat:", err);
              }
            }
          }

          // If still empty, create default conversation
          if (loadedSessions.length === 0) {
            const defaultSession: ChatSession = {
              id: Date.now().toString(),
              title: "New Conversation",
              messages: [
                {
                  role: 'model',
                  content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
                }
              ],
              activeRiskFlags: [],
              createdAt: Date.now()
            };
            loadedSessions = [defaultSession];
            await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessions: loadedSessions })
            });
          }

          setSessions(loadedSessions);

          const savedActiveId = localStorage.getItem('ag_chat_active_session_id');
          if (savedActiveId && loadedSessions.some((s: ChatSession) => s.id === savedActiveId)) {
            setActiveSessionId(savedActiveId);
          } else {
            setActiveSessionId(loadedSessions[0].id);
          }
        }
      } catch (e) {
        console.error("Failed to load chat sessions:", e);
      } finally {
        setLoadingSessions(false);
      }
    };

    loadSessions();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || loading || !activeSessionId) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: textToSend
    };

    let updatedSessions = sessions.map(s => {
      if (s.id === activeSessionId) {
        const nextMessages = [...s.messages, userMessage];
        let title = s.title;
        if (s.title === "New Conversation") {
          title = textToSend.length > 25 ? textToSend.substring(0, 25) + '...' : textToSend;
        }
        return {
          ...s,
          title,
          messages: nextMessages
        };
      }
      return s;
    });

    setSessions(updatedSessions);
    setInput('');
    setLoading(true);

    try {
      const currentSession = updatedSessions.find(s => s.id === activeSessionId)!;
      const payloadHistory = currentSession.messages.slice(0, -1).map(m => ({
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

      updatedSessions = updatedSessions.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: [...s.messages, assistantMessage],
            activeRiskFlags: data.risk_flags || []
          };
        }
        return s;
      });

      setSessions(updatedSessions);

      await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: updatedSessions })
      });
    } catch (e: any) {
      console.error(e);
      updatedSessions = updatedSessions.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: [
              ...s.messages,
              {
                role: 'model',
                content: "❌ **Error connecting to AI Advisor.** Please check that the backend server is running and your Gemini API key is correct."
              }
            ]
          };
        }
        return s;
      });
      setSessions(updatedSessions);
      await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: updatedSessions })
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: "New Conversation",
      messages: [
        {
          role: 'model',
          content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
        }
      ],
      activeRiskFlags: [],
      createdAt: Date.now()
    };
    
    const updatedSessions = [newSession, ...sessions];
    setSessions(updatedSessions);
    setActiveSessionId(newSession.id);
    localStorage.setItem('ag_chat_active_session_id', newSession.id);
    
    try {
      await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: updatedSessions })
      });
    } catch (e) {
      console.error("Failed to save new session:", e);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this chat conversation?")) return;
    
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(updatedSessions);
    
    let nextActiveId = activeSessionId;
    if (activeSessionId === sessionId) {
      nextActiveId = updatedSessions.length > 0 ? updatedSessions[0].id : null;
      setActiveSessionId(nextActiveId);
      if (nextActiveId) {
        localStorage.setItem('ag_chat_active_session_id', nextActiveId);
      } else {
        localStorage.removeItem('ag_chat_active_session_id');
      }
    }
    
    if (updatedSessions.length === 0) {
      const defaultSession: ChatSession = {
        id: Date.now().toString(),
        title: "New Conversation",
        messages: [
          {
            role: 'model',
            content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
          }
        ],
        activeRiskFlags: [],
        createdAt: Date.now()
      };
      const finalSessions = [defaultSession];
      setSessions(finalSessions);
      setActiveSessionId(defaultSession.id);
      localStorage.setItem('ag_chat_active_session_id', defaultSession.id);
      
      try {
        await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessions: finalSessions })
        });
      } catch (err) {
        console.error("Failed to save default session:", err);
      }
    } else {
      try {
        await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessions: updatedSessions })
        });
      } catch (err) {
        console.error("Failed to save sessions after deletion:", err);
      }
    }
  };

  const handleQuickAction = (actionText: string) => {
    handleSendMessage(actionText);
  };

  const handleClearChat = async () => {
    if (!activeSessionId) return;
    if (window.confirm("Are you sure you want to reset this chat conversation?")) {
      const updatedSessions: ChatSession[] = sessions.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            title: "New Conversation",
            messages: [
              {
                role: 'model' as const,
                content: "🤖 **Welcome to Antigravity AI Advisor!**\n\nI am your conservative, risk-averse investment companion. I scan your **portfolio holdings** and **trade logs** to help protect your capital and guide you toward premium setups (like MA20 Pullbacks and Volatility Contraction Patterns).\n\nHow can I help you today? Try clicking one of the quick analysis chips below to inspect your current risks."
              }
            ],
            activeRiskFlags: []
          };
        }
        return s;
      });
      setSessions(updatedSessions);
      
      try {
        await fetch(`${BACKEND_URL}/ai/chat/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessions: updatedSessions })
        });
      } catch (err) {
        console.error("Failed to save reset session:", err);
      }
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
              onClick={() => {
                const updated = sessions.map(s => s.id === activeSessionId ? { ...s, activeRiskFlags: [] } : s);
                setSessions(updated);
                fetch(`${BACKEND_URL}/ai/chat/sessions`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessions: updated })
                }).catch(console.error);
              }} 
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

      {/* Main Two-Column Layout */}
      <div style={{ flex: 1, display: 'flex', gap: '16px', overflow: 'hidden', minHeight: 0 }}>
        
        {/* Left Sidebar: Chat History List */}
        <div 
          className="glass-panel" 
          style={{ 
            width: '280px', 
            padding: '16px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '14px', 
            overflow: 'hidden'
          }}
        >
          {/* New Chat Button */}
          <button
            onClick={handleNewChat}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px var(--accent-primary-glow)',
              transition: 'var(--transition-smooth)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 16px var(--accent-primary-glow)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 12px var(--accent-primary-glow)';
            }}
          >
            <span>💬</span> New Chat ➕
          </button>

          {/* Sessions List */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
            {loadingSessions ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', color: 'var(--color-text-dark)', fontSize: '13px' }}>
                Loading conversations...
              </div>
            ) : (
              sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveSessionId(s.id);
                      localStorage.setItem('ag_chat_active_session_id', s.id);
                    }}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: isActive ? 'var(--glass-highlight)' : 'transparent',
                      border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'var(--transition-smooth)',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = isActive ? 'var(--glass-highlight)' : 'rgba(255,255,255,0.02)';
                      if (!isActive) e.currentTarget.style.borderColor = 'var(--glass-border)';
                      const deleteBtn = e.currentTarget.querySelector('.delete-session-btn') as HTMLElement;
                      if (deleteBtn) deleteBtn.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = isActive ? 'var(--glass-highlight)' : 'transparent';
                      if (!isActive) e.currentTarget.style.borderColor = 'transparent';
                      const deleteBtn = e.currentTarget.querySelector('.delete-session-btn') as HTMLElement;
                      if (deleteBtn) deleteBtn.style.opacity = '0';
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden', flex: 1, marginRight: '8px' }}>
                      <div 
                        style={{ 
                          fontSize: '13px', 
                          fontWeight: isActive ? 600 : 400, 
                          color: isActive ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        💬 {s.title}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-dark)' }}>
                        {new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <button
                      className="delete-session-btn"
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      title="Delete conversation"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-danger)',
                        cursor: 'pointer',
                        padding: '4px',
                        fontSize: '13px',
                        opacity: 0,
                        transition: 'opacity 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Chat Area Panel */}
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
