// Dine POS — Customer QR Menu PWA
// Warm cream theme matching the app, offline-first via Service Worker

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let menuData      = null;
  let hotelId       = null;
  let activeCategory = 'all';
  let vegOnly       = false;
  let searchQuery   = '';
  let isOffline     = !navigator.onLine;
  let cart          = {};   // { productId: { product, qty } }
  let view          = 'menu';
  let chatMessages  = [];
  let chatSocket    = null;
  let chatUnread    = 0;

  const urlParams  = new URLSearchParams(window.location.search);
  const tableNumber = urlParams.get('table') || '';

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
    // Re-render just the cart bar without full re-render (avoids losing input focus)
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
      const res = await fetch('/api/public/menu');
      if (!res.ok) throw new Error('non-ok');
      menuData = await res.json();
      if (menuData.hotel?.id) hotelId = menuData.hotel.id;
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

  // ─── Main render ──────────────────────────────────────────────────────────
  function render() {
    if      (view === 'cart')    renderCart();
    else if (view === 'confirm') renderConfirm();
    else if (view === 'chat')    renderChat();
    else                         renderMenu();
  }

  function renderLoader() {
    document.getElementById('app').innerHTML = `
      <div class="loader">
        <div class="spinner"></div>
        <p>Loading menu…</p>
      </div>`;
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

  // ─── Menu view ────────────────────────────────────────────────────────────
  function renderMenu() {
    const { hotel, categories } = menuData;
    const products  = filteredProducts();
    const currency  = hotel.currency || '₹';
    const count     = cartCount();

    // Group by category when showing all
    let productHTML = '';
    if (products.length === 0) {
      productHTML = `<div class="empty-state">
        <div class="big">${searchQuery ? '🔍' : vegOnly ? '🥗' : '🍽️'}</div>
        <h3>No items found</h3>
        <p>${searchQuery ? `No results for "${searchQuery}"` : vegOnly ? 'No veg items in this category' : 'Check back soon'}</p>
      </div>`;
    } else if (activeCategory === 'all' && !searchQuery) {
      const grouped = {};
      products.forEach(p => {
        const n = p.category?.name || 'Other';
        if (!grouped[n]) grouped[n] = [];
        grouped[n].push(p);
      });
      productHTML = Object.entries(grouped).map(([name, items]) => `
        <div class="section-header">${name}</div>
        <div class="products-grid">${items.map(p => productCard(p, currency)).join('')}</div>
      `).join('');
    } else {
      productHTML = `<div class="products-grid" style="padding-top:12px">${products.map(p => productCard(p, currency)).join('')}</div>`;
    }

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <div style="flex:1;min-width:0">
            <div class="hotel-name">${hotel.name || 'Our Menu'}</div>
            ${tableNumber ? `<div class="hotel-sub">🪑 Table ${tableNumber}</div>` : ''}
          </div>
          <div class="header-actions">
            ${tableNumber ? `
              <button class="icon-btn" onclick="switchViewChat()">
                💬
                <span id="chat-badge" class="badge ${chatUnread > 0 ? 'show' : ''}">${chatUnread}</span>
              </button>` : ''}
            <button class="icon-btn" onclick="switchView('cart')">
              🛒
              <span class="badge ${count > 0 ? 'show' : ''}">${count}</span>
            </button>
          </div>
        </div>
        <div class="offline-badge ${isOffline ? 'show' : ''}">📵 Offline Mode</div>
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

      <div class="screen" id="products-area">
        ${productHTML}
        <div class="footer">
          ${hotel.name || 'Menu'}${hotel.phone ? ` · 📞 ${hotel.phone}` : ''}
          <div style="margin-top:4px;opacity:0.7">${menuData.products.length} items · ${isOffline ? '📵 Offline' : '✅ Live'}</div>
        </div>
      </div>

      ${count > 0 ? `
        <div id="cart-bar" class="cart-bar" onclick="switchView('cart')">
          <span class="cart-bar-left">${count} item${count > 1 ? 's' : ''}</span>
          <span class="cart-bar-mid">View Order →</span>
          <span class="cart-bar-right">${currency}${cartGrand().toFixed(0)}</span>
        </div>` : ''}

      <div class="toast" id="toast"></div>
    `;

    initChat();
  }

  function productCard(p, currency) {
    const qty     = cart[p._id]?.qty || 0;
    const emoji   = getEmoji(p.name);
    const hasImg  = p.image && p.image.trim();
    const vegClass = p.isVeg ? 'veg' : 'nv';
    const pJson   = escAttr(JSON.stringify(p));

    return `
      <div class="product-card">
        <div class="product-img-wrap">
          ${hasImg
            ? `<img class="product-img" src="${p.image}" alt="${escHtml(p.name)}" loading="lazy"
                onerror="this.parentElement.innerHTML='<div class=\\'product-emoji\\'>${emoji}</div>'">`
            : `<div class="product-emoji">${emoji}</div>`}
          <div class="veg-indicator ${vegClass}"></div>
        </div>
        <div class="product-body">
          <div class="product-name">${escHtml(p.name)}</div>
          ${p.category?.name ? `<div class="product-cat">${escHtml(p.category.name)}</div>` : ''}
          <div class="product-footer-row">
            <div>
              <div class="product-price">${currency}${p.price.toFixed(0)}</div>
              ${p.taxPercent > 0 ? `<div class="product-tax">+${p.taxPercent}% GST</div>` : ''}
            </div>
            <div class="qty-control">
              ${qty > 0
                ? `<button class="qty-btn" onclick="handleRemove('${p._id}')">−</button>
                   <span class="qty-num">${qty}</span>
                   <button class="qty-btn plus" onclick="handleAdd('${pJson}')">+</button>`
                : `<button class="add-btn" onclick="handleAdd('${pJson}')">+ Add</button>`}
            </div>
          </div>
        </div>
      </div>`;
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
  window.switchView = (v) => { view = v; render(); window.scrollTo(0, 0); };
  window.switchViewChat = () => { view = 'chat'; chatUnread = 0; render(); };
  window.handleCategory = (id) => { activeCategory = id; render(); document.getElementById('products-area')?.scrollIntoView({ behavior: 'smooth' }); };
  window.handleSearch   = (val) => { searchQuery = val; render(); };
  window.toggleVeg      = () => { vegOnly = !vegOnly; render(); };

  window.handleAdd = (pJson) => {
    try { addToCart(JSON.parse(pJson)); render(); } catch (e) { console.error(e); }
  };
  window.handleRemove = (id) => { removeFromCart(id); render(); };

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

  window.sendChat = () => {
    const inp = document.getElementById('chatMsg');
    const txt = inp?.value?.trim();
    if (!txt || !chatSocket) return;
    chatSocket.emit('customer_message', { tableNumber, message: txt });
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
