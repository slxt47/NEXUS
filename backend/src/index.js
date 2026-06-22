// ============================================================
// NEXUS Backend — Express API
// ============================================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const {
  PORT = 4000,
  DATABASE_URL,
  JWT_SECRET,
  SMTP_HOST, SMTP_PORT, SMTP_FROM,
  SMTP_USER, SMTP_PASS, SMTP_SECURE = 'false',
  OWNER_EMAIL, OWNER_USERNAME, OWNER_DISPLAY_NAME,
  MAX_POST_LEN = 280,
  UPLOAD_DIR = '/uploads',
} = process.env;

if (!DATABASE_URL || !JWT_SECRET) {
  console.error('FATAL: DATABASE_URL and JWT_SECRET are required');
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ------------------------------------------------------------
// DB pool
// ------------------------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL });
async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function q1(sql, params = []) { return (await q(sql, params))[0] || null; }

// ------------------------------------------------------------
// Mailer
// ------------------------------------------------------------
// SMTP-Modus:
//   - Ohne SMTP_USER/PASS → dev mode (MailHog: kein Auth, kein TLS)
//   - Mit SMTP_USER/PASS  → prod mode (Auth + TLS)
//       SMTP_SECURE=true  → implicit TLS (typisch Port 465)
//       SMTP_SECURE=false → STARTTLS    (typisch Port 587)
const smtpConfig = {
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: String(SMTP_SECURE).toLowerCase() === 'true',
};
if (SMTP_USER && SMTP_PASS) {
  smtpConfig.auth = { user: SMTP_USER, pass: SMTP_PASS };
  if (!smtpConfig.secure) smtpConfig.requireTLS = true;
  console.log(`[mail] prod mode → ${SMTP_HOST}:${SMTP_PORT} (secure=${smtpConfig.secure}, auth=${SMTP_USER})`);
} else {
  smtpConfig.ignoreTLS = true;
  console.log(`[mail] dev mode → ${SMTP_HOST}:${SMTP_PORT} (no auth, no TLS)`);
}
const mailer = nodemailer.createTransport(smtpConfig);

// Beim Boot prüfen — failt nicht-fatal aber loggt klar
mailer.verify().then(
  () => console.log('[mail] SMTP transport verified'),
  (err) => console.warn('[mail] SMTP verify failed:', err.message)
);

async function sendCode(email, code) {
  await mailer.sendMail({
    from: SMTP_FROM, to: email,
    subject: `[NEXUS] Your access code: ${code}`,
    text: `Your verification code is: ${code}\n\nValid for 10 minutes.\n\n// NEXUS terminal`,
    html: `
      <div style="font-family:monospace;background:#000;color:#4ade80;padding:24px;border:1px solid #4ade80">
        <div style="opacity:.6;font-size:11px">// NEXUS terminal v2.4</div>
        <h2 style="color:#4ade80;letter-spacing:.3em">ACCESS CODE</h2>
        <div style="font-size:32px;letter-spacing:.5em;font-weight:bold;margin:16px 0">${code}</div>
        <div style="opacity:.6;font-size:11px">Valid for 10 minutes.</div>
      </div>`,
  });
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{2,20}$/;
const HASHTAG_RE = /#([\w\u00C0-\u017F]+)/g;
const sixDigit = () => Math.floor(100000 + Math.random() * 900000).toString();

function extractHashtags(text) {
  const out = new Set(); let m;
  while ((m = HASHTAG_RE.exec(text)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}
function signToken(payload, ttl = '30d') { return jwt.sign(payload, JWT_SECRET, { expiresIn: ttl }); }
function authRequired(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  try { req.auth = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'invalid token' }); }
}
function userShape(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, username: u.username, displayName: u.display_name,
    bio: u.bio, avatar: u.avatar, isOwner: u.is_owner, createdAt: u.created_at,
  };
}

async function postShape(p, viewerId) {
  const author = await q1('SELECT * FROM users WHERE id = $1', [p.author_id]);
  const [likeRow]   = await q('SELECT COUNT(*)::int AS c FROM likes WHERE post_id = $1', [p.id]);
  const [replyRow]  = await q('SELECT COUNT(*)::int AS c FROM posts WHERE reply_to = $1', [p.id]);
  const [repostRow] = await q('SELECT COUNT(*)::int AS c FROM posts WHERE repost_of = $1', [p.id]);
  let liked = false, reposted = false;
  if (viewerId) {
    liked = !!(await q1('SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [viewerId, p.id]));
    reposted = !!(await q1('SELECT 1 FROM posts WHERE repost_of = $1 AND author_id = $2', [p.id, viewerId]));
  }
  return {
    id: p.id, authorId: p.author_id, author: userShape(author),
    content: p.content,
    imageUrl: p.image_url,
    replyTo: p.reply_to, repostOf: p.repost_of, createdAt: p.created_at,
    counts: { likes: likeRow.c, replies: replyRow.c, reposts: repostRow.c },
    viewer: { liked, reposted },
  };
}

function messageShape(m, viewerId) {
  return {
    id: m.id,
    senderId: m.sender_id, receiverId: m.receiver_id,
    content: m.content, createdAt: m.created_at, readAt: m.read_at,
    isMine: m.sender_id === viewerId,
  };
}

// ------------------------------------------------------------
// SSE — targeted per user
// ------------------------------------------------------------
const sseClients = new Map(); // userId -> Set<res>

function sseAdd(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}
function sseRemove(userId, res) {
  sseClients.get(userId)?.delete(res);
  if (sseClients.get(userId)?.size === 0) sseClients.delete(userId);
}
function broadcastAll(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const set of sseClients.values()) {
    for (const res of set) { try { res.write(payload); } catch {} }
  }
}
function broadcastToUser(userId, event, data) {
  const set = sseClients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch {} }
}

// ------------------------------------------------------------
// App
// ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // groß genug für komprimierte Bilder als base64
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
app.post('/api/auth/request-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
  const code = sixDigit();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await q(
    `INSERT INTO verification_codes (email, code, expires_at, verified)
     VALUES ($1, $2, $3, FALSE)
     ON CONFLICT (email) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, verified = FALSE, user_id = NULL`,
    [email, code, expiresAt]
  );
  try { await sendCode(email, code); }
  catch (e) { console.error('mailer:', e.message); return res.status(500).json({ error: 'could not send email' }); }
  res.json({ ok: true, message: 'code sent (check MailHog at :8025)' });
});

app.post('/api/auth/verify-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid input' });
  const rec = await q1('SELECT * FROM verification_codes WHERE email = $1', [email]);
  if (!rec || rec.code !== code) return res.status(401).json({ error: 'wrong code' });
  if (new Date(rec.expires_at) < new Date()) return res.status(401).json({ error: 'code expired' });
  const existing = await q1('SELECT * FROM users WHERE email = $1', [email]);
  if (existing) {
    await q('DELETE FROM verification_codes WHERE email = $1', [email]);
    return res.json({ token: signToken({ uid: existing.id }), user: userShape(existing), needsRegistration: false });
  }
  await q('UPDATE verification_codes SET verified = TRUE WHERE email = $1', [email]);
  res.json({ regToken: signToken({ regEmail: email }, '15m'), needsRegistration: true });
});

app.post('/api/auth/register', async (req, res) => {
  const { regToken, username, displayName, avatar } = req.body || {};
  let payload;
  try { payload = jwt.verify(regToken, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'invalid registration token' }); }
  if (!payload.regEmail) return res.status(401).json({ error: 'invalid registration token' });
  const email = payload.regEmail;
  const uname = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) return res.status(400).json({ error: 'invalid username (2-20, a-z 0-9 _)' });
  if (await q1('SELECT 1 FROM users WHERE username = $1', [uname])) return res.status(409).json({ error: 'username taken' });
  const dn = String(displayName || '').trim() || uname;
  const av = typeof avatar === 'string' && avatar.startsWith('data:image/') ? avatar.slice(0, 500_000) : null;
  const user = await q1(
    `INSERT INTO users (email, username, display_name, avatar) VALUES ($1,$2,$3,$4) RETURNING *`,
    [email, uname, dn, av]
  );
  await q('DELETE FROM verification_codes WHERE email = $1', [email]);
  res.json({ token: signToken({ uid: user.id }), user: userShape(user), needsRegistration: false });
});

// ------------------------------------------------------------
// Me
// ------------------------------------------------------------
app.get('/api/me', authRequired, async (req, res) => {
  const user = await q1('SELECT * FROM users WHERE id = $1', [req.auth.uid]);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ user: userShape(user) });
});

app.patch('/api/me', authRequired, async (req, res) => {
  const me = await q1('SELECT * FROM users WHERE id = $1', [req.auth.uid]);
  if (!me) return res.status(404).json({ error: 'not found' });
  if (me.is_owner) return res.status(403).json({ error: 'owner profile is locked' });
  const { displayName, bio, avatar } = req.body || {};
  const dn = typeof displayName === 'string' ? displayName.trim().slice(0, 30) : me.display_name;
  const b  = typeof bio === 'string' ? bio.slice(0, 160) : me.bio;
  const av = typeof avatar === 'string'
    ? (avatar.startsWith('data:image/') ? avatar.slice(0, 500_000) : me.avatar) : me.avatar;
  const updated = await q1(
    `UPDATE users SET display_name=$1, bio=$2, avatar=$3 WHERE id=$4 RETURNING *`,
    [dn, b, av, me.id]
  );
  res.json({ user: userShape(updated) });
});

// ------------------------------------------------------------
// Image upload
// ------------------------------------------------------------
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB nach Komprimierung im Client

app.post('/api/upload', authRequired, async (req, res) => {
  const dataUrl = req.body?.dataUrl;
  if (typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl required' });
  const m = dataUrl.match(DATA_URL_RE);
  if (!m) return res.status(400).json({ error: 'invalid image format' });
  const extRaw = m[1].toLowerCase();
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'image too large (max 3 MB)' });
  const filename = `${randomUUID()}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buf);
  res.json({ url: `/uploads/${filename}` });
});

// ------------------------------------------------------------
// Users
// ------------------------------------------------------------
app.get('/api/users/:id', authRequired, async (req, res) => {
  const u = await q1('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'not found' });
  const [followers] = await q('SELECT COUNT(*)::int AS c FROM follows WHERE followee_id = $1', [u.id]);
  const [following] = await q('SELECT COUNT(*)::int AS c FROM follows WHERE follower_id = $1', [u.id]);
  const [postCount] = await q('SELECT COUNT(*)::int AS c FROM posts WHERE author_id = $1', [u.id]);
  const isFollowing = !!(await q1('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.auth.uid, u.id]));
  res.json({
    user: userShape(u),
    counts: { followers: followers.c, following: following.c, posts: postCount.c },
    viewer: { isFollowing, isSelf: req.auth.uid === u.id },
  });
});

app.get('/api/users/:id/posts', authRequired, async (req, res) => {
  const onlyReplies = req.query.replies === '1';
  const where = onlyReplies ? 'author_id = $1 AND reply_to IS NOT NULL' : 'author_id = $1 AND reply_to IS NULL';
  const rows = await q(`SELECT * FROM posts WHERE ${where} ORDER BY created_at DESC LIMIT 100`, [req.params.id]);
  const out = [];
  for (const p of rows) out.push(await postShape(p, req.auth.uid));
  res.json({ posts: out });
});

app.post('/api/users/:id/follow', authRequired, async (req, res) => {
  if (req.auth.uid === req.params.id) return res.status(400).json({ error: 'cannot follow yourself' });
  await q(`INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.auth.uid, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id/follow', authRequired, async (req, res) => {
  await q('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.auth.uid, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/users', authRequired, async (req, res) => {
  const search = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
  let rows;
  if (search) {
    rows = await q(
      `SELECT * FROM users WHERE id <> $1 AND (LOWER(username) LIKE $2 OR LOWER(display_name) LIKE $2) ORDER BY is_owner DESC LIMIT 20`,
      [req.auth.uid, search]
    );
  } else {
    rows = await q(
      `SELECT u.* FROM users u
       WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
       ORDER BY u.is_owner DESC, u.created_at DESC LIMIT 5`,
      [req.auth.uid]
    );
  }
  res.json({ users: rows.map(userShape) });
});

// ------------------------------------------------------------
// Posts
// ------------------------------------------------------------
app.get('/api/posts', authRequired, async (req, res) => {
  const tab = req.query.tab || 'all';
  const hashtag = req.query.hashtag ? String(req.query.hashtag).toLowerCase() : null;
  let rows;
  if (hashtag) {
    rows = await q(
      `SELECT p.* FROM posts p JOIN post_hashtags h ON h.post_id = p.id
        WHERE h.tag = $1 AND p.reply_to IS NULL ORDER BY p.created_at DESC LIMIT 100`,
      [hashtag]
    );
  } else if (tab === 'following') {
    rows = await q(
      `SELECT p.* FROM posts p
        WHERE p.reply_to IS NULL
          AND (p.author_id = $1 OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1))
        ORDER BY p.created_at DESC LIMIT 100`,
      [req.auth.uid]
    );
  } else {
    rows = await q(`SELECT * FROM posts WHERE reply_to IS NULL ORDER BY created_at DESC LIMIT 100`);
  }
  const out = [];
  for (const p of rows) out.push(await postShape(p, req.auth.uid));
  res.json({ posts: out });
});

app.post('/api/posts', authRequired, async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const replyTo = req.body?.replyTo || null;
  const repostOf = req.body?.repostOf || null;
  const imageUrl = typeof req.body?.imageUrl === 'string' && req.body.imageUrl.startsWith('/uploads/')
    ? req.body.imageUrl : null;

  if (repostOf) {
    if (!await q1('SELECT 1 FROM posts WHERE id = $1', [repostOf])) return res.status(404).json({ error: 'original not found' });
  } else {
    // Bei normalem Post oder Reply muss ENTWEDER content ODER image vorhanden sein
    if (!content && !imageUrl) return res.status(400).json({ error: 'content or image required' });
    if (content.length > Number(MAX_POST_LEN)) return res.status(400).json({ error: `content must be <= ${MAX_POST_LEN} chars` });
  }
  if (replyTo && !await q1('SELECT 1 FROM posts WHERE id = $1', [replyTo])) return res.status(404).json({ error: 'parent not found' });

  const post = await q1(
    `INSERT INTO posts (author_id, content, image_url, reply_to, repost_of) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.auth.uid, content, imageUrl, replyTo, repostOf]
  );
  if (!repostOf && content) {
    for (const t of extractHashtags(content)) {
      await q(`INSERT INTO post_hashtags (post_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [post.id, t]);
    }
  }
  const shaped = await postShape(post, req.auth.uid);
  broadcastAll('post:new', shaped);
  res.status(201).json({ post: shaped });
});

app.get('/api/posts/:id', authRequired, async (req, res) => {
  const p = await q1('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'not found' });
  const replies = await q('SELECT * FROM posts WHERE reply_to = $1 ORDER BY created_at ASC LIMIT 200', [p.id]);
  const parents = [];
  let cur = p.reply_to;
  while (cur && parents.length < 5) {
    const par = await q1('SELECT * FROM posts WHERE id = $1', [cur]);
    if (!par) break;
    parents.unshift(par); cur = par.reply_to;
  }
  const post = await postShape(p, req.auth.uid);
  const repliesShaped = [];
  for (const r of replies) repliesShaped.push(await postShape(r, req.auth.uid));
  const parentsShaped = [];
  for (const par of parents) parentsShaped.push(await postShape(par, req.auth.uid));
  res.json({ post, parents: parentsShaped, replies: repliesShaped });
});

app.delete('/api/posts/:id', authRequired, async (req, res) => {
  const p = await q1('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'not found' });
  const me = await q1('SELECT is_owner FROM users WHERE id = $1', [req.auth.uid]);
  if (p.author_id !== req.auth.uid && !me?.is_owner) return res.status(403).json({ error: 'forbidden' });
  // Optional: lokale Bild-Datei mit löschen
  if (p.image_url && p.image_url.startsWith('/uploads/')) {
    const filename = path.basename(p.image_url);
    fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
  }
  await q('DELETE FROM posts WHERE id = $1', [p.id]);
  broadcastAll('post:deleted', { id: p.id });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', authRequired, async (req, res) => {
  await q(`INSERT INTO likes (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.auth.uid, req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/posts/:id/like', authRequired, async (req, res) => {
  await q('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [req.auth.uid, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/trending', authRequired, async (req, res) => {
  const rows = await q(`SELECT tag, COUNT(*)::int AS c FROM post_hashtags GROUP BY tag ORDER BY c DESC LIMIT 8`);
  res.json({ tags: rows });
});

// ------------------------------------------------------------
// Direct Messages
// ------------------------------------------------------------
// List conversation threads (latest message + unread count per partner)
app.get('/api/messages/threads', authRequired, async (req, res) => {
  const me = req.auth.uid;
  const latest = await q(`
    SELECT DISTINCT ON (partner_id) *
    FROM (
      SELECT *,
        CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS partner_id
      FROM messages
      WHERE sender_id = $1 OR receiver_id = $1
    ) m
    ORDER BY partner_id, created_at DESC
  `, [me]);

  const threads = [];
  for (const row of latest) {
    const partner = await q1('SELECT * FROM users WHERE id = $1', [row.partner_id]);
    if (!partner) continue;
    const [unread] = await q(
      `SELECT COUNT(*)::int AS c FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [row.partner_id, me]
    );
    threads.push({
      partner: userShape(partner),
      lastMessage: {
        id: row.id, content: row.content, createdAt: row.created_at,
        isMine: row.sender_id === me, readAt: row.read_at,
      },
      unread: unread.c,
    });
  }
  threads.sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));
  res.json({ threads });
});

// Conversation with a specific user
app.get('/api/messages/with/:userId', authRequired, async (req, res) => {
  const me = req.auth.uid;
  const other = req.params.userId;
  const partner = await q1('SELECT * FROM users WHERE id = $1', [other]);
  if (!partner) return res.status(404).json({ error: 'user not found' });

  const rows = await q(`
    SELECT * FROM messages
    WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
    ORDER BY created_at ASC LIMIT 500
  `, [me, other]);

  // Empfangene Nachrichten als gelesen markieren
  await q(`UPDATE messages SET read_at = NOW() WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`, [other, me]);
  // Sender informieren, dass die Nachrichten gelesen wurden (für Read-Receipts)
  broadcastToUser(other, 'dm:read', { byUserId: me, at: new Date().toISOString() });

  res.json({
    partner: userShape(partner),
    messages: rows.map(m => messageShape(m, me)),
  });
});

// Send a DM
app.post('/api/messages', authRequired, async (req, res) => {
  const receiverId = req.body?.receiverId;
  const content = String(req.body?.content || '').trim();
  if (!receiverId || receiverId === req.auth.uid) return res.status(400).json({ error: 'invalid receiver' });
  if (!content || content.length > 1000) return res.status(400).json({ error: 'content 1..1000 chars' });
  const receiver = await q1('SELECT * FROM users WHERE id = $1', [receiverId]);
  if (!receiver) return res.status(404).json({ error: 'receiver not found' });

  const msg = await q1(
    `INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1,$2,$3) RETURNING *`,
    [req.auth.uid, receiverId, content]
  );
  const sender = await q1('SELECT * FROM users WHERE id = $1', [req.auth.uid]);

  // An Empfänger pushen (mit Sender-Info, damit Notifications hübsch sind)
  broadcastToUser(receiverId, 'dm:new', {
    ...messageShape(msg, receiverId),
    sender: userShape(sender),
  });
  // An Sender selbst (Multi-Tab-Sync)
  broadcastToUser(req.auth.uid, 'dm:sent', messageShape(msg, req.auth.uid));

  res.status(201).json({ message: messageShape(msg, req.auth.uid) });
});

// Unread badge count
app.get('/api/messages/unread', authRequired, async (req, res) => {
  const [row] = await q(
    'SELECT COUNT(*)::int AS c FROM messages WHERE receiver_id = $1 AND read_at IS NULL',
    [req.auth.uid]
  );
  res.json({ count: row.c });
});

// ------------------------------------------------------------
// SSE — live updates
// ------------------------------------------------------------
app.get('/api/events', (req, res) => {
  const token = req.query.token;
  let userId;
  try { userId = jwt.verify(token, JWT_SECRET).uid; }
  catch { return res.status(401).end(); }
  if (!userId) return res.status(401).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: {"ts":${Date.now()}}\n\n`);
  sseAdd(userId, res);

  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(keepalive); sseRemove(userId, res); });
});

// ------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------
async function bootstrap() {
  let attempts = 0;
  while (attempts < 30) {
    try { await pool.query('SELECT 1'); break; }
    catch { attempts++; await new Promise(r => setTimeout(r, 1000)); }
  }
  if (attempts >= 30) { console.error('DB unreachable'); process.exit(1); }

  const existing = await q1('SELECT * FROM users WHERE email = $1', [OWNER_EMAIL]);
  if (!existing) {
    const ownerBio = '// root operator // network administrator //\n> all systems nominal';
    const owner = await q1(
      `INSERT INTO users (email, username, display_name, bio, is_owner) VALUES ($1,$2,$3,$4,TRUE) RETURNING *`,
      [OWNER_EMAIL, OWNER_USERNAME, OWNER_DISPLAY_NAME, ownerBio]
    );
    const seedPosts = [
      'welcome to NEXUS // a public channel for short transmissions',
      'this network runs on a simple principle: signal in, signal out. #welcome',
      '> use #hashtags to thread conversations around a topic.\n> repost to amplify. reply to discuss.\n> attach an image with the picture button.\n> drop me a DM if you need anything.',
      'remember: every transmission here is public. broadcast accordingly. #ops',
    ];
    for (const content of seedPosts) {
      const p = await q1(`INSERT INTO posts (author_id, content) VALUES ($1,$2) RETURNING *`, [owner.id, content]);
      for (const tag of extractHashtags(content)) {
        await q(`INSERT INTO post_hashtags (post_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p.id, tag]);
      }
    }
    console.log(`[bootstrap] owner created: ${OWNER_USERNAME} <${OWNER_EMAIL}>`);
  } else {
    console.log(`[bootstrap] owner exists: ${existing.username}`);
  }
}

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'internal' }); });

bootstrap()
  .then(() => { app.listen(PORT, () => console.log(`[nexus] backend listening on :${PORT}`)); })
  .catch((err) => { console.error('bootstrap failed:', err); process.exit(1); });