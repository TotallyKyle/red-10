import { useEffect, useState } from 'react';

/**
 * Track viewport width with a resize listener. Used by layout components that
 * need to adapt to screen size beyond what Tailwind's media-query classes
 * can express (e.g., computing card widths from card count).
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return width;
}
