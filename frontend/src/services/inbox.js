import api from './api';

// Persistent in-app notification inbox endpoints.

export const getNotifications = (page = 1, limit = 30) =>
  api.get('/notifications', { params: { page, limit } }).then((r) => r.data);

export const getUnreadCount = () =>
  api.get('/notifications/unread-count').then((r) => r.data);

// Consolidated badge counts: { unread, sections: {leave, substitution, faces, holidays}, total }.
export const getBadges = () =>
  api.get('/notifications/badges').then((r) => r.data);

export const markNotificationRead = (id) =>
  api.post(`/notifications/${id}/read`).then((r) => r.data);

export const markAllNotificationsRead = () =>
  api.post('/notifications/read-all').then((r) => r.data);
