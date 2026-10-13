import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost/LavaLustLab6").replace(/\/+$/, "");
const AUTH_STORAGE_KEY = "lavalust-product-auth";
const EMPTY_PRODUCT = { product_name: "", description: "", price: "", quantity: "" };

function readAuth() {
  try {
    const value = localStorage.getItem(AUTH_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveAuth(value) {
  if (value) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

async function readApiResponse(response) {
  if (response.status === 204) return null;

  const contentType = response.headers.get("Content-Type") || "";
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(
        `The backend returned a non-JSON error (HTTP ${response.status}). Check the backend deployment logs; its database connection may be unavailable.`,
      );
    }
    throw new Error(`The backend returned an invalid JSON response (HTTP ${response.status}).`);
  }
}

async function apiRequest(path, options = {}, retried = false) {
  const auth = readAuth();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth?.tokens?.access_token && path !== "/api/auth/login" && path !== "/api/auth/register" && path !== "/api/auth/refresh") {
    headers.set("Authorization", `Bearer ${auth.tokens.access_token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "omit",
  });
  const payload = await readApiResponse(response);

  if (response.status === 401 && !retried && auth?.tokens?.refresh_token && path !== "/api/auth/refresh") {
    const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: auth.tokens.refresh_token }),
      credentials: "omit",
    });
    const refreshPayload = await readApiResponse(refreshResponse);
    if (refreshResponse.ok) {
      const renewedAuth = { ...auth, tokens: refreshPayload.tokens };
      saveAuth(renewedAuth);
      const retryOptions = path === "/api/auth/logout" && options.body
        ? {
            ...options,
            body: JSON.stringify({
              ...JSON.parse(options.body),
              refresh_token: renewedAuth.tokens.refresh_token,
            }),
          }
        : options;
      return apiRequest(path, retryOptions, true);
    }
    saveAuth(null);
  }

  if (!response.ok) {
    throw new Error(payload?.error || "The request could not be completed.");
  }
  return payload;
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
}

function App() {
  const [auth, setAuth] = useState(readAuth);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(Boolean(auth));
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  async function loadProducts() {
    const result = await apiRequest("/api/products");
    setProducts(result.data);
  }

  useEffect(() => {
    if (!auth) return undefined;
    let active = true;
    apiRequest("/api/products")
      .then((result) => {
        if (active) setProducts(result.data);
      })
      .catch((error) => {
        if (!active) return;
        setPageError(error.message);
        if (/unauthorized/i.test(error.message)) {
          saveAuth(null);
          setAuth(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      `${product.product_name} ${product.description}`.toLowerCase().includes(term),
    );
  }, [products, search]);

  const totalUnits = products.reduce((sum, product) => sum + Number(product.quantity), 0);
  const lowStockCount = products.filter((product) => Number(product.quantity) <= 5).length;
  const inventoryValue = products.reduce(
    (sum, product) => sum + Number(product.price) * Number(product.quantity),
    0,
  );

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setSigningIn(true);
    setPageError("");
    const form = new FormData(event.currentTarget);
    const registering = authMode === "register";
    try {
      const result = await apiRequest(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(registering
          ? {
              username: form.get("username"),
              email: form.get("email"),
              password: form.get("password"),
            }
          : {
              identity: form.get("identity"),
              password: form.get("password"),
            }),
      });
      const nextAuth = { user: result.user, tokens: result.tokens };
      saveAuth(nextAuth);
      setAuth(nextAuth);
      setProducts([]);
      setLoading(true);
      const productResult = await apiRequest("/api/products");
      setProducts(productResult.data);
      setNotice(registering
        ? "Your account is ready. The inventory is loaded from the database."
        : "Welcome back. Your inventory is ready.");
    } catch (error) {
      setPageError(error.message);
      if (!readAuth()) setAuth(null);
    } finally {
      setLoading(false);
      setSigningIn(false);
    }
  }

  async function handleLogout() {
    const currentAuth = readAuth();
    setPageError("");
    if (currentAuth?.tokens?.refresh_token) {
      try {
        await apiRequest("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: currentAuth.tokens.refresh_token }),
        });
      } catch (error) {
        setPageError(`Signed out on this device, but server token revocation failed: ${error.message}`);
      }
    }
    saveAuth(null);
    setAuth(null);
    setProducts([]);
    setNotice("");
  }

  async function handleSaveProduct(event) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setPageError("");
    const form = new FormData(event.currentTarget);
    const data = {
      product_name: form.get("product_name"),
      description: form.get("description"),
      price: form.get("price"),
      quantity: Number(form.get("quantity")),
    };

    try {
      await apiRequest(editor.id ? `/api/products/${editor.id}` : "/api/products", {
        method: editor.id ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      await loadProducts();
      setEditor(null);
      setNotice(editor.id ? "Product updated." : "Product added to your inventory.");
    } catch (error) {
      setPageError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product) {
    if (!window.confirm(`Delete "${product.product_name}"? This cannot be undone.`)) return;
    setPageError("");
    try {
      await apiRequest(`/api/products/${product.id}`, { method: "DELETE" });
      setProducts((current) => current.filter((item) => item.id !== product.id));
      setNotice("Product deleted.");
    } catch (error) {
      setPageError(error.message);
    }
  }

  if (!auth) {
    return (
      <main className="login-shell">
        <section className="login-story">
          <div className="brand brand-light"><span className="brand-mark">C</span><span>Campus Inventory<small>INSTITUTIONAL SERVICES</small></span></div>
          <div className="story-copy">
            <span className="eyebrow">CAMPUS OPERATIONS · INVENTORY OFFICE</span>
            <h1>Well-prepared<br />campuses start<br /><em>right here.</em></h1>
            <p>A dependable place to manage school supplies, equipment, and campus inventory.</p>
          </div>
          <div className="story-foot"><span className="story-line" /> Stewardship in service of learning.</div>
          <div className="story-orbit orbit-one" />
          <div className="story-orbit orbit-two" />
        </section>
        <section className="login-panel">
          <div className="login-card">
            <span className="eyebrow">{authMode === "register" ? "CREATE YOUR ACCOUNT" : "INSTITUTIONAL ACCESS"}</span>
            <h2>{authMode === "register" ? "Join Campus Inventory" : "Campus Inventory System"}</h2>
            <p className="muted">{authMode === "register"
              ? "Create an account to access and manage campus inventory."
              : "Sign in with your school account."}</p>
            {pageError && <div className="alert alert-error" role="alert">{pageError}</div>}
            <form className="login-form" onSubmit={handleAuthSubmit}>
              {authMode === "register" ? (
                <>
                  <label htmlFor="username">Username</label>
                  <input autoComplete="username" id="username" maxLength="100" minLength="3" name="username" placeholder="Choose a username" required />
                  <label htmlFor="email">School email</label>
                  <input autoComplete="email" id="email" maxLength="255" name="email" placeholder="you@school.edu" required type="email" />
                </>
              ) : (
                <>
                  <label htmlFor="identity">School account</label>
                  <input autoComplete="username" id="identity" name="identity" placeholder="Username or school email" required />
                </>
              )}
              <label htmlFor="password">Password</label>
              <input autoComplete={authMode === "register" ? "new-password" : "current-password"} id="password" maxLength={authMode === "register" ? 72 : undefined} minLength={authMode === "register" ? 8 : undefined} name="password" placeholder={authMode === "register" ? "8-72 bytes" : "Enter your password"} required type="password" />
              <button className="button button-primary button-wide" disabled={signingIn} type="submit">
                {signingIn ? (authMode === "register" ? "Creating account…" : "Signing in…") : (authMode === "register" ? "Create account" : "Sign in")} <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="login-note">
              {authMode === "register" ? "Already registered? " : "New to Campus Inventory? "}
              <button className="auth-mode-button" onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setPageError(""); }} type="button">
                {authMode === "register" ? "Sign in" : "Create an account"}
              </button>
            </p>
          </div>
          <div className="login-footer">CAMPUS OPERATIONS <span>·</span> INVENTORY MANAGEMENT</div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark">C</span><span>Campus Inventory<small>INSTITUTIONAL SERVICES</small></span>
        </a>
        <div className="side-label">CAMPUS OFFICE</div>
        <div className="nav-item nav-item-active"><span className="nav-icon">▦</span> Inventory</div>
        <div className="sidebar-bottom">
          <div className="account-card">
            <div className="avatar">{(auth.user?.username || "U").slice(0, 1).toUpperCase()}</div>
            <div className="account-details">
              <strong>{auth.user?.username}</strong>
              <span>{auth.user?.role || "Account"}</span>
            </div>
            <button aria-label="Sign out" className="icon-button logout-button" onClick={handleLogout} title="Sign out">↗</button>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">Campus office <span>/</span> <strong>Inventory</strong></div>
          <div className="topbar-meta"><span className="status-dot" /> Inventory office</div>
        </header>

        <section className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">CAMPUS OPERATIONS</span>
              <h1>School inventory</h1>
              <p className="muted">Manage school supplies and keep campus stock records current.</p>
            </div>
            <button className="button button-primary" onClick={() => { setPageError(""); setEditor({ ...EMPTY_PRODUCT }); }}>
              <span className="plus">+</span> Add item
            </button>
          </div>

          {pageError && <div className="alert alert-error" role="alert">{pageError}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}

          <div className="stats-grid">
            <article className="stat-card">
              <div className="stat-top"><span>CATALOG ITEMS</span><span className="stat-icon icon-violet">▦</span></div>
              <div className="stat-value">{products.length}</div>
              <div className="stat-foot">Distinct supplies and equipment</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>UNITS IN STOCK</span><span className="stat-icon icon-mint">▤</span></div>
              <div className="stat-value">{totalUnits.toLocaleString()}</div>
              <div className="stat-foot">Across campus inventory</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>INVENTORY VALUE</span><span className="stat-icon icon-amber">₱</span></div>
              <div className="stat-value">{formatPrice(inventoryValue)}</div>
              <div className="stat-foot">Estimated at recorded unit prices</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>REORDER REVIEW</span><span className="stat-icon icon-rose">!</span></div>
              <div className="stat-value">{lowStockCount}</div>
              <div className="stat-foot">Items with 5 units or fewer</div>
            </article>
          </div>

          <section className="catalog-card">
            <div className="catalog-heading">
              <div>
                <h2>Inventory register</h2>
                <p className="muted">{products.length} {products.length === 1 ? "catalog item" : "catalog items"} recorded</p>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input aria-label="Search inventory" onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory…" value={search} />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>ITEM / DESCRIPTION</th><th>UNIT COST</th><th>AVAILABLE</th><th>DATE RECORDED</th><th><span className="visually-hidden">Actions</span></th></tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="table-message" colSpan="5">Loading campus inventory…</td></tr>
                  ) : visibleProducts.length ? visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="product-cell">
                          <div className={`product-avatar product-avatar-${Number(product.id) % 5}`}>{product.product_name.trim().slice(0, 1).toUpperCase()}</div>
                          <div><strong>{product.product_name}</strong><span>{product.description || "No description recorded"}</span></div>
                        </div>
                      </td>
                      <td className="price-cell">{formatPrice(product.price)}</td>
                      <td><span className={`stock-pill ${Number(product.quantity) <= 5 ? "stock-low" : ""}`}><i />{Number(product.quantity)} available</span></td>
                      <td className="date-cell">{new Date(`${product.created_at.replace(" ", "T")}Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td>
                        <div className="row-actions">
                          <button aria-label={`Edit ${product.product_name}`} className="icon-button" onClick={() => { setPageError(""); setEditor({ ...product }); }} title="Edit">✎</button>
                          <button aria-label={`Delete ${product.product_name}`} className="icon-button delete-action" onClick={() => handleDelete(product)} title="Delete">⌫</button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="table-message" colSpan="5">
                        <div className="empty-state">
                          <span className="empty-icon">▦</span>
                          <strong>{search ? "No matching products" : "Your catalog is ready"}</strong>
                          <span>{search ? "Try a different item name or description." : "Add the first item to begin the campus inventory register."}</span>
                          {!search && <button className="button button-secondary" onClick={() => { setPageError(""); setEditor({ ...EMPTY_PRODUCT }); }}>Record first item</button>}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="catalog-footer"><span>Showing {visibleProducts.length} of {products.length} catalog items</span><span>Campus register <i className="status-dot" /></span></div>
          </section>
          <footer className="page-footer">Responsible inventory management in support of teaching and learning. <span>CAMPUS OPERATIONS</span></footer>
        </section>
      </main>

      {editor && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
          <section aria-labelledby="editor-title" aria-modal="true" className="modal" role="dialog">
            <div className="modal-heading">
              <div><span className="eyebrow">{editor.id ? "INVENTORY REGISTER" : "NEW REGISTER ENTRY"}</span><h2 id="editor-title">{editor.id ? "Update inventory item" : "Record an item"}</h2></div>
              <button aria-label="Close dialog" className="icon-button modal-close" onClick={() => setEditor(null)}>×</button>
            </div>
            <form className="product-form" onSubmit={handleSaveProduct}>
              <label htmlFor="product_name">Item name <span>*</span></label>
              <input autoFocus id="product_name" maxLength="100" name="product_name" placeholder="e.g. Laboratory safety goggles" required defaultValue={editor.product_name} />
              <label htmlFor="description">Item details</label>
              <textarea id="description" name="description" placeholder="Description, category, or intended use" rows="3" defaultValue={editor.description || ""} />
              <div className="form-row">
                <div><label htmlFor="price">Unit cost <span>*</span></label><div className="number-input"><span>₱</span><input id="price" min="0" name="price" placeholder="0.00" required step="0.01" type="number" defaultValue={editor.price} /></div></div>
                <div><label htmlFor="quantity">Available quantity <span>*</span></label><input id="quantity" min="0" name="quantity" placeholder="0" required step="1" type="number" defaultValue={editor.quantity} /></div>
              </div>
              <div className="modal-actions">
                <button className="button button-secondary" onClick={() => setEditor(null)} type="button">Cancel</button>
                <button className="button button-primary" disabled={saving} type="submit">{saving ? "Saving…" : editor.id ? "Save record" : "Record item"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
