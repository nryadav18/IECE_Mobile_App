import { useCallback, useEffect, useRef, useState } from 'react';
import { getActivitiesPage, activitiesError } from '../services/activities';
import { usePageSize } from './usePagination';

/**
 * One page of activities from the server, with the state a page control needs.
 *
 * Every screen that lists activities uses this, so they all page the same way
 * and — more to the point — they all download the same small amount. A screen
 * that fetched the full list "just this once" would put every cover image in
 * the organisation back on the wire.
 *
 * @param {object}  filters  status / schoolId / uploaderId, as the endpoint accepts
 * @param {boolean} enabled  false parks the hook (a tab that has not been opened,
 *                           a user whose id has not loaded yet) without firing a request
 */
export default function useActivityPage({ filters = {}, enabled = true } = {}) {
  const pageSize = usePageSize();

  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  // `loading` is the first load (show a skeleton); `paging` is a page change
  // (keep the cards, dim the control). Conflating them makes every Next tap
  // blank the screen, which reads as a reload rather than a page turn.
  const [loading, setLoading] = useState(enabled);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');

  // Filters are compared by value, not identity: nearly every caller passes an
  // object literal, which is a new reference on every render and would
  // otherwise re-fetch forever.
  const key = JSON.stringify(filters || {});

  // Guards a slow page-1 response from overwriting a fast page-3 one when
  // somebody taps ahead before the first request lands.
  const requestId = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (target, { silent = false } = {}) => {
    if (!enabled) return;
    const id = ++requestId.current;
    if (silent) setPaging(true); else setLoading(true);
    setError('');
    try {
      const res = await getActivitiesPage({ page: target, limit: pageSize, ...JSON.parse(key) });
      if (!alive.current || id !== requestId.current) return;
      setItems(res.items);
      setPages(res.pages);
      setTotal(res.total);
      // The server clamps the page against the real total, so this is where a
      // stale page number (three activities deleted while someone read page 4)
      // silently corrects itself instead of showing an empty list.
      if (res.page !== target) setPage(res.page);
    } catch (e) {
      if (!alive.current || id !== requestId.current) return;
      setError(activitiesError(e));
    } finally {
      if (alive.current && id === requestId.current) {
        setLoading(false);
        setPaging(false);
      }
    }
  }, [enabled, pageSize, key]);

  // A changed filter, or a page size that changed because the browser was
  // resized, invalidates the page number: page 3 of a 6-per-page list is not
  // page 3 of a 12-per-page one.
  //
  // Done DURING RENDER rather than in an effect, and that is the whole point.
  // An effect would run after this render had already committed with the old
  // page number, so the fetch effect below would fire once for the stale page
  // and again for page 1 — two requests where one was wanted, on a hook whose
  // entire job is to stop the app fetching things it does not need. React
  // re-renders immediately on a state update during render and discards the
  // in-progress output, so no effect ever sees the mismatched pair.
  const [seen, setSeen] = useState({ key, pageSize });
  if (seen.key !== key || seen.pageSize !== pageSize) {
    setSeen({ key, pageSize });
    setPage(1);
  }

  useEffect(() => {
    load(page, { silent: page !== 1 || items.length > 0 });
    // `items.length` is read for the silent/loud decision only — including it
    // would re-fetch every time the results arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, page]);

  /** Re-fetch the page being shown — after an upload, an edit or a delete. */
  const refresh = useCallback(() => load(page, { silent: true }), [load, page]);

  /**
   * Change one activity in place, without a round trip.
   *
   * For optimistic updates that must not cost a page fetch — starring is the
   * one that matters: re-fetching a page to flip a star would re-download every
   * cover on it, which is the exact cost this hook exists to avoid.
   */
  const patchItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((a) => (
      String(a._id) === String(id) ? { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } : a
    )));
  }, []);

  /**
   * Drop one activity from the page after it has been deleted.
   *
   * Followed by a refresh, because removing an item shifts every later page up
   * by one — the page being shown is now short by one row that belongs to it.
   */
  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((a) => String(a._id) !== String(id)));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  return {
    items, page, setPage, pages, total, pageSize,
    loading, paging, error, refresh, patchItem, removeItem,
  };
}
