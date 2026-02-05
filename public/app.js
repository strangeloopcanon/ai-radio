const healthPill = document.getElementById("healthPill");
const providerHintEl = document.getElementById("providerHint");
const promptEl = document.getElementById("prompt");
const stationNameEl = document.getElementById("stationName");
const variationCountEl = document.getElementById("variationCount");
const lengthEl = document.getElementById("lengthSec");

const statusEl = document.getElementById("status");
const generateMixBtn = document.getElementById("generateMixBtn");
const useExampleBtn = document.getElementById("useExampleBtn");
const tracksEl = document.getElementById("tracks");
const player = document.getElementById("player");
const downloadLink = document.getElementById("downloadLink");
const nextBtn = document.getElementById("nextBtn");
const clearBtn = document.getElementById("clearBtn");

let tracks = [];
let currentIndex = -1;
let lastHealth = {
  ok: false,
  musicProvider: "unknown",
  providerReady: false,
  providerReason: ""
};

function setStatus(message, kind = "info") {
  statusEl.textContent = message ?? "";
  statusEl.classList.toggle("error", kind === "error");
}

function setWorking(isWorking) {
  generateMixBtn.disabled = isWorking;
}

function fmtMs(ms) {
  const sec = Math.round(ms / 1000);
  return `${sec}s`;
}

function setHealth(ok, message) {
  healthPill.textContent = message;
  healthPill.style.borderColor = ok ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
  healthPill.style.color = ok ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)";
}

function updateHealthUI() {
  if (!lastHealth.ok) {
    setHealth(false, "Server not ready");
    providerHintEl.textContent = "Run `npm run dev`, then refresh.";
    return;
  }

  const provider = String(lastHealth.musicProvider || "unknown");
  if (lastHealth.providerReady) {
    setHealth(true, `Ready: ${provider}`);
    providerHintEl.textContent = `Using backend: ${provider}`;
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

function renderTracks() {
  tracksEl.innerHTML = "";
  if (!tracks.length) {
    tracksEl.innerHTML = `<div class="muted">No tracks yet. Generate a station mix above.</div>`;
    nextBtn.disabled = true;
    return;
  }

  nextBtn.disabled = tracks.length < 2;

  for (const [index, track] of tracks.entries()) {
    const item = document.createElement("div");
    item.className = "track";

    const meta = document.createElement("div");
    meta.className = "meta";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = track.stationName
      ? `${track.stationName} • ${track.variationLabel || `Track ${index + 1}`}`
      : track.prompt;

    const sub = document.createElement("div");
    sub.className = "sub";
    const created = new Date(track.createdAt).toLocaleString();
    sub.textContent = `${created} • ${fmtMs(track.musicLengthMs)} • ${track.provider || "unknown"}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const controls = document.createElement("div");
    controls.className = "controls";

    const playBtn = document.createElement("button");
    playBtn.textContent = "Play";
    playBtn.addEventListener("click", () => playIndex(index));

    const downloadA = document.createElement("a");
    downloadA.className = "link";
    downloadA.href = `/api/tracks/${track.id}/download`;
    downloadA.textContent = "Download";

    controls.appendChild(playBtn);
    controls.appendChild(downloadA);

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

  downloadLink.hidden = false;
  downloadLink.href = `/api/tracks/${track.id}/download`;
  downloadLink.textContent = `Download: ${track.filename}`;
}

async function generateMix() {
  const health = await checkHealth();
  if (!health.ok) {
    return setStatus("Can't reach the server. Run `npm run dev` in the project folder, then refresh.", "error");
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

  setStatus(`Generating mix (${variationCount} tracks)… this can take a while.`);
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
    setStatus(`Mix ready: ${data?.tracks?.length || variationCount} tracks for ${stationName}.`);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("failed to fetch")) {
      setStatus("Can't reach the server. Run `npm run dev` and refresh this page.", "error");
    } else {
      setStatus(message, "error");
    }
  } finally {
    setWorking(false);
  }
}

player.addEventListener("ended", () => {
  if (currentIndex < 0) return;
  if (currentIndex + 1 >= tracks.length) return;
  playIndex(currentIndex + 1);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < 0) return;
  if (currentIndex + 1 >= tracks.length) return;
  playIndex(currentIndex + 1);
});

clearBtn?.addEventListener("click", async () => {
  const health = await checkHealth();
  if (!health.ok) {
    return setStatus("Can't reach the server. Run `npm run dev` in the project folder, then refresh.", "error");
  }

  const confirmed = window.confirm("Clear generated tracks? This deletes files in ./generated.");
  if (!confirmed) return;

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
    downloadLink.hidden = true;
    await refreshTracks();
    setStatus("Cleared.");
  } catch (error) {
    setStatus(String(error?.message || error), "error");
  } finally {
    clearBtn.disabled = false;
  }
});

useExampleBtn.addEventListener("click", () => {
  stationNameEl.value = "Carnatic Flow FM";
  promptEl.value =
    "Carnatic classical station mix. Veena and violin lead with mridangam and ghatam percussion. Bright raga color, alapana-inspired openings, concert hall ambience, devotional but energetic mood.";
  variationCountEl.value = "4";
  lengthEl.value = "30";
});

generateMixBtn.addEventListener("click", generateMix);

await checkHealth();
await refreshTracks();
setInterval(checkHealth, 5000);
