// ---- DOM refs ----
const healthBeacon = document.getElementById("healthBeacon");
const healthPill = document.getElementById("healthPill");
const providerHintEl = document.getElementById("providerHint");
const promptEl = document.getElementById("prompt");
const stationNameEl = document.getElementById("stationName");
const variationCountEl = document.getElementById("variationCount");
const lengthEl = document.getElementById("lengthSec");

const statusEl = document.getElementById("status");
const generateMixBtn = document.getElementById("generateMixBtn");
const generateMixBtnIcon = generateMixBtn?.querySelector(".btn-icon");
const generateMixBtnLabel = generateMixBtn?.querySelector(".btn-label");
const useExampleBtn = document.getElementById("useExampleBtn");
const tracksEl = document.getElementById("tracks");
const trackCountEl = document.getElementById("trackCount");
const clearBtn = document.getElementById("clearBtn");

// Player
const player = document.getElementById("player");
const downloadLink = document.getElementById("downloadLink");
const playPauseBtn = document.getElementById("playPauseBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");
const nowPlayingTitle = document.getElementById("nowPlayingTitle");
const nowPlayingLabel = document.querySelector(".now-playing-label");
const vinyl = document.getElementById("vinyl");

// Scrubber
const scrubber = document.getElementById("scrubber");
const scrubberFill = document.getElementById("scrubberFill");
const currentTimeEl = document.getElementById("currentTime");
const durationTimeEl = document.getElementById("durationTime");

// Volume
const volumeSlider = document.getElementById("volumeSlider");

// ---- State ----
let tracks = [];
let currentIndex = -1;
let lastHealth = {
  ok: false,
  musicProvider: "unknown",
  providerReady: false,
  providerReason: ""
};

// ---- Helpers ----

function setDownloadLink(href) {
  if (!downloadLink) return;
  if (!href) {
    downloadLink.hidden = true;
    downloadLink.removeAttribute("href");
    downloadLink.setAttribute("aria-disabled", "true");
    downloadLink.tabIndex = -1;
    return;
  }

  downloadLink.hidden = false;
  downloadLink.href = href;
  downloadLink.setAttribute("aria-disabled", "false");
  downloadLink.tabIndex = 0;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtMs(ms) {
  const sec = Math.round(ms / 1000);
  return `${sec}s`;
}

// ---- Status & Health ----

function setStatus(message, kind = "info") {
  statusEl.textContent = message ?? "";
  statusEl.classList.toggle("error", kind === "error");
}

function setWorking(isWorking) {
  generateMixBtn.disabled = isWorking;
  generateMixBtn.classList.toggle("generating", isWorking);
  if (isWorking) {
    if (generateMixBtnIcon) generateMixBtnIcon.textContent = "";
    if (generateMixBtnLabel) generateMixBtnLabel.textContent = "Generating…";
  } else {
    if (generateMixBtnIcon) generateMixBtnIcon.textContent = "▶";
    if (generateMixBtnLabel) generateMixBtnLabel.textContent = "Generate Mix";
  }
}

function setHealth(ok, message) {
  healthPill.textContent = message;
  healthBeacon.className = "status-beacon" + (ok ? " live" : " error");
}

function updateHealthUI() {
  if (!lastHealth.ok) {
    setHealth(false, "Offline");
    providerHintEl.textContent = "Run npm run dev, then refresh.";
    return;
  }

  const provider = String(lastHealth.musicProvider || "unknown");
  if (lastHealth.providerReady) {
    setHealth(true, provider);
    providerHintEl.textContent = `Backend: ${provider}`;
    return;
  }

  const reason = String(lastHealth.providerReason || `Not ready: ${provider}`);
  setHealth(false, reason);
  providerHintEl.textContent = reason;
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json().catch(() => ({}));

    lastHealth = {
      ok: true,
      musicProvider: String(data?.musicProvider || "unknown"),
      providerReady: Boolean(data?.providerReady),
      providerReason: String(data?.providerReason || "")
    };
  } catch {
    lastHealth = {
      ok: false,
      musicProvider: "unknown",
      providerReady: false,
      providerReason: ""
    };
  }

  updateHealthUI();
  return lastHealth;
}

// ---- Player Controls ----

function updatePlayPauseIcon() {
  const isPlaying = !player.paused && !player.ended;
  playIcon.style.display = isPlaying ? "none" : "block";
  pauseIcon.style.display = isPlaying ? "block" : "none";
  vinyl.classList.toggle("spinning", isPlaying);
  nowPlayingLabel.classList.toggle("active", isPlaying);
}

function updateTransportButtons() {
  playPauseBtn.disabled = currentIndex < 0;
  prevBtn.disabled = currentIndex <= 0;
  nextBtn.disabled = currentIndex < 0 || currentIndex + 1 >= tracks.length;
}

player.addEventListener("play", updatePlayPauseIcon);
player.addEventListener("pause", updatePlayPauseIcon);
player.addEventListener("ended", () => {
  updatePlayPauseIcon();
  if (currentIndex >= 0 && currentIndex + 1 < tracks.length) {
    playIndex(currentIndex + 1);
  }
});

player.addEventListener("timeupdate", () => {
  if (!Number.isFinite(player.duration) || player.duration === 0) return;
  const pct = (player.currentTime / player.duration) * 100;
  scrubberFill.style.width = `${pct}%`;
  currentTimeEl.textContent = fmtTime(player.currentTime);
});

player.addEventListener("loadedmetadata", () => {
  durationTimeEl.textContent = fmtTime(player.duration);
});

player.addEventListener("durationchange", () => {
  durationTimeEl.textContent = fmtTime(player.duration);
});

// Scrubber click to seek
scrubber.addEventListener("click", (e) => {
  if (!Number.isFinite(player.duration) || player.duration === 0) return;
  const rect = scrubber.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.currentTime = pct * player.duration;
});

// Volume
player.volume = Number(volumeSlider.value);
volumeSlider.addEventListener("input", () => {
  player.volume = Number(volumeSlider.value);
});

playPauseBtn.addEventListener("click", () => {
  if (player.paused) {
    player.play().catch(() => {});
  } else {
    player.pause();
  }
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playIndex(currentIndex - 1);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex >= 0 && currentIndex + 1 < tracks.length) {
    playIndex(currentIndex + 1);
  }
});

// ---- Tracks ----

function renderTracks() {
  tracksEl.innerHTML = "";

  if (!tracks.length) {
    setDownloadLink(null);
    tracksEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">~</div>
        No tracks yet. Create a station above to start generating.
      </div>`;
    trackCountEl.textContent = "";
    updateTransportButtons();
    return;
  }

  trackCountEl.textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  updateTransportButtons();

  for (const [index, track] of tracks.entries()) {
    const item = document.createElement("div");
    item.className = "track-item" + (index === currentIndex ? " active" : "");

    const idx = document.createElement("span");
    idx.className = "track-index";
    idx.textContent = String(index + 1).padStart(2, "0");

    const meta = document.createElement("div");
    meta.className = "track-meta";

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = track.stationName
      ? `${track.stationName} — ${track.variationLabel || `Track ${index + 1}`}`
      : track.prompt;

    const sub = document.createElement("div");
    sub.className = "track-sub";
    const created = new Date(track.createdAt).toLocaleString();
    sub.textContent = `${created} · ${fmtMs(track.musicLengthMs)} · ${track.provider || "unknown"}`;

    meta.appendChild(name);
    meta.appendChild(sub);

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const playBtn = document.createElement("button");
    playBtn.className = "track-play-btn";
    playBtn.title = "Play";
    playBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 0l10 6-10 6V0z"/></svg>`;
    playBtn.addEventListener("click", () => playIndex(index));

    const downloadA = document.createElement("a");
    downloadA.className = "track-download";
    downloadA.href = `/api/tracks/${track.id}/download`;
    downloadA.setAttribute("download", "");
    downloadA.title = "Download";
    downloadA.setAttribute("aria-label", "Download");
    downloadA.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 4.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
        <path d="M11 15v6h2v-6h3l-4-4-4 4h3z"/>
      </svg>`;

    controls.appendChild(playBtn);
    controls.appendChild(downloadA);

    item.appendChild(idx);
    item.appendChild(meta);
    item.appendChild(controls);
    tracksEl.appendChild(item);
  }
}

async function refreshTracks() {
  const res = await fetch("/api/tracks");
  const data = await res.json();
  tracks = data.tracks ?? [];
  renderTracks();
}

function playIndex(index) {
  const track = tracks[index];
  if (!track) return;

  currentIndex = index;
  player.src = `/generated/${track.filename}`;
  player.play().catch(() => {});

  const title = track.stationName
    ? `${track.stationName} — ${track.variationLabel || `Track ${index + 1}`}`
    : track.prompt;
  nowPlayingTitle.textContent = title;

  setDownloadLink(`/api/tracks/${track.id}/download`);

  updateTransportButtons();
  renderTracks();
}

// ---- Generate ----

async function generateMix() {
  const health = await checkHealth();
  if (!health.ok) {
    return setStatus("Can't reach the server. Run npm run dev in the project folder, then refresh.", "error");
  }
  if (!health.providerReady) {
    return setStatus(health.providerReason || `Provider not ready: ${health.musicProvider}`, "error");
  }

  const stationName = String(stationNameEl.value || "").trim();
  const prompt = String(promptEl.value || "").trim();
  const lengthSec = Number(lengthEl.value);
  const variationCount = Number(variationCountEl.value);

  if (!stationName) return setStatus("Add a station name first.", "error");
  if (!prompt) return setStatus("Add a station vibe / prompt first.", "error");
  if (!Number.isFinite(lengthSec) || lengthSec < 5 || lengthSec > 180) {
    return setStatus("Track length must be between 5 and 180 seconds.", "error");
  }
  if (!Number.isFinite(variationCount) || variationCount < 2 || variationCount > 12) {
    return setStatus("Track count must be between 2 and 12.", "error");
  }

  setStatus(`Generating ${variationCount} tracks… this takes a while.`);
  setWorking(true);

  try {
    const res = await fetch("/api/station/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: health.musicProvider,
        stationName,
        stationPrompt: prompt,
        variationCount,
        musicLengthMs: Math.round(lengthSec * 1000),
        forceInstrumental: true,
        steps: 8,
        guidanceScale: 7,
        shift: 1,
        inferMethod: "ode"
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiMessage = data?.message || data?.detail?.detail?.message || data?.detail?.message;
      throw new Error(apiMessage || "Generation failed. Check server logs.");
    }

    await refreshTracks();
    playIndex(0);
    setStatus(`Ready — ${data?.tracks?.length || variationCount} tracks for ${stationName}.`);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("failed to fetch")) {
      setStatus("Can't reach the server. Run npm run dev and refresh this page.", "error");
    } else {
      setStatus(message, "error");
    }
  } finally {
    setWorking(false);
  }
}

// ---- Clear ----

clearBtn?.addEventListener("click", async () => {
  const health = await checkHealth();
  if (!health.ok) {
    return setStatus("Can't reach the server. Run npm run dev in the project folder, then refresh.", "error");
  }

  setStatus("Clearing track library…");
  clearBtn.disabled = true;
  try {
    const res = await fetch("/api/tracks/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepLatest: false })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiMessage = data?.message || data?.error || "Clear failed. Check server logs.";
      throw new Error(apiMessage);
    }

    currentIndex = -1;
    player.pause();
    player.removeAttribute("src");
    player.load();
    setDownloadLink(null);
    nowPlayingTitle.textContent = "No track loaded";
    scrubberFill.style.width = "0%";
    currentTimeEl.textContent = "0:00";
    durationTimeEl.textContent = "0:00";
    updatePlayPauseIcon();
    await refreshTracks();
    setStatus("Cleared.");
  } catch (error) {
    setStatus(String(error?.message || error), "error");
  } finally {
    clearBtn.disabled = false;
  }
});

// ---- Example ----

useExampleBtn.addEventListener("click", () => {
  stationNameEl.value = "Carnatic Flow FM";
  promptEl.value =
    "Carnatic classical station mix. Veena and violin lead with mridangam and ghatam percussion. Bright raga color, alapana-inspired openings, concert hall ambience, devotional but energetic mood.";
  variationCountEl.value = "4";
  lengthEl.value = "30";
});

// ---- Init ----

generateMixBtn.addEventListener("click", generateMix);

setDownloadLink(null);
await checkHealth();
await refreshTracks();
setInterval(checkHealth, 5000);
