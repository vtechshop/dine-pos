import { useEffect } from 'react';

const DEFAULT_TITLE = 'Dine POS — Restaurant POS System';
const DEFAULT_DESC  = 'Dine POS — The complete point-of-sale system built for modern restaurants. Streamline orders, billing, and inventory from one screen.';

export function usePageSEO(title: string, description: string = DEFAULT_DESC): void {
  useEffect(() => {
    const prevTitle = document.title;
    const metaEl    = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc  = metaEl?.content ?? DEFAULT_DESC;

    document.title = title;
    if (metaEl) metaEl.content = description;

    return () => {
      document.title = prevTitle;
      if (metaEl) metaEl.content = prevDesc;
    };
  }, [title, description]);
}
