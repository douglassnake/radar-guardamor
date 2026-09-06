const GUARDA_MOR = { lat: -17.7708, lon: -47.0997 };
const API_URL = "https://api.rainviewer.com/public/weather-maps.json";

let map;
let frames = [];
let radarLayers = [];
let currentIndex = 0;
let playTimer = null;
let isPlaying = false;
let frameDelay = 750;
let generatedAt = null;

const els = {
  timeline: document.getElementById("timeline"),
  playBtn: document.getElementById("playBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  speedSelect: document.getElementById("speedSelect"),
  frameLabel: document.getElementById("frameLabel"),
  frameDate: document.getElementById("frameDate"),
  timelineStart: document.getElementById("timelineStart"),
  timelineEnd: document.getElementById("timelineEnd"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  updatedAt: document.getElementById("updatedAt")
};

function initMap() {
  map = L.map("map", {
    center: [GUARDA_MOR.lat, GUARDA_MOR.lon],
    zoom: 7,
    minZoom: 4,
    maxZoom: 7,
    zoomControl: false,
    preferCanvas: true
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const markerIcon = L.divIcon({
    className: "",
    html: '<div class="guardamor-marker" aria-label="Guarda-Mor"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  L.marker([GUARDA_MOR.lat, GUARDA_MOR.lon], { icon: markerIcon, zIndexOffset: 1200 })
    .addTo(map)
    .bindTooltip("Guarda-Mor, MG", { direction: "top", offset: [0, -12] });
}

function formatTime(unixSeconds) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(unixSeconds * 1000));
}

function formatDate(unixSeconds) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(unixSeconds * 1000));
}

function setStatus(message, kind = "loading") {
  els.statusText.textContent = message;
  els.statusDot.classList.remove("ok", "error");
  if (kind === "ok") els.statusDot.classList.add("ok");
  if (kind === "error") els.statusDot.classList.add("error");
}

function clearRadarLayers() {
  radarLayers.forEach(layer => map.removeLayer(layer));
  radarLayers = [];
}

function buildRadarLayers(host) {
  clearRadarLayers();

  radarLayers = frames.map((frame, index) => {
    const url = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
    return L.tileLayer(url, {
      tileSize: 256,
      opacity: 0,
      maxNativeZoom: 7,
      maxZoom: 7,
      zIndex: 500,
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 3,
      crossOrigin: true
    }).addTo(map);
  });
}

function showFrame(index, { fromPlayback = false } = {}) {
  if (!frames.length) return;

  currentIndex = Math.max(0, Math.min(index, frames.length - 1));

  radarLayers.forEach((layer, i) => {
    layer.setOpacity(i === currentIndex ? 0.72 : 0);
  });

  const frame = frames[currentIndex];
  els.timeline.value = String(currentIndex);
  els.frameLabel.textContent = currentIndex === frames.length - 1
    ? `${formatTime(frame.time)} · MAIS RECENTE`
    : formatTime(frame.time);
  els.frameDate.textContent = formatDate(frame.time);

  if (!fromPlayback) stopPlayback();
}

function stopPlayback() {
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  isPlaying = false;
  els.playBtn.textContent = "▶";
  els.playBtn.setAttribute("aria-label", "Reproduzir animação");
}

function scheduleNextFrame() {
  if (!isPlaying) return;

  const atLastFrame = currentIndex >= frames.length - 1;
  const delay = atLastFrame ? 1650 : frameDelay;

  playTimer = setTimeout(() => {
    const nextIndex = atLastFrame ? 0 : currentIndex + 1;
    showFrame(nextIndex, { fromPlayback: true });
    scheduleNextFrame();
  }, delay);
}

function startPlayback() {
  if (frames.length < 2) return;
  isPlaying = true;
  els.playBtn.textContent = "❚❚";
  els.playBtn.setAttribute("aria-label", "Pausar animação");
  scheduleNextFrame();
}

function togglePlayback() {
  if (isPlaying) stopPlayback();
  else startPlayback();
}

async function loadRadar() {
  stopPlayback();
  setStatus("Atualizando imagens de radar…");
  els.refreshBtn.disabled = true;

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const past = data?.radar?.past;

    if (!Array.isArray(past) || past.length === 0) {
      throw new Error("Nenhum quadro de radar disponível.");
    }

    frames = past;
    generatedAt = data.generated || Math.floor(Date.now() / 1000);

    buildRadarLayers(data.host);

    els.timeline.min = "0";
    els.timeline.max = String(frames.length - 1);
    els.timeline.value = String(frames.length - 1);

    els.timelineStart.textContent = formatTime(frames[0].time);
    els.timelineEnd.textContent = `${formatTime(frames[frames.length - 1].time)} · AGORA`;
    els.updatedAt.textContent = `Atualizado ${formatTime(generatedAt)}`;

    showFrame(frames.length - 1, { fromPlayback: true });
    setStatus(`${frames.length} quadros observados · intervalos de 10 min`, "ok");

    // Pré-aquece os tiles adjacentes sem disparar reprodução.
    setTimeout(() => {
      const prev = radarLayers[Math.max(0, frames.length - 2)];
      if (prev) {
        prev.setOpacity(0.01);
        setTimeout(() => prev.setOpacity(0), 350);
      }
    }, 500);
  } catch (error) {
    console.error(error);
    setStatus("Não foi possível carregar o radar agora. Toque em ↻ para tentar novamente.", "error");
  } finally {
    els.refreshBtn.disabled = false;
  }
}

els.timeline.addEventListener("input", e => showFrame(Number(e.target.value)));
els.playBtn.addEventListener("click", togglePlayback);
els.prevBtn.addEventListener("click", () => showFrame(currentIndex - 1));
els.nextBtn.addEventListener("click", () => showFrame(currentIndex + 1));
els.refreshBtn.addEventListener("click", loadRadar);
els.speedSelect.addEventListener("change", e => {
  frameDelay = Number(e.target.value);
  if (isPlaying) {
    stopPlayback();
    startPlayback();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback();
});

initMap();
loadRadar();

setInterval(() => {
  if (!document.hidden) loadRadar();
}, 5 * 60 * 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
