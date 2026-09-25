import { useEffect } from 'react';

const BASE_URL      = 'https://dinepos.happya.in';
const DEFAULT_TITLE = 'Dine POS — Restaurant POS System';
const DEFAULT_DESC  = 'Dine POS — The complete point-of-sale system built for modern restaurants. Streamline orders, billing, and inventory from one screen.';

function getMeta(selector: string): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>(selector);
}

export interface PageSEOOptions {
  noindex?: boolean;
}

export function usePageSEO(
  title:       string,
  description: string         = DEFAULT_DESC,
  options:     PageSEOOptions = {},
): void {
  const { noindex = false } = options;

  useEffect(() => {
    const pathname = window.location.pathname;
    const canonical = pathname === '/' ? `${BASE_URL}/` : `${BASE_URL}${pathname}`;

    // ─── Snapshot ─────────────────────────────────────────────────────────────
    const prev = {
      title:        document.title,
      desc:         getMeta('meta[name="description"]')?.content ?? DEFAULT_DESC,
      canonical:    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? `${BASE_URL}/`,
      ogUrl:        getMeta('meta[property="og:url"]')?.content ?? `${BASE_URL}/`,
      ogTitle:      getMeta('meta[property="og:title"]')?.content ?? DEFAULT_TITLE,
      ogDesc:       getMeta('meta[property="og:description"]')?.content ?? DEFAULT_DESC,
      twitterTitle: getMeta('meta[name="twitter:title"]')?.content ?? DEFAULT_TITLE,
      twitterDesc:  getMeta('meta[name="twitter:description"]')?.content ?? DEFAULT_DESC,
      robots:       getMeta('meta[name="robots"]')?.content ?? null,
    };

    // ─── Apply ────────────────────────────────────────────────────────────────
    document.title = title;

    const metaDesc = getMeta('meta[name="description"]');
    if (metaDesc) metaDesc.content = description;

    let canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.rel = 'canonical';
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.href = canonical;

    const ogUrl = getMeta('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = canonical;

    const ogTitleEl = getMeta('meta[property="og:title"]');
    if (ogTitleEl) ogTitleEl.content = title;

    const ogDescEl = getMeta('meta[property="og:description"]');
    if (ogDescEl) ogDescEl.content = description;

    const twitterTitleEl = getMeta('meta[name="twitter:title"]');
    if (twitterTitleEl) twitterTitleEl.content = title;

    const twitterDescEl = getMeta('meta[name="twitter:description"]');
    if (twitterDescEl) twitterDescEl.content = description;

    // robots: noindex for placeholder/error pages
    let robotsEl = getMeta('meta[name="robots"]');
    if (noindex) {
      if (!robotsEl) {
        robotsEl = document.createElement('meta');
        robotsEl.name = 'robots';
        document.head.appendChild(robotsEl);
      }
      robotsEl.content = 'noindex,follow';
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      document.title = prev.title;
      const d = getMeta('meta[name="description"]');         if (d)  d.content  = prev.desc;
      const c = document.querySelector<HTMLLinkElement>('link[rel="canonical"]'); if (c) c.href = prev.canonical;
      const ou = getMeta('meta[property="og:url"]');         if (ou) ou.content = prev.ogUrl;
      const ot = getMeta('meta[property="og:title"]');       if (ot) ot.content = prev.ogTitle;
      const od = getMeta('meta[property="og:description"]'); if (od) od.content = prev.ogDesc;
      const tt = getMeta('meta[name="twitter:title"]');      if (tt) tt.content = prev.twitterTitle;
      const td = getMeta('meta[name="twitter:description"]');if (td) td.content = prev.twitterDesc;
      const rb = getMeta('meta[name="robots"]');
      if (rb) {
        if (prev.robots === null) rb.remove();
        else rb.content = prev.robots;
      }
    };
  }, [title, description, noindex]);
}
