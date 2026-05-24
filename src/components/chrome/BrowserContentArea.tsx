import React, { useLayoutEffect, useRef } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

/**
 * Visual placeholder for the active tab's BrowserView. The actual web
 * contents are painted by Electron's BrowserView on top of this div, so
 * this component's job is to (a) reserve the slot in the flex layout, and
 * (b) tell main exactly where that slot lives so the BrowserView mirrors
 * it. That eliminates the old hardcoded chromeHeight + inset math in
 * TabManager and means the BrowserView automatically tracks the AI
 * sidebar toggle, bookmarks-bar visibility, and window resizes.
 */
export const BrowserContentArea: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  // Re-measure when the AI sidebar opens/closes — the div doesn't change
  // size but it shifts horizontally, which ResizeObserver doesn't catch.
  const showAI = useBrowserStore((s) => s.showAI);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let rafId = 0;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      window.horizonAPI.invoke('ui:contentBounds', {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    };
    const schedule = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(report);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener('resize', schedule);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [showAI]);

  // absolute inset-0 fills the parent regardless of its flex direction —
  // the parent (`relative overflow-hidden` card in App.tsx) doesn't set a
  // flex direction, so `flex-1` alone collapses the height to 0.
  return <div ref={ref} className="absolute inset-0" style={{ background: '#ffffff' }} />;
};
