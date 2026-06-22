// API client for NEXUS backend.
const BASE = import.meta.env.VITE_API_BASE || '/api';
const TOKEN_KEY = 'nexus_token';

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request(path, opts = {}) {
  const token = auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  // Auth
  requestCode: (email) => request('/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyCode: (email, code) => request('/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) }),
  register: (regToken, username, displayName, avatar) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ regToken, username, displayName, avatar }) }),

  // Me
  me: () => request('/me'),
  updateMe: (patch) => request('/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  // Users
  getUser: (id) => request(`/users/${id}`),
  getUserPosts: (id, replies = false) => request(`/users/${id}/posts${replies ? '?replies=1' : ''}`),
  follow: (id) => request(`/users/${id}/follow`, { method: 'POST' }),
  unfollow: (id) => request(`/users/${id}/follow`, { method: 'DELETE' }),
  suggestions: () => request('/users'),
  searchUsers: (qs) => request(`/users?q=${encodeURIComponent(qs)}`),

  // Posts
  getFeed: (tab = 'all', hashtag = null) => {
    const params = new URLSearchParams();
    if (hashtag) params.set('hashtag', hashtag); else params.set('tab', tab);
    return request(`/posts?${params}`);
  },
  getPost: (id) => request(`/posts/${id}`),
  createPost: ({ content = '', replyTo = null, repostOf = null, imageUrl = null }) =>
    request('/posts', { method: 'POST', body: JSON.stringify({ content, replyTo, repostOf, imageUrl }) }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  like: (id) => request(`/posts/${id}/like`, { method: 'POST' }),
  unlike: (id) => request(`/posts/${id}/like`, { method: 'DELETE' }),

  // Trending
  trending: () => request('/trending'),

  // Uploads (image as data URL → returns { url })
  upload: (dataUrl) => request('/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) }),

  // Direct Messages
  threads: () => request('/messages/threads'),
  conversation: (userId) => request(`/messages/with/${userId}`),
  sendMessage: (receiverId, content) =>
    request('/messages', { method: 'POST', body: JSON.stringify({ receiverId, content }) }),
  unreadCount: () => request('/messages/unread'),
};

// Server-Sent Events
export function connectEvents(handlers) {
  const token = auth.getToken();
  if (!token) return () => {};
  const es = new EventSource(`${BASE}/events?token=${encodeURIComponent(token)}`);
  const wire = (name) => {
    if (!handlers[name]) return;
    es.addEventListener(name, (e) => {
      try { handlers[name](JSON.parse(e.data)); } catch {}
    });
  };
  wire('post:new');
  wire('post:deleted');
  wire('dm:new');
  wire('dm:sent');
  wire('dm:read');
  es.onerror = () => { /* auto-reconnect */ };
  return () => es.close();
}

// Image helpers: client-side compression to keep upload under 3 MB.
export function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxDim) {
          if (w > h) { h = h * maxDim / w; w = maxDim; }
          else       { w = w * maxDim / h; h = maxDim; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
