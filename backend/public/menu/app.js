// Hotel Digital Menu PWA
// Offline-first: Service Worker caches after first load
// Supports: Browse menu → Add to cart → Place order → Admin sees it

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────
  let menuData = null;
  let hotelId = null;
  let activeCategory = 'all';
  let searchQuery = '';
  let isOffline = !navigator.onLine;
  let cart = {}; // { productId: { product, qty } }
  let view = 'menu'; // 'menu' | 'cart' | 'confirm' | 'chat'
  let chatMessages = [];
  let chatSocket = null;
  let chatUnread = 0;

  // Read table number from URL ?table=1
  const urlParams = new URLSearchParams(window.location.search);
  const tableNumber = urlParams.get('table') || '';

  // ─── Register Service Worker ──────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/menu/sw.js').catch(() => {});
  }

  // ─── Online/Offline ───────────────────────────────────────
  window.addEventListener('online', () => { isOffline = false; updateOfflineBadge(); fetchMenu(true); });
  window.addEventListener('offline', () => { isOffline = true; updateOfflineBadge(); showToast('Offline – showing cached menu'); });

  function updateOfflineBadge() {
    const b = document.querySelector('.offline-badge');
    if (b) b.classList.toggle('show', isOffline);
  }

  // ─── Cart helpers ─────────────────────────────────────────
  function cartCount() {
    return Object.values(cart).reduce((s, i) => s + i.qty, 0);
  }
  function cartTotal() {
    return Object.values(cart).reduce((s, i) => s + i.product.price * i.qty, 0);
  }
  function addToCart(product) {
    if (cart[product._id]) {
      cart[product._id].qty += 1;
    } else {
      cart[product._id] = { product, qty: 1 };
    }
    updateCartBadge();
    showToast(`${product.name} added!`);
    render();
  }
  function removeFromCart(productId) {
    if (cart[productId]) {
      cart[productId].qty -= 1;
      if (cart[productId].qty <= 0) delete cart[productId];
    }
    updateCartBadge();
    render();
  }
  function clearCart() {
    cart = {};
    updateCartBadge();
  }
  function updateCartBadge() {
    const badge = document.querySelector('.cart-badge');
    const count = cartCount();
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  // ─── Fetch menu ───────────────────────────────────────────
  async function fetchMenu(silent = false) {
    if (!silent) renderLoader();
    try {
      const res = await fetch('/api/public/menu');
      if (!res.ok) throw new Error();
      menuData = await res.json();
      if (menuData.hotel?.id) hotelId = menuData.hotel.id;
      if (menuData.offline) isOffline = true;
      render();
    } catch {
      if (!silent) renderError();
    }
  }

  // ─── Place order API ──────────────────────────────────────
  async function placeOrder(customerName) {
    const items = Object.values(cart).map(({ product, qty }) => {
      const taxAmount = (product.price * qty * (product.taxPercent || 0)) / 100;
      return {
        product: product._id,
        productName: product.name,
        quantity: qty,
        price: product.price,
        taxPercent: product.taxPercent || 0,
        taxAmount,
        total: product.price * qty + taxAmount,
      };
    });

    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const taxTotal = items.reduce((s, i) => s + i.taxAmount, 0);
    const grandTotal = subtotal + taxTotal;

    const payload = {
      hotel: hotelId,
      items,
      subtotal,
      taxTotal,
      grandTotal,
      paymentMethod: 'cash',
      status: 'pending',
      tableNumber: tableNumber || 'Walk-in',
      customerName: customerName || 'Table ' + (tableNumber || 'Walk-in'),
      notes: `Order from Table ${tableNumber || 'Walk-in'} via QR Menu`,
    };

    const res = await fetch('/api/public/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error('Order failed');
    return res.json();
  }

  // ─── Emoji helpers ────────────────────────────────────────
  const catEmoji = { meals:'🍽️', biryani:'🍛', starters:'🍢', drinks:'☕', snacks:'🍟', desserts:'🍨', juice:'🥤', default:'🍴' };
  const prodEmoji = { rice:'🍚', biryani:'🍛', chicken:'🍗', fish:'🐟', tea:'☕', coffee:'☕', juice:'🥤', shake:'🥤', ice:'🍦', cake:'🎂', dosa:'🫓', idli:'🥞', curry:'🍛', noodle:'🍜', default:'🍴' };
  function getCatEmoji(n) { const k=n.toLowerCase(); for(const[ky,v] of Object.entries(catEmoji)) if(k.includes(ky)) return v; return catEmoji.default; }
  function getProdEmoji(n) { const k=n.toLowerCase(); for(const[ky,v] of Object.entries(prodEmoji)) if(k.includes(ky)) return v; return prodEmoji.default; }

  // ─── Filter products ──────────────────────────────────────
  function filteredProducts() {
    if (!menuData) return [];
    let list = menuData.products;
    if (activeCategory !== 'all') list = list.filter(p => (p.category?._id || p.category) === activeCategory);
    if (searchQuery.trim()) { const q = searchQuery.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)); }
    return list;
  }

  // ─── Main render ─────────────────────────────────────────
  function render() {
    if (view === 'cart') renderCart();
    else if (view === 'confirm') renderConfirm();
    else if (view === 'chat') renderChat();
    else renderMenu();
  }

  function renderLoader() {
    document.getElementById('app').innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading menu...</p></div>`;
  }

  function renderError() {
    document.getElementById('app').innerHTML = `
      <div class="loader"><div class="empty-state">
        <div class="icon">😕</div><p>Could not load menu.</p>
        <button onclick="location.reload()" class="btn-primary" style="margin-top:20px">Retry</button>
      </div></div>`;
  }

  // ─── Menu view ────────────────────────────────────────────
  function renderMenu() {
    const { hotel, categories } = menuData;
    const products = filteredProducts();
    const count = cartCount();
    const total = cartTotal();
    const currency = hotel.currency || '₹';

    // Group by category when showing all
    const grouped = {};
    products.forEach(p => {
      const n = p.category?.name || 'Other';
      if (!grouped[n]) grouped[n] = [];
      grouped[n].push(p);
    });

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <div>
            <div class="hotel-name">${hotel.name || 'Our Menu'}</div>
            ${tableNumber ? `<div class="hotel-sub">🪑 Table ${tableNumber}</div>` : ''}
            ${hotel.address ? `<div class="hotel-sub">📍 ${hotel.address}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px">
            ${tableNumber ? `
            <button class="cart-btn" onclick="switchView('chat')" style="font-size:18px">
              💬
              <span id="chat-badge" class="cart-badge" style="display:none;background:#ff9800">0</span>
            </button>` : ''}
            <button class="cart-btn" onclick="switchView('cart')">
              <span class="cart-icon">🛒</span>
              <span class="cart-badge" style="display:${count>0?'flex':'none'}">${count}</span>
            </button>
          </div>
        </div>
        <div class="offline-badge ${isOffline?'show':''}">📵 Offline Mode</div>
      </div>

      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="search-input" type="text" placeholder="Search dishes..."
          value="${searchQuery}" oninput="handleSearch(this.value)" />
      </div>

      <div class="categories-wrap">
        <div class="categories-inner">
          <button class="cat-btn ${activeCategory==='all'?'active':''}" onclick="handleCategory('all')">🍴 All</button>
          ${categories.map(cat => `
            <button class="cat-btn ${activeCategory===cat._id?'active':''}" onclick="handleCategory('${cat._id}')">
              <span class="cat-dot" style="background:${cat.color}"></span>
              ${getCatEmoji(cat.name)} ${cat.name}
            </button>`).join('')}
        </div>
      </div>

      <div id="products-area">
        ${products.length === 0
          ? `<div class="empty-state"><div class="icon">🔍</div><p>No items found</p></div>`
          : activeCategory === 'all'
            ? Object.entries(grouped).map(([catName, items]) => `
                <div class="section-title">${catName}</div>
                <div class="products-grid">${items.map(p => productCard(p, currency)).join('')}</div>
              `).join('')
            : `<div class="products-grid" style="padding-top:12px">${products.map(p => productCard(p, currency)).join('')}</div>`
        }
      </div>

      ${count > 0 ? `
        <div class="cart-footer" onclick="switchView('cart')">
          <span>${count} item${count>1?'s':''}</span>
          <span>View Order</span>
          <span>${currency}${total.toFixed(0)}</span>
        </div>` : ''}

      <div class="footer">
        ${hotel.name || 'Menu'} ${hotel.phone ? `· 📞 ${hotel.phone}` : ''}
        <div style="margin-top:4px;font-size:11px;opacity:0.6">
          ${isOffline ? '📵 Offline mode' : '✅ Live menu'} · ${menuData.products.length} items
        </div>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  function productCard(p, currency) {
    const inCart = cart[p._id]?.qty || 0;
    const emoji = getProdEmoji(p.name);
    const hasImg = p.image && p.image.trim();
    return `
      <div class="product-card">
        ${hasImg
          ? `<img class="product-img" src="${p.image}" alt="${p.name}" onerror="this.outerHTML='<div class=\\'product-img placeholder\\'>${emoji}</div>'">`
          : `<div class="product-img placeholder">${emoji}</div>`}
        <div class="product-info">
          <div class="product-header">
            <div class="veg-dot ${p.isVeg?'veg':'non-veg'}"></div>
            <span class="product-name">${p.name}</span>
          </div>
          <div class="product-cat">${p.category?.name||''}${p.description ? ` · <span style="font-style:italic">${p.description}</span>` : ''}</div>
          <div class="product-footer">
            <span class="product-price">${currency}${p.price.toFixed(0)}</span>
            ${p.taxPercent>0 ? `<span class="product-tax">GST ${p.taxPercent}%</span>` : ''}
            <div class="qty-control">
              ${inCart > 0
                ? `<button class="qty-btn minus" onclick="handleRemove('${p._id}')">−</button>
                   <span class="qty-num">${inCart}</span>
                   <button class="qty-btn plus" onclick="handleAdd('${JSON.stringify(p).replace(/"/g,'&quot;')}')">+</button>`
                : `<button class="add-btn" onclick="handleAdd('${JSON.stringify(p).replace(/"/g,'&quot;')}')">+ Add</button>`}
            </div>
          </div>
        </div>
      </div>`;
  }

  // ─── Cart view ────────────────────────────────────────────
  function renderCart() {
    const items = Object.values(cart);
    const currency = menuData?.hotel?.currency || '₹';
    const subtotal = cartTotal();
    const taxTotal = items.reduce((s, {product, qty}) => s + (product.price * qty * (product.taxPercent||0)/100), 0);
    const grand = subtotal + taxTotal;

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <button class="back-btn" onclick="switchView('menu')">← Menu</button>
          <div class="hotel-name" style="font-size:18px">Your Order</div>
          ${tableNumber ? `<div style="font-size:12px;opacity:0.8">Table ${tableNumber}</div>` : '<div></div>'}
        </div>
      </div>

      <div class="cart-body">
        ${items.length === 0
          ? `<div class="empty-state" style="padding:60px 20px">
               <div class="icon">🛒</div>
               <p>Your cart is empty</p>
               <button class="btn-primary" onclick="switchView('menu')" style="margin-top:16px">Browse Menu</button>
             </div>`
          : `
            ${items.map(({product, qty}) => `
              <div class="cart-item">
                <div class="cart-item-info">
                  <div class="veg-dot ${product.isVeg?'veg':'non-veg'}" style="flex-shrink:0"></div>
                  <div>
                    <div class="cart-item-name">${product.name}</div>
                    <div class="cart-item-price">${currency}${product.price.toFixed(0)} each</div>
                  </div>
                </div>
                <div class="qty-control">
                  <button class="qty-btn minus" onclick="handleRemove('${product._id}')">−</button>
                  <span class="qty-num">${qty}</span>
                  <button class="qty-btn plus" onclick="handleAdd('${JSON.stringify(product).replace(/"/g,'&quot;')}')">+</button>
                </div>
                <div class="cart-item-total">${currency}${(product.price*qty).toFixed(0)}</div>
              </div>`).join('')}

            <div class="cart-summary">
              <div class="summary-row"><span>Subtotal</span><span>${currency}${subtotal.toFixed(2)}</span></div>
              <div class="summary-row"><span>Tax (GST)</span><span>${currency}${taxTotal.toFixed(2)}</span></div>
              <div class="summary-row grand"><span>TOTAL</span><span>${currency}${grand.toFixed(2)}</span></div>
            </div>

            <button class="btn-primary" onclick="switchView('confirm')" style="margin:16px;width:calc(100% - 32px)">
              Confirm Order — ${currency}${grand.toFixed(0)}
            </button>
          `}
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Confirm view ─────────────────────────────────────────
  function renderConfirm() {
    const currency = menuData?.hotel?.currency || '₹';
    const grand = cartTotal() + Object.values(cart).reduce((s,{product,qty}) => s + product.price*qty*(product.taxPercent||0)/100, 0);

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <button class="back-btn" onclick="switchView('cart')">← Back</button>
          <div class="hotel-name" style="font-size:18px">Confirm Order</div>
          <div></div>
        </div>
      </div>

      <div class="cart-body" style="padding:20px">
        <div class="confirm-card">
          <div class="confirm-icon">🪑</div>
          <div class="confirm-title">Table ${tableNumber || 'Walk-in'}</div>
          <div class="confirm-total">${currency}${grand.toFixed(2)}</div>
          <div class="confirm-sub">${cartCount()} items · Payment at counter</div>
        </div>

        <div class="confirm-note">
          <p style="font-size:13px;color:#b0b8c9;margin-bottom:8px">Optional: Your name</p>
          <input id="customerName" class="search-input" type="text" placeholder="e.g. Ravi" style="margin-bottom:0" />
        </div>

        <button class="btn-primary btn-large" onclick="submitOrder()" style="margin-top:20px;width:100%">
          🍽️ Place Order
        </button>
        <button onclick="switchView('cart')" style="
          width:100%;margin-top:12px;background:transparent;
          border:1px solid #444;color:#aaa;padding:14px;
          border-radius:12px;font-size:15px;cursor:pointer">
          Cancel
        </button>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Order success view ───────────────────────────────────
  function renderSuccess(order) {
    document.getElementById('app').innerHTML = `
      <div class="success-screen">
        <div class="success-icon">✅</div>
        <h2 class="success-title">Order Placed!</h2>
        <p class="success-num">Order #${order.orderNumber || ''}</p>
        <p class="success-sub">Your order has been sent to the kitchen.<br>Please pay at the counter.</p>
        <div class="success-detail">
          <div>🪑 Table ${tableNumber || 'Walk-in'}</div>
          <div>💰 ${menuData?.hotel?.currency || '₹'}${order.grandTotal?.toFixed(2) || ''}</div>
        </div>
        <button class="btn-primary" onclick="resetAndGoMenu()" style="margin-top:28px;width:100%">
          Order More
        </button>
      </div>
      <div class="toast" id="toast"></div>
    `;
  }

  // ─── Global handlers ──────────────────────────────────────
  window.switchView = (v) => { view = v; render(); };
  window.handleCategory = (id) => { activeCategory = id; render(); window.scrollTo({top:100,behavior:'smooth'}); };
  window.handleSearch = (val) => { searchQuery = val; render(); };

  window.handleAdd = (productJson) => {
    try { addToCart(JSON.parse(productJson.replace(/&quot;/g, '"'))); }
    catch(e) { console.error(e); }
  };
  window.handleRemove = (id) => { removeFromCart(id); };

  window.submitOrder = async () => {
    const name = document.getElementById('customerName')?.value || '';
    const btn = document.querySelector('.btn-large');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }
    try {
      const order = await placeOrder(name);
      clearCart();
      view = 'menu';
      renderSuccess(order);
    } catch {
      showToast('Failed to place order. Check connection.');
      if (btn) { btn.disabled = false; btn.textContent = '🍽️ Place Order'; }
    }
  };

  window.resetAndGoMenu = () => {
    view = 'menu';
    activeCategory = 'all';
    searchQuery = '';
    render();
  };

  // ─── Toast ────────────────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.className='toast'; t.id='toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  // ─── Chat (Socket.io) ─────────────────────────────────────
  function initChat() {
    if (chatSocket || !tableNumber) return;
    const scriptEl = document.createElement('script');
    scriptEl.src = '/socket.io/socket.io.js';
    scriptEl.onload = () => {
      chatSocket = window.io({ transports: ['websocket'] });
      chatSocket.emit('join', tableNumber);
      chatSocket.on('new_message', (msg) => {
        if (msg.tableNumber !== tableNumber) return;
        chatMessages.push(msg);
        if (view !== 'chat' && msg.sender === 'admin') {
          chatUnread++;
          showToast(`💬 Staff: ${msg.message}`);
          updateChatBadge();
        }
        if (view === 'chat') renderChat();
      });
    };
    document.head.appendChild(scriptEl);
  }

  function updateChatBadge() {
    const badge = document.getElementById('chat-badge');
    if (badge) {
      badge.textContent = chatUnread;
      badge.style.display = chatUnread > 0 ? 'flex' : 'none';
    }
  }

  function sendChatMessage(text) {
    if (!chatSocket || !text.trim() || !tableNumber) return;
    chatSocket.emit('customer_message', { tableNumber, message: text.trim() });
  }

  function renderChat() {
    chatUnread = 0;
    updateChatBadge();
    const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-top">
          <button class="back-btn" onclick="switchView('menu')">← Menu</button>
          <div class="hotel-name" style="font-size:17px">💬 Chat with Staff</div>
          ${tableNumber ? `<div style="font-size:11px;opacity:0.8">Table ${tableNumber}</div>` : '<div></div>'}
        </div>
      </div>

      <div class="chat-messages" id="chat-messages">
        ${chatMessages.length === 0
          ? `<div style="text-align:center;padding:40px 20px;color:#b0b8c9;font-size:14px">
               <div style="font-size:40px;margin-bottom:10px">💬</div>
               <p>Send a message to our staff</p>
               <p style="font-size:12px;margin-top:6px">e.g. "Need an extra plate", "Water please"</p>
             </div>`
          : chatMessages.map(m => `
            <div style="display:flex;justify-content:${m.sender==='admin'?'flex-start':'flex-end'};margin-bottom:10px">
              <div style="
                max-width:75%;background:${m.sender==='admin'?'#0f3460':'#FF6B35'};
                color:#fff;border-radius:${m.sender==='admin'?'16px 16px 16px 4px':'16px 16px 4px 16px'};
                padding:10px 14px;font-size:14px;line-height:1.4">
                ${m.sender==='admin'?'<div style="font-size:10px;opacity:0.7;margin-bottom:3px">Staff</div>':''}
                ${m.message}
                <div style="font-size:10px;opacity:0.6;margin-top:4px;text-align:right">${formatTime(m.createdAt||new Date())}</div>
              </div>
            </div>`).join('')}
      </div>

      <div class="chat-input-row">
        <input id="chat-input" class="search-input" type="text" placeholder="Type a message..."
          style="margin-bottom:0" onkeydown="if(event.key==='Enter')sendChat()" />
        <button onclick="sendChat()" class="add-btn" style="flex-shrink:0;padding:10px 16px;border-radius:12px">Send</button>
      </div>
      <div class="toast" id="toast"></div>
    `;
    // Scroll to bottom
    setTimeout(() => {
      const el = document.getElementById('chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  window.sendChat = function() {
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    const now = new Date().toISOString();
    chatMessages.push({ sender: 'customer', message: text, createdAt: now, tableNumber });
    sendChatMessage(text);
    input.value = '';
    renderChat();
  };

  // ─── Init ─────────────────────────────────────────────────
  fetchMenu();
  if (tableNumber) initChat();
})();
