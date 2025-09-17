// src/index.js
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// ---- Fetch shim: rewrite http(s)://localhost:5000 -> same-origin ----
(function () {
  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = typeof input === 'string'
      ? input
      : (input && input.url ? input.url : '');

    if (/^https?:\/\/localhost:5000/i.test(url)) {
      const newUrl = url.replace(/^https?:\/\/localhost:5000/i, '');
      console.warn('[FetchShim] Rewriting localhost -> same-origin:', url, '=>', newUrl);
      return origFetch(newUrl, init);
    }
    return origFetch(input, init);
  };

  console.log('[FetchShim] Active: localhost rewrites enabled');
})();
// ---------------------------------------------------------------------

const container = document.getElementById('root');
createRoot(container).render(<App />);
