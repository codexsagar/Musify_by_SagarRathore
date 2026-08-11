/* ============================================================
 * Musify — Free Music Streaming Player (Final 6-Card Guaranteed Grid)
 * ============================================================ */

const CONFIG = {
  API_BASE: "https://musify-api-paka.onrender.com", 
  PAGE_SIZE: 25,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const escapeHtml = (str = "") =>
  str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

const debounce = (fn, ms = 400) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* ------------------------------------------------------------------
 * Local storage & History layer
 * ---------------------------------------------------------------- */
const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(`wavelet:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(`wavelet:${key}`, JSON.stringify(value));
    } catch {
      toast("Storage is full", "err");
    }
  },
};

const state = {
  liked: store.read("liked", []),
  recent: store.read("recent", []),
  playlists: store.read("playlists", []),
  history: store.read("searchHistory", []),
  queue: [],
  index: -1,
  shuffle: false,
  repeat: "off",
  view: "home",
  search: { term: "", offset: 0, loading: false, done: false, results: [] },
};

const persist = () => {
  store.write("liked", state.liked);
  store.write("recent", state.recent);
  store.write("playlists", state.playlists);
  store.write("searchHistory", state.history);
};

/* ------------------------------------------------------------------
 * API layer with Clean Deduplication
 * ---------------------------------------------------------------- */
const normalizeJio = (r) => {
  const getLink = (arr) => {
    if (Array.isArray(arr) && arr.length > 0) return arr[arr.length - 1].link || arr[arr.length - 1].url || "";
    return typeof arr === 'string' ? arr : "";
  };
  return {
    id: String(r.id),
    title: r.name || r.title || "Unknown",
    artist: r.primaryArtists || r.singers || "Unknown artist",
    album: r.album?.name || r.album || "",
    artwork: getLink(r.image) || "./assets/placeholder.svg",
    preview: getLink(r.downloadUrl) || r.media_url || "",
    duration: Number(r.duration) || 0,
  };
};

const api = {
  async search(term, { offset = 0, limit = CONFIG.PAGE_SIZE } = {}) {
    const page = Math.floor(offset / limit) + 1;
    try {
      const url = `${CONFIG.API_BASE}/api/search/songs?query=${encodeURIComponent(term)}&page=${page}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      
      let results = [];
      if (json.data && Array.isArray(json.data.results)) results = json.data.results;
      else if (json.data && Array.isArray(json.data)) results = json.data;
      else if (Array.isArray(json.results)) results = json.results;
      else if (Array.isArray(json)) results = json;
      
      const mapped = results.map(normalizeJio).filter((t) => t.preview);
      
      const seen = new Set();
      const uniqueResults = mapped.filter((t) => {
        const cleanTitle = t.title.toLowerCase().replace(/\[.*?\]|\(.*?\)/g, "").trim();
        if (!cleanTitle) return false;
        if (seen.has(cleanTitle)) return false;
        seen.add(cleanTitle);
        return true;
      });

      return uniqueResults;
    } catch (err) {
      console.error("API Error:", err);
      return [];
    }
  },
  
  async lyrics(artist, title) {
    try {
      const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
      if (!res.ok) return "";
      const data = await res.json();
      return (data.lyrics || "").trim();
    } catch {
      return "";
    }
  },
};

/* ------------------------------------------------------------------
 * Audio Engine & Smart Auto-Queue
 * ---------------------------------------------------------------- */
const audio = $("#audio");
audio.volume = Number(store.read("volume", 0.8));
$("#volume").value = audio.volume;

const player = {
  async load(list, index, { autoplay = true } = {}) {
    state.queue = list;
    state.index = index;
    const track = list[index];
    if (!track) return;
    
    audio.src = track.preview;
    if (autoplay) audio.play().catch(() => toast("Playback blocked — tap play", "err"));
    ui.renderNowPlaying(track);
    history.push(track);

    if (index >= list.length - 2) {
      try {
        const mixTerms = ["90s hits bollywood", "romantic songs hindi", "evergreen hits", "party mix 2026"];
        const randomTerm = mixTerms[Math.floor(Math.random() * mixTerms.length)];
        const extraSongs = await api.search(randomTerm, { limit: 10 });
        const newTracks = extraSongs.filter(st => !state.queue.some(q => q.id === st.id));
        state.queue.push(...newTracks);
      } catch(e) {
        console.log("Auto-queue fetch error", e);
      }
    }
  },
  toggle() {
    if (!audio.src) return toast("Choose a song first");
    audio.paused ? audio.play() : audio.pause();
  },
  next(auto = false) {
    if (!state.queue.length) return;
    if (state.repeat === "one" && auto) {
      audio.currentTime = 0;
      return audio.play();
    }
    let i = state.shuffle
      ? Math.floor(Math.random() * state.queue.length)
      : state.index + 1;
    if (i >= state.queue.length) {
      if (state.repeat === "all") i = 0;
      else return audio.pause();
    }
    player.load(state.queue, i);
  },
  prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) return (audio.currentTime = 0);
    player.load(state.queue, Math.max(0, state.index - 1));
  },
  seekBy(sec) {
    if (audio.duration) audio.currentTime = Math.min(audio.duration, Math.max(0, audio.duration + sec));
  },
};

const history = {
  push(track) {
    state.recent = [track, ...state.recent.filter((t) => t.id !== track.id)].slice(0, 30);
    persist();
    if (state.view === "recent" || state.view === "search") ui.render();
  },
};

/* ------------------------------------------------------------------
 * Likes & Playlists
 * ---------------------------------------------------------------- */
const isLiked = (id) => state.liked.some((t) => t.id === id);

function toggleLike(track) {
  if (isLiked(track.id)) {
    state.liked = state.liked.filter((t) => t.id !== track.id);
    toast("Removed from Liked Songs");
  } else {
    state.liked = [track, ...state.liked];
    toast("Added to Liked Songs ♥");
  }
  persist();
  ui.syncLike();
  if (state.view === "liked") ui.render();
  $$(`.row[data-id="${CSS.escape(track.id)}"] .like-row`).forEach((b) =>
    b.classList.toggle("on", isLiked(track.id))
  );
}

function addToPlaylist(track) {
  if (!state.playlists.length) return toast("Create a playlist first", "err");
  const names = state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const pick = prompt(`Add "${track.title}" to which playlist?\n\n${names}\n\nEnter number:`);
  const p = state.playlists[Number(pick) - 1];
  if (!p) return;
  if (p.tracks.some((t) => t.id === track.id)) return toast("Already in playlist");
  p.tracks.push(track);
  persist();
  ui.renderPlaylists();
  toast(`Added to ${p.name}`);
}

/* ------------------------------------------------------------------
 * Rendering & UI with Guaranteed 6-Card Grid
 * ---------------------------------------------------------------- */
let homeCache = {};

const ui = {
  view: $("#view"),

  skeletonGrid(n = 8) {
    return `<div class="grid">${Array.from({ length: n }, () => '<div class="skeleton sk-card"></div>').join("")}</div>`;
  },
  skeletonRows(n = 8) {
    return Array.from({ length: n }, () => '<div class="skeleton sk-row"></div>').join("");
  },
  errorBox(msg, retryId) {
    return `<div class="error-box"><p>${escapeHtml(msg)}</p><button class="primary-btn" id="${retryId}">Try again</button></div>`;
  },

  trackRow(t, i, ctx) {
    return `
      <div class="row" data-id="${t.id}" data-ctx="${ctx}" data-index="${i}">
        <span class="idx">${i + 1}</span>
        <img loading="lazy" src="${t.artwork}" alt="${escapeHtml(t.album || t.title)} cover" />
        <div>
          <div class="t-title">${escapeHtml(t.title)}</div>
          <div class="t-artist">${escapeHtml(t.artist)}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn like-row ${isLiked(t.id) ? "on like" : ""}" data-act="like" title="Like">♥</button>
          <button class="icon-btn" data-act="add" title="Add to playlist">＋</button>
          <button class="icon-btn" data-act="queue" title="Add to queue">☰</button>
        </div>
        <span class="dur">${fmtTime(t.duration)}</span>
      </div>`;
  },

  trackList(list, ctx = "list") {
    if (!list.length) return `<p class="empty">Nothing here yet.</p>`;
    return `<div class="tracks">${list.map((t, i) => ui.trackRow(t, i, ctx)).join("")}</div>`;
  },

  card(t, ctx, i) {
    return `
      <article class="card" data-ctx="${ctx}" data-index="${i}" data-id="${t.id}">
        <img loading="lazy" src="${t.artwork}" alt="${escapeHtml(t.title)} artwork" />
        <button class="play-fab" data-act="play">▶</button>
        <b>${escapeHtml(t.title)}</b>
        <small>${escapeHtml(t.artist)}</small>
      </article>`;
  },

  async render() {
    const v = state.view;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));

    if (v === "home") return ui.home();
    if (v === "search") return ui.searchView();
    if (v === "liked") return ui.simple("Liked Songs", state.liked, "liked");
    if (v === "recent") return ui.simple("Recently Played", state.recent, "recent");
    if (v === "queue") return ui.simple("Queue", state.queue, "queue");
    if (v === "library") return ui.library();
    if (v.startsWith("pl:")) return ui.playlistView(v.slice(3));
  },

  simple(title, list, ctx) {
    ui.view.innerHTML = `
      <div class="section-head"><h2>${title}</h2><span>${list.length} song${list.length === 1 ? "" : "s"}</span></div>
      ${list.length ? `<button class="primary-btn" id="playAll">▶ Play all</button>` : ""}
      <div style="height:14px"></div>
      ${ui.trackList(list, ctx)}`;
    const btn = $("#playAll");
    if (btn) btn.onclick = () => player.load(ui.ctxList(ctx), 0);
  },

  library() {
    ui.view.innerHTML = `
      <div class="section-head"><h2>Your Library</h2><span>${state.playlists.length} playlists</span></div>
      <button class="primary-btn" id="createPl">＋ New playlist</button>
      <div style="height:16px"></div>
      <div class="grid">
        ${state.playlists
          .map(
            (p) => `
          <article class="card" data-pl="${p.id}">
            <img loading="lazy" src="${p.cover || p.tracks[0]?.artwork || "./assets/placeholder.svg"}" alt="${escapeHtml(p.name)} cover" />
            <b>${escapeHtml(p.name)}</b>
            <small>${p.tracks.length} songs</small>
          </article>`
          )
          .join("") || `<p class="empty">No playlists yet — create your first one.</p>`}
      </div>`;
    $("#createPl").onclick = openPlaylistModal;
  },

  playlistView(id) {
    const p = state.playlists.find((x) => x.id === id);
    if (!p) return ui.simple("Playlist", [], "list");
    ui.view.innerHTML = `
      <div class="hero" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <img src="${p.cover || p.tracks[0]?.artwork || "./assets/placeholder.svg"}" alt="" style="width:140px;height:140px;border-radius:14px;object-fit:cover" />
        <div>
          <h1>${escapeHtml(p.name)}</h1>
          <p>${p.tracks.length} songs</p>
          <div style="height:12px"></div>
          <button class="primary-btn" id="playPl">▶ Play</button>
          <button class="ghost-btn" id="delPl">Delete playlist</button>
        </div>
      </div>
      ${ui.trackList(p.tracks, `pl:${p.id}`)}`;
    $("#playPl").onclick = () => (p.tracks.length ? player.load(p.tracks, 0) : toast("Playlist is empty"));
    $("#delPl").onclick = () => {
      if (!confirm(`Delete "${p.name}"?`)) return;
      state.playlists = state.playlists.filter((x) => x.id !== id);
      persist();
      ui.renderPlaylists();
      navigate("library");
      toast("Playlist deleted");
    };
  },

  async home() {
    homeCache = {};

    let activeSections = [
      { title: "Trending in India", term: "bollywood hits" },
      { title: "90s Evergreen Hits", term: "90s romantic hits hindi" },
      { title: "Punjabi Beats", term: "punjabi 2024" },
      { title: "Chill & Lo-Fi", term: "lofi chill hindi" },
    ];

    if (state.history.length > 0) {
      const lastSearch = state.history[0];
      activeSections.unshift({ title: `Because you searched "${lastSearch}" 🔍`, term: lastSearch });
    }

    activeSections = activeSections.slice(0, 4);

    ui.view.innerHTML = `
      <div class="hero">
        <h3>Welcome to Musify, presented by Sagar Rathore! 🎧</h3>
        <p>Discover your favorite tracks, build playlists, and keep the good vibes playing while you browse.</p>
      </div>
      ${activeSections.map(
        (s, i) => `
        <div class="section-head"><h2>${s.title}</h2><span>Preview clips</span></div>
        <div id="sec-${i}">${ui.skeletonGrid(6)}</div>`
      ).join("")}`;

    activeSections.forEach(async (s, i) => {
      const host = $(`#sec-${i}`);
      try {
        let list = await api.search(s.term, { limit: 40 });
        
        const uniqueGridList = [];
        const seenArtworks = new Set();
        for (let track of list) {
          if (!seenArtworks.has(track.artwork)) {
            seenArtworks.add(track.artwork);
            uniqueGridList.push(track);
          }
          if (uniqueGridList.length >= 6) break;
        }

        // 💡 GUARANTEE 6 CARDS: Agar kisi section mein 6 se kam gaane hue, toh use bollywood hits se backfill kar do!
        if (uniqueGridList.length < 6) {
          const fallbackList = await api.search("bollywood hits", { limit: 20 });
          for (let track of fallbackList) {
            if (!seenArtworks.has(track.artwork) && uniqueGridList.length < 6) {
              seenArtworks.add(track.artwork);
              uniqueGridList.push(track);
            }
          }
        }

        homeCache[i] = uniqueGridList;
        host.innerHTML = `<div class="grid">${uniqueGridList
          .map((t, k) => ui.card(t, `home:${i}`, k))
          .join("")}</div>`;
      } catch (err) {
        host.innerHTML = ui.errorBox("Couldn't load this section.", `retry-${i}`);
        $(`#retry-${i}`).onclick = () => ui.home();
      }
    });
  },

  searchView() {
    const s = state.search;
    
    const historyHtml = state.history.length ? `
      <div style="margin-bottom: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <h3 style="font-size:16px; color:var(--muted); margin:0;">Recent Searches</h3>
          <button id="clearHistory" class="ghost-btn" style="padding: 2px 8px; font-size: 12px;">Clear</button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          ${state.history.map(item => `<button class="history-chip ghost-btn" data-term="${escapeHtml(item)}" style="font-size:13px; padding:6px 12px;">🔍 ${escapeHtml(item)}</button>`).join("")}
        </div>
      </div>` : "";

    const recentSongsHtml = state.recent.length && !s.term ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size:16px; color:var(--muted); margin:0 0 10px 0;">Recently Played Songs</h3>
        ${ui.trackList(state.recent.slice(0, 5), "recent")}
      </div>` : "";

    ui.view.innerHTML = `
      <div class="section-head">
        <h2>${s.term ? `Results for “${escapeHtml(s.term)}”` : "Search"}</h2>
        <span>${s.results.length} songs</span>
      </div>
      ${historyHtml}
      ${recentSongsHtml}
      <div id="searchResults">
        ${s.term ? ui.trackList(s.results, "search") : `<p class="empty">Start typing to find songs, artists or albums.</p>`}
      </div>
      <div id="searchMore"></div>`;

    const clearBtn = $("#clearHistory");
    if (clearBtn) {
      clearBtn.onclick = () => {
        state.history = [];
        persist();
        ui.searchView();
      };
    }

    $$(".history-chip").forEach(chip => {
      chip.onclick = () => {
        const term = chip.dataset.term;
        $("#searchInput").value = term;
        state.search.term = term;
        runSearch(true);
      };
    });
  },

  ctxList(ctx) {
    if (ctx === "liked") return state.liked;
    if (ctx === "recent") return state.recent;
    if (ctx === "queue") return state.queue;
    if (ctx === "search") return state.search.results;
    if (ctx.startsWith("home:")) return homeCache[Number(ctx.split(":")[1])] || [];
    if (ctx.startsWith("pl:")) return state.playlists.find((p) => p.id === ctx.slice(3))?.tracks || [];
    return [];
  },

  renderPlaylists() {
    $("#playlistList").innerHTML = state.playlists
      .map((p) => `<li><button data-pl-nav="${p.id}">♪ ${escapeHtml(p.name)}</button></li>`)
      .join("");
  },

  renderNowPlaying(t) {
    $("#npArt").src = t.artwork;
    $("#npTitle").textContent = t.title;
    $("#npArtist").textContent = t.artist;
    $("#miniArt").src = t.artwork;
    $("#miniTitle").textContent = t.title;
    $("#miniArtist").textContent = t.artist;
    $("#mini").hidden = false;
    ui.syncLike();
    ui.markPlaying();
    if (!$("#lyricsPanel").hidden) loadLyrics();
  },

  markPlaying() {
    const cur = state.queue[state.index];
    $$(".row").forEach((r) => r.classList.toggle("playing", !!cur && r.dataset.id === cur.id));
  },

  syncLike() {
    const cur = state.queue[state.index];
    const btn = $("#likeBtn");
    const on = cur && isLiked(cur.id);
    btn.classList.toggle("on", !!on);
    btn.textContent = on ? "♥" : "♡";
  },
};

/* ------------------------------------------------------------------
 * Navigation & Events
 * ---------------------------------------------------------------- */
function navigate(view) {
  state.view = view;
  ui.render();
  $("#main").scrollTo({ top: 0, behavior: "smooth" });
  closeSidebar();
}

$$(".nav-item").forEach((b) => (b.onclick = () => navigate(b.dataset.view)));

$("#playlistList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pl-nav]");
  if (btn) navigate(`pl:${btn.dataset.plNav}`);
});

ui.view.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  const row = e.target.closest(".row");
  const actBtn = e.target.closest("[data-act]");

  if (card?.dataset.pl) return navigate(`pl:${card.dataset.pl}`);

  const host = row || card;
  if (!host) return;
  const list = ui.ctxList(host.dataset.ctx);
  const idx = Number(host.dataset.index);
  const track = list[idx];
  if (!track) return;

  const act = actBtn?.dataset.act;
  if (act === "like") return toggleLike(track);
  if (act === "add") return addToPlaylist(track);
  if (act === "queue") {
    state.queue.push(track);
    toast("Added to queue");
    return;
  }
  player.load(list, idx);
});

const runSearch = async (reset = true) => {
  const s = state.search;
  if (s.loading || (!reset && s.done) || !s.term) return;
  
  if (reset && s.term.trim()) {
    state.history = [s.term.trim(), ...state.history.filter(item => item.toLowerCase() !== s.term.toLowerCase())].slice(0, 10);
    persist();
  }

  s.loading = true;
  if (reset) {
    s.offset = 0;
    s.done = false;
    s.results = [];
    ui.searchView();
    $("#searchResults").innerHTML = ui.skeletonRows(8);
  } else {
    $("#searchMore").innerHTML = ui.skeletonRows(3);
  }
  try {
    const rows = await api.search(s.term, { offset: s.offset });
    s.offset += CONFIG.PAGE_SIZE;
    if (rows.length < 1) s.done = true;
    s.results = [...s.results, ...rows];
    $("#searchResults").innerHTML = ui.trackList(s.results, "search");
    const count = $(".section-head span");
    if (count) count.textContent = `${s.results.length} songs`;
    $("#searchMore").innerHTML = s.done ? `<p class="empty">End of results.</p>` : "";
    ui.markPlaying();
  } catch (err) {
    $("#searchResults").innerHTML = ui.errorBox("Search failed.", "retrySearch");
    $("#retrySearch").onclick = () => runSearch(true);
  } finally {
    s.loading = false;
  }
};

$("#searchInput").addEventListener(
  "input",
  debounce((e) => {
    const term = e.target.value.trim();
    state.search.term = term;
    if (state.view !== "search") navigate("search");
    term ? runSearch(true) : ui.searchView();
  }, 450)
);

$("#searchInput").addEventListener("focus", () => {
  if (state.view !== "search") navigate("search");
});

new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting && state.view === "search" && state.search.term) runSearch(false);
  },
  { rootMargin: "300px" }
).observe($("#sentinel"));

/* ------------------------------------------------------------------
 * Player Controls
 * ---------------------------------------------------------------- */
$("#playBtn").onclick = () => player.toggle();
$("#miniPlay").onclick = () => player.toggle();
$("#nextBtn").onclick = () => player.next();
$("#prevBtn").onclick = () => player.prev();
$("#miniClose").onclick = () => ($("#mini").hidden = true);
$("#likeBtn").onclick = () => {
  const cur = state.queue[state.index];
  if (cur) toggleLike(cur);
};
$("#queueBtn").onclick = () => navigate("queue");

$("#shuffleBtn").onclick = (e) => {
  state.shuffle = !state.shuffle;
  e.currentTarget.classList.toggle("on", state.shuffle);
  toast(`Shuffle ${state.shuffle ? "on" : "off"}`);
};

$("#repeatBtn").onclick = (e) => {
  state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  e.currentTarget.classList.toggle("on", state.repeat !== "off");
  e.currentTarget.textContent = state.repeat === "one" ? "🔂" : "🔁";
  toast(`Repeat: ${state.repeat}`);
};

audio.addEventListener("play", () => {
  $("#playBtn").textContent = "⏸";
  $("#miniPlay").textContent = "⏸";
});
audio.addEventListener("pause", () => {
  $("#playBtn").textContent = "▶";
  $("#miniPlay").textContent = "▶";
});
audio.addEventListener("timeupdate", () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  $("#seek").value = pct;
  $("#curTime").textContent = fmtTime(audio.currentTime);
});
audio.addEventListener("loadedmetadata", () => ($("#durTime").textContent = fmtTime(audio.duration)));
audio.addEventListener("ended", () => player.next(true));
audio.addEventListener("error", () => {
  if (audio.src) toast("This track could not be played", "err");
});

$("#seek").addEventListener("input", (e) => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});
$("#volume").addEventListener("input", (e) => {
  audio.volume = Number(e.target.value);
  audio.muted = false;
  store.write("volume", audio.volume);
  $("#muteBtn").textContent = audio.volume === 0 ? "🔇" : "🔊";
});
$("#muteBtn").onclick = () => {
  audio.muted = !audio.muted;
  $("#muteBtn").textContent = audio.muted ? "🔇" : "🔊";
};

/* ------------------------------------------------------------------
 * Lyrics & UI wiring
 * ---------------------------------------------------------------- */
async function loadLyrics() {
  const cur = state.queue[state.index];
  const body = $("#lyricsBody");
  if (!cur) return (body.textContent = "Play a song to see its lyrics.");
  body.textContent = "Loading lyrics…";
  try {
    const text = await api.lyrics(cur.artist, cur.title);
    body.textContent = text || "No lyrics found for this track.";
  } catch {
    body.textContent = "No lyrics found for this track.";
  }
}
$("#lyricsBtn").onclick = () => {
  const p = $("#lyricsPanel");
  p.hidden = !p.hidden;
  if (!p.hidden) loadLyrics();
};
$("#lyricsClose").onclick = () => ($("#lyricsPanel").hidden = true);

function openPlaylistModal() {
  $("#modal").hidden = false;
  $("#plName").value = "";
  $("#plCover").value = "";
  $("#plName").focus();
}
$("#newPlaylistBtn").onclick = openPlaylistModal;
$("#modalCancel").onclick = () => ($("#modal").hidden = true);
$("#modalSave").onclick = () => {
  const name = $("#plName").value.trim();
  if (!name) return toast("Name your playlist first", "err");
  state.playlists.push({ id: String(Date.now()), name, cover: $("#plCover").value.trim(), tracks: [] });
  persist();
  ui.renderPlaylists();
  $("#modal").hidden = true;
  toast(`Playlist "${name}" created`);
  if (state.view === "library") ui.render();
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "🌙 Dark mode" : "☀️ Light mode";
  $("#themeBtn").textContent = label;
  $("#themeBtn2").textContent = theme === "dark" ? "🌙" : "☀️";
  store.write("theme", theme);
}
const toggleTheme = () =>
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
$("#themeBtn").onclick = toggleTheme;
$("#themeBtn2").onclick = toggleTheme;
applyTheme(store.read("theme", "dark"));

const closeSidebar = () => {
  $("#sidebar").classList.remove("open");
  $("#scrim").hidden = true;
};
$("#menuBtn").onclick = () => {
  $("#sidebar").classList.add("open");
  $("#scrim").hidden = false;
};
$("#scrim").onclick = closeSidebar;

// Boot
ui.renderPlaylists();
ui.render();
