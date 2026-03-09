import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAllItems, fetchOrders, getTopOrders, getMedianPrice, getRecommendation, getJWT, setJWT, createSellOrder } from './api';
import './App.css';

function App() {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Input mode
  const [inputMode, setInputMode] = useState('search'); // 'search' | 'paste'
  const [pasteText, setPasteText] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // Selected items & results
  const [selectedItems, setSelectedItems] = useState([]);
  const [results, setResults] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // JWT auth
  const [jwtToken, setJwtToken] = useState(getJWT());
  const [jwtInput, setJwtInput] = useState('');
  const [showLogin, setShowLogin] = useState(!getJWT());

  // Sell order form state: keyed by item slug
  const [listingForm, setListingForm] = useState(null); // { slug, price, quantity }
  const [listingStatus, setListingStatus] = useState({}); // { [slug]: { type, message } }

  const handleLogin = useCallback(() => {
    const token = jwtInput.trim();
    if (!token) return;
    setJWT(token);
    setJwtToken(token);
    setJwtInput('');
    setShowLogin(false);
  }, [jwtInput]);

  const handleLogout = useCallback(() => {
    setJWT('');
    setJwtToken('');
    setShowLogin(true);
  }, []);

  const openListingForm = useCallback((item) => {
    setListingForm({
      slug: item.slug,
      itemId: item.id,
      name: item.name,
      price: item.sellMedian || item.platValue || 1,
      quantity: 1,
    });
    setListingStatus((prev) => {
      const next = { ...prev };
      delete next[item.slug];
      return next;
    });
  }, []);

  const submitListing = useCallback(async () => {
    if (!listingForm) return;
    const { slug, itemId, price, quantity } = listingForm;
    setListingStatus((prev) => ({ ...prev, [slug]: { type: 'loading', message: 'Posting...' } }));
    setListingForm(null);

    try {
      await createSellOrder({ itemId, platinum: price, quantity });
      setListingStatus((prev) => ({ ...prev, [slug]: { type: 'success', message: `Listed for ${price}p` } }));
    } catch (err) {
      setListingStatus((prev) => ({ ...prev, [slug]: { type: 'error', message: err.message } }));
    }
  }, [listingForm]);

  // Load all items on mount
  useEffect(() => {
    fetchAllItems()
      .then((items) => {
        setAllItems(items);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Search filtering
  useEffect(() => {
    if (!searchQuery.trim() || !allItems.length) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matches = allItems
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 20);
    setSearchResults(matches);
  }, [searchQuery, allItems]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addItem = useCallback(
    (item) => {
      if (!selectedItems.find((s) => s.slug === item.slug)) {
        setSelectedItems((prev) => [...prev, item]);
      }
      setSearchQuery('');
      setShowDropdown(false);
    },
    [selectedItems]
  );

  const removeItem = useCallback((slug) => {
    setSelectedItems((prev) => prev.filter((i) => i.slug !== slug));
    setResults((prev) => prev.filter((r) => r.slug !== slug));
  }, []);

  const parsePastedItems = useCallback(() => {
    if (!pasteText.trim()) return;
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    const matched = [];
    for (const line of lines) {
      const found = allItems.find(
        (item) =>
          item.name.toLowerCase() === line ||
          item.slug === line.replace(/\s+/g, '_')
      );
      if (found && !selectedItems.find((s) => s.slug === found.slug)) {
        matched.push(found);
      } else if (!found) {
        // Fuzzy: find best partial match
        const fuzzy = allItems.find((item) =>
          item.name.toLowerCase().includes(line)
        );
        if (fuzzy && !selectedItems.find((s) => s.slug === fuzzy.slug) && !matched.find((m) => m.slug === fuzzy.slug)) {
          matched.push(fuzzy);
        }
      }
    }
    setSelectedItems((prev) => [...prev, ...matched]);
    setPasteText('');
  }, [pasteText, allItems, selectedItems]);

  const analyzeItems = useCallback(async () => {
    if (!selectedItems.length) return;
    setAnalyzing(true);
    setResults([]);
    setProgress({ current: 0, total: selectedItems.length });

    const newResults = [];
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      setProgress({ current: i + 1, total: selectedItems.length });

      try {
        const orders = await fetchOrders(item.slug);
        const sellOrders = getTopOrders(orders, 'sell', 5);
        const buyOrders = getTopOrders(orders, 'buy', 5);
        const sellMedian = getMedianPrice(sellOrders);
        const buyMedian = getMedianPrice(buyOrders);
        const platValue = sellMedian || buyMedian;
        const rec = getRecommendation(platValue, item.ducats);

        newResults.push({
          ...item,
          sellOrders,
          buyOrders,
          sellMedian,
          buyMedian,
          platValue,
          recommendation: rec,
        });
      } catch (err) {
        newResults.push({
          ...item,
          sellOrders: [],
          buyOrders: [],
          sellMedian: 0,
          buyMedian: 0,
          platValue: 0,
          recommendation: getRecommendation(0, item.ducats),
          error: err.message,
        });
      }

      // Small delay to avoid rate limiting
      if (i < selectedItems.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    // Sort by recommendation priority, then by plat value desc
    newResults.sort((a, b) => {
      if (a.recommendation.priority !== b.recommendation.priority) {
        return a.recommendation.priority - b.recommendation.priority;
      }
      return b.platValue - a.platValue;
    });

    setResults(newResults);
    setAnalyzing(false);
  }, [selectedItems]);

  const clearAll = useCallback(() => {
    setSelectedItems([]);
    setResults([]);
  }, []);

  if (loading) {
    return (
      <div className="app">
        <div className="loading-screen">
          <div className="spinner" />
          <p>Loading Warframe Market data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="error-screen">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <p className="hint">Make sure the dev server proxy is running (npm run dev)</p>
        </div>
      </div>
    );
  }

  const totalPlat = results.reduce((sum, r) => sum + r.platValue, 0);
  const totalDucats = results.reduce((sum, r) => sum + r.ducats, 0);
  const sellCount = results.filter((r) => r.recommendation.type === 'sell').length;
  const ducatCount = results.filter((r) => r.recommendation.type === 'ducat').length;
  const junkCount = results.filter((r) => r.recommendation.type === 'junk').length;

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">
          <span className="title-accent">WARFRAME</span> INVENTORY CLEANER
        </h1>
        <p className="subtitle">
          Analyze your inventory • Find what to sell, ducat, or trash
        </p>
        <div className="auth-section">
          {jwtToken ? (
            <div className="auth-status">
              <span className="auth-connected">Connected to warframe.market</span>
              <button className="btn-text auth-logout" onClick={handleLogout}>Logout</button>
            </div>
          ) : showLogin ? (
            <div className="auth-login">
              <button className="btn-text auth-toggle" onClick={() => setShowLogin(false)}>
                Login to list items for sale
              </button>
              <div className="auth-form">
                <input
                  type="password"
                  className="auth-input"
                  placeholder="Paste JWT token from warframe.market cookies"
                  value={jwtInput}
                  onChange={(e) => setJwtInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button className="btn btn-primary btn-sm" onClick={handleLogin}>
                  Save
                </button>
              </div>
              <p className="auth-hint">
                DevTools → Application → Cookies → warframe.market → JWT
              </p>
            </div>
          ) : (
            <button className="btn-text auth-toggle" onClick={() => setShowLogin(true)}>
              Login to list items for sale
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {/* Input Section */}
        <section className="input-section">
          <div className="mode-tabs">
            <button
              className={`tab ${inputMode === 'search' ? 'active' : ''}`}
              onClick={() => setInputMode('search')}
            >
              Search & Add
            </button>
            <button
              className={`tab ${inputMode === 'paste' ? 'active' : ''}`}
              onClick={() => setInputMode('paste')}
            >
              Paste List
            </button>
          </div>

          {inputMode === 'search' ? (
            <div className="search-container" ref={searchRef}>
              <input
                type="text"
                className="search-input"
                placeholder="Search items... (e.g. Ash Prime, Nikana, Condition Overload)"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => searchQuery && setShowDropdown(true)}
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="dropdown">
                  {searchResults.map((item) => (
                    <button
                      key={item.slug}
                      className="dropdown-item"
                      onClick={() => addItem(item)}
                    >
                      <span className="dropdown-name">{item.name}</span>
                      <span className="dropdown-meta">
                        {item.ducats > 0 && (
                          <span className="ducat-badge">{item.ducats} duc</span>
                        )}
                        {item.tags.includes('prime') && (
                          <span className="prime-badge">Prime</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="paste-container">
              <textarea
                className="paste-input"
                placeholder="Paste item names, one per line:&#10;&#10;Ash Prime Set&#10;Nikana Prime Blueprint&#10;Condition Overload&#10;..."
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
              />
              <button className="btn btn-secondary" onClick={parsePastedItems}>
                Match & Add Items
              </button>
            </div>
          )}

          {/* Selected Items */}
          {selectedItems.length > 0 && (
            <div className="selected-items">
              <div className="selected-header">
                <span className="selected-count">
                  {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                </span>
                <button className="btn-text" onClick={clearAll}>
                  Clear all
                </button>
              </div>
              <div className="chips">
                {selectedItems.map((item) => (
                  <span key={item.slug} className="chip">
                    {item.name}
                    <button
                      className="chip-remove"
                      onClick={() => removeItem(item.slug)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                className="btn btn-primary analyze-btn"
                onClick={analyzeItems}
                disabled={analyzing}
              >
                {analyzing
                  ? `Analyzing... (${progress.current}/${progress.total})`
                  : 'Analyze Inventory'}
              </button>
            </div>
          )}
        </section>

        {/* Results */}
        {results.length > 0 && (
          <section className="results-section">
            {/* Summary */}
            <div className="summary">
              <div className="summary-card sell">
                <div className="summary-value">{sellCount}</div>
                <div className="summary-label">Sell for Plat</div>
              </div>
              <div className="summary-card ducat">
                <div className="summary-value">{ducatCount}</div>
                <div className="summary-label">Ducat Worthy</div>
              </div>
              <div className="summary-card junk">
                <div className="summary-value">{junkCount}</div>
                <div className="summary-label">Junk / Delete</div>
              </div>
              <div className="summary-card total">
                <div className="summary-value">{totalPlat}p</div>
                <div className="summary-label">Total Plat Value</div>
              </div>
              <div className="summary-card total">
                <div className="summary-value">{totalDucats}</div>
                <div className="summary-label">Total Ducats</div>
              </div>
            </div>

            {/* Table */}
            <div className="table-container">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Sell Price (Top 5)</th>
                    <th>Buy Price (Top 5)</th>
                    <th>Plat Value</th>
                    <th>Ducats</th>
                    <th>Recommendation</th>
                    {jwtToken && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {results.map((item) => (
                    <tr key={item.slug} className={`row-${item.recommendation.type}`}>
                      <td className="item-cell">
                        <span className="item-name">{item.name}</span>
                        {item.error && (
                          <span className="item-error" title={item.error}>⚠️</span>
                        )}
                      </td>
                      <td className="price-cell">
                        {item.sellOrders.length > 0
                          ? item.sellOrders.map((o) => o.platinum).join(', ')
                          : '—'}
                        {item.sellOrders.length > 0 && (
                          <span className="median">
                            med: {item.sellMedian}p
                          </span>
                        )}
                      </td>
                      <td className="price-cell">
                        {item.buyOrders.length > 0
                          ? item.buyOrders.map((o) => o.platinum).join(', ')
                          : '—'}
                        {item.buyOrders.length > 0 && (
                          <span className="median">
                            med: {item.buyMedian}p
                          </span>
                        )}
                      </td>
                      <td className="plat-cell">
                        <span className="plat-value">{item.platValue}p</span>
                      </td>
                      <td className="ducat-cell">
                        {item.ducats > 0 ? (
                          <span className="ducat-value">{item.ducats}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="rec-cell">
                        <span className={`rec-badge rec-${item.recommendation.type}`}>
                          {item.recommendation.label}
                        </span>
                      </td>
                      {jwtToken && (
                        <td className="action-cell">
                          {listingForm?.slug === item.slug ? (
                            <div className="listing-form">
                              <input
                                type="number"
                                className="listing-input"
                                min="1"
                                value={listingForm.price}
                                onChange={(e) => setListingForm((f) => ({ ...f, price: e.target.value }))}
                                placeholder="Price"
                              />
                              <span className="listing-plat">p</span>
                              <input
                                type="number"
                                className="listing-input listing-qty"
                                min="1"
                                value={listingForm.quantity}
                                onChange={(e) => setListingForm((f) => ({ ...f, quantity: e.target.value }))}
                              />
                              <button className="btn btn-primary btn-xs" onClick={submitListing}>Post</button>
                              <button className="btn-text" onClick={() => setListingForm(null)}>Cancel</button>
                            </div>
                          ) : listingStatus[item.slug] ? (
                            <span className={`listing-status listing-${listingStatus[item.slug].type}`}>
                              {listingStatus[item.slug].message}
                            </span>
                          ) : (
                            <button
                              className="btn btn-sell btn-xs"
                              onClick={() => openListingForm(item)}
                            >
                              List for Sale
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>
          Data from{' '}
          <a href="https://warframe.market" target="_blank" rel="noopener noreferrer">
            warframe.market
          </a>
          {' '}• Prices reflect online PC sellers • Not affiliated with Digital Extremes
        </p>
      </footer>
    </div>
  );
}

export default App;
