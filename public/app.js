const healthPill = document.getElementById("healthPill");
const providerEl = document.getElementById("provider");
const providerHintEl = document.getElementById("providerHint");
const promptEl = document.getElementById("prompt");
const tagsEl = document.getElementById("tags");
const lyricsEl = document.getElementById("lyrics");
const stationNameEl = document.getElementById("stationName");
const variationCountEl = document.getElementById("variationCount");
const lengthEl = document.getElementById("lengthSec");
const instrumentalEl = document.getElementById("instrumental");

const heartControlsEl = document.getElementById("heartControls");
const temperatureEl = document.getElementById("temperature");
const topkEl = document.getElementById("topk");
const cfgScaleEl = document.getElementById("cfgScale");

const aceControlsEl = document.getElementById("aceControls");
const stepsEl = document.getElementById("steps");
const guidanceScaleEl = document.getElementById("guidanceScale");
const shiftEl = document.getElementById("shift");
const inferMethodEl = document.getElementById("inferMethod");

const statusEl = document.getElementById("status");
const generateBtn = document.getElementById("generateBtn");
const generateStationBtn = document.getElementById("generateStationBtn");
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
  providerReady: false,
  musicProvider: "unknown",
  providerReason: "",
  providers: {}
};

function setStatus(message, kind = "info") {
  statusEl.textContent = message ?? "";
  statusEl.classList.toggle("error", kind === "error");
}

function setWorking(isWorking) {
  generateBtn.disabled = isWorking;
  generateStationBtn.disabled = isWorking;
}

function fmtMs(ms) {
  const sec = Math.round(ms / 1000);
  return `${sec}s`;
}

function ellipsize(text, max = 90) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function getSelectedProvider() {
  const raw = String(providerEl?.value || lastHealth.musicProvider || "acestep").toLowerCase();
  if (raw === "heartmula" || raw === "elevenlabs" || raw === "acestep") return raw;
  return "acestep";
}

function providerStatusFor(provider) {
  return lastHealth.providers?.[provider] || { ready: false, reason: `Unknown provider: ${provider}` };
}

function updateHealthPill() {
  if (!lastHealth.ok) {
    setHealth(false, "Server not ready");
    providerHintEl.textContent = "Run `npm run dev`, then refresh.";
    return;
  }

  const provider = getSelectedProvider();
  const providerStatus = providerStatusFor(provider);
  const ready = Boolean(providerStatus.ready);
  const reason = String(providerStatus.reason || "");
  const label = ready ? `Ready: ${provider}` : reason || `Not ready: ${provider}`;
  setHealth(ready, label);
  providerHintEl.textContent = ready ? `${provider} backend is ready.` : label;
}

function syncAdvancedControls() {
  const provider = getSelectedProvider();
  heartControlsEl.hidden = provider !== "heartmula";
  aceControlsEl.hidden = provider !== "acestep";
  updateHealthPill();
}

function renderTracks() {
  tracksEl.innerHTML = "";
  if (!tracks.length) {
    tracksEl.innerHTML = `<div class="muted">No tracks yet. Generate one above.</div>`;
    nextBtn.disabled = true;
    return;
  }
  nextBtn.disabled = tracks.length < 2;

  for (const [i, t] of tracks.entries()) {
    const div = document.createElement("div");
    div.className = "track";
    const created = new Date(t.createdAt).toLocaleString();

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.prompt;

    const sub = document.createElement("div");
    sub.className = "sub";

    const bits = [created, fmtMs(t.musicLengthMs), t.provider || "unknown"];
    if (typeof t.tags === "string" && t.tags.trim()) bits.push(ellipsize(t.tags.trim(), 72));
    if (t.stationName) bits.push(t.stationName);
    if (t.variationLabel) bits.push(t.variationLabel);
    sub.textContent = bits.join(" • ");

    meta.appendChild(title);
    meta.appendChild(sub);

    const controls = document.createElement("div");
    controls.className = "controls";

    const playBtn = document.createElement("button");
    playBtn.textContent = "Play";
    playBtn.addEventListener("click", () => playIndex(i));

    const downloadA = document.createElement("a");
    downloadA.className = "link";
    downloadA.href = `/api/tracks/${t.id}/download`;
    downloadA.textContent = "Download";

    controls.appendChild(playBtn);
    controls.appendChild(downloadA);

    div.appendChild(meta);
    div.appendChild(controls);
    tracksEl.appendChild(div);
  }
}

async function refreshTracks() {
  const res = await fetch("/api/tracks");
  const data = await res.json();
  tracks = data.tracks ?? [];
  renderTracks();
}

function setHealth(ok, message) {
  healthPill.textContent = message;
  healthPill.style.borderColor = ok ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
  healthPill.style.color = ok ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)";
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json().catch(() => ({}));

    lastHealth = {
      ok: true,
      providerReady: Boolean(data?.providerReady),
      musicProvider: String(data?.musicProvider || "unknown"),
      providerReason: String(data?.providerReason || ""),
      providers: typeof data?.providers === "object" && data.providers ? data.providers : {}
    };

    const current = getSelectedProvider();
    if (!providerEl.value && lastHealth.musicProvider) {
      providerEl.value = lastHealth.musicProvider;
    } else if (!providerStatusFor(current).ready && providerStatusFor(lastHealth.musicProvider).ready) {
      providerEl.value = lastHealth.musicProvider;
    }

    syncAdvancedControls();
  } catch {
    lastHealth = {
      ok: false,
      providerReady: false,
      musicProvider: "unknown",
      providerReason: "",
      providers: {}
    };
    updateHealthPill();
  }
  return lastHealth;
}

function playIndex(i) {
  const t = tracks[i];
  if (!t) return;
  currentIndex = i;
  player.src = `/generated/${t.filename}`;
  player.play().catch(() => {});

  downloadLink.hidden = false;
  downloadLink.href = `/api/tracks/${t.id}/download`;
  downloadLink.textContent = `Download: ${t.filename}`;
}

function validateRange(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function buildProviderControls(provider) {
  if (provider === "heartmula") {
    const temperature = validateRange(Number(temperatureEl.value), 0.1, 2.0, "Temperature");
    const topk = validateRange(Number(topkEl.value), 1, 500, "Top-k");
    const cfgScale = validateRange(Number(cfgScaleEl.value), 1.0, 10.0, "CFG scale");
    return { temperature, topk, cfgScale };
  }

  if (provider === "acestep") {
    const steps = validateRange(Number(stepsEl.value), 1, 200, "Steps");
    const guidanceScale = validateRange(Number(guidanceScaleEl.value), 1.0, 30.0, "Guidance scale");
    const shift = validateRange(Number(shiftEl.value), 1.0, 5.0, "Shift");
    const inferMethod = String(inferMethodEl.value || "ode");
    if (inferMethod !== "ode" && inferMethod !== "sde") {
      throw new Error("Infer method must be ODE or SDE.");
    }
    return { steps, guidanceScale, shift, inferMethod };
  }

  return {};
}

async function runTrackGeneration(mode) {
  const health = await checkHealth();
  if (!health.ok) {
    return setStatus("Can't reach the server. Run `npm run dev` in the project folder, then refresh.", "error");
  }

  const provider = getSelectedProvider();
  const providerStatus = providerStatusFor(provider);
  if (!providerStatus.ready) {
    return setStatus(providerStatus.reason || `Provider not ready: ${provider}`, "error");
  }

  const prompt = promptEl.value.trim();
  const tags = String(tagsEl?.value || "").trim();
  const lyrics = String(lyricsEl?.value || "").trim();
  const stationName = String(stationNameEl?.value || "").trim();
  const variationCount = Number(variationCountEl.value);
  const lengthSec = Number(lengthEl.value);
  const forceInstrumental = Boolean(instrumentalEl?.checked);

  if (!prompt) return setStatus("Add a prompt first.", "error");
  if (!Number.isFinite(lengthSec) || lengthSec < 5 || lengthSec > 180) {
    return setStatus("Length must be between 5 and 180 seconds.", "error");
  }

  let providerControls;
  try {
    providerControls = buildProviderControls(provider);
  } catch (e) {
    return setStatus(String(e?.message || e), "error");
  }

  const commonBody = {
    provider,
    ...(tags ? { tags } : {}),
    ...(!forceInstrumental && lyrics ? { lyrics } : {}),
    musicLengthMs: Math.round(lengthSec * 1000),
    forceInstrumental,
    ...providerControls
  };

  if (mode === "station") {
    if (!Number.isFinite(variationCount) || variationCount < 2 || variationCount > 12) {
      return setStatus("Station variations must be between 2 and 12.", "error");
    }

    setStatus(`Generating station set (${variationCount} tracks)… this can take a while.`);
    setWorking(true);
    try {
      const res = await fetch("/api/station/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationPrompt: prompt,
          ...(stationName ? { stationName } : {}),
          variationCount,
          ...commonBody
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const apiMessage = data?.message || data?.detail?.detail?.message || data?.detail?.message;
        throw new Error(apiMessage || "Station generation failed. Check server logs.");
      }

      await refreshTracks();
      playIndex(0);
      setStatus(`Generated ${data?.tracks?.length || variationCount} tracks for station ${data?.station?.name || "station"}.`);
    } catch (e) {
      const message = String(e?.message || e);
      if (message.toLowerCase().includes("failed to fetch")) {
        setStatus("Can't reach the server. Run `npm run dev` and refresh this page.", "error");
      } else {
        setStatus(message, "error");
      }
    } finally {
      setWorking(false);
    }
    return;
  }

  setStatus("Generating… this can take a bit.");
  setWorking(true);
  try {
    const res = await fetch("/api/music/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ...commonBody
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiMessage = data?.message || data?.detail?.detail?.message || data?.detail?.message;
      throw new Error(apiMessage || "Generation failed. Check server logs.");
    }

    setStatus("Done. Added to your track list.");
    await refreshTracks();
    playIndex(0);
  } catch (e) {
    const message = String(e?.message || e);
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
  } catch (e) {
    setStatus(String(e?.message || e), "error");
  } finally {
    clearBtn.disabled = false;
  }
});

useExampleBtn.addEventListener("click", () => {
  promptEl.value =
    "Carnatic classical concert vibe. Veena and violin lead with mridangam and ghatam percussion. Bright raga feel, alapana opening then kriti-like rhythmic section. Warm hall ambience, expressive gamakas, energetic but devotional mood.";
  tagsEl.value = "carnatic,classical,veena,violin,mridangam,ghatam,raga,alapana,kriti,concert,live,hall,warm,bright,devotional,energetic,instrumental";
  stationNameEl.value = "Carnatic Flow FM";
  variationCountEl.value = "4";
  instrumentalEl.checked = true;
  lyricsEl.value = "";
  lyricsEl.disabled = true;
});

instrumentalEl.addEventListener("change", () => {
  const instrumental = Boolean(instrumentalEl?.checked);
  lyricsEl.disabled = instrumental;
  if (instrumental) lyricsEl.value = "";
});

providerEl.addEventListener("change", syncAdvancedControls);
generateBtn.addEventListener("click", () => runTrackGeneration("single"));
generateStationBtn.addEventListener("click", () => runTrackGeneration("station"));

// Initial state
lyricsEl.disabled = Boolean(instrumentalEl?.checked);
syncAdvancedControls();

await checkHealth();
await refreshTracks();
setInterval(checkHealth, 5000);
