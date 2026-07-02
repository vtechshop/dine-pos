// Dine POS — Customer QR Menu PWA
// Warm cream theme matching the app, offline-first via Service Worker

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let menuData       = null;
  let hotelId        = null;
  let activeCategory = 'all';
  let vegOnly        = false;
  let searchQuery    = '';
  let isOffline      = !navigator.onLine;
  let cart           = {};   // { productId: { product, qty } }
  let view           = 'menu';
  let chatMessages   = [];
  let chatSocket     = null;
  let chatUnread     = 0;
  let selectedProduct = null;
  let bestsellerIds   = [];
  let billData        = null;
  let billLoading     = false;

  const urlParams   = new URLSearchParams(window.location.search);
  const tableNumber = urlParams.get('table') || '';
  // Read hotelId from QR code URL immediately so fetchMenu and placeOrder have it
  if (urlParams.get('hotel')) hotelId = urlParams.get('hotel');

  // ─── Service Worker ───────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/menu/sw.js').catch(() => {});
  }

  // ─── Network ──────────────────────────────────────────────────────────────
  window.addEventListener('online',  () => { isOffline = false; refreshOfflineBadge(); fetchMenu(true); });
  window.addEventListener('offline', () => { isOffline = true;  refreshOfflineBadge(); showToast('Offline – showing cached menu'); });

  function refreshOfflineBadge() {
    const b = document.querySelector('.offline-badge');
    if (b) b.classList.toggle('show', isOffline);
  }

  // ─── Cart helpers ──────────────────────────────────────────────────────────
  function cartCount() { return Object.values(cart).reduce((s, i) => s + i.qty, 0); }
  function cartTotal() { return Object.values(cart).reduce((s, i) => s + i.product.price * i.qty, 0); }
  function cartTax()   { return Object.values(cart).reduce((s, {product, qty}) => s + product.price * qty * (product.taxPercent || 0) / 100, 0); }
  function cartGrand() { return cartTotal() + cartTax(); }

  function addToCart(product) {
    if (cart[product._id]) cart[product._id].qty++;
    else cart[product._id] = { product, qty: 1 };
    updateCartBar();
    showToast(`${product.name} added!`);
  }
  function removeFromCart(id) {
    if (!cart[id]) return;
    cart[id].qty--;
    if (cart[id].qty <= 0) delete cart[id];
    updateCartBar();
  }
  function clearCart() { cart = {}; updateCartBar(); }

  function updateCartBar() {
    if (view !== 'menu') return;
    const existing = document.getElementById('cart-bar');
    const count = cartCount();
    if (count === 0) {
      if (existing) existing.remove();
      return;
    }
    const currency = menuData?.hotel?.currency || '₹';
    const html = `<div id="cart-bar" class="cart-bar" onclick="switchView('cart')">
      <span class="cart-bar-left">${count} item${count > 1 ? 's' : ''}</span>
      <span class="cart-bar-mid">View Order →</span>
      <span class="cart-bar-right">${currency}${cartGrand().toFixed(0)}</span>
    </div>`;
    if (existing) { existing.outerHTML = html; }
    else { document.getElementById('app').insertAdjacentHTML('beforeend', html); }
  }

  // ─── Fetch menu from backend ──────────────────────────────────────────────
  async function fetchMenu(silent = false) {
    if (!silent) renderLoader();
    try {
      const menuUrl = hotelId ? `/api/public/menu?hotel=${hotelId}` : '/api/public/menu';
      const res = await fetch(menuUrl);
      if (!res.ok) throw new Error('non-ok');
      menuData = await res.json();
      if (menuData.hotel?.id)       hotelId      = menuData.hotel.id;
      if (menuData.bestsellerIds)   bestsellerIds = menuData.bestsellerIds;
      render();
    } catch {
      if (!silent) renderError();
    }
  }

  // ─── Success sound ───────────────────────────────────────────────────────
  function playSuccessSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    } catch {}
  }

  // ─── Place order ─────────────────────────────────────────────────────────
  async function placeOrder(customerName) {
    const items = Object.values(cart).map(({ product, qty }) => {
      const taxAmount = (product.price * qty * (product.taxPercent || 0)) / 100;
      return {
        product:     product._id,
        productName: product.name,
        quantity:    qty,
        price:       product.price,
        taxPercent:  product.taxPercent || 0,
        taxAmount,
        total:       product.price * qty + taxAmount,
      };
    });

    const subtotal  = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const taxTotal  = items.reduce((s, i) => s + i.taxAmount, 0);
    const grandTotal = subtotal + taxTotal;

    const payload = {
      hotel:         hotelId,
      items,
      subtotal,
      taxTotal,
      grandTotal,
      paymentMethod: 'cash',
      status:        'pending',
      tableNumber:   tableNumber || 'Walk-in',
      customerName:  customerName || 'Table ' + (tableNumber || 'Walk-in'),
      notes:         `QR Order — Table ${tableNumber || 'Walk-in'}`,
    };

    const res = await fetch('/api/public/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error('Order failed');
    return res.json();
  }

  // ─── Emoji helpers ────────────────────────────────────────────────────────
  const EMOJI_MAP = { rice:'🍚', biryani:'🍛', chicken:'🍗', fish:'🐟', tea:'☕', coffee:'☕', juice:'🥤', shake:'🥤', ice:'🍦', cake:'🎂', dosa:'🫓', idli:'🥞', curry:'🍛', noodle:'🍜', roti:'🫓', chapati:'🫓', egg:'🥚', milk:'🥛', veg:'🥗', paneer:'🧀', samosa:'🫔', puff:'🥐', soup:'🍲' };
  function getEmoji(name) {
    const k = name.toLowerCase();
    for (const [key, val] of Object.entries(EMOJI_MAP)) if (k.includes(key)) return val;
    return '🍴';
  }

  // ─── Filter ───────────────────────────────────────────────────────────────
  function filteredProducts() {
    if (!menuData) return [];
    let list = menuData.products;
    if (activeCategory !== 'all') {
      list = list.filter(p => (p.category?._id || p.category) === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.category?.name?.toLowerCase().includes(q));
    }
    if (vegOnly) list = list.filter(p => p.isVeg);
    return list;
  }

  // ─── Fetch bill for this table ────────────────────────────────────────────
  async function fetchBill() {
    if (!tableNumber) return;
    billLoading = true;
    render();
    try {
      const params = new URLSearchParams({ table: tableNumber });
      if (hotelId) params.set('hotel', hotelId);
      const res = await fetch(`/api/public/bill?${params}`);
      billData = res.ok ? await res.json() : null;
    } catch { billData = null; }
    billLoading = false;
    render();
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  function render() {
    if      (view === 'cart')    renderCart();
    else if (view === 'confirm') renderConfirm();
    else if (view === 'chat')    renderChat();
    else if (view === 'bill')    renderBill();
    else                         renderMenu();
    // Restore detail overlay if it was open
    if (selectedProduct && view === 'menu') renderDetailOverlay();
    // Keep scroll-padding-top in sync with sticky header height
    requestAnimationFrame(() => {
      const hdr = document.querySelector('.sticky-header-group');
      if (hdr) document.documentElement.style.scrollPaddingTop = hdr.offsetHeight + 'px';
    });
  }

  function renderLoader() {
    const skelCard = () => `
      <div class="skel-card">
        <div class="skel-img skel-pulse"></div>
        <div class="skel-body">
          <div class="skel-line skel-pulse" style="width:80%"></div>
          <div class="skel-line skel-pulse" style="width:55%;height:8px"></div>
          <div class="skel-footer">
            <div class="skel-price skel-pulse"></div>
            <div class="skel-btn skel-pulse"></div>
          </div>
        </div>
      </div>`;
    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <div class="hotel-avatar">🍴</div>
          <div><div class="hotel-name">Loading menu…</div></div>
        </div>
      </div>
      <div class="skel-grid">${[1,2,3,4].map(skelCard).join('')}</div>`;
  }

  function renderError() {
    document.getElementById('app').innerHTML = `
      <div class="loader">
        <div class="empty-state">
          <div class="big">😕</div>
          <h3>Could not load menu</h3>
          <p>Check your connection and try again</p>
          <button onclick="location.reload()" class="btn-primary" style="margin-top:20px;width:auto;padding:13px 32px">Retry</button>
        </div>
      </div>`;
  }

  // ─── Bottom navigation bar ────────────────────────────────────────────────
  function renderBottomNav(activeTab) {
    const count = cartCount();
    const tabs = [
      { id: 'menu', icon: '🍴', label: 'Menu', fn: "switchView('menu')" },
      ...(tableNumber ? [{ id: 'bill', icon: '🧾', label: 'My Bill', fn: 'switchViewBill()' }] : []),
      { id: 'cart', icon: '🛒', label: 'Cart', fn: "switchView('cart')", badge: count > 0 ? count : 0 },
      ...(tableNumber ? [{ id: 'chat', icon: '💬', label: 'Chat', fn: 'switchViewChat()', badge: chatUnread > 0 ? chatUnread : 0 }] : []),
    ];
    return `<nav class="bottom-nav">${tabs.map(t => `
      <button class="bnav-btn ${activeTab === t.id ? 'active' : ''}" onclick="${t.fn}">
        <div class="bnav-indicator"></div>
        <span class="bnav-icon" style="position:relative">
          ${t.icon}
          ${t.badge ? `<span class="bnav-badge">${t.badge}</span>` : ''}
        </span>
        <span class="bnav-label">${t.label}</span>
      </button>`).join('')}
    </nav>`;
  }

  // ─── Menu view ────────────────────────────────────────────────────────────
  function renderMenu() {
    const { hotel, categories } = menuData;
    const products  = filteredProducts();
    const currency  = hotel.currency || '₹';
    const count     = cartCount();
    const initial   = (hotel.name || 'M')[0].toUpperCase();

    let productHTML = '';
    if (products.length === 0) {
      productHTML = `<div class="empty-state">
        <div class="big">${searchQuery ? '🔍' : vegOnly ? '🥗' : '🍽️'}</div>
        <h3>No items found</h3>
        <p>${searchQuery ? `No results for "${searchQuery}"` : vegOnly ? 'No veg items in this category' : 'Check back soon'}</p>
      </div>`;
    } else if (activeCategory === 'all' && !searchQuery) {
      // Popular section at top
      const popular = products.filter(p => bestsellerIds.includes(p._id) && p.isAvailable !== false);
      let popularHTML = '';
      if (popular.length > 0) {
        popularHTML = `
          <div class="cat-sec-hdr">
            <span>⭐ Popular</span>
            <span class="cat-sec-count">${popular.length} items</span>
          </div>
          <div class="products-list">${popular.map(p => productCard(p, currency)).join('')}</div>`;
      }
      // Category groups
      const grouped = {};
      const catOrder = [];
      products.forEach(p => {
        const n = p.category?.name || 'Other';
        if (!grouped[n]) { grouped[n] = []; catOrder.push(n); }
        grouped[n].push(p);
      });
      const groupedHTML = catOrder.map(name => `
        <div class="cat-sec-hdr">
          <span>${escHtml(name)}</span>
          <span class="cat-sec-count">${grouped[name].length} items</span>
        </div>
        <div class="products-list">${grouped[name].map(p => productCard(p, currency)).join('')}</div>
      `).join('');
      productHTML = popularHTML + groupedHTML;
    } else {
      productHTML = `<div class="products-list">${products.map(p => productCard(p, currency)).join('')}</div>`;
    }

    document.getElementById('app').innerHTML = `
      <div class="sticky-header-group">
        <div class="header">
          <div class="header-top">
            <div class="hotel-avatar">${initial}</div>
            <div style="flex:1;min-width:0">
              <div class="hotel-name">${hotel.name || 'Our Menu'}</div>
              ${tableNumber ? `<div class="hotel-sub">🪑 Table ${tableNumber}</div>` : `<div class="hotel-sub">Tap an item to order</div>`}
            </div>
            ${!tableNumber ? `
            <div class="header-actions">
              <button class="icon-btn" onclick="switchView('cart')">
                🛒
                <span class="badge ${count > 0 ? 'show' : ''}">${count}</span>
              </button>
            </div>` : ''}
          </div>
          ${isOffline ? `<div class="offline-badge show">📵 Offline Mode</div>` : ''}
        </div>

        <div class="search-row">
          <div class="search-wrap">
            <span class="search-icon-abs">🔍</span>
            <input class="search-input" type="text" placeholder="Search dishes…"
              value="${escHtml(searchQuery)}" oninput="handleSearch(this.value)" />
          </div>
          <button class="veg-toggle ${vegOnly ? 'active' : ''}" onclick="toggleVeg()">
            🥗 Veg
          </button>
        </div>

        <div class="categories-wrap">
          <div class="categories-inner">
            <button class="cat-btn ${activeCategory === 'all' ? 'active' : ''}" onclick="handleCategory('all')">
              🍴 All
            </button>
            ${categories.map(cat => `
              <button class="cat-btn ${activeCategory === cat._id ? 'active' : ''}" onclick="handleCategory('${cat._id}')">
                <span class="cat-dot" style="background:${cat.color || '#E8380D'}"></span>
                ${cat.name}
              </button>`).join('')}
          </div>
        </div>
      </div>

      <div class="screen" id="products-area">
        ${productHTML}
        <div class="footer">
          ${hotel.name || 'Menu'}${hotel.phone ? ` · 📞 ${hotel.phone}` : ''}
          <div style="margin-top:4px;opacity:0.7">${menuData.products.length} items · ${isOffline ? '📵 Offline' : '✅ Live'}</div>
        </div>
      </div>

      ${tableNumber ? `<button class="waiter-fab" onclick="callWaiter()">🔔 Call Waiter</button>` : ''}

      ${count > 0 ? `
        <div id="cart-bar" class="cart-bar" onclick="switchView('cart')">
          <span class="cart-bar-left">${count} item${count > 1 ? 's' : ''}</span>
          <span class="cart-bar-mid">View Order →</span>
          <span class="cart-bar-right">${currency}${cartGrand().toFixed(0)}</span>
        </div>` : ''}

      ${renderBottomNav('menu')}
      <div class="toast" id="toast"></div>
    `;

    initChat();
  }

  // ─── Product card — Swiggy-style horizontal list card ─────────────────────
  function productCard(p, currency) {
    const qty     = cart[p._id]?.qty || 0;
    const emoji   = getEmoji(p.name);
    const hasImg  = p.image && p.image.trim();
    const soldOut = !p.isAvailable || p.stock === 0;
    const isBest  = bestsellerIds.includes(p._id);
    const pJson   = escAttr(JSON.stringify(p));
    const desc    = p.description
      ? escHtml(p.description.substring(0, 72) + (p.description.length > 72 ? '…' : ''))
      : '';

    const ctrl = soldOut
      ? `<span class="sold-out-tag">Sold Out</span>`
      : qty > 0
        ? `<div class="plc-qty" onclick="event.stopPropagation()">
             <button class="plc-qb" onclick="handleRemove('${p._id}')">−</button>
             <span class="plc-qn">${qty}</span>
             <button class="plc-qb" onclick="handleAdd('${pJson}')">+</button>
           </div>`
        : `<button class="plc-add" onclick="event.stopPropagation(); handleAdd('${pJson}')">ADD</button>`;

    return `
      <div class="plc${soldOut ? ' plc-out' : ''}" onclick="openDetail('${pJson}')">
        <div class="plc-l">
          <div class="veg-dot ${p.isVeg ? 'veg' : 'nv'}"></div>
          ${isBest && !soldOut ? `<div class="plc-popular">⭐ Bestseller</div>` : ''}
          <div class="plc-name">${escHtml(p.name)}</div>
          ${desc ? `<div class="plc-desc">${desc}</div>` : ''}
          <div class="plc-bottom">
            <span class="plc-price">${currency}${p.price.toFixed(0)}</span>
            ${p.taxPercent > 0 ? `<span class="plc-tax">+${p.taxPercent}% GST</span>` : ''}
          </div>
        </div>
        <div class="plc-r">
          <div class="plc-img-box${soldOut ? ' dimmed' : ''}">
            ${hasImg
              ? `<img class="plc-img" src="${p.image}" alt="${escHtml(p.name)}" loading="lazy"
                  onerror="this.parentElement.innerHTML='<div class=\\'plc-moji\\'>${emoji}</div>'">`
              : `<div class="plc-moji">${emoji}</div>`}
            ${soldOut ? `<div class="plc-sold"><span>SOLD OUT</span></div>` : ''}
          </div>
          ${ctrl}
        </div>
      </div>`;
  }

  // ─── Item detail bottom-sheet ─────────────────────────────────────────────
  function buildDetailHTML(p) {
    const qty      = cart[p._id]?.qty || 0;
    const emoji    = getEmoji(p.name);
    const hasImg   = p.image && p.image.trim();
    const soldOut  = !p.isAvailable || p.stock === 0;
    const currency = menuData?.hotel?.currency || '₹';
    const isBest   = bestsellerIds.includes(p._id);
    const priceInclGST = p.taxPercent > 0
      ? (p.price * (1 + p.taxPercent / 100)).toFixed(0)
      : null;
    const pJson = escAttr(JSON.stringify(p));

    return `
      <div id="detail-overlay" onclick="if(event.target===this)closeDetail()">
        <div class="detail-sheet">
          <div class="detail-handle"></div>
          <button class="detail-close" onclick="closeDetail()">✕</button>

          ${hasImg
            ? `<img class="detail-img" src="${p.image}" alt="${escHtml(p.name)}" loading="lazy">`
            : `<div class="detail-emoji-wrap">${emoji}</div>`}

          <div class="detail-body">
            <div class="detail-name-row">
              <div class="veg-indicator ${p.isVeg ? 'veg' : 'nv'}" style="position:static;flex-shrink:0"></div>
              <h2 class="detail-name">${escHtml(p.name)}</h2>
            </div>

            <div class="detail-tags">
              <span class="detail-tag" style="color:${p.isVeg ? 'var(--veg)' : 'var(--non-veg)'}">
                ${p.isVeg ? '🌿 Veg' : '🍗 Non-Veg'}
              </span>
              ${p.taxPercent > 0 ? `<span class="detail-tag">GST ${p.taxPercent}%</span>` : ''}
              ${p.stock > 0 && p.stock !== -1 ? `<span class="detail-tag">📦 ${p.stock} left</span>` : ''}
              ${isBest ? `<span class="detail-tag" style="color:#FF8F00">⭐ Bestseller</span>` : ''}
            </div>

            ${p.description ? `<p class="detail-desc">${escHtml(p.description)}</p>` : ''}

            <div class="detail-price-row">
              <div>
                <div class="detail-price">${currency}${p.price.toFixed(0)}</div>
                ${priceInclGST ? `<div class="detail-price-sub">${currency}${priceInclGST} incl. GST</div>` : ''}
              </div>
              ${soldOut
                ? `<span class="sold-out-tag" style="font-size:13px;padding:8px 16px">Sold Out</span>`
                : qty > 0
                  ? `<div class="qty-control">
                       <button class="qty-btn" onclick="handleRemoveDetail('${p._id}')">−</button>
                       <span class="qty-num" style="font-size:18px;min-width:28px">${qty}</span>
                       <button class="qty-btn plus" onclick="handleAddDetail('${pJson}')">+</button>
                     </div>`
                  : `<button class="add-btn add-btn-lg" onclick="handleAddDetail('${pJson}')">+ Add to Cart</button>`
              }
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderDetailOverlay() {
    const existing = document.getElementById('detail-overlay');
    if (!selectedProduct) {
      if (existing) existing.remove();
      return;
    }
    const html = buildDetailHTML(selectedProduct);
    if (existing) {
      existing.outerHTML = html;
    } else {
      document.getElementById('app').insertAdjacentHTML('beforeend', html);
    }
  }

  // ─── Cart view ────────────────────────────────────────────────────────────
  function renderCart() {
    const items    = Object.values(cart);
    const currency = menuData?.hotel?.currency || '₹';
    const subtotal = cartTotal();
    const tax      = cartTax();
    const grand    = subtotal + tax;

    document.getElementById('app').innerHTML = `
      <div class="cart-header">
        <button class="back-btn" onclick="switchView('menu')">← Menu</button>
        <span class="cart-title">Your Order</span>
        ${tableNumber ? `<span class="cart-table">Table ${tableNumber}</span>` : '<span></span>'}
      </div>

      <div class="screen">
        ${items.length === 0
          ? `<div class="empty-state" style="padding:60px 24px">
               <div class="big">🛒</div>
               <h3>Cart is empty</h3>
               <p>Go back and add some items!</p>
               <button class="btn-primary" onclick="switchView('menu')" style="margin-top:16px;width:auto;padding:13px 32px">Browse Menu</button>
             </div>`
          : `
            ${items.map(({ product, qty }) => `
              <div class="cart-item">
                <div class="veg-indicator ${product.isVeg ? 'veg' : 'nv'} cart-item-veg" style="position:static;flex-shrink:0"></div>
                <div class="cart-item-info">
                  <div class="cart-item-name">${escHtml(product.name)}</div>
                  <div class="cart-item-price">${currency}${product.price.toFixed(0)} each</div>
                </div>
                <div class="qty-control">
                  <button class="qty-btn" onclick="handleRemoveAndReRender('${product._id}')">−</button>
                  <span class="qty-num">${qty}</span>
                  <button class="qty-btn plus" onclick="handleAddAndReRender('${escAttr(JSON.stringify(product))}')">+</button>
                </div>
                <div class="cart-item-total">${currency}${(product.price * qty).toFixed(0)}</div>
              </div>`).join('')}

            <div class="cart-summary">
              <div class="summary-row"><span>Subtotal</span><span>${currency}${subtotal.toFixed(2)}</span></div>
              <div class="summary-row"><span>Tax (GST)</span><span>${currency}${tax.toFixed(2)}</span></div>
              <div class="summary-row grand"><span>TOTAL</span><span>${currency}${grand.toFixed(2)}</span></div>
            </div>

            <button class="btn-primary" onclick="switchView('confirm')">
              Proceed to Place Order — ${currency}${grand.toFixed(0)}
            </button>
            <button class="btn-secondary" onclick="switchView('menu')">Continue Shopping</button>
          `}
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Confirm view ─────────────────────────────────────────────────────────
  function renderConfirm() {
    const currency = menuData?.hotel?.currency || '₹';
    const grand    = cartGrand();

    document.getElementById('app').innerHTML = `
      <div class="cart-header">
        <button class="back-btn" onclick="switchView('cart')">← Back</button>
        <span class="cart-title">Confirm Order</span>
        <span></span>
      </div>

      <div class="screen" style="padding:16px">
        <div class="confirm-card">
          <div class="confirm-icon">🪑</div>
          <div class="confirm-title">Table ${escHtml(tableNumber || 'Walk-in')}</div>
          <div class="confirm-total">${currency}${grand.toFixed(2)}</div>
          <div class="confirm-sub">${cartCount()} items · Pay at counter</div>
        </div>

        <p style="font-size:13px;color:var(--text2);margin-bottom:8px;font-weight:600">Your Name (optional)</p>
        <input id="customerName" class="name-input" type="text"
          placeholder="e.g. Ravi Kumar"
          onkeydown="if(event.key==='Enter') submitOrder()" />

        <button id="placeBtn" class="btn-primary" onclick="submitOrder()">
          🍽️ Place Order
        </button>
        <button class="btn-secondary" onclick="switchView('cart')">Cancel</button>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Success view ─────────────────────────────────────────────────────────
  function renderSuccess(order) {
    const currency = menuData?.hotel?.currency || '₹';
    document.getElementById('app').innerHTML = `
      <div class="success-screen">
        <div class="success-icon">🎉</div>
        <h2 class="success-title">Order Placed!</h2>
        <p class="success-num">Order #${escHtml(order.orderNumber || '')}</p>
        <p class="success-sub">Your order has been sent to the kitchen.<br>Sit back and relax — we'll serve you soon!</p>
        <div class="success-card">
          <span><strong>🪑</strong>Table ${escHtml(tableNumber || 'Walk-in')}</span>
          <span><strong>${currency}${(order.grandTotal || 0).toFixed(0)}</strong>Amount</span>
        </div>
        <button class="btn-primary" style="width:auto;padding:14px 40px" onclick="resetAndGoMenu()">
          Order More Items
        </button>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Global handlers (called from inline HTML) ─────────────────────────────
  window.switchView = (v) => {
    view = v;
    selectedProduct = null;
    document.body.style.overflow = '';
    render();
    window.scrollTo(0, 0);
  };
  window.switchViewChat = () => { view = 'chat'; chatUnread = 0; render(); };
  window.switchViewBill = () => { view = 'bill'; billData = null; fetchBill(); };
  window.fetchBill = fetchBill;
  window.handleCategory = (id) => { activeCategory = id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  window.handleSearch   = (val) => { searchQuery = val; render(); };
  window.toggleVeg      = () => { vegOnly = !vegOnly; render(); };

  window.handleAdd = (pJson) => {
    try { addToCart(JSON.parse(pJson)); } catch (e) { console.error(e); }
    render();
  };
  window.handleRemove = (id) => {
    removeFromCart(id);
    render();
  };

  // Detail modal handlers
  window.openDetail = (pJson) => {
    try { selectedProduct = JSON.parse(pJson); } catch { return; }
    document.body.style.overflow = 'hidden';
    renderDetailOverlay();
  };

  window.closeDetail = () => {
    selectedProduct = null;
    document.body.style.overflow = '';
    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.remove();
  };

  window.handleAddDetail = (pJson) => {
    try { addToCart(JSON.parse(pJson)); } catch {}
    if (selectedProduct) renderDetailOverlay();
    updateCartBar();
  };

  window.handleRemoveDetail = (id) => {
    removeFromCart(id);
    if (selectedProduct) renderDetailOverlay();
    updateCartBar();
  };

  // Cart screen versions (re-render full cart on qty change)
  window.handleAddAndReRender = (pJson) => {
    try { const p = JSON.parse(pJson); if (cart[p._id]) cart[p._id].qty++; else cart[p._id] = { product: p, qty: 1 }; renderCart(); } catch (e) {}
  };
  window.handleRemoveAndReRender = (id) => { removeFromCart(id); renderCart(); };

  window.submitOrder = async () => {
    const name = document.getElementById('customerName')?.value?.trim() || '';
    const btn  = document.getElementById('placeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }
    try {
      const order = await placeOrder(name);
      clearCart();
      playSuccessSound();
      view = 'menu';
      renderSuccess(order);
    } catch {
      showToast('Failed to place order. Check connection and try again.');
      if (btn) { btn.disabled = false; btn.textContent = '🍽️ Place Order'; }
    }
  };

  window.resetAndGoMenu = () => {
    view = 'menu';
    activeCategory = 'all';
    searchQuery = '';
    render();
  };

  // ─── Call Waiter ──────────────────────────────────────────────────────────
  window.callWaiter = () => {
    const existing = document.getElementById('waiter-modal');
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.id = 'waiter-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--surface);border-radius:24px 24px 0 0;padding:24px 20px 36px;width:100%;max-width:540px;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">
        <div style="width:40px;height:4px;border-radius:4px;background:var(--border);margin:0 auto 20px"></div>
        <div style="font-size:32px;text-align:center;margin-bottom:8px">🔔</div>
        <div style="font-size:17px;font-weight:800;text-align:center;color:var(--text);margin-bottom:6px">Call Waiter</div>
        <div style="font-size:13px;color:var(--text3);text-align:center;margin-bottom:20px">Table ${tableNumber} · What do you need?</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${['Water please 💧','Bill please 🧾','Napkins / Tissue 🧻','Extra cutlery 🍴','Need assistance 🙋'].map(r =>
            `<button onclick="sendWaiterRequest('${r}')" style="background:var(--bg);border:1.5px solid var(--border);border-radius:12px;padding:13px 16px;text-align:left;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;color:var(--text);cursor:pointer">${r}</button>`
          ).join('')}
        </div>
        <button onclick="document.getElementById('waiter-modal').remove()" style="margin-top:14px;width:100%;background:none;border:none;font-size:14px;color:var(--text3);font-family:Poppins,sans-serif;cursor:pointer;padding:8px">Dismiss</button>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  };

  window.sendWaiterRequest = (msg) => {
    document.getElementById('waiter-modal')?.remove();
    if (chatSocket) {
      chatSocket.emit('customer_message', { hotelId, tableNumber, message: `[Waiter Request] ${msg}` });
      chatMessages.push({ sender: 'customer', message: `[Waiter Request] ${msg}`, createdAt: new Date().toISOString() });
    }
    showToast('✅ Waiter has been notified!');
  };

  // ─── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ─── Chat (Socket.io) ─────────────────────────────────────────────────────
  function initChat() {
    if (chatSocket || !tableNumber) return;
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = () => {
      chatSocket = window.io({ transports: ['websocket'] });
      chatSocket.emit('join', tableNumber);
      chatSocket.on('new_message', (msg) => {
        if (msg.tableNumber !== tableNumber) return;
        chatMessages.push(msg);
        if (view !== 'chat' && msg.sender === 'admin') {
          chatUnread++;
          showToast(`💬 Staff: ${msg.message}`);
          const b = document.getElementById('chat-badge');
          if (b) { b.textContent = chatUnread; b.classList.add('show'); }
        }
        if (view === 'chat') renderChat();
      });
    };
    document.head.appendChild(s);
  }

  function renderChat() {
    chatUnread = 0;
    const fmt = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('app').innerHTML = `
      <div class="cart-header">
        <button class="back-btn" onclick="switchView('menu')">← Back</button>
        <span class="cart-title">Chat with Staff</span>
        <span class="cart-table">Table ${tableNumber}</span>
      </div>

      <div style="display:flex;flex-direction:column;min-height:calc(100vh - 64px)">
        <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;padding-bottom:80px">
          ${chatMessages.length === 0
            ? `<div class="empty-state" style="padding:40px 0"><div class="big">💬</div><p>No messages yet</p></div>`
            : chatMessages.map(m => `
              <div style="display:flex;flex-direction:column;align-items:${m.sender==='admin'?'flex-start':'flex-end'}">
                <div style="background:${m.sender==='admin'?'var(--surface)':'var(--primary)'};color:${m.sender==='admin'?'var(--text)':'#fff'};
                  border-radius:${m.sender==='admin'?'4px 14px 14px 14px':'14px 4px 14px 14px'};
                  padding:10px 14px;max-width:80%;font-size:14px;border:1.5px solid var(--border)">
                  ${escHtml(m.message)}
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:3px">${m.sender==='admin'?'Staff · ':'You · '}${fmt(m.createdAt)}</div>
              </div>`).join('')}
        </div>

        <div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;
          display:flex;gap:8px;padding:10px 12px;background:var(--surface);border-top:1.5px solid var(--border);z-index:200">
          <input id="chatMsg" class="name-input" type="text" placeholder="Type a message…"
            style="margin:0;flex:1" onkeydown="if(event.key==='Enter') sendChat()" />
          <button onclick="sendChat()" class="add-btn" style="padding:10px 18px;border-radius:10px;white-space:nowrap">Send</button>
        </div>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Bill view ────────────────────────────────────────────────────────────
  function renderBill() {
    const currency = menuData?.hotel?.currency || '₹';
    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    let content = '';

    if (billLoading) {
      content = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;gap:14px">
        <div class="spinner"></div>
        <p style="color:var(--text2);font-size:14px">Loading your bill…</p>
      </div>`;
    } else if (!billData || billData.items.length === 0) {
      content = `<div class="empty-state" style="padding:60px 24px">
        <div class="big">🧾</div>
        <h3>No orders yet</h3>
        <p>Place your first order from the menu!</p>
        <button class="btn-primary" onclick="switchView('menu')" style="margin-top:20px;width:auto;padding:13px 32px">Browse Menu</button>
      </div>`;
    } else {
      const itemRows = billData.items.map(item => `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${escHtml(item.productName)}</div>
            <div class="cart-item-price">${currency}${item.price.toFixed(0)} × ${item.quantity}</div>
          </div>
          <div class="cart-item-total">${currency}${item.total.toFixed(0)}</div>
        </div>`).join('');

      content = `
        ${itemRows}

        <div class="cart-summary">
          <div class="summary-row">
            <span>Subtotal (${billData.orderCount} order${billData.orderCount > 1 ? 's' : ''})</span>
            <span>${currency}${billData.subtotal.toFixed(2)}</span>
          </div>
          <div class="summary-row">
            <span>Tax (GST)</span>
            <span>${currency}${billData.taxTotal.toFixed(2)}</span>
          </div>
          <div class="summary-row grand">
            <span>TOTAL DUE</span>
            <span>${currency}${billData.grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div style="background:var(--primary-bg);border:1.5px solid var(--primary);border-radius:14px;padding:14px 16px;margin:12px;text-align:center">
          <div style="font-size:20px;margin-bottom:6px">💳</div>
          <div style="font-size:14px;font-weight:700;color:var(--primary)">Pay at the Counter</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px">Show this bill to our staff</div>
        </div>

        <button class="btn-primary" onclick="switchView('menu')">
          + Order More Items
        </button>`;
    }

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <div class="hotel-avatar">🧾</div>
          <div style="flex:1">
            <div class="hotel-name">My Bill</div>
            ${tableNumber ? `<div class="hotel-sub">🪑 Table ${tableNumber}</div>` : ''}
          </div>
          <button onclick="fetchBill()" style="background:rgba(255,255,255,0.2);border:none;border-radius:50px;padding:6px 14px;font-size:12px;font-weight:700;color:#fff;cursor:pointer">
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style="padding:8px 14px 4px;background:var(--bg)">
        <span style="font-size:11px;color:var(--text3);font-weight:500">Last updated: ${now}</span>
      </div>

      <div class="screen" style="padding-top:0">
        ${content}
      </div>

      ${renderBottomNav('bill')}
      <div class="toast" id="toast"></div>
    `;
  }

  window.sendChat = () => {
    const inp = document.getElementById('chatMsg');
    const txt = inp?.value?.trim();
    if (!txt || !chatSocket) return;
    chatSocket.emit('customer_message', { hotelId, tableNumber, message: txt });
    chatMessages.push({ sender: 'customer', message: txt, createdAt: new Date().toISOString() });
    inp.value = '';
    renderChat();
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  fetchMenu();

})();
