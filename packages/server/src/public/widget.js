(() => {
  // ----- config read from script tag -----
  const script = document.currentScript;
  const src  = script.getAttribute('data-src');             // URL to widget.html
  const base = script.getAttribute('data-base') || '';      // API base
  if (!src) { console.warn('widget.js: Missing data-src attribute'); return; }

  // Twilio Sandbox defaults (you can change here if needed)
  const WA_NUMBER = '14155238886';   // no '+'; +1 415 523 8886
  const WA_JOIN   = 'dark-magic';    // your sandbox join code

  // ----- internal state -----
  let currentDomain = '';            // filled when iframe posts "indexed"
  let iframeOpen = false;

  // ----- helpers -----
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function buildWaLink(message) {
    const t = encodeURIComponent(message);
    return isMobile ? `whatsapp://send?phone=${WA_NUMBER}&text=${t}`
                    : `https://wa.me/${WA_NUMBER}?text=${t}`;
  }
  function waPrefill() {
    if (currentDomain) {
      const d = currentDomain.startsWith('http') ? currentDomain : `https://${currentDomain}`;
      return `site ${d}`;
    }
    return `join ${WA_JOIN}`;
  }

  // ----- styles -----
  const style = document.createElement('style');
  style.textContent = `
    .ragbot-btn { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%;
                  display:flex; align-items:center; justify-content:center; cursor:pointer; z-index: 2147483000;
                  box-shadow: 0 12px 28px rgba(0,0,0,0.35); border: none; transition: transform .12s, filter .12s; }
    .ragbot-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }

    #ragbot-chat { background: linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
    #ragbot-wa   { background: #25D366; color:#0b1020; right: 84px; }

    .ragbot-frame { position: fixed; right: 20px; bottom: 90px; width: min(420px, 96vw); height: min(620px, 75vh);
                    border: 0; border-radius: 16px; display:none; background: transparent; z-index: 2147483000;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
    @media (max-width: 520px) {
      #ragbot-wa   { right: 80px; bottom: 16px; }
      #ragbot-chat { right: 16px; bottom: 16px; }
      .ragbot-frame { right: 2vw; width: 96vw; }
    }
  `;
  document.head.appendChild(style);

  // ----- iframe -----
  const iframe = document.createElement('iframe');
  iframe.className = 'ragbot-frame';
  const url = new URL(src, location.href);
  if (base) url.searchParams.set('base', base);
  iframe.src = url.toString();
  iframe.title = 'Chat Widget';
  document.body.appendChild(iframe);

  // ----- chat bubble -----
  const chatBtn = document.createElement('button');
  chatBtn.id = 'ragbot-chat';
  chatBtn.className = 'ragbot-btn';
  chatBtn.title = 'Open Site Chat';
  chatBtn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M7 8h10M7 12h6M20 12c0 4.4-4 8-9 8-1.1 0-2.17-.17-3.15-.48L3 21l1.5-4.2C3.6 15.4 3 13.76 3 12 3 7.6 7 4 12 4s9 3.6 9 8Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  chatBtn.addEventListener('click', () => {
    iframeOpen = !iframeOpen;
    iframe.style.display = iframeOpen ? 'block' : 'none';
  });
  document.body.appendChild(chatBtn);

  // ----- WhatsApp bubble -----
  const waBtn = document.createElement('a');
  waBtn.id = 'ragbot-wa';
  waBtn.className = 'ragbot-btn';
  waBtn.rel = 'noopener';
  waBtn.target = '_blank';
  waBtn.title = 'Chat on WhatsApp';
  waBtn.href = buildWaLink(waPrefill());    // initial link (join)
  waBtn.innerHTML = `
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
      <path fill="currentColor"
        d="M19.1 17.7c-.3-.2-1.8-.9-2-.9-.3-.1-.5-.2-.7.1-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.2-.1.3-.3.5-.5.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.3-.6-.5-.5-.7-.5H6.9c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5 0 1.5 1.1 2.9 1.2 3.1.1.2 2.1 3.2 5.1 4.5 3 1.3 3 .9 3.5.8.5-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4 0-.1-.2-.2-.6-.3zM16 3C9.4 3 4 8.4 4 15c0 2.6.9 5.1 2.3 7.1L4 29l7.1-2.3c1.8 1.2 3.3 1.4 4.9 1.4 6.6 0 12-5.4 12-12S22.6 3 16 3z"/>
    </svg>`;
  // Re-compose the href at click-time so it reflects latest state
  waBtn.addEventListener('click', () => {
    waBtn.href = buildWaLink(waPrefill());
  });
  document.body.appendChild(waBtn);

  // ----- listen for messages from the iframe (widget.html) -----
  window.addEventListener('message', (ev) => {
    try {
      const data = ev.data || {};
      if (data && data.source === 'rag-widget' && data.type === 'indexed' && data.domain) {
        currentDomain = (data.domain || '').trim();
        // refresh href so the next click uses "site https://<domain>"
        waBtn.href = buildWaLink(waPrefill());
      }
    } catch (_) {}
  }, false);
})();
