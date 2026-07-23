import { useState, useCallback } from 'react';

/**
 * Smooth section/tab switching with an instant skeleton.
 *
 * The portal screens keep every tab mounted (toggled via `display:none` or
 * `activeTab === x`), so changing the active tab re-renders the whole heavy
 * tree synchronously and freezes the JS thread for a beat — the old screen
 * appears "stuck" for 1–2s before the new section shows.
 *
 * This hook flips that into a smooth, intentional load:
 *   1. On select, it updates `activeTab` AND raises `tabLoading` in the same
 *      (batched) render. The caller renders ONLY the skeleton while
 *      `tabLoading` is true — a cheap frame that skips the heavy tab content,
 *      so it paints immediately.
 *   2. Its shine keeps animating on the UI thread even while JS is busy.
 *   3. After two frames (guaranteeing the skeleton painted), `tabLoading`
 *      drops and the real content renders behind it.
 *
 * Usage:
 *   const { tabLoading, selectTab } = useSectionTransition(activeTab, setActiveTab);
 *   <SidebarMenu onSelectTab={selectTab} ... />
 *   {tabLoading ? <SkeletonList .../> : <RealContent/>}
 */
export function useSectionTransition(activeTab, setActiveTab) {
  const [tabLoading, setTabLoading] = useState(false);

  const selectTab = useCallback((key) => {
    if (key === activeTab) return; // same section → no flicker
    setActiveTab(key);
    setTabLoading(true);
    // Two rAFs → the cheap skeleton frame paints before the heavy content
    // render runs (and briefly blocks) behind it.
    requestAnimationFrame(() => requestAnimationFrame(() => setTabLoading(false)));
  }, [activeTab, setActiveTab]);

  return { tabLoading, selectTab };
}

export default useSectionTransition;
