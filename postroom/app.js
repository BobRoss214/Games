/* Postroom: write one post, preview it per network, send or schedule it.
   No libraries. All data stays in this browser (localStorage).
   The only part that must change to post for real is `Publisher` below. */
(function () {
  'use strict';

  const KEY = 'postroom.v1';

  // ---------------------------------------------------------------- networks
  const NETS = [
    { id: 'facebook', name: 'Facebook', glyph: 'f', limit: 63206, cut: 477, acct: 'Page name', ph: 'Fernhill Bakery' },
    { id: 'instagram', name: 'Instagram', glyph: 'cam', limit: 2200, cut: 125, needsImage: true, maxTags: 30, acct: 'Username', ph: 'fernhillbakery' },
    { id: 'x', name: 'X', glyph: 'X', limit: 280, acct: 'Username', ph: 'fernhillbakery' },
    { id: 'linkedin', name: 'LinkedIn', glyph: 'in', limit: 3000, cut: 210, acct: 'Page or profile name', ph: 'Fernhill Bakery' },
    { id: 'threads', name: 'Threads', glyph: '@', limit: 500, acct: 'Username', ph: 'fernhillbakery' },
    { id: 'bluesky', name: 'Bluesky', glyph: 'b', limit: 300, acct: 'Handle', ph: 'fernhill.bsky.social' },
    { id: 'pinterest', name: 'Pinterest', glyph: 'P', limit: 500, needsImage: true, acct: 'Username', ph: 'fernhillbakery' },
    { id: 'tiktok', name: 'TikTok', glyph: 'note', limit: 2200, cut: 90, needsImage: true, acct: 'Username', ph: 'fernhillbakery' },
  ];
  const NET = Object.fromEntries(NETS.map((n) => [n.id, n]));

  /* Publishing adapter. Today it only pretends. To post for real, replace `send`
     with a call to your own server, which holds the network API keys. */
  const Publisher = {
    live: false,
    send(/* post, netId, account */) {
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 700 + Math.random() * 900));
    },
  };

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const len = (s) => Array.from(s || '').length;
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n) => n.toLocaleString();

  const ICONS = {
    pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>',
    posts: '<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 3h4l1-3h5"/>',
    plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    comment: '<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    repost: '<path d="M7 7h10v6M14 4l3 3-3 3M17 17H7v-6M10 20l-3-3 3-3"/>',
    share: '<path d="M12 15V4m0 0-4 4m4-4 4 4M5 13v6h14v-6"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    cam: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.6" cy="7.4" r=".6"/>',
    note: '<path d="M10 17V5c2 3 4 4 7 4"/><circle cx="7.5" cy="17" r="2.5"/>',
  };
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  function netTile(id, small) {
    const n = NET[id];
    const inner = ICONS[n.glyph] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.glyph]}</svg>` : n.glyph;
    return `<span class="net net-${id}${small ? ' sm' : ''}" aria-hidden="true">${inner}</span>`;
  }
  function initials(name) {
    const parts = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // dates
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (ms) => dayFmt.format(ms);
  const fmtTime = (ms) => timeFmt.format(ms);
  const fmtWhen = (ms) => `${fmtDay(ms)}, ${fmtTime(ms)}`;
  const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function dayLabel(ms) {
    const diff = Math.round((startOfDay(ms) - startOfDay(Date.now())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return fmtDay(ms);
  }
  function draftTime(d) {
    if (!d.date || !d.time) return NaN;
    return new Date(`${d.date}T${d.time}`).getTime();
  }

  // sample pictures, drawn as tiny SVGs so the sample data needs no files
  function art(kind) {
    const svgs = {
      loaf: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#e9d9bf"/><rect y="820" width="1200" height="380" fill="#b98b5e"/><ellipse cx="600" cy="850" rx="430" ry="46" fill="#8c633e" opacity=".5"/><path d="M190 760c0-250 190-400 410-400s410 150 410 400c0 60-40 90-100 90H290c-60 0-100-30-100-90z" fill="#c9833f"/><path d="M250 730c0-200 160-320 350-320s350 120 350 320" fill="none" stroke="#e3aa66" stroke-width="26" opacity=".6"/><g stroke="#f4dcb4" stroke-width="30" stroke-linecap="round"><path d="M420 520l70 150"/><path d="M570 480l70 170"/><path d="M720 500l70 160"/></g></svg>',
      cup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#2f4a45"/><circle cx="520" cy="450" r="300" fill="#f3efe6"/><circle cx="520" cy="450" r="215" fill="#fbf9f4"/><circle cx="520" cy="450" r="170" fill="#6b4329"/><path d="M430 450c40-80 140-80 180 0-40 70-140 70-180 0z" fill="#d9b48c"/><path d="M790 330c120 0 160 60 160 120s-40 120-160 120" fill="none" stroke="#f3efe6" stroke-width="54"/><rect x="930" y="640" width="190" height="130" rx="14" fill="#e6b85c" transform="rotate(-14 1025 705)"/></svg>',
      shop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1250"><rect width="1000" height="1250" fill="#bcd3dc"/><rect y="1090" width="1000" height="160" fill="#7c8a8f"/><rect x="130" y="330" width="740" height="760" fill="#f2ead9"/><rect x="130" y="250" width="740" height="90" fill="#31444d"/><g><path d="M110 430h780l-50 150H160z" fill="#c6402f"/><g fill="#f6efe2"><path d="M222 430h112l-12 150H210z"/><path d="M446 430h108v150H446z"/><path d="M666 430h112l12 150H678z"/></g></g><rect x="200" y="660" width="330" height="290" fill="#8fb4c2"/><rect x="620" y="660" width="180" height="430" fill="#31444d"/><circle cx="650" cy="880" r="12" fill="#e6b85c"/><g fill="#c9833f"><ellipse cx="290" cy="900" rx="60" ry="34"/><ellipse cx="420" cy="905" rx="70" ry="38"/></g></svg>',
    };
    return 'data:image/svg+xml,' + encodeURIComponent(svgs[kind]);
  }
  const ART_RATIO = { loaf: 1, cup: 1200 / 900, shop: 1000 / 1250 };

  // ---------------------------------------------------------------- state
  function blankDraft(accounts) {
    return { id: null, text: '', tags: [], image: null, ratio: 1, overrides: {}, targets: Object.keys(accounts || {}), when: 'now', date: '', time: '' };
  }
  function sampleState() {
    const now = Date.now();
    const at = (days, h, m) => { const d = new Date(now + days * 864e5); d.setHours(h, m, 0, 0); return d.getTime(); };
    const accounts = {
      instagram: { handle: 'fernhillbakery', since: now - 40 * 864e5 },
      facebook: { handle: 'Fernhill Bakery', since: now - 40 * 864e5 },
      linkedin: { handle: 'Fernhill Bakery', since: now - 12 * 864e5 },
    };
    const mk = (o) => Object.assign({ id: uid(), tags: [], image: null, ratio: 1, overrides: {}, sample: true, results: {} }, o);
    const sent = (o) => { const p = mk(o); p.status = 'sent'; p.targets.forEach((t) => { p.results[t] = 'sent'; }); return p; };
    return {
      profile: { brand: 'Fernhill Bakery', person: '', email: '', sample: true },
      accounts,
      draft: Object.assign(blankDraft(accounts), {
        text: 'Sourdough is back on Saturdays. First loaves are out at 8, and last week they were gone by 10.\n\nPre-order at the counter, or reply here and we will hold one for you.',
        tags: ['sourdough', 'fernhill', 'saturdaybake'], image: art('loaf'), ratio: ART_RATIO.loaf,
      }),
      posts: [
        mk({ status: 'scheduled', scheduledFor: at(1, 9, 0), text: 'Cinnamon knots, this Friday only. We make 60 and we do not make more.', tags: ['fridaybake'], image: art('cup'), ratio: ART_RATIO.cup, targets: ['instagram', 'facebook'] }),
        mk({ status: 'scheduled', scheduledFor: at(4, 7, 30), text: 'Closed this Thursday for the oven service. Back on Friday at 7.', targets: ['facebook', 'linkedin'] }),
        sent({ sentAt: at(-2, 12, 15), text: 'We are hiring a weekend baker. Early starts, good bread, and Mondays off. Ask for Dana at the counter.', tags: ['hiring'], image: art('shop'), ratio: ART_RATIO.shop, targets: ['facebook', 'linkedin'] }),
        sent({ sentAt: at(-6, 8, 0), text: 'New winter hours start Monday: 7 to 4 on weekdays, 8 to 2 at the weekend.', image: art('cup'), ratio: ART_RATIO.cup, targets: ['facebook', 'instagram'] }),
      ],
    };
  }

  let state;
  let storageWarned = false;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.profile && s.posts && s.draft && s.accounts) return s;
      }
    } catch (e) { /* fall through to sample data */ }
    return sampleState();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        toast('This browser is out of storage space. Delete old posts that have images.');
      }
    }
  }

  // view-only state (not saved)
  const ui = { step: 'write', editing: null, tab: 'scheduled', q: '', netFilter: '', tried: false };

  // ---------------------------------------------------------------- post text
  function fullText(p) {
    const tags = (p.tags || []).map((t) => '#' + t).join(' ');
    const text = (p.text || '').trim();
    return text && tags ? `${text}\n\n${tags}` : text || tags;
  }
  function netText(p, id) {
    return p.overrides && p.overrides[id] != null ? p.overrides[id] : fullText(p);
  }
  function countTags(s) { return (s.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length; }

  function issuesFor(p, id) {
    const n = NET[id];
    const text = netText(p, id);
    const out = [];
    const over = len(text) - n.limit;
    if (over > 0) out.push({ block: true, msg: `${num(over)} characters too long for ${n.name}. Shorten this version.` });
    if (n.needsImage && !p.image) out.push({ block: true, msg: `${n.name} needs an image. Add one, or untick ${n.name}.` });
    if (!n.needsImage && !text && !p.image) out.push({ block: true, msg: 'This version is empty.' });
    if (n.maxTags && countTags(text) > n.maxTags) out.push({ block: true, msg: `${n.name} allows ${n.maxTags} hashtags at most.` });
    if (id === 'pinterest' && p.image && p.ratio > 1.05) out.push({ block: false, msg: 'Tall images (2:3) get more room on Pinterest.' });
    return out;
  }
  const blocked = (p, id) => issuesFor(p, id).some((i) => i.block);

  function rich(text, cut) {
    let t = text || '';
    let more = '';
    if (cut && len(t) > cut + 20) {
      t = Array.from(t).slice(0, cut).join('').replace(/\s+\S*$/, '');
      more = '<span class="more">… more</span>';
    }
    let h = esc(t);
    h = h.replace(/https?:\/\/[^\s<]+/g, (m) => `<span class="lk">${m}</span>`);
    h = h.replace(/(^|\s)([#@][\p{L}\p{N}_.]*[\p{L}\p{N}_])/gu, '$1<span class="lk">$2</span>');
    return h.replace(/\n/g, '<br>') + more;
  }

  // ---------------------------------------------------------------- mock-ups
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function pvImg(p, lo, hi) {
    if (!p.image) return '';
    return `<img class="pv-img" src="${esc(p.image)}" alt="" style="aspect-ratio:${clamp(p.ratio || 1, lo, hi).toFixed(3)}">`;
  }
  function pvNoImg(name) {
    return `<div class="pv-noimg">${icon('image')}<span>${name} needs an image</span></div>`;
  }
  function pvText(p, id, extra) {
    const t = netText(p, id);
    const body = t ? rich(t, NET[id].cut) : '<span class="pv-empty">Your text shows here</span>';
    return `<div class="pv-text" data-act="edit-net" data-net="${id}" title="Click to change the text for ${NET[id].name}">${extra || ''}${body}</div>`;
  }
  function mock(p, id) {
    const brand = state.profile.brand || 'Your brand';
    const acct = state.accounts[id] || {};
    const raw = String(acct.handle || brand);
    const handle = raw.toLowerCase().replace(/[^a-z0-9._]/g, '') || 'yourbrand';
    const av = `<span class="pv-av">${esc(initials(brand))}</span>`;
    const bar = (items) => `<div class="pv-bar">${items.map(([i, l]) => `<span>${icon(i)}${l}</span>`).join('')}</div>`;

    switch (id) {
      case 'facebook':
        return `<div class="pv pv-fb"><div class="pv-head">${av}<div><b>${esc(raw)}</b><small>Just now · Public</small></div>${icon('dots')}</div>
          ${pvText(p, id)}${pvImg(p, 0.8, 1.91)}
          ${bar([['heart', 'Like'], ['comment', 'Comment'], ['share', 'Share']])}</div>`;
      case 'instagram':
        return `<div class="pv pv-ig"><div class="pv-head">${av}<div><b>${esc(handle)}</b></div>${icon('dots')}</div>
          ${p.image ? pvImg(p, 0.8, 1.91) : pvNoImg('Instagram')}
          <div class="pv-acts">${icon('heart')}${icon('comment')}${icon('send')}${icon('bookmark')}</div>
          ${pvText(p, id, `<b>${esc(handle)}</b> `)}</div>`;
      case 'linkedin':
        return `<div class="pv pv-li"><div class="pv-head">${av}<div><b>${esc(raw)}</b><small>Now · Visible to anyone</small></div>${icon('dots')}</div>
          ${pvText(p, id)}${pvImg(p, 0.8, 1.91)}
          ${bar([['heart', 'Like'], ['comment', 'Comment'], ['repost', 'Repost'], ['send', 'Send']])}</div>`;
      case 'x':
      case 'bluesky':
      case 'threads': {
        const at = id === 'bluesky' ? (handle.includes('.') ? handle : handle + '.bsky.social') : handle;
        const who = id === 'threads'
          ? `<b>${esc(handle)}</b><span class="mut">now</span>`
          : `<b>${esc(brand)}</b><span class="mut">@${esc(at)} · now</span>`;
        const acts = id === 'threads' ? ['heart', 'comment', 'repost', 'send'] : ['comment', 'repost', 'heart', 'share'];
        return `<div class="pv pv-micro pv-${id === 'threads' ? 'th' : id}">${av}<div><div class="pv-who">${who}</div>
          ${pvText(p, id)}${pvImg(p, 0.75, 1.91)}
          <div class="pv-acts">${acts.map(icon).join('')}</div></div></div>`;
      }
      case 'pinterest': {
        const t = netText(p, id);
        const first = t.split('\n')[0];
        const title = len(first) > 60 ? Array.from(first).slice(0, 60).join('') + '…' : first;
        return `<div class="pv pv-pin">${p.image ? pvImg(p, 0.5, 1.5) : pvNoImg('Pinterest')}
          <div class="pv-body">${title ? `<div class="pv-title">${esc(title)}</div>` : ''}${pvText(p, id)}
          <div class="pv-by"><span class="pv-av">${esc(initials(brand))}</span>${esc(raw)}</div></div></div>`;
      }
      case 'tiktok':
        return `<div class="pv pv-tt">${p.image ? `<img class="pv-img" src="${esc(p.image)}" alt="">` : pvNoImg('TikTok')}
          <div class="pv-rail">${av}${icon('heart')}${icon('comment')}${icon('bookmark')}${icon('share')}</div>
          <div class="pv-cap"><b>@${esc(handle)}</b>${pvText(p, id)}</div></div>`;
    }
    return '';
  }

  // ---------------------------------------------------------------- toast + modal
  function toast(msg, action) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>`;
    let timer;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = () => { clearTimeout(timer); el.remove(); action.fn(); };
      el.appendChild(b);
    }
    box.appendChild(el);
    timer = setTimeout(() => el.remove(), action ? 7000 : 3600);
  }
  let lastFocus = null;
  function openModal(html) {
    lastFocus = document.activeElement;
    $('#modal-root').innerHTML = `<div class="scrim" data-act="scrim"><div class="modal card" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</div></div>`;
    const first = $('#modal-root input, #modal-root button');
    if (first) first.focus();
  }
  function closeModal() {
    $('#modal-root').innerHTML = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------------------------------------------------------------- shell
  const ROUTES = ['compose', 'posts', 'accounts'];
  const route = () => { const h = location.hash.slice(1); return ROUTES.includes(h) ? h : 'compose'; };
  function go(r) { if (route() === r) render(); else location.hash = r; }

  function whoBtn() {
    const p = state.profile;
    return `<button type="button" class="who" data-act="profile" title="Workspace settings">
      <span class="av">${esc(initials(p.brand))}</span>
      <span><b>${esc(p.brand)}</b><small>${p.sample ? 'Sample workspace' : esc(p.email || 'Workspace')}</small></span></button>`;
  }
  const demoTag = () => (Publisher.live ? '' : '<button type="button" class="demo-tag" data-act="demo">Demo mode</button>');

  function renderShell() {
    const r = route();
    const n = state.posts.filter((p) => p.status === 'scheduled').length;
    const link = (id, ic, label, badge) =>
      `<a href="#${id}"${r === id ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
    $('#nav').innerHTML = link('compose', 'pencil', 'New post') + link('posts', 'posts', 'Posts', n) + link('accounts', 'plug', 'Accounts');
    $('#side-foot').innerHTML = demoTag() + whoBtn();
  }

  function render() {
    renderShell();
    const r = route();
    const top = `<div class="topbar"><span class="wordmark"><span class="mark"></span>Postroom</span><span class="right">${demoTag()}<button type="button" class="who" data-act="profile" aria-label="Workspace settings"><span class="av sm">${esc(initials(state.profile.brand))}</span></button></span></div>`;
    const banner = state.profile.sample
      ? `<div class="banner"><span>You are looking at a sample workspace with example posts.</span><button type="button" class="btn sm" data-act="profile">Set up your own</button></div>`
      : '';
    const body = r === 'posts' ? viewPosts() : r === 'accounts' ? viewAccounts() : ui.step === 'preview' ? viewPreview() : viewWrite();
    $('#main').innerHTML = top + banner + body;
    if (r === 'compose' && ui.step === 'write') updateWrite();
    if (r === 'compose' && ui.step === 'preview') updateSend();
  }

  // ---------------------------------------------------------------- compose: write
  function targetList(withMeters) {
    const d = state.draft;
    const ids = NETS.filter((n) => state.accounts[n.id]).map((n) => n.id);
    if (!ids.length) {
      return `<p class="hint">No accounts are connected yet.</p><a class="btn" href="#accounts">${icon('plug')}Connect an account</a>`;
    }
    const rows = ids.map((id) => {
      const n = NET[id];
      const on = d.targets.includes(id);
      const used = len(netText(d, id));
      const bad = on && blocked(d, id);
      const note = on ? (issuesFor(d, id).find((i) => i.block) || {}).msg : '';
      const short = note && used > n.limit ? '' : note;
      return `<li class="${on ? '' : 't-off'}${bad ? ' t-bad' : ''}"><label>
        <input type="checkbox" data-act="target" data-net="${id}" id="target-${id}"${on ? ' checked' : ''}>
        ${netTile(id)}<span class="t-name">${n.name}<small>${esc(state.accounts[id].handle)}</small></span>
        ${withMeters ? `<span class="t-meta"><span class="meter"><i style="width:${Math.min(100, (used / n.limit) * 100).toFixed(1)}%"></i></span><span class="count">${num(used)} / ${num(n.limit)}</span></span>` : ''}
        ${short ? `<span class="t-note">${esc(short)}</span>` : ''}</label></li>`;
    }).join('');
    const rest = NETS.filter((n) => !state.accounts[n.id]);
    const add = rest.length
      ? `<div><span class="label">Not connected</span><div class="addnet">${rest.map((n) => `<button type="button" class="chip" data-act="connect" data-net="${n.id}">+ ${n.name}</button>`).join('')}</div></div>`
      : '';
    return `<ul class="targets">${rows}</ul>${add}`;
  }

  function imageBlock() {
    const d = state.draft;
    if (d.image) {
      return `<div class="shot"><img src="${esc(d.image)}" alt="Image for this post">
        <div><span class="hint">This image goes out with the post on every account.</span>
        <div class="row"><label class="btn sm" for="file">Replace</label><button type="button" class="btn sm quiet danger" data-act="remove-image">Remove</button></div></div></div>`;
    }
    return `<label class="drop" for="file" id="drop">${icon('image')}<span><strong>Add an image</strong></span><span class="hint">Drop it here, paste it, or click to choose. JPG, PNG, or WebP.</span></label>`;
  }
  function tagChips() {
    return state.draft.tags.map((t, i) => `<span class="tag">#${esc(t)}<button type="button" data-act="untag" data-i="${i}" aria-label="Remove hashtag ${esc(t)}">${icon('x')}</button></span>`).join('');
  }

  function viewWrite() {
    const d = state.draft;
    const editing = d.id && state.posts.find((p) => p.id === d.id);
    return `
    <div class="steps"><b>1 Write</b><i></i><span>2 Preview</span><i></i><span>3 Send</span></div>
    <div class="head"><div><h1>${editing ? 'Change a scheduled post' : 'Write a post'}</h1>
      <p>Write it once. On the next step you see how it looks on each account.</p></div>
      ${editing ? '<button type="button" class="btn quiet" data-act="discard">Stop editing</button>' : ''}</div>
    <div class="write">
      <section class="sheet card" aria-label="Post">
        <div class="sheet-in">
          <div><span class="label">Image</span><div id="image-slot">${imageBlock()}</div>
            <input type="file" id="file" accept="image/*" hidden></div>
          <div><label class="label" for="text">What do you want to say?</label>
            <textarea class="field" id="text" placeholder="Write your post here…">${esc(d.text)}</textarea>
            <div class="undertext"><span class="hint">Ctrl + Enter opens the preview.</span><span class="count" id="text-count"></span></div></div>
          <div><label class="label" for="tag-input">Hashtags</label>
            <div class="tags" id="tags" data-act="focus-tags"><span id="tag-chips" style="display:contents">${tagChips()}</span>
              <input id="tag-input" placeholder="Type a word and press Enter" autocomplete="off" autocapitalize="none"></div>
            <p class="hint" style="margin-top:6px">Hashtags go at the end of the post. No need to type the #.</p></div>
        </div>
        <div class="sheet-foot"><button type="button" class="btn quiet" data-act="clear">Clear</button>
          <button type="button" class="btn primary" data-act="preview">Preview</button></div>
      </section>
      <aside class="panel card" aria-label="Accounts"><h2>Send to</h2><div id="targets" class="stack"></div></aside>
    </div>`;
  }
  function updateWrite() {
    const t = $('#targets');
    if (t) t.innerHTML = targetList(true);
    const c = $('#text-count');
    if (c) c.textContent = `${num(len(fullText(state.draft)))} characters with hashtags`;
  }

  function addTags(raw) {
    const d = state.draft;
    String(raw).split(/[\s,#]+/).forEach((w) => {
      const t = w.replace(/[^\p{L}\p{N}_]/gu, '');
      if (t && !d.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && d.tags.length < 30) d.tags.push(t);
    });
    $('#tag-chips').innerHTML = tagChips();
    save();
    updateWrite();
  }

  function takeImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('That file is not an image. Use a JPG, PNG, or WebP.'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('The image could not be read. Try a different file.');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => toast('The image could not be opened. Try a JPG or PNG.');
      img.onload = () => {
        const max = 1440;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        state.draft.image = c.toDataURL('image/jpeg', 0.86);
        state.draft.ratio = c.width / c.height;
        save();
        if (route() === 'compose') render();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------------- compose: preview
  function quickTimes() {
    const now = new Date();
    const out = [];
    const mk = (label, d) => out.push({ label, date: dateInput(d), time: timeInput(d) });
    const h = new Date(now.getTime() + 36e5); h.setMinutes(Math.ceil(h.getMinutes() / 5) * 5, 0, 0);
    mk('In 1 hour', h);
    if (now.getHours() < 17) { const e = new Date(now); e.setHours(18, 0, 0, 0); mk('Today 6 pm', e); }
    const t = new Date(now); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); mk('Tomorrow 9 am', t);
    const m = new Date(now); m.setDate(m.getDate() + ((8 - m.getDay()) % 7 || 7)); m.setHours(9, 0, 0, 0); mk('Monday 9 am', m);
    return out;
  }

  function previewCard(id) {
    const d = state.draft;
    const n = NET[id];
    const used = len(netText(d, id));
    const iss = issuesFor(d, id);
    const isBad = iss.some((i) => i.block);
    const custom = d.overrides[id] != null;
    const editor = ui.editing === id
      ? `<div class="neted card"><label class="label" for="neted-text">Text for ${n.name} only</label>
          <textarea class="field" id="neted-text" data-net="${id}">${esc(netText(d, id))}</textarea>
          <div class="row"><button type="button" class="btn sm primary" data-act="edit-done">Done</button>
          ${custom ? `<button type="button" class="btn sm quiet" data-act="edit-reset" data-net="${id}">Use the main text again</button>` : ''}</div></div>`
      : '';
    return `<article class="pcard${isBad ? ' bad' : ''}" id="pcard-${id}">
      <header>${netTile(id)}<b>${n.name}</b>${custom ? '<span class="edited">Edited</span>' : ''}<span class="count" id="count-${id}">${num(used)} / ${num(n.limit)}</span></header>
      <div class="pv-wrap">${ui.editing === id ? '' : `<button type="button" class="btn sm pv-edit" data-act="edit-net" data-net="${id}">${icon('pencil')}Edit text</button>`}
        <div id="mock-${id}">${mock(d, id)}</div></div>
      <ul class="issues" id="issues-${id}">${iss.map((i) => `<li class="${i.block ? '' : 'tip'}">${esc(i.msg)}</li>`).join('')}</ul>
      ${editor}
    </article>`;
  }

  function viewPreview() {
    const d = state.draft;
    const ids = NETS.map((n) => n.id).filter((id) => d.targets.includes(id) && state.accounts[id]);
    const cards = ids.length
      ? `<div class="pgrid">${ids.map(previewCard).join('')}</div>`
      : `<div class="empty card"><h2>No account is ticked</h2><p>Tick at least one account under “Send to”.</p></div>`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    return `
    <div class="steps"><span>1 Write</span><i></i><b>2 Preview</b><i></i><span>3 Send</span></div>
    <div class="head"><div><h1>Check how it looks</h1>
      <p>Click the text in a preview to change it for that account only.</p></div>
      <button type="button" class="btn" data-act="back">${icon('pencil')}Change the post</button></div>
    <div class="review">
      <section aria-label="Previews">${cards}</section>
      <aside class="panel card" aria-label="Send">
        <div><h2>Send to</h2><div id="targets" class="stack" style="margin-top:6px">${targetList(false)}</div></div>
        <div class="when"><h2>When</h2>
          <div class="seg"><label><input type="radio" name="when" id="when-now" value="now"${d.when === 'now' ? ' checked' : ''}>Now</label>
            <label><input type="radio" name="when" id="when-later" value="later"${d.when === 'later' ? ' checked' : ''}>Later</label></div>
          <div id="later"${d.when === 'later' ? '' : ' hidden'} class="when">
            <div class="dt"><input class="field" type="date" id="date" aria-label="Date" value="${esc(d.date)}" min="${dateInput(new Date())}">
              <input class="field" type="time" id="time" aria-label="Time" value="${esc(d.time)}"></div>
            <div class="quick">${quickTimes().map((q) => `<button type="button" class="chip" data-act="quick" data-date="${q.date}" data-time="${q.time}">${q.label}</button>`).join('')}</div>
            <p class="hint">Times are in your time zone (${esc(tz)}).</p>
          </div></div>
        <div class="when"><p class="err" id="send-err" role="alert" hidden></p>
          <button type="button" class="btn primary big" data-act="send" id="send-btn"></button>
          <p class="hint" id="send-hint"></p></div>
      </aside>
    </div>`;
  }

  function sendProblem() {
    const d = state.draft;
    const ids = d.targets.filter((id) => state.accounts[id]);
    if (!ids.length) return 'Tick at least one account.';
    const bad = ids.filter((id) => blocked(d, id));
    if (bad.length) return `Fix the red notes for ${bad.map((id) => NET[id].name).join(', ')}, or untick ${bad.length > 1 ? 'them' : 'it'}.`;
    if (d.when === 'later') {
      const t = draftTime(d);
      if (isNaN(t)) return 'Choose a date and a time.';
      if (t < Date.now() + 30e3) return 'That time has passed. Choose a later time.';
    }
    return '';
  }
  function updateSend() {
    const btn = $('#send-btn');
    if (!btn) return;
    const d = state.draft;
    const n = d.targets.filter((id) => state.accounts[id]).length;
    const accts = `${n} account${n === 1 ? '' : 's'}`;
    const t = draftTime(d);
    const editing = d.id && state.posts.some((p) => p.id === d.id);
    btn.textContent = d.when === 'later'
      ? (isNaN(t) ? 'Schedule' : `${editing ? 'Save' : 'Schedule'} for ${fmtWhen(t)}`)
      : `Post now to ${accts}`;
    $('#send-hint').textContent = d.when === 'later' ? `Goes to ${accts}. You can change or cancel it until then.` : '';
    const err = $('#send-err');
    const prob = ui.tried ? sendProblem() : '';
    err.hidden = !prob;
    err.textContent = prob;
  }
  function refreshCard(id) {
    const d = state.draft;
    const n = NET[id];
    const m = $('#mock-' + id);
    if (!m) return;
    m.innerHTML = mock(d, id);
    const iss = issuesFor(d, id);
    $('#issues-' + id).innerHTML = iss.map((i) => `<li class="${i.block ? '' : 'tip'}">${esc(i.msg)}</li>`).join('');
    $('#count-' + id).textContent = `${num(len(netText(d, id)))} / ${num(n.limit)}`;
    $('#pcard-' + id).classList.toggle('bad', iss.some((i) => i.block));
    updateSend();
  }

  // ---------------------------------------------------------------- sending
  function publish(post) {
    post.status = 'sending';
    post.results = {};
    const jobs = post.targets.map((id) => {
      if (!state.accounts[id]) { post.results[id] = 'failed'; return Promise.resolve(); }
      post.results[id] = 'sending';
      return Publisher.send(post, id, state.accounts[id])
        .then((r) => { post.results[id] = r && r.ok ? 'sent' : 'failed'; })
        .catch(() => { post.results[id] = 'failed'; })
        .then(() => { save(); if (route() === 'posts') render(); });
    });
    save();
    return Promise.all(jobs).then(() => {
      post.status = 'sent';
      post.sentAt = Date.now();
      save();
      const failed = post.targets.filter((id) => post.results[id] === 'failed');
      toast(failed.length ? `Not sent to ${failed.map((id) => NET[id].name).join(', ')}. The account is not connected.` : (Publisher.live ? 'Posted.' : 'Posted (demo: nothing went to the real networks).'));
      render();
    });
  }
  function submitDraft() {
    ui.tried = true;
    const prob = sendProblem();
    if (prob) { updateSend(); return; }
    const d = state.draft;
    const targets = NETS.map((n) => n.id).filter((id) => d.targets.includes(id) && state.accounts[id]);
    const overrides = {};
    targets.forEach((id) => { if (d.overrides[id] != null) overrides[id] = d.overrides[id]; });
    let post = d.id && state.posts.find((p) => p.id === d.id && p.status === 'scheduled');
    if (!post) { post = { id: uid(), createdAt: Date.now(), results: {} }; state.posts.push(post); }
    Object.assign(post, { text: d.text.trim(), tags: d.tags.slice(), image: d.image, ratio: d.ratio, overrides, targets, sample: false });
    state.draft = blankDraft(state.accounts);
    ui.step = 'write'; ui.editing = null; ui.tried = false;
    if (d.when === 'later') {
      post.status = 'scheduled';
      post.scheduledFor = draftTime(d);
      ui.tab = 'scheduled';
      save();
      toast(`Scheduled for ${fmtWhen(post.scheduledFor)}.`);
    } else {
      post.scheduledFor = null;
      ui.tab = 'sent';
      publish(post);
    }
    go('posts');
  }
  function tick() {
    const due = state.posts.filter((p) => p.status === 'scheduled' && p.scheduledFor <= Date.now());
    due.forEach(publish);
    if (due.length) render();
  }

  // ---------------------------------------------------------------- posts view
  function destChips(p) {
    return `<span class="dests">${p.targets.map((id) => {
      const r = p.results && p.results[id];
      const cls = r === 'failed' ? ' fail' : r === 'sending' ? ' going' : '';
      const label = r === 'failed' ? 'Not sent' : r === 'sending' ? 'Sending…' : NET[id].name;
      return `<span class="dest${cls}">${netTile(id, true)}${label}</span>`;
    }).join('')}</span>`;
  }
  function postCard(p) {
    const thumb = p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : `<span class="thumb">${icon('pencil')}</span>`;
    const tags = (p.tags || []).map((t) => '#' + t).join(' ');
    const edited = Object.keys(p.overrides || {}).length;
    let right;
    if (p.status === 'scheduled') {
      right = `<div class="row"><button type="button" class="btn sm" data-act="edit-post" data-id="${p.id}">Change</button>
        <button type="button" class="btn sm" data-act="send-now" data-id="${p.id}">Post now</button>
        <button type="button" class="btn sm quiet danger" data-act="del-post" data-id="${p.id}">Cancel</button></div>`;
    } else if (p.status === 'sending') {
      right = `<span class="spin" role="status" aria-label="Sending"></span>`;
    } else {
      const d = new Date(p.sentAt);
      right = `<span class="stamp" title="Sent ${esc(fmtWhen(p.sentAt))}"><span>Sent</span><b>${pad(d.getDate())} ${d.toLocaleString(undefined, { month: 'short' })}</b><span>${pad(d.getHours())}:${pad(d.getMinutes())}</span></span>
        <div class="row"><button type="button" class="btn sm" data-act="reuse" data-id="${p.id}">Use again</button>
        <button type="button" class="btn sm quiet danger" data-act="del-post" data-id="${p.id}">Delete</button></div>`;
    }
    const when = p.status === 'scheduled' ? `<span class="time">${icon('clock')}${esc(fmtTime(p.scheduledFor))}</span>` : '';
    return `<article class="post card">${thumb}
      <div class="body"><p class="txt">${esc(p.text || '(image only)')}${tags ? `\n<span class="hint">${esc(tags)}</span>` : ''}</p>
        <div class="meta">${when}${destChips(p)}${edited ? `<span>${edited} edited version${edited > 1 ? 's' : ''}</span>` : ''}${p.sample ? '<span class="sample">Sample</span>' : ''}</div></div>
      <div class="acts">${right}</div></article>`;
  }
  function viewPosts() {
    const all = state.posts;
    const sched = all.filter((p) => p.status === 'scheduled').sort((a, b) => a.scheduledFor - b.scheduledFor);
    const sent = all.filter((p) => p.status !== 'scheduled').sort((a, b) => (b.sentAt || Infinity) - (a.sentAt || Infinity));
    const q = ui.q.trim().toLowerCase();
    const match = (p) => (!q || (fullText(p) + ' ' + Object.values(p.overrides || {}).join(' ')).toLowerCase().includes(q)) && (!ui.netFilter || p.targets.includes(ui.netFilter));
    const list = (ui.tab === 'scheduled' ? sched : sent).filter(match);
    let body = '';
    let last = '';
    list.forEach((p) => {
      const label = dayLabel(p.status === 'scheduled' ? p.scheduledFor : p.sentAt || Date.now());
      if (label !== last) { body += `${last ? '</div>' : ''}<h2 class="day">${esc(label)}</h2><div class="plist">`; last = label; }
      body += postCard(p);
    });
    if (last) body += '</div>';
    if (!list.length) {
      const filtered = q || ui.netFilter;
      body = `<div class="empty card"><h2>${filtered ? 'Nothing matches' : ui.tab === 'scheduled' ? 'Nothing is scheduled' : 'No posts sent yet'}</h2>
        <p>${filtered ? 'Try a different word, or show all accounts.' : ui.tab === 'scheduled' ? 'Posts you schedule wait here until their time.' : 'Posts appear here after they go out.'}</p>
        ${filtered ? '' : `<a class="btn primary" href="#compose">${icon('pencil')}Write a post</a>`}</div>`;
    }
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const thisMonth = sent.filter((p) => p.sentAt >= monthStart.getTime()).length;
    const next = sched[0];
    return `
    <div class="head"><div><h1>Posts</h1>
      <p>${next ? `Next one goes out ${dayLabel(next.scheduledFor).toLowerCase()} at ${esc(fmtTime(next.scheduledFor))}.` : 'Nothing is waiting to go out.'} ${thisMonth} sent this month.</p></div>
      <a class="btn primary" href="#compose">${icon('plus')}New post</a></div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-act="tab" data-tab="scheduled" aria-selected="${ui.tab === 'scheduled'}">Scheduled<span class="count">${sched.length}</span></button>
      <button type="button" role="tab" data-act="tab" data-tab="sent" aria-selected="${ui.tab === 'sent'}">History<span class="count">${sent.length}</span></button></div>
    <div class="filters"><div class="search">${icon('search')}<input class="field" type="search" id="q" placeholder="Search your posts" aria-label="Search your posts" value="${esc(ui.q)}"></div>
      <select class="field" id="net-filter" aria-label="Show posts for"><option value="">All accounts</option>
        ${NETS.map((n) => `<option value="${n.id}"${ui.netFilter === n.id ? ' selected' : ''}>${n.name}</option>`).join('')}</select></div>
    <div id="post-list">${body}</div>`;
  }

  // ---------------------------------------------------------------- accounts view
  function viewAccounts() {
    const cards = NETS.map((n) => {
      const a = state.accounts[n.id];
      return `<article class="acct card"><div class="top">${netTile(n.id)}<div><b>${n.name}</b>
        <small>${a ? esc(a.handle) : 'Not connected'}</small></div></div>
        <div class="foot">${a
          ? `<span class="on">${icon('check')}Connected</span><button type="button" class="btn sm quiet" data-act="disconnect" data-net="${n.id}">Disconnect</button>`
          : `<span class="hint">${n.needsImage ? 'Image posts' : 'Text and image posts'}</span><button type="button" class="btn sm primary" data-act="connect" data-net="${n.id}">Connect</button>`}</div></article>`;
    }).join('');
    const count = Object.keys(state.accounts).length;
    return `
    <div class="head"><div><h1>Accounts</h1>
      <p>${count ? `${count} of ${NETS.length} connected.` : 'Connect the places you post to.'} You sign in on the network's own page. Postroom never sees your password.</p></div></div>
    <div class="agrid">${cards}</div>`;
  }
  function connectModal(id) {
    const n = NET[id];
    openModal(`<h2 id="modal-title">${netTile(id)}Connect ${n.name}</h2>
      <form data-form="connect" data-net="${id}">
        <p>Postroom asks ${n.name} for permission to publish posts for you. You can remove that permission at any time.</p>
        <div><label class="label" for="acct-handle">${n.acct}</label>
          <input class="field" id="acct-handle" required maxlength="60" placeholder="${esc(n.ph)}" autocomplete="off"></div>
        <p class="note">Demo mode: this step stands in for the ${n.name} sign-in page. No password is asked for or stored.</p>
        <div class="row"><button type="button" class="btn quiet" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Continue to ${n.name}</button></div>
      </form>`);
  }

  // ---------------------------------------------------------------- profile + demo modals
  function profileModal() {
    const p = state.profile;
    openModal(`<h2 id="modal-title">${p.sample ? 'Set up your workspace' : 'Workspace'}</h2>
      <form data-form="profile">
        <div><label class="label" for="pf-brand">Business or brand name</label>
          <input class="field" id="pf-brand" required maxlength="60" value="${p.sample ? '' : esc(p.brand)}" placeholder="Shown in the post previews"></div>
        <div><label class="label" for="pf-person">Your name</label>
          <input class="field" id="pf-person" maxlength="60" value="${esc(p.person)}" autocomplete="name"></div>
        <div><label class="label" for="pf-email">Email</label>
          <input class="field" id="pf-email" type="email" maxlength="120" value="${esc(p.email)}" autocomplete="email"></div>
        ${p.sample ? '<label class="check"><input type="checkbox" id="pf-clear" checked><span>Remove the sample posts and sample accounts</span></label>' : ''}
        <p class="hint">No password yet. In this version your work is kept in this browser only.</p>
        <div class="row">${p.sample ? '' : '<button type="button" class="btn quiet danger" data-act="reset" style="margin-right:auto">Erase everything</button>'}
          <button type="button" class="btn quiet" data-act="close">Cancel</button><button type="submit" class="btn primary">Save</button></div>
      </form>`);
  }
  function demoModal() {
    openModal(`<h2 id="modal-title">Demo mode</h2><div class="stack">
      <p>Everything works, but posts stop here. Nothing goes out to the real networks yet.</p>
      <ul><li>Accounts, posts, and the schedule are saved in this browser only.</li>
        <li>A scheduled post goes out while this page is open. If the page is closed, it goes out the next time you open it.</li>
        <li>Real posting needs a small server and an approved developer app for each network.</li></ul>
      <div class="row"><button type="button" class="btn primary" data-act="close">OK</button></div></div>`);
  }
  function resetModal() {
    openModal(`<h2 id="modal-title">Erase everything?</h2><div class="stack">
      <p>This removes your accounts, posts, and schedule from this browser. You cannot undo it.</p>
      <div class="row"><button type="button" class="btn quiet" data-act="close">Keep my work</button>
        <button type="button" class="btn danger" data-act="reset-yes">Erase everything</button></div></div>`);
  }

  // ---------------------------------------------------------------- events
  function toPreview() {
    const d = state.draft;
    if (!d.text.trim() && !d.image && !d.tags.length) { toast('Write some text or add an image first.'); return; }
    const pending = $('#tag-input');
    if (pending && pending.value.trim()) addTags(pending.value);
    ui.step = 'preview'; ui.editing = null; ui.tried = false;
    render();
    window.scrollTo(0, 0);
  }

  const actions = {
    preview: toPreview,
    back() { ui.step = 'write'; ui.editing = null; render(); window.scrollTo(0, 0); },
    clear() {
      const old = state.draft;
      state.draft = blankDraft(state.accounts);
      save(); render();
      toast('Post cleared.', { label: 'Undo', fn() { state.draft = old; save(); render(); } });
    },
    discard() { state.draft = blankDraft(state.accounts); ui.step = 'write'; save(); go('posts'); },
    'remove-image'() { state.draft.image = null; state.draft.ratio = 1; save(); render(); },
    untag(el) { state.draft.tags.splice(+el.dataset.i, 1); $('#tag-chips').innerHTML = tagChips(); save(); updateWrite(); },
    'focus-tags'(el, e) { if (e.target === el) $('#tag-input').focus(); },
    'edit-net'(el) {
      ui.editing = el.dataset.net;
      render();
      const t = $('#neted-text');
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'nearest' }); }
    },
    'edit-done'() { ui.editing = null; render(); },
    'edit-reset'(el) { delete state.draft.overrides[el.dataset.net]; ui.editing = null; save(); render(); },
    quick(el) {
      state.draft.date = el.dataset.date; state.draft.time = el.dataset.time;
      $('#date').value = el.dataset.date; $('#time').value = el.dataset.time;
      save(); updateSend();
    },
    send: submitDraft,
    tab(el) { ui.tab = el.dataset.tab; render(); },
    'edit-post'(el) {
      const p = state.posts.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const when = new Date(p.scheduledFor);
      state.draft = { id: p.id, text: p.text, tags: p.tags.slice(), image: p.image, ratio: p.ratio, overrides: Object.assign({}, p.overrides), targets: p.targets.slice(), when: 'later', date: dateInput(when), time: timeInput(when) };
      ui.step = 'write'; save(); go('compose');
    },
    reuse(el) {
      const p = state.posts.find((x) => x.id === el.dataset.id);
      if (!p) return;
      state.draft = Object.assign(blankDraft(state.accounts), { text: p.text, tags: p.tags.slice(), image: p.image, ratio: p.ratio, overrides: Object.assign({}, p.overrides), targets: p.targets.filter((t) => state.accounts[t]) });
      ui.step = 'write'; save(); go('compose');
      toast('Copied into a new post.');
    },
    'send-now'(el) {
      const p = state.posts.find((x) => x.id === el.dataset.id);
      if (!p) return;
      ui.tab = 'sent'; publish(p); render();
    },
    'del-post'(el) {
      const i = state.posts.findIndex((x) => x.id === el.dataset.id);
      if (i < 0) return;
      const [p] = state.posts.splice(i, 1);
      if (state.draft.id === p.id) state.draft.id = null;
      save(); render();
      toast(p.status === 'scheduled' ? 'Scheduled post cancelled.' : 'Post removed from history.', { label: 'Undo', fn() { state.posts.push(p); save(); render(); } });
    },
    connect(el) { connectModal(el.dataset.net); },
    disconnect(el) {
      const id = el.dataset.net;
      const old = state.accounts[id];
      delete state.accounts[id];
      state.draft.targets = state.draft.targets.filter((t) => t !== id);
      save(); render();
      toast(`${NET[id].name} disconnected.`, { label: 'Undo', fn() { state.accounts[id] = old; save(); render(); } });
    },
    profile: profileModal,
    demo: demoModal,
    reset: resetModal,
    'reset-yes'() {
      try { localStorage.removeItem(KEY); } catch (e) { /* nothing to remove */ }
      state = sampleState(); ui.step = 'write'; closeModal(); go('compose');
      toast('Everything erased. The sample workspace is back.');
    },
    close: closeModal,
    scrim(el, e) { if (e.target === el) closeModal(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    const d = state.draft;
    if (t.id === 'text') { d.text = t.value; save(); updateWrite(); }
    else if (t.id === 'tag-input') { if (/[,\s]/.test(t.value)) { addTags(t.value); t.value = ''; } }
    else if (t.id === 'neted-text') {
      const id = t.dataset.net;
      if (t.value === fullText(d)) delete d.overrides[id]; else d.overrides[id] = t.value;
      save(); refreshCard(id);
    }
    else if (t.id === 'date' || t.id === 'time') { d[t.id] = t.value; save(); updateSend(); }
    else if (t.id === 'q') { ui.q = t.value; const tmp = document.createElement('div'); tmp.innerHTML = viewPosts(); $('#post-list').innerHTML = $('#post-list', tmp).innerHTML; }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    const d = state.draft;
    if (t.id === 'file') { takeImage(t.files[0]); t.value = ''; }
    else if (t.dataset.act === 'target') {
      const id = t.dataset.net;
      d.targets = t.checked ? d.targets.concat(id) : d.targets.filter((x) => x !== id);
      if (ui.editing === id && !t.checked) ui.editing = null;
      save();
      if (ui.step === 'preview') render(); else updateWrite();
    }
    else if (t.name === 'when') {
      d.when = t.value;
      if (d.when === 'later' && !d.date) { const q = quickTimes().find((x) => x.label.startsWith('Tomorrow')); d.date = q.date; d.time = q.time; $('#date').value = q.date; $('#time').value = q.time; }
      $('#later').hidden = d.when !== 'later';
      save(); updateSend();
    }
    else if (t.id === 'net-filter') { ui.netFilter = t.value; render(); }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape' && $('#modal-root').firstChild) { closeModal(); return; }
    if (t.id === 'text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toPreview(); }
    if (t.id === 'tag-input') {
      if (e.key === 'Enter') { e.preventDefault(); if (t.value.trim()) { addTags(t.value); t.value = ''; } }
      else if (e.key === 'Backspace' && !t.value && state.draft.tags.length) { state.draft.tags.pop(); $('#tag-chips').innerHTML = tagChips(); save(); updateWrite(); }
    }
    if (t.id === 'neted-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); actions['edit-done'](); }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.dataset.form === 'connect') {
      const id = f.dataset.net;
      const handle = $('#acct-handle').value.trim().replace(/^@/, '');
      if (!handle) return;
      $('#modal-root .modal').innerHTML = `<h2 id="modal-title">${netTile(id)}Connect ${NET[id].name}</h2>
        <div class="waiting" role="status"><span class="spin"></span><span>Waiting for ${NET[id].name} to confirm…</span></div>`;
      setTimeout(() => {
        state.accounts[id] = { handle, since: Date.now() };
        if (!state.draft.targets.includes(id)) state.draft.targets.push(id);
        save(); closeModal(); render();
        toast(`${NET[id].name} connected.`);
      }, 1100);
    } else if (f.dataset.form === 'profile') {
      const p = state.profile;
      const clear = $('#pf-clear') && $('#pf-clear').checked;
      p.brand = $('#pf-brand').value.trim() || p.brand;
      p.person = $('#pf-person').value.trim();
      p.email = $('#pf-email').value.trim();
      const wasSample = p.sample;
      p.sample = false;
      if (clear) {
        state.posts = state.posts.filter((x) => !x.sample);
        state.accounts = {};
        state.draft = blankDraft({});
        ui.step = 'write';
      }
      save(); closeModal();
      if (wasSample && clear) { go('accounts'); toast('Workspace ready. Connect your first account.'); }
      else { render(); toast('Saved.'); }
    }
  });

  // drag, drop, and paste an image
  document.addEventListener('dragover', (e) => {
    if (route() !== 'compose' || ui.step !== 'write') return;
    e.preventDefault();
    const d = $('#drop'); if (d) d.classList.add('over');
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { const d = $('#drop'); if (d) d.classList.remove('over'); } });
  document.addEventListener('drop', (e) => {
    if (route() !== 'compose' || ui.step !== 'write') return;
    e.preventDefault();
    const d = $('#drop'); if (d) d.classList.remove('over');
    takeImage(e.dataTransfer && e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (route() !== 'compose' || ui.step !== 'write') return;
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (item) { e.preventDefault(); takeImage(item.getAsFile()); }
  });

  // ---------------------------------------------------------------- start
  function start() {
    state = load();
    // a post that was mid-send when the page closed goes back in the queue
    state.posts.forEach((p) => { if (p.status === 'sending') { p.status = 'scheduled'; p.scheduledFor = p.scheduledFor || Date.now(); } });
    window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });
    render();
    tick();
    setInterval(tick, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
  start();
})();
