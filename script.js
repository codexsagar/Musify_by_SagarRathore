/* ============================================================
 * Musify — Free Music Streaming Player (Clean & Stable)
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
 * API layer
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
    try {
      const url = `${CONFIG.API_BASE}/api/search/songs?query=${encodeURIComponent(term)}&page=1&limit=${limit}`;
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
      return mapped.filter((t) => {
        const cleanTitle = t.title.toLowerCase().replace(/\[.*?\]|\(.*?\)/g, "").trim();
        if (!cleanTitle || seen.has(cleanTitle)) return false;
        seen.add(cleanTitle);
        return true;
      });
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
 * Audio Engine
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
    let i = state.shuffle ? Math.floor(Math.random() * state.queue.length) : state.index + 1;
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
};

const history = {
  push(track) {
    state.recent = [track, ...state.recent.filter((t) => t.id !== track.id)].slice(0, 30);
    persist();
  },
};

/* ------------------------------------------------------------------
 * UI & Rendering
 * ---------------------------------------------------------------- */
let homeCache = {};

const ui = {
  view: $("#view"),

  card(t, ctx, i) {
    return `
      <article class="card" data-ctx="${ctx}" data-index="${i}" data-id="${t.id}">
        <img loading="lazy" src="${t.artwork}" alt="${escapeHtml(t.title)}" />
        <button class="play-fab" data-act="play">▶</button>
        <b>${escapeHtml(t.title)}</b>
        <small>${escapeHtml(t.artist)}</small>
      </article>`;
  },

  trackRow(t, i, ctx) {
    return `
      <div class="row" data-id="${t.id}" data-ctx="${ctx}" data-index="${i}">
        <span class="idx">${i + 1}</span>
        <img loading="lazy" src="${t.artwork}" alt="" />
        <div>
          <div class="t-title">${escapeHtml(t.title)}</div>
          <div class="t-artist">${escapeHtml(t.artist)}</div>
        </div>
        <span class="dur">${fmtTime(t.duration)}</span>
      </div>`;
  },

  trackList(list, ctx) {
    if (!list.length) return `<p class="empty">No songs found.</p>`;
    return `<div class="tracks">${list.map((t, i) => ui.trackRow(t, i, ctx)).join("")}</div>`;
  },

  async render() {
    const v = state.view;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));

    if (v === "home") return ui.home();
    if (v === "search") return ui.searchView();
    if (v === "liked") ui.simple("Liked Songs", state.liked, "liked");
    if (v === "recent") ui.simple("Recently Played", state.recent, "recent");
    if (v === "queue") ui.simple("Queue", state.queue, "queue");
  },

  simple(title, list, ctx) {
    ui.view.innerHTML = `<div class="section-head"><h2>${title}</h2><span>${list.length} songs</span></div>${ui.trackList(list, ctx)}`;
  },

  async home() {
    homeCache = {};
    const sections = [
      { title: "Trending in India", term: "bollywood hits" },
      { title: "90s Evergreen Hits", term: "90s romantic hits hindi" },
      { title: "Punjabi Beats", term: "punjabi 2024" },
    ];

    ui.view.innerHTML = `
      <div class="hero">
        <h3>Welcome to Musify, presented by Sagar Rathore! 🎧</h3>
        <p>Discover your favorite tracks and enjoy seamless music streaming.</p>
      </div>
      ${sections.map((s, i) => `
        <div class="section-head"><h2>${s.title}</h2><span>Loading...</span></div>
        <div id="sec-${i}"><p class="empty">Loading tracks...</p></div>
      `).join("")}`;

    sections.forEach(async (s, i) => {
      const host = $(`#sec-${i}`);
      const span = host.previousElementSibling.querySelector("span");
      const list = await api.search(s.term, { limit: 6 });
      
      if (list.length > 0) {
        span.textContent = "Preview clips";
        homeCache[i] = list;
        host.innerHTML = `<div class="grid">${list.map((t, k) => ui.card(t, `home:${i}`, k)).join("")}</div>`;
      } else {
        span.textContent = "Error";
        host.innerHTML = `<p class="empty">Failed to load. Refresh page.</p>`;
      }
    });
  },

  searchView() {
    const s = state.search;
    ui.view.innerHTML = `
      <div class="section-head"><h2>Search</h2><span>${s.results.length} songs</span></div>
      <div id="searchResults">${s.term ? ui.trackList(s.results, "search") : `<p class="empty">Type above to search songs.</p>`}</div>`;
  },

  renderNowPlaying(t) {
    $("#npArt").src = t.artwork;
    $("#npTitle").textContent = t.title;
    $("#npArtist").textContent = t.artist;
    $("#miniArt").src = t.artwork;
    $("#miniTitle").textContent = t.title;
    $("#miniArtist").textContent = t.artist;
    $("#mini").hidden = false;
  }
};

/* ------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------- */
function navigate(view) {
  state.view = view;
  ui.render();
  $("#main").scrollTo({ top: 0, behavior: "smooth" });
}

$$(".nav-item").forEach((b) => b.onclick = () => navigate(b.dataset.view));

ui.view.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  const row = e.target.closest(".row");
  const host = row || card;
  if (!host) return;
  
  let list = [];
  if (host.dataset.ctx.startsWith("home:")) {
    list = homeCache[Number(host.dataset.ctx.split(":")[1])] || [];
  } else if (host.dataset.ctx === "search") {
    list = state.search.results;
  } else if (host.dataset.ctx === "recent") {
    list = state.recent;
  }
  
  const idx = Number(host.dataset.index);
  if (list[idx]) player.load(list, idx);
});

$("#searchInput").addEventListener("input", debounce(async (e) => {
  const term = e.target.value.trim();
  state.search.term = term;
  if (state.view !== "search") navigate("search");
  if (term) {
    state.search.results = await api.search(term, { limit: 20 });
    ui.searchView();
  }
}, 400));

$("#playBtn").onclick = () => player.toggle();
$("#miniPlay").onclick = () => player.toggle();
$("#nextBtn").onclick = () => player.next();
$("#prevBtn").onclick = () => player.prev();
$("#miniClose").onclick = () => ($("#mini").hidden = true);

// Boot
ui.render();
