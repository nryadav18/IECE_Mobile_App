import { useEffect, useMemo, useState } from 'react';
import useResponsiveLayout from './useResponsiveLayout';

/**
 * Page sizing and paging state, shared by every activity list.
 *
 * Kept in one place because the page size is not a cosmetic number: it is how
 * many cover images the device downloads at once. A screen that picks its own
 * would quietly undo the saving on the screens that did not.
 */

/**
 * How many items belong on one page, given how wide the window is.
 *
 * A phone shows one column, so six is about two screens of scrolling and six
 * covers to fetch. A wide browser shows three or four columns, where six would
 * be two thin rows and a lot of empty space — so it gets twelve, which fills
 * the grid without asking a phone to pay for it.
 *
 * `columns` is 1 on native by design (see useResponsiveLayout), so the mobile
 * app always gets the compact size no matter how large the device is.
 */
export function usePageSize({ compact = 6, wide = 12 } = {}) {
  const { columns } = useResponsiveLayout();
  return columns >= 2 ? wide : compact;
}

/**
 * Page a list that is already in memory.
 *
 * For feeds the server cannot page — the Chairman's, which merges visit reports
 * and activities into one sorted stream, so no single collection's `skip` could
 * produce it. The JSON still arrives whole, but only the current page's cards
 * are rendered, so only that page's images are ever fetched. That is where
 * nearly all the bytes are.
 *
 * The page is clamped to the list, so items disappearing underneath (a refresh,
 * a deletion) lands the reader on the last real page instead of a blank one.
 */
export function useLocalPagination(items, pageSize) {
  const list = useMemo(() => items || [], [items]);
  const [page, setPage] = useState(1);

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);

  // Re-sync when the clamp actually moved us, so the control shows the page
  // being displayed rather than the one that was asked for.
  useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);

  const pageItems = useMemo(
    () => list.slice((current - 1) * pageSize, current * pageSize),
    [list, current, pageSize]
  );

  return { page: current, setPage, pageItems, pages, total, pageSize };
}
