import api from './api';

/**
 * Activities, one page at a time.
 *
 * `GET /api/activities` still returns everything when asked without `page` or
 * `limit` — several screens depend on the whole list and truncating them
 * silently would be a data-loss bug that looks like nothing at all. Passing a
 * page is opt-in, and this is the only place that does it.
 *
 * The point is bandwidth. An activity carries its photo URLs, and the app
 * downloads a cover for every card it draws. Paging on the SERVER means the
 * device never learns the URLs of the activities it is not showing, so the
 * images are never requested at all.
 *
 * @param {object} opts page, limit, and any filter the endpoint accepts
 *   (status, schoolId, uploaderId).
 * @returns {Promise<{items: array, page: number, pages: number, total: number}>}
 */
export const getActivitiesPage = async ({ page = 1, limit = 6, ...filters } = {}) => {
  const params = { page, limit };
  // Only real filters go on the wire — an `undefined` would serialise as the
  // string "undefined" and match nothing.
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params[k] = v;
  });

  const { data } = await api.get('/activities', { params });

  return {
    items: data.data || [],
    // The server clamps the page against the real total and tells us what it
    // actually served, which can differ from what we asked for. Trust its
    // answer rather than our own arithmetic.
    page: data.page || 1,
    pages: data.pages || 1,
    total: data.total ?? (data.data || []).length,
  };
};

export const activitiesError = (e) =>
  e?.response?.data?.error || e?.response?.data?.message || e?.message
  || 'Could not load activities.';
