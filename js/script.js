/* ===========================================================
   Mixio Organic — Shared site behaviour
   =========================================================== */

document.addEventListener('DOMContentLoaded', () => {

  const COMPANY_EMAIL = 'oilsmixio@gmail.com';

  const formatEuro = (n) => '€ ' + n.toFixed(2).replace('.', ',');

  /* ---------- Taal (gebruikt door dynamisch gerenderde tekst) ---------- */
  const LANG_KEY = 'mixioLang';
  const getLang = () => localStorage.getItem(LANG_KEY) || 'nl';
  const t = (nl, en) => (getLang() === 'en' ? en : nl);

  /* ---------- Cart core (client-side, localStorage) ---------- */
  const CART_KEY = 'mixioCart';
  const MAX_QTY = 10;

  function getCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function updateCartBadge() {
    const count = getCart().reduce((sum, item) => sum + item.qty, 0);
    document.querySelectorAll('.cart-badge').forEach(el => {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  function addToCart({ product, size, price, qty }) {
    const id = `${product}|${size}`;
    const cart = getCart();
    const existing = cart.find(item => item.id === id);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    } else {
      cart.push({ id, product, size, price, qty: Math.min(MAX_QTY, Math.max(1, qty)) });
    }
    saveCart(cart);
  }

  function updateCartItemQty(id, qty) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.min(MAX_QTY, Math.max(1, qty));
    saveCart(cart);
  }

  function removeFromCart(id) {
    saveCart(getCart().filter(i => i.id !== id));
  }

  /* ---------- Prijsberekening: staffelkorting per productregel ---------- */
  // 1 stuk = normale prijs, 2 stuks = 25% korting, 3+ stuks = 35% korting.
  // Moet exact in de pas lopen met get_discount_rate() in app.py.
  const DISCOUNT_TIERS = [[3, 0.35], [2, 0.25]];
  const VAT_RATE = 0.21;

  function getDiscountRate(qty) {
    for (const [minQty, rate] of DISCOUNT_TIERS) {
      if (qty >= minQty) return rate;
    }
    return 0;
  }

  // Prijzen zijn inclusief btw; dit haalt het btw-deel uit een totaalbedrag.
  function getVatAmount(total) {
    return total - (total / (1 + VAT_RATE));
  }

  function getLinePricing(item) {
    const subtotal = item.price * item.qty;
    const discount = subtotal * getDiscountRate(item.qty);
    return { subtotal, discount, total: subtotal - discount };
  }

  function getCartPricing(cart) {
    return cart.reduce((acc, item) => {
      const line = getLinePricing(item);
      acc.subtotal += line.subtotal;
      acc.discount += line.discount;
      acc.total += line.total;
      return acc;
    }, { subtotal: 0, discount: 0, total: 0 });
  }

  updateCartBadge();

  /* ---------- Blog-slideshow (homepage) ---------- */
  const blogSlideshow = document.getElementById('blogSlideshow');
  if (blogSlideshow) {
    const slides = blogSlideshow.querySelectorAll('.blog-slide');
    const dots = document.querySelectorAll('#blogSlideDots button');
    let current = 0;
    let slideTimer;

    const showSlide = (index) => {
      current = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === current));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === current));
    };

    const startAutoplay = () => {
      clearInterval(slideTimer);
      slideTimer = setInterval(() => showSlide(current + 1), 6000);
    };

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        showSlide(i);
        startAutoplay();
      });
    });

    startAutoplay();
  }

  /* ---------- Promo banner countdown (48u, gedeeld via localStorage) ---------- */
  const promoBanner = document.getElementById('promoBanner');
  if (promoBanner) {
    if (sessionStorage.getItem('mixioPromoDismissed') === '1') {
      promoBanner.classList.add('hidden');
    } else {
      const STORAGE_KEY = 'mixioPromoDeadline';
      const DURATION_MS = 48 * 60 * 60 * 1000;
      let deadline = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      if (!deadline || deadline < Date.now()) {
        deadline = Date.now() + DURATION_MS;
        localStorage.setItem(STORAGE_KEY, String(deadline));
      }

      const hoursEls = document.querySelectorAll('.promo-hours');
      const minutesEls = document.querySelectorAll('.promo-minutes');
      const secondsEls = document.querySelectorAll('.promo-seconds');
      const pad = n => String(n).padStart(2, '0');
      let promoTimerId;

      const tickPromo = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          promoBanner.classList.add('hidden');
          if (promoTimerId) clearInterval(promoTimerId);
          return;
        }
        const totalSeconds = Math.floor(remaining / 1000);
        const h = pad(Math.floor(totalSeconds / 3600));
        const m = pad(Math.floor((totalSeconds % 3600) / 60));
        const s = pad(totalSeconds % 60);
        hoursEls.forEach(el => el.textContent = h);
        minutesEls.forEach(el => el.textContent = m);
        secondsEls.forEach(el => el.textContent = s);
      };
      tickPromo();
      promoTimerId = setInterval(tickPromo, 1000);
    }

    document.getElementById('promoBannerClose')?.addEventListener('click', () => {
      promoBanner.classList.add('hidden');
      sessionStorage.setItem('mixioPromoDismissed', '1');
    });
  }

  /* ---------- Promo popup (10% korting-teaser, eenmaal per sessie) ---------- */
  const promoPopup = document.getElementById('promoPopup');
  if (promoPopup) {
    const POPUP_KEY = 'mixioPromoPopupShown';
    const closePromoPopup = () => {
      promoPopup.classList.remove('open');
      document.body.style.overflow = '';
    };
    if (!sessionStorage.getItem(POPUP_KEY)) {
      sessionStorage.setItem(POPUP_KEY, '1');
      setTimeout(() => {
        promoPopup.classList.add('open');
        document.body.style.overflow = 'hidden';
      }, 4000);
    }
    promoPopup.querySelectorAll('[data-promo-popup-close]').forEach(el => {
      el.addEventListener('click', closePromoPopup);
    });
    promoPopup.addEventListener('click', (e) => {
      if (e.target === promoPopup) closePromoPopup();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePromoPopup();
    });
  }

  /* ---------- Fake chat widget ---------- */
  const chatWidget = document.getElementById('chatWidget');
  if (chatWidget) {
    const chatToggle = document.getElementById('chatToggle');
    const chatWindow = document.getElementById('chatWindow');
    const chatClose = document.getElementById('chatClose');
    const chatBody = document.getElementById('chatBody');
    const CHAT_MESSAGES = t(
      ['Hallo, jij daar?', 'Welkom op de Mixio website!', 'Waar ben je naar op zoek?'],
      ['Hi, is that you?', 'Welcome to the Mixio website!', 'What are you looking for?']
    );
    let chatPlayed = false;

    const openChat = () => chatWindow.classList.add('open');
    const closeChat = () => chatWindow.classList.remove('open');

    const addChatBubble = (text) => {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = text;
      chatBody.appendChild(bubble);
      chatBody.scrollTop = chatBody.scrollHeight;
    };

    const addChatTyping = () => {
      const typing = document.createElement('div');
      typing.className = 'chat-typing';
      typing.id = 'chatTypingIndicator';
      typing.innerHTML = '<span></span><span></span><span></span>';
      chatBody.appendChild(typing);
      chatBody.scrollTop = chatBody.scrollHeight;
    };

    const removeChatTyping = () => {
      document.getElementById('chatTypingIndicator')?.remove();
    };

    const addChatQuickReplies = () => {
      const wrap = document.createElement('div');
      wrap.className = 'chat-quick-replies';
      wrap.innerHTML =
        '<button class="chat-quick-reply" data-chat-link="diensten.html">Treatments</button>' +
        '<button class="chat-quick-reply" data-chat-link="producten.html">Products</button>';
      chatBody.appendChild(wrap);
      chatBody.scrollTop = chatBody.scrollHeight;
      wrap.querySelectorAll('[data-chat-link]').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.href = btn.dataset.chatLink;
        });
      });
    };

    const playChatConversation = () => {
      let delay = 300;
      CHAT_MESSAGES.forEach((msg, i) => {
        setTimeout(() => {
          addChatTyping();
          setTimeout(() => {
            removeChatTyping();
            addChatBubble(msg);
            if (i === CHAT_MESSAGES.length - 1) {
              setTimeout(addChatQuickReplies, 500);
            }
          }, 700);
        }, delay);
        delay += 1500;
      });
    };

    const ensureChatConversation = () => {
      if (chatPlayed) return;
      chatPlayed = true;
      playChatConversation();
    };

    chatToggle.addEventListener('click', () => {
      if (chatWindow.classList.contains('open')) {
        closeChat();
      } else {
        openChat();
        ensureChatConversation();
      }
    });
    chatClose.addEventListener('click', closeChat);

    const CHAT_KEY = 'mixioChatAutoOpened';
    if (!sessionStorage.getItem(CHAT_KEY)) {
      sessionStorage.setItem(CHAT_KEY, '1');
      setTimeout(() => {
        if (!chatPlayed) {
          openChat();
          ensureChatConversation();
        }
      }, 600);
    }
  }

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });
    navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      navLinks.classList.remove('open');
    }));
  }

  /* ---------- Reveal-on-scroll (funnel storytelling effect) ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in'));
  }

  /* ---------- Funnel progress rail (homepage only) ---------- */
  const rail = document.querySelector('.funnel-rail');
  if (rail) {
    const dots = Array.from(rail.querySelectorAll('button'));
    const targets = dots.map(d => document.getElementById(d.dataset.target)).filter(Boolean);

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const target = document.getElementById(dot.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });

    if ('IntersectionObserver' in window) {
      const railIO = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            dots.forEach(d => d.classList.toggle('active', d.dataset.target === id));
          }
        });
      }, { threshold: 0.5 });
      targets.forEach(t => railIO.observe(t));
    }
  }

  /* ---------- FAQ: only one open at a time ---------- */
  document.querySelectorAll('.faq-item').forEach(item => {
    item.addEventListener('toggle', () => {
      if (item.open) {
        document.querySelectorAll('.faq-item').forEach(other => {
          if (other !== item) other.open = false;
        });
      }
    });
  });

  /* ---------- Product page: quantity stepper ---------- */
  const qtyInput = document.querySelector('.qty-stepper input');
  const qtyMinus = document.querySelector('.qty-stepper .qty-minus');
  const qtyPlus = document.querySelector('.qty-stepper .qty-plus');
  if (qtyInput && qtyMinus && qtyPlus) {
    const clamp = (n) => Math.min(10, Math.max(1, n));
    qtyMinus.addEventListener('click', () => {
      qtyInput.value = clamp(parseInt(qtyInput.value || '1', 10) - 1);
    });
    qtyPlus.addEventListener('click', () => {
      qtyInput.value = clamp(parseInt(qtyInput.value || '1', 10) + 1);
    });
    qtyInput.addEventListener('change', () => {
      qtyInput.value = clamp(parseInt(qtyInput.value || '1', 10));
    });
  }

  /* ---------- Product page: bundle picker (drives the hidden qty input) ---------- */
  const bundleOptions = document.querySelectorAll('.bundle-option');
  if (bundleOptions.length && qtyInput) {
    bundleOptions.forEach(option => {
      const radio = option.querySelector('input[type="radio"]');
      radio?.addEventListener('change', () => {
        if (!radio.checked) return;
        qtyInput.value = option.dataset.qty;
        bundleOptions.forEach(o => o.classList.toggle('is-selected', o === option));
      });
    });
  }

  const priceCurrentEl = document.querySelector('.price-row .price-current');

  /* ---------- Product page: tabs ---------- */
  const tabButtons = document.querySelectorAll('.tab-headers button');
  const tabPanels = document.querySelectorAll('.tab-panel');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab)?.classList.add('active');
    });
  });

  /* ---------- Product page: add to cart ---------- */
  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', () => {
      const price = parseFloat((priceCurrentEl?.textContent || '€ 0,00').replace('€', '').replace(',', '.').trim());
      const qty = parseInt(qtyInput?.value || '1', 10);
      addToCart({
        product: btn.dataset.product || 'Mixio Organic product',
        size: btn.dataset.size || '',
        price,
        qty
      });
      window.location.href = 'cart.html';
    });
  });

  /* ---------- Cart page ---------- */
  const cartItemsEl = document.getElementById('cartItems');
  const cartEmptyEl = document.getElementById('cartEmpty');
  const cartContentEl = document.getElementById('cartContent');
  const cartSubtotalEl = document.getElementById('cartSubtotal');
  const cartDiscountRowEl = document.getElementById('cartDiscountRow');
  const cartDiscountEl = document.getElementById('cartDiscount');
  const cartTotalEl = document.getElementById('cartTotal');
  const cartVatEl = document.getElementById('cartVat');

  function renderCart() {
    if (!cartItemsEl) return;
    const cart = getCart();

    if (cartEmptyEl) cartEmptyEl.hidden = cart.length > 0;
    if (cartContentEl) cartContentEl.hidden = cart.length === 0;
    if (cart.length === 0) {
      cartItemsEl.innerHTML = '';
      return;
    }

    cartItemsEl.innerHTML = cart.map(item => {
      const line = getLinePricing(item);
      const ratePct = Math.round(getDiscountRate(item.qty) * 100);
      const discountNote = line.discount > 0
        ? `<div class="cart-item-discount">${t(`${ratePct}% korting toegepast`, `${ratePct}% discount applied`)}</div>`
        : '';
      return `
      <div class="cart-item" data-id="${item.id}">
        <div class="cart-item-img"><img src="assets/img/hair-food-oil.jpg" alt="${item.product}"></div>
        <div class="cart-item-info">
          <h3>${item.product}</h3>
          <div class="cart-item-size">${item.size}</div>
          <div class="cart-item-price">${formatEuro(item.price)} ${t('per stuk', 'each')}</div>
        </div>
        <div class="cart-item-side">
          <div class="cart-item-subtotal">${formatEuro(line.total)}</div>
          ${discountNote}
          <div class="qty-stepper">
            <button type="button" class="cart-qty-minus" aria-label="${t('Minder', 'Decrease')}">−</button>
            <input type="text" class="cart-qty-input" value="${item.qty}" inputmode="numeric" aria-label="${t('Aantal', 'Quantity')}" readonly>
            <button type="button" class="cart-qty-plus" aria-label="${t('Meer', 'Increase')}">+</button>
          </div>
          <button type="button" class="cart-item-remove">${t('Verwijderen', 'Remove')}</button>
        </div>
      </div>
    `;
    }).join('');

    const pricing = getCartPricing(cart);
    if (cartSubtotalEl) cartSubtotalEl.textContent = formatEuro(pricing.subtotal);
    if (cartDiscountRowEl) cartDiscountRowEl.hidden = pricing.discount <= 0;
    if (cartDiscountEl) cartDiscountEl.textContent = '− ' + formatEuro(pricing.discount);
    if (cartTotalEl) cartTotalEl.textContent = formatEuro(pricing.total);
    if (cartVatEl) cartVatEl.textContent = formatEuro(getVatAmount(pricing.total));
  }

  if (cartItemsEl) {
    renderCart();
    cartItemsEl.addEventListener('click', (e) => {
      const row = e.target.closest('.cart-item');
      if (!row) return;
      const id = row.dataset.id;
      const item = getCart().find(i => i.id === id);
      if (e.target.classList.contains('cart-qty-plus') && item) {
        updateCartItemQty(id, item.qty + 1);
        renderCart();
      } else if (e.target.classList.contains('cart-qty-minus') && item) {
        if (item.qty <= 1) removeFromCart(id);
        else updateCartItemQty(id, item.qty - 1);
        renderCart();
      } else if (e.target.classList.contains('cart-item-remove')) {
        removeFromCart(id);
        renderCart();
      }
    });
  }

  /* ---------- Checkout page ---------- */
  const checkoutSummaryEl = document.getElementById('checkoutSummary');
  const checkoutSubtotalEl = document.getElementById('checkoutSubtotal');
  const checkoutDiscountRowEl = document.getElementById('checkoutDiscountRow');
  const checkoutDiscountEl = document.getElementById('checkoutDiscount');
  const checkoutTotalEl = document.getElementById('checkoutTotal');
  const checkoutVatEl = document.getElementById('checkoutVat');
  const checkoutEmptyEl = document.getElementById('checkoutEmpty');
  const checkoutContentEl = document.getElementById('checkoutContent');
  const checkoutForm = document.getElementById('checkoutForm');

  function renderCheckoutSummary() {
    if (!checkoutSummaryEl) return;
    const cart = getCart();

    if (checkoutEmptyEl) checkoutEmptyEl.hidden = cart.length > 0;
    if (checkoutContentEl) checkoutContentEl.hidden = cart.length === 0;
    if (cart.length === 0) {
      checkoutSummaryEl.innerHTML = '';
      return;
    }

    checkoutSummaryEl.innerHTML = cart.map(item => {
      const line = getLinePricing(item);
      return `
      <div class="checkout-summary-item">
        <span>${item.qty} x ${item.product} (${item.size})</span>
        <strong>${formatEuro(line.total)}</strong>
      </div>
    `;
    }).join('');

    const pricing = getCartPricing(cart);
    if (checkoutSubtotalEl) checkoutSubtotalEl.textContent = formatEuro(pricing.subtotal);
    if (checkoutDiscountRowEl) checkoutDiscountRowEl.hidden = pricing.discount <= 0;
    if (checkoutDiscountEl) checkoutDiscountEl.textContent = '− ' + formatEuro(pricing.discount);
    if (checkoutTotalEl) checkoutTotalEl.textContent = formatEuro(pricing.total);
    if (checkoutVatEl) checkoutVatEl.textContent = formatEuro(getVatAmount(pricing.total));
  }
  renderCheckoutSummary();

  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cart = getCart();
      if (cart.length === 0) return;

      const data = new FormData(checkoutForm);
      const customer = {
        naam: data.get('naam') || '',
        email: data.get('email') || '',
        adres: data.get('adres') || '',
        postcode: data.get('postcode') || '',
        plaats: data.get('plaats') || '',
        telefoon: data.get('telefoon') || '',
        opmerkingen: data.get('opmerkingen') || ''
      };

      const msg = document.getElementById('checkoutMsg');
      const submitBtn = checkoutForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      if (msg) {
        msg.textContent = t('Je wordt doorgestuurd naar Mollie om te betalen...', 'You are being redirected to Mollie to pay...');
        msg.classList.remove('success', 'error');
        msg.classList.add('show');
      }

      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart, customer })
        });
        const result = await res.json();
        if (!res.ok || !result.checkoutUrl) {
          throw new Error(result.error || 'Onbekende fout bij Mollie.');
        }
        saveCart([]);
        window.location.href = result.checkoutUrl;
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (msg) {
          msg.textContent = /uitverkocht/i.test(err.message || '')
            ? t(err.message, 'Sorry, this product just sold out. Please remove it from your cart.')
            : t(
              'Er ging iets mis bij het doorsturen naar Mollie. Probeer het opnieuw, of stuur je bestelling per e-mail naar ' + COMPANY_EMAIL + '.',
              'Something went wrong redirecting to Mollie. Please try again, or email your order to ' + COMPANY_EMAIL + '.'
            );
          msg.classList.remove('success');
          msg.classList.add('show', 'error');
        }
      }
    });
  }

  /* ---------- Contact form (fallback: opens mail client) ---------- */
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(contactForm);
      const subject = encodeURIComponent(`Contactformulier: ${data.get('naam') || 'Website bezoeker'}`);
      const body = encodeURIComponent(
        `Naam: ${data.get('naam') || ''}\nE-mail: ${data.get('email') || ''}\nTelefoon: ${data.get('telefoon') || ''}\n\nBericht:\n${data.get('bericht') || ''}`
      );
      window.location.href = `mailto:${COMPANY_EMAIL}?subject=${subject}&body=${body}`;

      const msg = document.getElementById('formMsg');
      if (msg) {
        msg.textContent = t(
          'Je e-mailprogramma wordt geopend om het bericht te versturen naar ' + COMPANY_EMAIL + '.',
          'Your email app will open to send the message to ' + COMPANY_EMAIL + '.'
        );
        msg.classList.add('show', 'success');
      }
    });
  }

  /* ---------- Footer year ---------- */
  function fillFooterYear() {
    document.querySelectorAll('[data-year]').forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  }
  fillFooterYear();

  /* ---------- Taalwissel (NL/EN) ---------- */
  function applyLanguage(lang) {
    const html = document.documentElement;
    html.lang = lang;

    if (html.dataset.titleEn) {
      if (html.dataset.titleNl === undefined) html.dataset.titleNl = document.title;
      document.title = lang === 'en' ? html.dataset.titleEn : html.dataset.titleNl;
    }

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && html.dataset.descEn) {
      if (html.dataset.descNl === undefined) html.dataset.descNl = metaDesc.content;
      metaDesc.content = lang === 'en' ? html.dataset.descEn : html.dataset.descNl;
    }

    document.querySelectorAll('[data-en]').forEach(el => {
      if (el.dataset.nl === undefined) el.dataset.nl = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.nl;
    });

    document.querySelectorAll('[data-en-placeholder]').forEach(el => {
      if (el.dataset.placeholderNl === undefined) el.dataset.placeholderNl = el.placeholder;
      el.placeholder = lang === 'en' ? el.dataset.enPlaceholder : el.dataset.placeholderNl;
    });

    document.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });

    fillFooterYear();
    renderCart();
    renderCheckoutSummary();
  }

  function initLanguage() {
    const saved = localStorage.getItem(LANG_KEY) || 'nl';
    applyLanguage(saved);
    document.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        localStorage.setItem(LANG_KEY, lang);
        applyLanguage(lang);
      });
    });
  }
  initLanguage();

});
