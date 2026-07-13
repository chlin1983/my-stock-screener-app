import { useState, useEffect, useCallback } from 'react';

interface NewsItem {
  id: number;
  title: string;
  summary: string;
  author: string;
  published_at: number;
  image_url: string;
  url: string;
}

interface ArticleDetail {
  id: number;
  title: string;
  content: string;
  summary: string;
  author: string;
  published_at: number;
  image_url: string;
  url: string;
}

interface NewsPanelProps {
  theme: 'dark' | 'light';
}

export function NewsPanel({ theme: _theme }: NewsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<'global' | 'shares' | 'ai' | 'favorites'>('global');
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ArticleDetail | null>(null);
  const [favorites, setFavorites] = useState<NewsItem[]>([]);
  
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  
  const [countdown, setCountdown] = useState<number>(300); // 5-minute auto refresh
  const [excludeChina, setExcludeChina] = useState<boolean>(false);

  const BACKEND_URL = (window as any).__env__?.VITE_BACKEND_URL || import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

  const fetchFavorites = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/news/favorites`);
      if (!response.ok) throw new Error('Failed to load favorites');
      const data = await response.json();
      setFavorites(data);
    } catch (err) {
      console.error('Error fetching favorites:', err);
    }
  }, [BACKEND_URL]);

  const fetchNewsList = useCallback(async (cat: 'global' | 'shares' | 'ai' | 'favorites', noChina: boolean = false) => {
    setLoadingList(true);
    setErrorList(null);
    try {
      if (cat === 'favorites') {
        const response = await fetch(`${BACKEND_URL}/news/favorites`);
        if (!response.ok) {
          throw new Error('Failed to load favorite articles.');
        }
        const data = await response.json();
        setArticles(data);
        if (data.length > 0 && !selectedArticleId) {
          setSelectedArticleId(data[0].id);
        }
      } else {
        const response = await fetch(`${BACKEND_URL}/news/list?category=${cat}&exclude_china=${noChina}`);
        if (!response.ok) {
          throw new Error('Failed to load articles from the server.');
        }
        const data = await response.json();
        setArticles(data);
        if (data.length > 0 && !selectedArticleId) {
          setSelectedArticleId(data[0].id);
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorList(err.message || 'Error fetching articles.');
    } finally {
      setLoadingList(false);
    }
  }, [BACKEND_URL, selectedArticleId]);

  const fetchArticleDetail = useCallback(async (id: number) => {
    // 1. Check if the article is already fully loaded locally (e.g. from Favorites tab)
    const localMatch = articles.find(a => a.id === id) as any;
    if (localMatch && localMatch.content) {
      setSelectedArticle(localMatch);
      return;
    }

    // 2. Check in our loaded favorites list
    const favMatch = favorites.find(a => a.id === id) as any;
    if (favMatch && favMatch.content) {
      setSelectedArticle(favMatch);
      return;
    }

    setLoadingDetail(true);
    setErrorDetail(null);
    try {
      const response = await fetch(`${BACKEND_URL}/news/article/${id}`);
      if (!response.ok) {
        // Fallback: search in loaded favorites
        if (favMatch) {
          setSelectedArticle(favMatch);
          return;
        }
        throw new Error('Failed to fetch article details.');
      }
      const data = await response.json();
      setSelectedArticle(data);
    } catch (err: any) {
      console.error(err);
      // Fallback: search in loaded favorites
      if (favMatch) {
        setSelectedArticle(favMatch);
      } else {
        setErrorDetail(err.message || 'Error loading article content.');
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [BACKEND_URL, articles, favorites]);

  const toggleFavorite = async (article: ArticleDetail) => {
    if (!article) return;
    const isFav = favorites.some(fav => fav.id === article.id);
    
    try {
      if (isFav) {
        const response = await fetch(`${BACKEND_URL}/news/favorites/${article.id}`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to remove favorite');
        
        setFavorites(prev => prev.filter(fav => fav.id !== article.id));
        
        if (activeCategory === 'favorites') {
          const updatedArticles = articles.filter(a => a.id !== article.id);
          setArticles(updatedArticles);
          if (updatedArticles.length > 0) {
            setSelectedArticleId(updatedArticles[0].id);
          } else {
            setSelectedArticleId(null);
            setSelectedArticle(null);
          }
        }
      } else {
        const response = await fetch(`${BACKEND_URL}/news/favorites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(article)
        });
        if (!response.ok) throw new Error('Failed to save favorite');
        
        const result = await response.json();
        setFavorites(prev => [...prev, result.article]);
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  // Load favorites list on component mount
  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  // Load list when category OR excludeChina changes
  useEffect(() => {
    fetchNewsList(activeCategory, excludeChina);
  }, [activeCategory, excludeChina, fetchNewsList]);

  // Load article detail when selected ID changes
  useEffect(() => {
    if (selectedArticleId) {
      fetchArticleDetail(selectedArticleId);
    }
  }, [selectedArticleId, fetchArticleDetail]);

  // Countdown timer for auto-refresh
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchNewsList(activeCategory);
          if (selectedArticleId) {
            fetchArticleDetail(selectedArticleId);
          }
          return 300; // reset
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCategory, excludeChina, selectedArticleId, fetchNewsList, fetchArticleDetail]);

  const handleManualRefresh = () => {
    fetchNewsList(activeCategory, excludeChina);
    if (selectedArticleId) {
      fetchArticleDetail(selectedArticleId);
    }
    setCountdown(300);
  };

  const formatPublishTime = (timestamp: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="news-panel-layout">
      {/* Top Banner with Categories and Info */}
      <div className="news-banner glass-panel">
        <div className="news-categories">
          <button 
            className={`news-cat-tab ${activeCategory === 'global' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('global');
              setSelectedArticleId(null);
              setSelectedArticle(null);
            }}
          >
            🔥 全部快讯
          </button>
          <button 
            className={`news-cat-tab ${activeCategory === 'shares' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('shares');
              setSelectedArticleId(null);
              setSelectedArticle(null);
            }}
          >
            📈 股市见闻
          </button>
          <button 
            className={`news-cat-tab ${activeCategory === 'ai' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('ai');
              setSelectedArticleId(null);
              setSelectedArticle(null);
            }}
          >
            🤖 硬核 AI
          </button>
          <button 
            className={`news-cat-tab ${activeCategory === 'favorites' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('favorites');
              setSelectedArticleId(null);
              setSelectedArticle(null);
            }}
          >
            ⭐ 收藏夹
          </button>
        </div>

        <div className="news-banner-right">
          {/* China filter toggle */}
          <div
            className={`news-china-toggle ${excludeChina ? 'active' : ''}`}
            onClick={() => {
              const next = !excludeChina;
              setExcludeChina(next);
              setSelectedArticleId(null);
              setSelectedArticle(null);
            }}
            title={excludeChina ? 'China news excluded — click to show all' : 'Click to exclude China-related news'}
          >
            <span className="toggle-flag">🇨🇳</span>
            <span className="toggle-label">{excludeChina ? 'China Excluded' : 'Include China'}</span>
            <span className={`toggle-pill ${excludeChina ? 'on' : 'off'}`}></span>
          </div>

          <div className="news-timer-section">
            <span className="news-timer-label">Auto-refresh: <strong>{formatCountdown(countdown)}</strong></span>
            <button className="btn btn-refresh-news" onClick={handleManualRefresh} title="Fetch Latest News">
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace: Two column layout */}
      <div className="news-workspace">
        {/* Left Column: Article list */}
        <div className="news-list-column glass-panel">
          {loadingList ? (
            <div className="news-skeletons">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="news-skeleton-card">
                  <div className="skeleton-image"></div>
                  <div className="skeleton-text-container">
                    <div className="skeleton-title"></div>
                    <div className="skeleton-meta"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : errorList ? (
            <div className="news-error-state">
              <div className="error-icon">⚠️</div>
              <h4>Failed to Load News</h4>
              <p>{errorList}</p>
              <button className="btn" onClick={() => fetchNewsList(activeCategory)}>Retry</button>
            </div>
          ) : articles.length === 0 ? (
            <div className="news-empty-state">
              <div className="empty-icon">📭</div>
              <h4>No news available right now</h4>
              <p>Check back shortly or try changing categories.</p>
            </div>
          ) : (
            <div className="news-scroll-container">
              {articles.map((item) => (
                <div 
                  key={item.id}
                  className={`news-article-card ${selectedArticleId === item.id ? 'active' : ''}`}
                  onClick={() => setSelectedArticleId(item.id)}
                >
                  {item.image_url && (
                    <div className="news-card-thumbnail">
                      <img src={item.image_url} alt="" loading="lazy" />
                    </div>
                  )}
                  <div className="news-card-content">
                    <h4 className="news-card-title">{item.title}</h4>
                    <p className="news-card-summary">{item.summary}</p>
                    <div className="news-card-meta">
                      <span className="news-card-author">👤 {item.author || '见闻君'}</span>
                      <span className="news-card-time">⏰ {formatPublishTime(item.published_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Article detail reader */}
        <div className="news-reader-column glass-panel">
          {loadingDetail ? (
            <div className="article-reader-loading">
              <div className="loading-spinner"></div>
              <p>Fetching full article content...</p>
            </div>
          ) : errorDetail ? (
            <div className="article-reader-error">
              <div className="error-icon">⚠️</div>
              <h4>Failed to Load Article</h4>
              <p>{errorDetail}</p>
              <button 
                className="btn" 
                onClick={() => selectedArticleId && fetchArticleDetail(selectedArticleId)}
              >
                Retry
              </button>
            </div>
          ) : !selectedArticle ? (
            <div className="article-reader-empty">
              <div className="reader-icon">📖</div>
              <h4>No Article Selected</h4>
              <p>Select an article from the left list to read the full story.</p>
            </div>
          ) : (
            <div className="article-reader-scroll">
              <article className="full-article">
                <header className="article-header">
                  <h1 className="article-title">{selectedArticle.title}</h1>
                  <div className="article-meta-row">
                    <div className="article-author-info">
                      {selectedArticle.image_url && (
                        <img 
                          className="author-avatar" 
                          src={selectedArticle.image_url} 
                          alt="" 
                        />
                      )}
                      <span className="author-name">{selectedArticle.author || '华尔街见闻'}</span>
                    </div>
                    <time className="publish-time">
                      发布于: {formatPublishTime(selectedArticle.published_at)}
                    </time>
                    <a 
                      href={selectedArticle.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="origin-link"
                    >
                      🔗 阅读原文
                    </a>
                    <button 
                      onClick={() => toggleFavorite(selectedArticle)}
                      className={`btn-favorite-toggle ${favorites.some(f => f.id === selectedArticle.id) ? 'active' : ''}`}
                      title={favorites.some(f => f.id === selectedArticle.id) ? 'Remove from Favorites' : 'Save to Favorites'}
                    >
                      {favorites.some(f => f.id === selectedArticle.id) ? '⭐ 已收藏' : '☆ 收藏'}
                    </button>
                  </div>
                </header>

                {selectedArticle.summary && (
                  <blockquote className="article-summary-block">
                    <strong>摘要：</strong>{selectedArticle.summary}
                  </blockquote>
                )}

                <div 
                  className="article-body-content"
                  dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
                />
              </article>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
