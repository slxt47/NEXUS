import { useState, useEffect, useRef, useCallback } from 'react';
import {
  User, Hash, Heart, Repeat2, MessageCircle, Send, Search,
  Home, Mail, ArrowLeft, Trash2, TrendingUp, UserPlus, UserMinus, Loader2,
  Check, AlertCircle, Image as ImageIcon, Settings, Power, Cpu, Wifi, Activity, X,
  MessageSquare, Inbox, ZoomIn,
} from 'lucide-react';
import { api, auth, connectEvents, compressImage } from './api.js';

const MAX_POST_LEN = 280;
const MAX_DM_LEN = 1000;
const BOOT_LINES = [
  '> NEXUS TERMINAL v2.5',
  '> Initializing socket layer...',
  '> Loading user registry...',
  '> Mounting feed buffer...',
  '> Linking DM channel...',
  '> Establishing secure channel...',
  '> System ready.',
];

// ============================================================
// HELPERS
// ============================================================
const formatTime = (ts) => {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return new Date(ts).toLocaleDateString();
};
const hashColor = (str) => {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 70%, 50%)`;
};
const extractHashtags = (text) => {
  const m = text.match(/#[\w\u00C0-\u017F]+/g) || [];
  return [...new Set(m.map((t) => t.substring(1).toLowerCase()))];
};

// ============================================================
// PRIMITIVES
// ============================================================
function Avatar({ user, size = 40, onClick }) {
  const dim = `${size}px`;
  if (!user) return <div style={{ width: dim, height: dim }} className="bg-zinc-900 border border-green-500/30" />;
  if (user.isOwner) {
    return (
      <div onClick={onClick} style={{ width: dim, height: dim }}
        className={`relative flex items-center justify-center bg-black border border-green-400 shrink-0 ${onClick ? 'cursor-pointer' : ''}`}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#4ade80" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" />
          <path d="M6 8l3 3-3 3M11 14h5" />
        </svg>
        <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 animate-pulse" />
      </div>
    );
  }
  if (user.avatar) {
    return <img onClick={onClick} src={user.avatar} alt={user.username}
      style={{ width: dim, height: dim }}
      className={`object-cover border border-green-500/40 shrink-0 ${onClick ? 'cursor-pointer' : ''}`} />;
  }
  const initial = (user.displayName || user.username || '?').charAt(0).toUpperCase();
  return (
    <div onClick={onClick}
      style={{ width: dim, height: dim, background: hashColor(user.id || user.username), fontSize: size * 0.45 }}
      className={`flex items-center justify-center font-bold text-black border border-green-500/40 shrink-0 ${onClick ? 'cursor-pointer' : ''}`}>
      {initial}
    </div>
  );
}

function PostContent({ content, onHashtag }) {
  if (!content) return null;
  const parts = content.split(/(#[\w\u00C0-\u017F]+|@[\w]+|https?:\/\/\S+)/g);
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('#')) {
          return <span key={i} onClick={(e) => { e.stopPropagation(); onHashtag && onHashtag(p.substring(1).toLowerCase()); }}
            className="text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer">{p}</span>;
        }
        if (p.startsWith('@')) return <span key={i} className="text-cyan-400">{p}</span>;
        if (p.startsWith('http')) return <a key={i} href={p} target="_blank" rel="noreferrer" className="text-cyan-400 underline break-all">{p}</a>;
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

// ============================================================
// LIGHTBOX
// ============================================================
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-green-400/70 hover:text-green-300 p-2 border border-green-500/30">
        <X size={20} />
      </button>
      <img src={src} className="max-w-full max-h-full object-contain border border-green-500/30" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ============================================================
// BOOT
// ============================================================
function BootScreen({ onDone }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setLines((prev) => [...prev, BOOT_LINES[i]]);
      i++;
      if (i >= BOOT_LINES.length) { clearInterval(interval); setTimeout(onDone, 400); }
    }, 140);
    return () => clearInterval(interval);
  }, [onDone]);
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center p-6 font-mono z-50">
      <div className="w-full max-w-xl text-green-400 text-sm">
        <div className="text-xs text-green-500/50 mb-4 border-b border-green-500/20 pb-2">
          ┌─[ N E X U S ]─────────────────────────────┐
        </div>
        {lines.map((l, i) => <div key={i} className="leading-relaxed glow">{l}</div>)}
        <span className="inline-block w-2 h-4 bg-green-400 animate-pulse ml-0 mt-1" />
      </div>
    </div>
  );
}

// ============================================================
// AUTH SCREEN
// ============================================================
function AuthScreen({ onAuthenticated }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [regToken, setRegToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newAvatar, setNewAvatar] = useState(null);
  const fileRef = useRef(null);

  const submitEmail = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.requestCode(email.trim().toLowerCase());
      setEmail(email.trim().toLowerCase());
      setStep('code');
    } catch (err) { setError(err.message || 'failed'); }
    setBusy(false);
  };
  const submitCode = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api.verifyCode(email, code.trim());
      if (res.needsRegistration) {
        setRegToken(res.regToken);
        const sug = email.split('@')[0].replace(/[^a-z0-9_]/gi, '').slice(0, 15) || 'user';
        setNewUsername(sug); setNewDisplay(sug);
        setStep('profile');
      } else { auth.setToken(res.token); onAuthenticated(res.user); }
    } catch (err) { setError(err.message || 'verification failed'); }
    setBusy(false);
  };
  const handleAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('image only'); return; }
    try { setNewAvatar(await compressImage(f, 200, 0.75)); }
    catch { setError('could not process image'); }
  };
  const submitProfile = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api.register(regToken, newUsername, newDisplay, newAvatar);
      auth.setToken(res.token); onAuthenticated(res.user);
    } catch (err) { setError(err.message || 'registration failed'); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 font-mono">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-green-400 text-3xl font-bold tracking-widest glow">N E X U S</div>
          <div className="text-green-500/50 text-xs mt-1 tracking-wider">// secure terminal access //</div>
        </div>
        <div className="border border-green-500/40 bg-zinc-950/50">
          <div className="border-b border-green-500/30 px-4 py-2 flex items-center justify-between bg-green-500/5">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 bg-red-500/70" />
              <div className="w-2.5 h-2.5 bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 bg-green-500" />
            </div>
            <div className="text-green-400/70 text-xs">
              {step === 'email' && 'auth.sh — login'}
              {step === 'code' && 'auth.sh — verify'}
              {step === 'profile' && 'auth.sh — register'}
            </div>
            <div className="w-12" />
          </div>
          <div className="p-6 text-green-400 text-sm">
            {step === 'email' && (
              <form onSubmit={submitEmail} className="space-y-4">
                <div>
                  <div className="text-green-500/70 mb-1">$ enter your email_address:</div>
                  <div className="flex items-center gap-2 border border-green-500/40 px-3 py-2 focus-within:border-green-400 bg-black/60">
                    <Mail size={16} className="text-green-500/60" />
                    <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="[email protected]"
                      className="bg-transparent outline-none flex-1 text-green-300 placeholder:text-green-500/30" />
                  </div>
                </div>
                <div className="text-xs text-green-500/50 leading-relaxed">
                  &gt; Code wird via SMTP versendet. 
                </div>
                <button type="submit" disabled={busy} className="w-full border border-green-400 text-green-300 hover:bg-green-400 hover:text-black py-2 font-bold tracking-wider transition-colors disabled:opacity-50">
                  {busy ? <Loader2 className="animate-spin mx-auto" size={18} /> : '[ TRANSMIT CODE ]'}
                </button>
                {error && <div className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={12} />{error}</div>}
              </form>
            )}
            {step === 'code' && (
              <form onSubmit={submitCode} className="space-y-4">
                <div className="border border-cyan-500/40 bg-cyan-500/5 p-3 text-xs">
                  <div className="text-cyan-300 mb-1">[ CODE TRANSMITTED ]</div>
                  <div className="text-cyan-400/70">to: {email}</div>
                </div>
                <div>
                  <div className="text-green-500/70 mb-1">$ enter verification code:</div>
                  <input autoFocus maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="------"
                    className="w-full bg-black/60 border border-green-500/40 focus:border-green-400 outline-none px-3 py-2 text-green-300 text-center text-xl tracking-[0.5em] font-bold" />
                </div>
                <button type="submit" disabled={busy} className="w-full border border-green-400 text-green-300 hover:bg-green-400 hover:text-black py-2 font-bold tracking-wider transition-colors disabled:opacity-50">
                  {busy ? <Loader2 className="animate-spin mx-auto" size={18} /> : '[ VERIFY ]'}
                </button>
                <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="w-full text-green-500/60 hover:text-green-400 text-xs">
                  &lt; back
                </button>
                {error && <div className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={12} />{error}</div>}
              </form>
            )}
            {step === 'profile' && (
              <form onSubmit={submitProfile} className="space-y-4">
                <div className="text-green-500/70">$ initialize new_user profile:</div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    {newAvatar ? (
                      <img src={newAvatar} className="w-16 h-16 object-cover border border-green-400" />
                    ) : (
                      <div className="w-16 h-16 border border-dashed border-green-500/40 flex items-center justify-center text-green-500/40">
                        <ImageIcon size={24} />
                      </div>
                    )}
                    <button type="button" onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 bg-green-400 text-black p-1 hover:bg-green-300">
                      <ImageIcon size={10} />
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
                  </div>
                  <div className="flex-1 text-xs text-green-500/60">
                    &gt; upload avatar<br />&gt; or skip (auto-generate)
                  </div>
                </div>
                <div>
                  <div className="text-green-500/70 mb-1 text-xs">username:</div>
                  <div className="flex items-center border border-green-500/40 focus-within:border-green-400 bg-black/60">
                    <span className="px-2 text-green-500/60">@</span>
                    <input value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      maxLength={20} className="bg-transparent outline-none flex-1 py-2 text-green-300" />
                  </div>
                </div>
                <div>
                  <div className="text-green-500/70 mb-1 text-xs">display name:</div>
                  <input value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} maxLength={30}
                    className="w-full bg-black/60 border border-green-500/40 focus:border-green-400 outline-none px-3 py-2 text-green-300" />
                </div>
                <button type="submit" disabled={busy} className="w-full border border-green-400 text-green-300 hover:bg-green-400 hover:text-black py-2 font-bold tracking-wider transition-colors disabled:opacity-50">
                  {busy ? <Loader2 className="animate-spin mx-auto" size={18} /> : '[ ENTER NEXUS ]'}
                </button>
                {error && <div className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={12} />{error}</div>}
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMPOSER WITH IMAGE ATTACHMENT
// ============================================================
function Composer({ user, onSubmit, replyTo = null, compact = false, placeholder = null }) {
  const [content, setContent] = useState('');
  const [image, setImage] = useState(null); // data URL preview
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const pickImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('image only'); return; }
    if (f.size > 15 * 1024 * 1024) { setError('file too large (>15MB raw)'); return; }
    setError(''); setUploading(true);
    try {
      const compressed = await compressImage(f, 1200, 0.82);
      setImage(compressed);
    } catch { setError('could not process image'); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async () => {
    const t = content.trim();
    if (!t && !image) return;
    if (busy) return;
    setBusy(true); setError('');
    try {
      let imageUrl = null;
      if (image) {
        const up = await api.upload(image);
        imageUrl = up.url;
      }
      await onSubmit({ content: t, imageUrl });
      setContent(''); setImage(null);
    } catch (e) {
      setError(e.message || 'failed');
    }
    setBusy(false);
  };

  const remaining = MAX_POST_LEN - content.length;
  const over = remaining < 0;
  const canSubmit = (content.trim() || image) && !over && !busy && !uploading;

  return (
    <div className={`flex gap-3 ${compact ? 'p-3' : 'p-4'} border-b border-green-500/20`}>
      <Avatar user={user} size={compact ? 36 : 44} />
      <div className="flex-1 min-w-0">
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
          placeholder={placeholder || (replyTo ? `> reply to @${replyTo.username}...` : "> what's on your mind?_")}
          rows={compact ? 2 : 3}
          className="w-full bg-transparent outline-none resize-none text-green-300 placeholder:text-green-500/30 text-[15px] leading-relaxed" />

        {image && (
          <div className="relative inline-block mt-2 border border-green-500/30">
            <img src={image} className="max-h-48 object-contain" />
            <button onClick={() => setImage(null)} className="absolute top-1 right-1 bg-black/80 border border-green-500/40 hover:border-red-400 hover:text-red-400 text-green-300 p-1">
              <X size={12} />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-green-500/10">
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="text-green-500/70 hover:text-green-300 transition-colors disabled:opacity-30" title="attach image">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} className="hidden" />
            {extractHashtags(content).length > 0 && (
              <span className="text-xs text-cyan-400/60">#{extractHashtags(content).length}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-mono ${over ? 'text-red-400' : remaining < 20 ? 'text-yellow-400' : 'text-green-500/50'}`}>{remaining}</span>
            <button onClick={submit} disabled={!canSubmit}
              className="border border-green-400 text-green-300 hover:bg-green-400 hover:text-black px-3 py-1 text-xs font-bold tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {replyTo ? 'REPLY' : 'POST'}
            </button>
          </div>
        </div>
        {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
      </div>
    </div>
  );
}

// ============================================================
// POST CARD
// ============================================================
function PostCard({ post, currentUser, onAction, onNavigate, onHashtag, onLightbox }) {
  if (!post || !post.author) return null;
  if (post.repostOf && !post.content && !post.imageUrl) return null; // skip orphan repost markers

  const liked = post.viewer?.liked;
  const reposted = post.viewer?.reposted;
  const canDelete = currentUser.id === post.authorId || currentUser.isOwner;

  return (
    <div className="border-b border-green-500/20 hover:bg-green-500/[0.02] transition-colors">
      <div className="p-4 cursor-pointer" onClick={() => onNavigate('post', post.id)}>
        <div className="flex gap-3">
          <Avatar user={post.author} size={44}
            onClick={(e) => { e.stopPropagation(); onNavigate('profile', post.authorId); }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-sm flex-wrap">
              <span className="font-bold text-green-300 hover:underline"
                onClick={(e) => { e.stopPropagation(); onNavigate('profile', post.authorId); }}>
                {post.author.displayName}
              </span>
              {post.author.isOwner && <span className="text-[9px] bg-green-400 text-black px-1 font-bold tracking-wider">ROOT</span>}
              <span className="text-green-500/50">@{post.author.username}</span>
              <span className="text-green-500/40">·</span>
              <span className="text-green-500/50 text-xs">{formatTime(post.createdAt)}</span>
              {canDelete && (
                <button onClick={(e) => { e.stopPropagation(); onAction('delete', post.id); }}
                  className="ml-auto text-green-500/40 hover:text-red-400 p-1" title="delete">
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {post.replyTo && <div className="text-xs text-green-500/50 mb-1">replying to thread</div>}

            <div className="text-green-100/90 text-[15px] mt-1">
              <PostContent content={post.content} onHashtag={onHashtag} />
            </div>

            {post.imageUrl && (
              <div className="mt-3 border border-green-500/20 relative inline-block max-w-full"
                onClick={(e) => { e.stopPropagation(); onLightbox(post.imageUrl); }}>
                <img src={post.imageUrl} className="max-h-96 max-w-full object-contain cursor-zoom-in" />
                <div className="absolute top-2 right-2 bg-black/60 text-green-400 p-1 border border-green-500/30 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                  <ZoomIn size={12} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-6 mt-3 text-green-500/60 text-xs">
              <button onClick={(e) => { e.stopPropagation(); onNavigate('post', post.id); }}
                className="flex items-center gap-1.5 hover:text-cyan-400 transition-colors group">
                <MessageCircle size={14} className="group-hover:scale-110 transition-transform" />
                <span>{post.counts?.replies || 0}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onAction('repost', post.id); }}
                className={`flex items-center gap-1.5 hover:text-green-300 transition-colors group ${reposted ? 'text-green-300' : ''}`}>
                <Repeat2 size={14} className="group-hover:scale-110 transition-transform" />
                <span>{post.counts?.reposts || 0}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onAction('like', post.id); }}
                className={`flex items-center gap-1.5 hover:text-pink-400 transition-colors group ${liked ? 'text-pink-400' : ''}`}>
                <Heart size={14} fill={liked ? 'currentColor' : 'none'} className="group-hover:scale-110 transition-transform" />
                <span>{post.counts?.likes || 0}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SIDEBAR + MOBILE NAV
// ============================================================
function Sidebar({ currentUser, currentView, onNavigate, onLogout, onCompose, unreadDMs }) {
  const items = [
    { id: 'feed', label: 'home', icon: Home },
    { id: 'explore', label: 'explore', icon: Hash },
    { id: 'messages', label: 'messages', icon: MessageSquare, badge: unreadDMs },
    { id: 'profile', label: 'profile', icon: User, payload: currentUser.id },
    { id: 'settings', label: 'settings', icon: Settings },
  ];
  return (
    <aside className="w-56 shrink-0 border-r border-green-500/20 bg-black/80 sticky top-0 h-screen p-4 flex-col hidden md:flex">
      <div className="text-green-400 font-bold tracking-widest text-lg mb-1 glow">N E X U S</div>
      <div className="text-green-500/40 text-[10px] tracking-wider mb-8">// terminal v2.5</div>
      <nav className="space-y-1 mb-6">
        {items.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id, item.payload)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors border ${active ? 'border-green-400 bg-green-400/10 text-green-300' : 'border-transparent text-green-500/70 hover:text-green-300 hover:border-green-500/30'}`}>
              <Icon size={16} /><span className="tracking-wider">{item.label}</span>
              {item.badge > 0 && (
                <span className="ml-auto bg-green-400 text-black text-[10px] px-1.5 font-bold">{item.badge > 99 ? '99+' : item.badge}</span>
              )}
            </button>
          );
        })}
      </nav>
      <button onClick={onCompose}
        className="w-full border border-green-400 text-green-300 hover:bg-green-400 hover:text-black py-2 px-3 font-bold tracking-wider text-sm transition-colors mb-auto">
        [ + NEW POST ]
      </button>
      <div className="mt-6 pt-4 border-t border-green-500/20">
        <div className="flex items-center gap-2 mb-3">
          <Avatar user={currentUser} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-green-300 text-xs truncate">{currentUser.displayName}</div>
            <div className="text-green-500/50 text-[10px] truncate">@{currentUser.username}</div>
          </div>
        </div>
        <button onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 text-xs text-green-500/60 hover:text-red-400 py-1.5 border border-green-500/20 hover:border-red-500/40 transition-colors">
          <Power size={12} /> LOGOUT
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ currentView, onNavigate, currentUser, onCompose, unreadDMs }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black/95 border-t border-green-500/30 flex items-center justify-around py-2 z-30 backdrop-blur">
      <button onClick={() => onNavigate('feed')} className={`p-3 ${currentView === 'feed' ? 'text-green-300' : 'text-green-500/50'}`}><Home size={20} /></button>
      <button onClick={() => onNavigate('explore')} className={`p-3 ${currentView === 'explore' ? 'text-green-300' : 'text-green-500/50'}`}><Hash size={20} /></button>
      <button onClick={onCompose} className="bg-green-400 text-black p-3"><Send size={20} /></button>
      <button onClick={() => onNavigate('messages')} className={`p-3 relative ${currentView === 'messages' ? 'text-green-300' : 'text-green-500/50'}`}>
        <MessageSquare size={20} />
        {unreadDMs > 0 && <span className="absolute top-1 right-1 bg-green-400 text-black text-[9px] px-1 font-bold">{unreadDMs > 9 ? '9+' : unreadDMs}</span>}
      </button>
      <button onClick={() => onNavigate('profile', currentUser.id)} className={`p-3 ${currentView === 'profile' ? 'text-green-300' : 'text-green-500/50'}`}><User size={20} /></button>
    </nav>
  );
}

// ============================================================
// FEED
// ============================================================
function FeedView({ currentUser, onNavigate, onHashtag, onLightbox, refreshKey, onRefresh }) {
  const [tab, setTab] = useState('all');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.getFeed(tab); setPosts(r.posts || []); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAction = async (action, id) => {
    try {
      if (action === 'like') {
        const p = posts.find((x) => x.id === id);
        if (!p) return;
        if (p.viewer.liked) await api.unlike(id); else await api.like(id);
      } else if (action === 'repost') {
        await api.createPost({ repostOf: id });
      } else if (action === 'delete') {
        await api.deletePost(id);
      }
      load(); onRefresh();
    } catch (e) { console.error(e); }
  };

  const createPost = async ({ content, imageUrl }) => {
    await api.createPost({ content, imageUrl });
    load(); onRefresh();
  };

  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-green-300 font-bold tracking-wider text-sm">~/ FEED</div>
          <div className="flex items-center gap-2 text-[10px] text-green-500/40">
            <Activity size={10} className="animate-pulse text-green-400" /> LIVE
          </div>
        </div>
        <div className="flex border-t border-green-500/20">
          {['all', 'following'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs tracking-widest uppercase transition-colors ${tab === t ? 'text-green-300 border-b-2 border-green-400' : 'text-green-500/50 hover:text-green-400 border-b-2 border-transparent'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <Composer user={currentUser} onSubmit={createPost} />
      {loading && <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto mb-2" /> loading feed...</div>}
      {!loading && posts.length === 0 && (
        <div className="p-12 text-center text-green-500/40 text-sm">
          <div>┌──────────────────────┐</div>
          <div>│ no signal in buffer │</div>
          <div className="mb-4">└──────────────────────┘</div>
          {tab === 'following' && <div className="text-xs">&gt; follow some users to see their posts</div>}
        </div>
      )}
      {!loading && posts.map((post) => (
        <PostCard key={post.id} post={post} currentUser={currentUser}
          onAction={handleAction} onNavigate={onNavigate} onHashtag={onHashtag} onLightbox={onLightbox} />
      ))}
    </div>
  );
}

// ============================================================
// EXPLORE
// ============================================================
function ExploreView({ currentUser, hashtag, onNavigate, onHashtag, onLightbox, refreshKey, onRefresh }) {
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState([]);
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [feed, trend] = await Promise.all([
        hashtag ? api.getFeed('all', hashtag) : api.getFeed('all'),
        api.trending(),
      ]);
      setPosts(feed.posts || []); setTrending(trend.tags || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [hashtag]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAction = async (action, id) => {
    try {
      if (action === 'like') {
        const p = posts.find((x) => x.id === id);
        if (p?.viewer.liked) await api.unlike(id); else await api.like(id);
      } else if (action === 'repost') { await api.createPost({ repostOf: id }); }
      else if (action === 'delete') { await api.deletePost(id); }
      load(); onRefresh();
    } catch (e) { console.error(e); }
  };

  const filtered = query.trim()
    ? posts.filter((p) => p.content.toLowerCase().includes(query.toLowerCase()) ||
      p.author?.username.toLowerCase().includes(query.toLowerCase()) ||
      p.author?.displayName.toLowerCase().includes(query.toLowerCase()))
    : posts;

  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        {hashtag ? (
          <>
            <button onClick={() => onNavigate('explore')} className="text-green-500/60 hover:text-green-300"><ArrowLeft size={18} /></button>
            <div>
              <div className="text-green-300 font-bold tracking-wider">#{hashtag}</div>
              <div className="text-green-500/50 text-xs">{posts.length} posts</div>
            </div>
          </>
        ) : (
          <>
            <Search size={16} className="text-green-500/60" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="$ search posts, users, tags..."
              className="bg-transparent flex-1 outline-none text-green-300 placeholder:text-green-500/40 text-sm" />
          </>
        )}
      </div>
      {!hashtag && !query && (
        <div className="border-b border-green-500/20 p-4">
          <div className="flex items-center gap-2 text-green-300 text-sm font-bold tracking-wider mb-3"><TrendingUp size={14} /> TRENDING</div>
          {trending.length === 0 ? (
            <div className="text-green-500/40 text-xs">&gt; no trends yet</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {trending.map(({ tag, c }) => (
                <button key={tag} onClick={() => onHashtag(tag)}
                  className="text-left border border-green-500/20 hover:border-green-400 hover:bg-green-500/5 p-2 transition-colors">
                  <div className="text-cyan-400 text-sm">#{tag}</div>
                  <div className="text-green-500/50 text-[10px]">{c} post{c !== 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {loading ? <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" /></div>
        : filtered.length === 0 ? <div className="p-12 text-center text-green-500/40 text-sm">&gt; no results</div>
        : filtered.map((p) => (
          <PostCard key={p.id} post={p} currentUser={currentUser}
            onAction={handleAction} onNavigate={onNavigate} onHashtag={onHashtag} onLightbox={onLightbox} />
        ))}
    </div>
  );
}

// ============================================================
// PROFILE
// ============================================================
function ProfileView({ userId, currentUser, onNavigate, onHashtag, onLightbox, refreshKey, onRefresh }) {
  const [data, setData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [replies, setReplies] = useState([]);
  const [tab, setTab] = useState('posts');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, p, r] = await Promise.all([
        api.getUser(userId),
        api.getUserPosts(userId, false),
        api.getUserPosts(userId, true),
      ]);
      setData(u); setPosts(p.posts || []); setReplies(r.posts || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const toggleFollow = async () => {
    if (data.viewer.isFollowing) await api.unfollow(userId); else await api.follow(userId);
    load(); onRefresh();
  };
  const handleAction = async (action, id) => {
    try {
      if (action === 'like') {
        const all = [...posts, ...replies];
        const p = all.find((x) => x.id === id);
        if (p?.viewer.liked) await api.unlike(id); else await api.like(id);
      } else if (action === 'repost') { await api.createPost({ repostOf: id }); }
      else if (action === 'delete') { await api.deletePost(id); }
      load(); onRefresh();
    } catch (e) { console.error(e); }
  };

  if (loading || !data) return <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" /></div>;
  const list = tab === 'posts' ? posts : replies;
  const u = data.user;

  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => onNavigate('feed')} className="text-green-500/60 hover:text-green-300"><ArrowLeft size={18} /></button>
        <div className="text-green-300 font-bold tracking-wider text-sm">~/ {u.username}</div>
      </div>
      <div className="border-b border-green-500/20 p-6">
        <div className="flex items-start justify-between mb-4">
          <Avatar user={u} size={80} />
          <div className="flex items-center gap-2">
            {!data.viewer.isSelf && (
              <button onClick={() => onNavigate('dm', userId)}
                className="border border-green-500/40 text-green-400 hover:border-green-400 hover:text-green-300 px-4 py-1.5 text-xs font-bold tracking-wider flex items-center gap-2">
                <MessageSquare size={12} /> MESSAGE
              </button>
            )}
            {data.viewer.isSelf ? (
              <button onClick={() => onNavigate('settings')}
                className="border border-green-500/40 text-green-400 hover:border-green-400 px-4 py-1.5 text-xs font-bold tracking-wider flex items-center gap-2">
                <Settings size={12} /> EDIT
              </button>
            ) : (
              <button onClick={toggleFollow}
                className={`border px-4 py-1.5 text-xs font-bold tracking-wider transition-colors flex items-center gap-2 ${data.viewer.isFollowing ? 'border-green-500/40 text-green-400 hover:border-red-500 hover:text-red-400' : 'border-green-400 text-green-300 hover:bg-green-400 hover:text-black'}`}>
                {data.viewer.isFollowing ? <><UserMinus size={12} /> UNFOLLOW</> : <><UserPlus size={12} /> FOLLOW</>}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-green-200 font-bold text-lg">{u.displayName}</div>
          {u.isOwner && <span className="text-[9px] bg-green-400 text-black px-1.5 py-0.5 font-bold tracking-wider">ROOT</span>}
        </div>
        <div className="text-green-500/60 text-sm">@{u.username}</div>
        {u.bio && (
          <div className="text-green-300/80 text-sm mt-3 whitespace-pre-wrap leading-relaxed">
            <PostContent content={u.bio} onHashtag={onHashtag} />
          </div>
        )}
        <div className="flex gap-5 mt-4 text-xs">
          <div><span className="text-green-300 font-bold">{data.counts.following}</span><span className="text-green-500/60"> following</span></div>
          <div><span className="text-green-300 font-bold">{data.counts.followers}</span><span className="text-green-500/60"> followers</span></div>
          <div><span className="text-green-300 font-bold">{data.counts.posts}</span><span className="text-green-500/60"> posts</span></div>
        </div>
      </div>
      <div className="flex border-b border-green-500/20">
        {['posts', 'replies'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs tracking-widest uppercase transition-colors ${tab === t ? 'text-green-300 border-b-2 border-green-400' : 'text-green-500/50 hover:text-green-400 border-b-2 border-transparent'}`}>{t}</button>
        ))}
      </div>
      {list.length === 0 ? <div className="p-12 text-center text-green-500/40 text-sm">&gt; no {tab} yet</div>
        : list.map((p) => (
          <PostCard key={p.id} post={p} currentUser={currentUser}
            onAction={handleAction} onNavigate={onNavigate} onHashtag={onHashtag} onLightbox={onLightbox} />
        ))}
    </div>
  );
}

// ============================================================
// POST DETAIL
// ============================================================
function PostDetailView({ postId, currentUser, onNavigate, onHashtag, onLightbox, refreshKey, onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.getPost(postId)); }
    catch { setData({ error: true }); }
    setLoading(false);
  }, [postId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleAction = async (action, id) => {
    try {
      if (action === 'like') {
        const all = [data.post, ...data.parents, ...data.replies].filter(Boolean);
        const p = all.find((x) => x.id === id);
        if (p?.viewer.liked) await api.unlike(id); else await api.like(id);
      } else if (action === 'repost') { await api.createPost({ repostOf: id }); }
      else if (action === 'delete') {
        await api.deletePost(id);
        if (id === postId) { onNavigate('feed'); return; }
      }
      load(); onRefresh();
    } catch (e) { console.error(e); }
  };
  const createReply = async ({ content, imageUrl }) => {
    await api.createPost({ content, imageUrl, replyTo: postId });
    load(); onRefresh();
  };

  if (loading) return <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" /></div>;
  if (!data || data.error) return (
    <div>
      <div className="sticky top-0 bg-black/90 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => onNavigate('feed')} className="text-green-500/60"><ArrowLeft size={18} /></button>
        <div className="text-green-300 text-sm">~/ post</div>
      </div>
      <div className="p-12 text-center text-red-400/60 text-sm">// post not found</div>
    </div>
  );

  const { post, parents, replies } = data;
  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => onNavigate('feed')} className="text-green-500/60 hover:text-green-300"><ArrowLeft size={18} /></button>
        <div className="text-green-300 font-bold tracking-wider text-sm">~/ thread</div>
      </div>
      {parents.map((p) => (
        <PostCard key={p.id} post={p} currentUser={currentUser}
          onAction={handleAction} onNavigate={onNavigate} onHashtag={onHashtag} onLightbox={onLightbox} />
      ))}
      <div className="border-b border-green-500/30 p-5 bg-green-500/[0.02]">
        <div className="flex items-center gap-3 mb-3">
          <Avatar user={post.author} size={48} onClick={() => onNavigate('profile', post.authorId)} />
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-green-300 hover:underline cursor-pointer" onClick={() => onNavigate('profile', post.authorId)}>
                {post.author.displayName}
              </span>
              {post.author.isOwner && <span className="text-[9px] bg-green-400 text-black px-1 font-bold tracking-wider">ROOT</span>}
            </div>
            <div className="text-green-500/50 text-sm">@{post.author.username}</div>
          </div>
          {(currentUser.id === post.authorId || currentUser.isOwner) && (
            <button onClick={() => handleAction('delete', post.id)} className="text-green-500/40 hover:text-red-400 p-1">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="text-green-100/90 text-base mb-3"><PostContent content={post.content} onHashtag={onHashtag} /></div>
        {post.imageUrl && (
          <div className="mb-3 border border-green-500/20 inline-block max-w-full cursor-zoom-in"
            onClick={() => onLightbox(post.imageUrl)}>
            <img src={post.imageUrl} className="max-h-96 max-w-full object-contain" />
          </div>
        )}
        <div className="text-xs text-green-500/50 pb-3 border-b border-green-500/20">
          {new Date(post.createdAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-6 mt-3 text-green-500/60 text-xs">
          <div className="flex items-center gap-1.5"><MessageCircle size={14} /> <span>{post.counts.replies}</span></div>
          <button onClick={() => handleAction('repost', post.id)}
            className={`flex items-center gap-1.5 hover:text-green-300 ${post.viewer.reposted ? 'text-green-300' : ''}`}>
            <Repeat2 size={14} /> <span>{post.counts.reposts}</span>
          </button>
          <button onClick={() => handleAction('like', post.id)}
            className={`flex items-center gap-1.5 hover:text-pink-400 ${post.viewer.liked ? 'text-pink-400' : ''}`}>
            <Heart size={14} fill={post.viewer.liked ? 'currentColor' : 'none'} />
            <span>{post.counts.likes}</span>
          </button>
        </div>
      </div>
      <Composer user={currentUser} onSubmit={createReply} replyTo={post.author} compact />
      {replies.map((r) => (
        <PostCard key={r.id} post={r} currentUser={currentUser}
          onAction={handleAction} onNavigate={onNavigate} onHashtag={onHashtag} onLightbox={onLightbox} />
      ))}
    </div>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function SettingsView({ currentUser, onNavigate, onUserUpdated }) {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('image only'); return; }
    try { setAvatar(await compressImage(f, 200, 0.75)); }
    catch { setError('could not process image'); }
  };
  const save = async () => {
    setError(''); setSaving(true);
    try {
      const r = await api.updateMe({ displayName, bio, avatar });
      onUserUpdated(r.user);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e.message || 'save failed'); }
    setSaving(false);
  };

  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => onNavigate('feed')} className="text-green-500/60 hover:text-green-300"><ArrowLeft size={18} /></button>
        <div className="text-green-300 font-bold tracking-wider text-sm">~/ settings</div>
      </div>
      <div className="p-6 space-y-5">
        {currentUser.isOwner && (
          <div className="border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs text-yellow-300">
            // owner profile is locked / predefined by system
          </div>
        )}
        <div>
          <div className="text-green-500/70 text-xs mb-2 tracking-wider">$ avatar:</div>
          <div className="flex items-center gap-4">
            <Avatar user={{ ...currentUser, avatar }} size={72} />
            <button type="button" disabled={currentUser.isOwner} onClick={() => fileRef.current?.click()}
              className="border border-green-500/40 hover:border-green-400 px-3 py-2 text-xs text-green-300 tracking-wider disabled:opacity-30">
              [ UPLOAD ]
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
          </div>
        </div>
        <div>
          <div className="text-green-500/70 text-xs mb-2 tracking-wider">$ display_name:</div>
          <input disabled={currentUser.isOwner} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30}
            className="w-full bg-black/60 border border-green-500/40 focus:border-green-400 outline-none px-3 py-2 text-green-300 disabled:opacity-50" />
        </div>
        <div>
          <div className="text-green-500/70 text-xs mb-2 tracking-wider">$ username (immutable):</div>
          <div className="w-full bg-black/30 border border-green-500/20 px-3 py-2 text-green-500/60">@{currentUser.username}</div>
        </div>
        <div>
          <div className="text-green-500/70 text-xs mb-2 tracking-wider">$ bio:</div>
          <textarea disabled={currentUser.isOwner} value={bio} onChange={(e) => setBio(e.target.value)}
            maxLength={160} rows={3} placeholder="// tell the network about yourself..."
            className="w-full bg-black/60 border border-green-500/40 focus:border-green-400 outline-none px-3 py-2 text-green-300 text-sm resize-none disabled:opacity-50" />
          <div className="text-right text-[10px] text-green-500/40">{160 - bio.length}</div>
        </div>
        <button onClick={save} disabled={saving || currentUser.isOwner}
          className="border border-green-400 text-green-300 hover:bg-green-400 hover:text-black px-4 py-2 text-sm font-bold tracking-wider transition-colors disabled:opacity-30 flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? 'SAVED' : 'SAVE'}
        </button>
        {error && <div className="text-red-400 text-xs">{error}</div>}
      </div>
    </div>
  );
}

// ============================================================
// MESSAGES — Thread List
// ============================================================
function MessagesView({ currentUser, onNavigate, refreshKey }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.threads(); setThreads(r.threads || []); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div>
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <div className="text-green-300 font-bold tracking-wider text-sm flex items-center gap-2 flex-1">
          <Inbox size={14} /> ~/ MESSAGES
        </div>
        <button onClick={() => setPicking(true)}
          className="border border-green-400 text-green-300 hover:bg-green-400 hover:text-black px-3 py-1 text-xs font-bold tracking-wider transition-colors">
          [ + NEW ]
        </button>
      </div>

      {loading && <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" /></div>}

      {!loading && threads.length === 0 && (
        <div className="p-12 text-center text-green-500/40 text-sm">
          <div>┌─────────────────────────┐</div>
          <div>│ inbox is empty           │</div>
          <div className="mb-4">└─────────────────────────┘</div>
          <div className="text-xs">&gt; tap [+ NEW] to start a conversation</div>
        </div>
      )}

      {!loading && threads.map((t) => (
        <button key={t.partner.id}
          onClick={() => onNavigate('dm', t.partner.id)}
          className="w-full text-left border-b border-green-500/20 hover:bg-green-500/[0.03] transition-colors p-4 flex gap-3">
          <Avatar user={t.partner} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-green-300 truncate">{t.partner.displayName}</span>
              {t.partner.isOwner && <span className="text-[9px] bg-green-400 text-black px-1 font-bold tracking-wider">ROOT</span>}
              <span className="text-green-500/50 text-xs truncate">@{t.partner.username}</span>
              <span className="text-green-500/40 text-xs ml-auto whitespace-nowrap">{formatTime(t.lastMessage.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`text-sm truncate ${t.unread > 0 ? 'text-green-200 font-bold' : 'text-green-500/70'}`}>
                {t.lastMessage.isMine && <span className="text-green-500/50">you: </span>}
                {t.lastMessage.content}
              </div>
              {t.unread > 0 && (
                <span className="bg-green-400 text-black text-[10px] px-1.5 font-bold ml-auto whitespace-nowrap">
                  {t.unread > 99 ? '99+' : t.unread}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}

      {picking && <UserPicker currentUser={currentUser} onPick={(u) => { setPicking(false); onNavigate('dm', u.id); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

// ============================================================
// USER PICKER (for starting a new DM)
// ============================================================
function UserPicker({ currentUser, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = q ? await api.searchUsers(q) : await api.suggestions();
        setUsers(r.users || []);
      } catch { setUsers([]); }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-16 p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-green-500/40 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-green-500/30 px-4 py-2">
          <div className="text-green-400 text-xs tracking-wider">// new_message.sh</div>
          <button onClick={onClose} className="text-green-500/60 hover:text-red-400"><X size={16} /></button>
        </div>
        <div className="border-b border-green-500/30 px-4 py-2 flex items-center gap-2">
          <Search size={14} className="text-green-500/60" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="search users..."
            className="bg-transparent flex-1 outline-none text-green-300 placeholder:text-green-500/40 text-sm py-1" />
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && <div className="p-6 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" size={16} /></div>}
          {!loading && users.length === 0 && <div className="p-6 text-center text-green-500/40 text-xs">no users found</div>}
          {!loading && users.map((u) => (
            <button key={u.id} onClick={() => onPick(u)}
              className="w-full text-left p-3 border-b border-green-500/10 hover:bg-green-500/5 flex items-center gap-3">
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-green-300 text-sm truncate">{u.displayName}</span>
                  {u.isOwner && <span className="text-[9px] bg-green-400 text-black px-1 font-bold">ROOT</span>}
                </div>
                <div className="text-green-500/50 text-xs truncate">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CONVERSATION VIEW
// ============================================================
function ConversationView({ partnerId, currentUser, onNavigate, refreshKey, onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.conversation(partnerId)); }
    catch { setData({ error: true }); }
    setLoading(false);
  }, [partnerId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.messages?.length]);

  const send = async (e) => {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    if (content.length > MAX_DM_LEN) { setError(`max ${MAX_DM_LEN} chars`); return; }
    setError(''); setSending(true);
    try {
      await api.sendMessage(partnerId, content);
      setDraft(''); load(); onRefresh();
    } catch (e) { setError(e.message || 'send failed'); }
    setSending(false);
  };

  if (loading) return <div className="p-12 text-center text-green-500/40"><Loader2 className="animate-spin mx-auto" /></div>;
  if (!data || data.error) return (
    <div>
      <div className="sticky top-0 bg-black/90 border-b border-green-500/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => onNavigate('messages')} className="text-green-500/60"><ArrowLeft size={18} /></button>
        <div className="text-green-300 text-sm">~/ dm</div>
      </div>
      <div className="p-12 text-center text-red-400/60 text-sm">// user not found</div>
    </div>
  );

  const { partner, messages } = data;
  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 bg-black/90 backdrop-blur z-20 border-b border-green-500/30 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => onNavigate('messages')} className="text-green-500/60 hover:text-green-300"><ArrowLeft size={18} /></button>
        <Avatar user={partner} size={32} onClick={() => onNavigate('profile', partner.id)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-green-300 text-sm truncate cursor-pointer hover:underline"
              onClick={() => onNavigate('profile', partner.id)}>
              {partner.displayName}
            </span>
            {partner.isOwner && <span className="text-[9px] bg-green-400 text-black px-1 font-bold tracking-wider">ROOT</span>}
          </div>
          <div className="text-green-500/50 text-[10px] truncate">@{partner.username}</div>
        </div>
        <div className="text-[10px] text-green-500/40 flex items-center gap-1">
          <Activity size={10} className="text-green-400 animate-pulse" /> live
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-green-500/40 text-xs py-12">
            <div>// channel established</div>
            <div>&gt; no messages yet — say hi</div>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showAvatar = !m.isMine && (!prev || prev.senderId !== m.senderId);
          const showTime = !prev || (new Date(m.createdAt) - new Date(prev.createdAt)) > 5 * 60 * 1000;
          return (
            <div key={m.id}>
              {showTime && (
                <div className="text-center text-green-500/30 text-[10px] py-2">
                  ─── {new Date(m.createdAt).toLocaleString()} ───
                </div>
              )}
              <div className={`flex gap-2 ${m.isMine ? 'justify-end' : 'justify-start'}`}>
                {!m.isMine && (
                  <div className="w-8 shrink-0">
                    {showAvatar && <Avatar user={partner} size={32} />}
                  </div>
                )}
                <div className={`max-w-[75%] px-3 py-2 text-sm border ${m.isMine
                  ? 'border-green-400/60 bg-green-400/10 text-green-200'
                  : 'border-green-500/30 bg-zinc-950 text-green-200/90'}`}>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  <div className={`text-[9px] mt-1 flex items-center gap-1 ${m.isMine ? 'text-green-400/60 justify-end' : 'text-green-500/40'}`}>
                    <span>{formatTime(m.createdAt)}</span>
                    {m.isMine && m.readAt && <Check size={10} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="border-t border-green-500/30 p-3 flex items-end gap-2 bg-black/80 shrink-0">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
          rows={1} maxLength={MAX_DM_LEN}
          placeholder={`> message @${partner.username}...`}
          className="flex-1 bg-black/60 border border-green-500/40 focus:border-green-400 outline-none px-3 py-2 text-green-300 placeholder:text-green-500/30 text-sm resize-none" />
        <button type="submit" disabled={!draft.trim() || sending}
          className="border border-green-400 text-green-300 hover:bg-green-400 hover:text-black px-3 py-2 text-xs font-bold tracking-wider transition-colors disabled:opacity-30 flex items-center gap-1.5">
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          SEND
        </button>
      </form>
      {error && <div className="text-red-400 text-xs px-3 pb-2 bg-black/80">{error}</div>}
    </div>
  );
}

// ============================================================
// COMPOSE MODAL
// ============================================================
function ComposeModal({ user, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-16 z-40 p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-green-500/40 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-green-500/30 px-4 py-2">
          <div className="text-green-400 text-xs tracking-wider">// new_post.sh</div>
          <button onClick={onClose} className="text-green-500/60 hover:text-red-400"><X size={16} /></button>
        </div>
        <Composer user={user} onSubmit={async (data) => { await onSubmit(data); onClose(); }} />
      </div>
    </div>
  );
}

// ============================================================
// RIGHT PANEL
// ============================================================
function RightPanel({ currentUser, onNavigate, refreshKey, onRefresh }) {
  const [suggestions, setSuggestions] = useState([]);
  const [latency, setLatency] = useState(0);

  useEffect(() => {
    api.suggestions().then((r) => setSuggestions(r.users || [])).catch(() => {});
    const start = Date.now();
    fetch('/api/health').then(() => setLatency(Date.now() - start)).catch(() => {});
  }, [refreshKey]);

  return (
    <aside className="w-72 shrink-0 p-4 hidden lg:block sticky top-0 h-screen overflow-y-auto">
      <div className="border border-green-500/30 bg-zinc-950/60 mb-4">
        <div className="border-b border-green-500/20 px-3 py-2 text-xs text-green-400 tracking-wider flex items-center justify-between">
          <span>// system_status</span><Cpu size={12} />
        </div>
        <div className="p-3 space-y-1.5 text-[11px] text-green-500/70">
          <div className="flex justify-between"><span>uplink</span><span className="text-green-300 flex items-center gap-1"><Wifi size={10} /> stable</span></div>
          <div className="flex justify-between"><span>api_latency</span><span className="text-green-300">{latency}ms</span></div>
          <div className="flex justify-between"><span>mode</span><span className="text-green-300">live (SSE)</span></div>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="border border-green-500/30 bg-zinc-950/60">
          <div className="border-b border-green-500/20 px-3 py-2 text-xs text-green-400 tracking-wider">// suggested_nodes</div>
          <div className="divide-y divide-green-500/10">
            {suggestions.map((u) => (
              <div key={u.id} className="p-3 flex items-center gap-2">
                <Avatar user={u} size={32} onClick={() => onNavigate('profile', u.id)} />
                <div className="flex-1 min-w-0">
                  <div onClick={() => onNavigate('profile', u.id)} className="text-green-300 text-xs truncate hover:underline cursor-pointer flex items-center gap-1">
                    {u.displayName}
                    {u.isOwner && <span className="text-[8px] bg-green-400 text-black px-1 font-bold">ROOT</span>}
                  </div>
                  <div className="text-green-500/50 text-[10px] truncate">@{u.username}</div>
                </div>
                <button onClick={async () => { await api.follow(u.id); onRefresh(); }}
                  className="border border-green-400 text-green-300 hover:bg-green-400 hover:text-black px-2 py-1 text-[10px] font-bold tracking-wider transition-colors">
                  +FOLLOW
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-[9px] text-green-500/30 mt-4 tracking-wider text-center">
        [ nexus · multi-container · v2.5 ]
      </div>
    </aside>
  );
}

function Background() {
  return (
    <>
      <div className="fixed inset-0 pointer-events-none scanlines" />
      <div className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 50% 50%, transparent 0%, rgba(0,0,0,0.4) 100%)' }} />
    </>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [booted, setBooted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState({ name: 'feed', payload: null });
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // Restore session
  useEffect(() => {
    (async () => {
      if (!auth.getToken()) { setLoading(false); return; }
      try { const r = await api.me(); setCurrentUser(r.user); }
      catch { auth.clear(); }
      setLoading(false);
    })();
  }, []);

  // Load unread count and refresh on changes
  const refreshUnread = useCallback(async () => {
    if (!currentUser) return;
    try { const r = await api.unreadCount(); setUnreadDMs(r.count || 0); }
    catch {}
  }, [currentUser]);

  useEffect(() => { refreshUnread(); }, [refreshUnread, refreshKey]);

  // SSE handlers
  useEffect(() => {
    if (!currentUser) return;
    const off = connectEvents({
      'post:new':     () => setRefreshKey((k) => k + 1),
      'post:deleted': () => setRefreshKey((k) => k + 1),
      'dm:new':       (msg) => {
        setRefreshKey((k) => k + 1);
        // only bump unread when not currently viewing this conversation
        if (!(view.name === 'dm' && view.payload === msg.senderId)) {
          setUnreadDMs((n) => n + 1);
        }
      },
      'dm:sent':      () => setRefreshKey((k) => k + 1),
      'dm:read':      () => setRefreshKey((k) => k + 1),
    });
    return off;
  }, [currentUser, view.name, view.payload]);

  const onAuthenticated = (user) => { setCurrentUser(user); setView({ name: 'feed', payload: null }); };
  const onLogout = () => { auth.clear(); setCurrentUser(null); setView({ name: 'feed', payload: null }); };
  const navigate = (name, payload = null) => {
    setView({ name, payload });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // When entering a DM, clear unread immediately (will refresh on next refreshUnread)
    if (name === 'dm') setUnreadDMs(0);
  };
  const handleHashtag = (tag) => navigate('hashtag', tag);
  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  if (!booted) return <BootScreen onDone={() => setBooted(true)} />;
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center font-mono"><Loader2 className="animate-spin text-green-400" size={32} /></div>;
  if (!currentUser) return <><Background /><AuthScreen onAuthenticated={onAuthenticated} /></>;

  let content;
  const sharedProps = {
    currentUser, onNavigate: navigate, onHashtag: handleHashtag,
    onLightbox: setLightboxSrc, refreshKey, onRefresh: triggerRefresh,
  };

  if (view.name === 'feed') content = <FeedView {...sharedProps} />;
  else if (view.name === 'explore') content = <ExploreView {...sharedProps} />;
  else if (view.name === 'hashtag') content = <ExploreView {...sharedProps} hashtag={view.payload} />;
  else if (view.name === 'profile') content = <ProfileView {...sharedProps} userId={view.payload} />;
  else if (view.name === 'post') content = <PostDetailView {...sharedProps} postId={view.payload} />;
  else if (view.name === 'settings') content = <SettingsView currentUser={currentUser} onNavigate={navigate} onUserUpdated={setCurrentUser} />;
  else if (view.name === 'messages') content = <MessagesView currentUser={currentUser} onNavigate={navigate} refreshKey={refreshKey} />;
  else if (view.name === 'dm') content = <ConversationView partnerId={view.payload} currentUser={currentUser} onNavigate={navigate} refreshKey={refreshKey} onRefresh={triggerRefresh} />;

  const navView = view.name === 'hashtag' ? 'explore'
    : view.name === 'post' ? 'feed'
    : view.name === 'dm' ? 'messages'
    : view.name;

  return (
    <>
      <Background />
      <div className="min-h-screen bg-transparent text-green-300 font-mono flex">
        <Sidebar currentUser={currentUser} currentView={navView}
          onNavigate={navigate} onLogout={onLogout} onCompose={() => setComposeOpen(true)} unreadDMs={unreadDMs} />
        <main className="flex-1 max-w-2xl border-r border-green-500/20 min-h-screen pb-20 md:pb-0">
          {content}
        </main>
        <RightPanel currentUser={currentUser} onNavigate={navigate} refreshKey={refreshKey} onRefresh={triggerRefresh} />
        <MobileNav currentView={navView} onNavigate={navigate} currentUser={currentUser}
          onCompose={() => setComposeOpen(true)} unreadDMs={unreadDMs} />
        {composeOpen && (
          <ComposeModal user={currentUser} onClose={() => setComposeOpen(false)}
            onSubmit={async ({ content, imageUrl }) => { await api.createPost({ content, imageUrl }); triggerRefresh(); }} />
        )}
        {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    </>
  );
}
