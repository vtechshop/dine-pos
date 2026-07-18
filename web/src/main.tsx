import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

// F-01: Fail fast if API URL still points to localhost in a production build.
// Set VITE_API_URL and VITE_SOCKET_URL in .env.production before running vite build.
if (import.meta.env.PROD) {
  const apiUrl    = import.meta.env.VITE_API_URL    ?? '';
  const socketUrl = import.meta.env.VITE_SOCKET_URL ?? '';
  const bad = (u: string) => !u || u.includes('localhost') || u.includes('127.0.0.1');
  if (bad(apiUrl) || bad(socketUrl)) {
    document.getElementById('root')!.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#fafaf9">
        <div style="max-width:480px;padding:40px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#1c1917">
          <p style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#dc2626;margin-bottom:12px">Deployment Error</p>
          <h1 style="font-size:20px;font-weight:700;margin-bottom:12px">API URL not configured</h1>
          <p style="font-size:14px;color:#57534e;line-height:1.6;margin-bottom:16px">
            <code>VITE_API_URL</code> and <code>VITE_SOCKET_URL</code> must be set to your production server
            before running <code>vite build</code>. They are currently missing or pointing to localhost.
          </p>
          <p style="font-size:13px;color:#a8a29e">Set them in <code>.env.production</code> and rebuild.</p>
        </div>
      </div>`;
    throw new Error('[DinePOS] VITE_API_URL / VITE_SOCKET_URL not configured for production.');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
