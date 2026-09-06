const $ = (id) => document.getElementById(id);
const TZ = "America/Sao_Paulo";

const BUILTIN_CITIES = [
  {id:"guarda-mor-mg", name:"Guarda-Mor", state:"MG", lat:-17.770833, lon:-47.097778},
  {id:"paracatu-mg", name:"Paracatu", state:"MG", lat:-17.222056, lon:-46.874778},
  {id:"vazante-mg", name:"Vazante", state:"MG", lat:-17.986944, lon:-46.907778},
  {id:"coromandel-mg", name:"Coromandel", state:"MG", lat:-18.473333, lon:-47.200278},
  {id:"joao-pinheiro-mg", name:"João Pinheiro", state:"MG", lat:-17.742500, lon:-46.173056},
  {id:"patos-de-minas-mg", name:"Patos de Minas", state:"MG", lat:-18.578889, lon:-46.518056},
  {id:"catalao-go", name:"Catalão", state:"GO", lat:-18.165833, lon:-47.946389},
  {id:"unai-mg", name:"Unaí", state:"MG", lat:-16.359167, lon:-46.902778}
];

const MODEL_ENDPOINTS = {
  ECMWF: {
    url: "https://api.open-meteo.com/v1/ecmwf",
    hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,convective_inhibition"
  },
  GFS: {
    url: "https://api.open-meteo.com/v1/gfs",
    hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index,convective_inhibition,thunderstorm_probability"
  },
  ICON: {
    url: "https://api.open-meteo.com/v1/dwd-icon",
    hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lightning_potential"
  }
};

const weatherLabels = {
  0:"Céu limpo",1:"Predom. limpo",2:"Parcialmente nublado",3:"Nublado",
  45:"Neblina",48:"Neblina",51:"Garoa",53:"Garoa",55:"Garoa forte",
  61:"Chuva fraca",63:"Chuva",65:"Chuva forte",80:"Pancadas",81:"Pancadas",82:"Pancadas fortes",
  95:"Tempestade",96:"Tempestade c/ granizo",99:"Tempestade forte c/ granizo"
};

let map, cityMarker, radarLayer, radarFrames = [], radarIndex = 0, radarTimer = null;
let lastData = null;
let loadToken = 0;
let overviewMode = "all";
let overviewToken = 0;
let currentCity = null;

function loadCustomCities() {
  try { return JSON.parse(localStorage.getItem("radarGM:customCities") || "[]"); }
  catch { return []; }
}
function allCities() {
  const merged = [...BUILTIN_CITIES, ...loadCustomCities()];
  return merged.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
}
function selectedCityId() {
  return localStorage.getItem("radarGM:selectedCity") || "guarda-mor-mg";
}
function favoriteIds() {
  try { return JSON.parse(localStorage.getItem("radarGM:favorites") || '["guarda-mor-mg"]'); }
  catch { return ["guarda-mor-mg"]; }
}
function setFavoriteIds(ids) {
  localStorage.setItem("radarGM:favorites", JSON.stringify([...new Set(ids)]));
}
function slugify(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}
function fmt(v, digits = 0, suffix = "") {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(digits)}${suffix}`;
}
function median(values) {
  const a = values.filter(v => Number.isFinite(v)).sort((x,y)=>x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}
function max(values) {
  const a = values.filter(v => Number.isFinite(v));
  return a.length ? Math.max(...a) : null;
}
function sum(values) {
  const a = values.filter(v => Number.isFinite(v));
  return a.length ? a.reduce((acc,v)=>acc+v,0) : null;
}
function hourLabel(iso) {
  try { return new Date(iso).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"}); }
  catch { return iso?.slice(11,16) || "—"; }
}
function dateTimeLabel(d = new Date()) {
  return d.toLocaleString("pt-BR", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}
function pickRow(hourly, i) {
  const row = { time: hourly.time?.[i] };
  for (const [k, arr] of Object.entries(hourly)) {
    if (k !== "time" && Array.isArray(arr)) row[k] = arr[i] ?? null;
  }
  return row;
}
function getFutureRows(raw, count = 12) {
  const h = raw?.hourly || {};
  const times = h.time || [];
  const now = Date.now() - 5 * 60 * 1000;
  let start = times.findIndex(t => new Date(t).getTime() >= now);
  if (start < 0) start = 0;
  const rows = [];
  for (let i = start; i < Math.min(times.length, start + count); i++) rows.push(pickRow(h, i));
  return rows;
}
async function fetchJSON(url, timeoutMs = 14000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {cache:"no-store", signal: ctrl.signal});
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
function modelURL(def, city = currentCity) {
  const p = new URLSearchParams({latitude:city.lat, longitude:city.lon, timezone:TZ, forecast_hours:"24", hourly:def.hourly, wind_speed_unit:"kmh"});
  return `${def.url}?${p.toString()}`;
}
async function fetchCurrent(city = currentCity) {
  const p = new URLSearchParams({
    latitude: city.lat, longitude: city.lon, timezone: TZ,
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "kmh"
  });
  return fetchJSON(`https://api.open-meteo.com/v1/forecast?${p.toString()}`);
}
function cityCacheKey(city = currentCity) { return `radarGM:last:${city.id}`; }

async function loadWeather() {
  const myToken = ++loadToken;
  const city = {...currentCity};
  $("refreshBtn").disabled = true;
  $("updated").textContent = "Atualizando modelos…";
  try {
    const modelPromises = Object.entries(MODEL_ENDPOINTS).map(async ([name, def]) => {
      try { return [name, await fetchJSON(modelURL(def, city))]; }
      catch (e) { console.warn(name, e); return [name, null]; }
    });
    const [current, pairs] = await Promise.all([fetchCurrent(city), Promise.all(modelPromises)]);
    if (myToken !== loadToken || city.id !== currentCity.id) return;
    const models = Object.fromEntries(pairs.filter(([,v]) => v));
    if (!Object.keys(models).length) throw new Error("Nenhum modelo meteorológico respondeu");
    lastData = buildConsensus(current, models, city);
    render(lastData);
    localStorage.setItem(cityCacheKey(city), JSON.stringify(lastData));
  } catch (err) {
    console.error(err);
    if (myToken !== loadToken || city.id !== currentCity.id) return;
    const cached = localStorage.getItem(cityCacheKey(city));
    if (cached) {
      lastData = JSON.parse(cached);
      render(lastData, true);
    } else {
      $("updated").textContent = "Não foi possível carregar os dados";
      $("riskSummary").textContent = "Confira sua conexão e tente novamente.";
    }
  } finally {
    if (myToken === loadToken) $("refreshBtn").disabled = false;
  }
}
function summarizeModel(name, raw) {
  const rows = getFutureRows(raw, 12);
  const six = rows.slice(0,6);
  const arr = (key) => six.map(r => Number(r[key])).filter(Number.isFinite);
  return {
    name, rows,
    rainSum: sum(arr("precipitation")), rainPeak: max(arr("precipitation")), rainProb: max(arr("precipitation_probability")),
    gustMax: max(arr("wind_gusts_10m")), capeMax: max(arr("cape")), dewMax: max(arr("dew_point_2m")),
    humidityMax: max(arr("relative_humidity_2m")), cinMin: arr("convective_inhibition").length ? Math.min(...arr("convective_inhibition")) : null,
    liMin: arr("lifted_index").length ? Math.min(...arr("lifted_index")) : null,
    thunderProb: max(arr("thunderstorm_probability")), lightningPotential: max(arr("lightning_potential"))
  };
}
function buildConsensus(currentRaw, rawModels, city) {
  const models = Object.fromEntries(Object.entries(rawModels).map(([n,r]) => [n, summarizeModel(n,r)]));
  const ms = Object.values(models);
  const consensus = {
    rainSum: median(ms.map(m => m.rainSum)), rainPeak: median(ms.map(m => m.rainPeak)), rainProb: median(ms.map(m => m.rainProb)),
    gustMax: median(ms.map(m => m.gustMax)), capeMax: median(ms.map(m => m.capeMax)), dewMax: median(ms.map(m => m.dewMax)),
    humidityMax: median(ms.map(m => m.humidityMax)), cinMin: median(ms.map(m => m.cinMin)), liMin: median(ms.map(m => m.liMin)),
    thunderProb: median(ms.map(m => m.thunderProb))
  };
  const hourly = [];
  for (let i=0; i<12; i++) {
    const rows = ms.map(m => m.rows[i]).filter(Boolean);
    hourly.push({time:rows[0]?.time, precipitation:median(rows.map(r => Number(r.precipitation))), wind_gusts_10m:median(rows.map(r => Number(r.wind_gusts_10m))), cape:median(rows.map(r => Number(r.cape)))});
  }
  return {generatedAt:new Date().toISOString(), city, current:currentRaw.current || {}, models, consensus, hourly, risk:calculateRisk(consensus, models)};
}
function calculateRisk(c, models = {}) {
  let score = 0;
  const reasons = [];
  const cape = c.capeMax ?? 0, gust = c.gustMax ?? 0, rain = c.rainSum ?? 0, dew = c.dewMax ?? 0, rainProb = c.rainProb ?? 0, thunder = c.thunderProb ?? 0;
  if (cape >= 2500) { score += 4; reasons.push(`CAPE ${Math.round(cape)} J/kg`); }
  else if (cape >= 1500) { score += 3; reasons.push(`CAPE ${Math.round(cape)} J/kg`); }
  else if (cape >= 750) { score += 2; reasons.push(`CAPE ${Math.round(cape)} J/kg`); }
  else if (cape >= 300) score += 1;
  if (gust >= 70) { score += 4; reasons.push(`rajadas ~${Math.round(gust)} km/h`); }
  else if (gust >= 55) { score += 3; reasons.push(`rajadas ~${Math.round(gust)} km/h`); }
  else if (gust >= 40) { score += 2; reasons.push(`rajadas ~${Math.round(gust)} km/h`); }
  else if (gust >= 30) score += 1;
  if (rain >= 20) { score += 3; reasons.push(`chuva ~${rain.toFixed(0)} mm/6h`); }
  else if (rain >= 10) { score += 2; reasons.push(`chuva ~${rain.toFixed(0)} mm/6h`); }
  else if (rain >= 3) { score += 1; reasons.push("chuva prevista"); }
  if (dew >= 20) { score += 2; reasons.push("ar muito úmido"); }
  else if (dew >= 17) score += 1;
  if (rainProb >= 70) score += 1;
  if (thunder >= 50) { score += 2; reasons.push("trovoadas prováveis"); }
  const highCapeModels = Object.values(models).filter(m => (m.capeMax ?? 0) >= 1000).length;
  if (highCapeModels >= 2) { score += 1; reasons.push(`${highCapeModels} modelos concordam`); }
  const level = score >= 12 ? 4 : score >= 9 ? 3 : score >= 6 ? 2 : score >= 3 ? 1 : 0;
  const labels = ["Normal", "Atenção", "Alerta", "Perigo", "Severo"];
  const summaries = [
    "Sem combinação relevante de sinais nas próximas 6 horas.",
    "Há sinais meteorológicos que justificam acompanhamento.",
    "Instabilidade, chuva ou rajadas podem ganhar importância.",
    "Há combinação forte de fatores; acompanhe radar e avisos oficiais.",
    "Cenário muito intenso no consenso dos modelos; trate como situação de alta atenção."
  ];
  return {level, label:labels[level], summary:summaries[level], score, reasons:reasons.slice(0,5)};
}
function render(data, cached = false) {
  const {current:c, consensus:n, risk, models, hourly} = data;
  $("updated").textContent = `${cached ? "Dados salvos • " : "Atualizado "}${dateTimeLabel(new Date(data.generatedAt))}`;
  $("riskLevel").textContent = risk.level;
  $("riskLabel").textContent = risk.label;
  $("riskSummary").textContent = risk.summary;
  $("riskBadge").className = `risk-badge level-${risk.level}`;
  $("riskReasons").innerHTML = risk.reasons.map(x => `<span class="chip">${x}</span>`).join("");
  $("tempNow").textContent = fmt(c.temperature_2m,1,"°C");
  $("humidityNow").textContent = fmt(c.relative_humidity_2m,0,"%");
  $("windNow").textContent = fmt(c.wind_speed_10m,0," km/h");
  $("gustNow").textContent = fmt(c.wind_gusts_10m,0," km/h");
  $("weatherText").textContent = weatherLabels[c.weather_code] || "Condição atual";
  $("rain6").textContent = fmt(n.rainSum,1," mm");
  $("gust6").textContent = fmt(n.gustMax,0," km/h");
  $("cape6").textContent = fmt(n.capeMax,0," J/kg");
  $("dew6").textContent = fmt(n.dewMax,1,"°C");
  $("models").innerHTML = Object.entries(models).map(([name,m]) => `
    <article class="model-card">
      <div><h3>${name}</h3><small>${m.rainProb != null ? `prob. chuva ${fmt(m.rainProb,0,"%")}` : "modelo determinístico"}</small></div>
      <div class="model-stat"><strong>${fmt(m.rainSum,1)}</strong><span>mm/6h</span></div>
      <div class="model-stat"><strong>${fmt(m.gustMax,0)}</strong><span>raj. km/h</span></div>
      <div class="model-stat"><strong>${fmt(m.capeMax,0)}</strong><span>CAPE</span></div>
    </article>`).join("");
  $("hourlyRows").innerHTML = hourly.filter(h => h.time).map(h => `<tr><td>${hourLabel(h.time)}</td><td>${fmt(h.precipitation,1," mm")}</td><td>${fmt(h.wind_gusts_10m,0," km/h")}</td><td>${fmt(h.cape,0)}</td></tr>`).join("");
}
function populateCitySelect() {
  const cities = allCities();
  $("citySelect").innerHTML = cities.map(c => `<option value="${c.id}">${c.name} • ${c.state}</option>`).join("");
  const wanted = selectedCityId();
  currentCity = cities.find(c => c.id === wanted) || cities[0];
  $("citySelect").value = currentCity.id;
  updateCityUI(false);
}
function updateCityUI(moveMap = true) {
  $("locationEyebrow").textContent = `${currentCity.name.toUpperCase()} • ${currentCity.state}`;
  $("appTitle").textContent = `Radar ${currentCity.name}`;
  document.title = `Radar ${currentCity.name}`;
  localStorage.setItem("radarGM:selectedCity", currentCity.id);
  const fav = favoriteIds().includes(currentCity.id);
  $("favoriteBtn").textContent = fav ? "★" : "☆";
  $("favoriteBtn").classList.toggle("is-favorite", fav);
  if (moveMap && map) {
    map.setView([currentCity.lat, currentCity.lon], 7);
    if (cityMarker) cityMarker.setLatLng([currentCity.lat,currentCity.lon]).bindTooltip(currentCity.name);
  }
  document.querySelectorAll(".city-card").forEach(el => el.classList.toggle("selected", el.dataset.cityId === currentCity.id));
}
async function selectCity(id) {
  const city = allCities().find(c => c.id === id);
  if (!city || city.id === currentCity?.id) return;
  currentCity = city;
  $("citySelect").value = city.id;
  updateCityUI(true);
  clearMainMetrics();
  await loadWeather();
}
function clearMainMetrics() {
  $("updated").textContent = "Atualizando modelos…";
  $("riskLabel").textContent = "Analisando";
  $("riskSummary").textContent = `Calculando o risco para ${currentCity.name}.`;
  $("riskReasons").innerHTML = "";
}
function toggleFavorite() {
  const ids = favoriteIds();
  const idx = ids.indexOf(currentCity.id);
  if (idx >= 0) ids.splice(idx,1); else ids.push(currentCity.id);
  setFavoriteIds(ids);
  updateCityUI(false);
  if (overviewMode === "favorites") loadCityOverview();
}
function summaryURL(city) {
  const p = new URLSearchParams({
    latitude:city.lat, longitude:city.lon, timezone:TZ, forecast_hours:"6", wind_speed_unit:"kmh",
    hourly:"precipitation,precipitation_probability,wind_gusts_10m,cape,dew_point_2m"
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}
function summaryFromRaw(city, raw) {
  const rows = getFutureRows(raw, 6);
  const arr = key => rows.map(r => Number(r[key])).filter(Number.isFinite);
  const c = {rainSum:sum(arr("precipitation")), rainProb:max(arr("precipitation_probability")), gustMax:max(arr("wind_gusts_10m")), capeMax:max(arr("cape")), dewMax:max(arr("dew_point_2m")), thunderProb:0};
  return {city, ...c, risk:calculateRisk(c)};
}
function levelClass(level) { return `level-${Math.max(0,Math.min(4,level ?? 0))}`; }
function cityCardHTML(s) {
  const c = s.city;
  if (s.error) return `<button class="city-card${c.id===currentCity.id?' selected':''}" data-city-id="${c.id}" type="button"><div class="city-card-head"><h3>${c.name} <small>${c.state}</small></h3><span class="mini-level level-0">—</span></div><span class="city-card-loading">Dados indisponíveis</span></button>`;
  return `<button class="city-card${c.id===currentCity.id?' selected':''}" data-city-id="${c.id}" type="button">
    <div class="city-card-head"><h3>${c.name} <small>${c.state}</small></h3><span class="mini-level ${levelClass(s.risk.level)}">${s.risk.level}</span></div>
    <div class="city-stats"><div class="city-stat"><span>Chuva 6h</span><strong>${fmt(s.rainSum,1," mm")}</strong></div><div class="city-stat"><span>Rajada máx.</span><strong>${fmt(s.gustMax,0," km/h")}</strong></div></div>
  </button>`;
}
async function loadCityOverview() {
  const myToken = ++overviewToken;
  const fav = favoriteIds();
  const cities = allCities().filter(c => overviewMode === "all" || fav.includes(c.id));
  if (!cities.length) {
    $("cityOverview").innerHTML = '<div class="city-card-loading">Nenhuma cidade favorita. Use ☆ no topo para adicionar.</div>';
    return;
  }
  $("cityOverview").innerHTML = cities.map(c => `<div class="city-card"><span class="city-card-loading">${c.name}…</span></div>`).join("");
  const results = await Promise.all(cities.map(async city => {
    try { return summaryFromRaw(city, await fetchJSON(summaryURL(city), 10000)); }
    catch (error) { return {city,error:true}; }
  }));
  if (myToken !== overviewToken) return;
  $("cityOverview").innerHTML = results.map(cityCardHTML).join("");
  $("cityOverview").querySelectorAll("[data-city-id]").forEach(b => b.addEventListener("click", () => selectCity(b.dataset.cityId)));
}
async function searchCities() {
  const q = $("citySearchInput").value.trim();
  if (q.length < 2) return;
  $("citySearchResults").innerHTML = '<span class="city-card-loading">Buscando…</span>';
  try {
    const p = new URLSearchParams({name:q,count:"8",language:"pt",format:"json"});
    const j = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?${p.toString()}`, 10000);
    const results = (j.results || []).filter(r => r.country_code === "BR");
    if (!results.length) { $("citySearchResults").innerHTML = '<span class="city-card-loading">Nenhuma cidade brasileira encontrada.</span>'; return; }
    $("citySearchResults").innerHTML = results.map((r,i) => `<button class="search-result" type="button" data-result="${i}"><strong>${r.name}</strong><span>${r.admin1 || "Brasil"}${r.admin2 ? ` • ${r.admin2}` : ""}</span></button>`).join("");
    $("citySearchResults").querySelectorAll("[data-result]").forEach(b => b.addEventListener("click", () => addSearchResult(results[Number(b.dataset.result)])));
  } catch (e) {
    console.warn(e); $("citySearchResults").innerHTML = '<span class="city-card-loading">Não foi possível pesquisar agora.</span>';
  }
}
function addSearchResult(r) {
  const state = r.admin1 || r.country_code || "BR";
  const stateCode = state.length === 2 ? state : (r.admin1 || "BR");
  const id = `${slugify(r.name)}-${slugify(stateCode)}-${Math.abs(Number(r.latitude)).toFixed(3)}-${Math.abs(Number(r.longitude)).toFixed(3)}`;
  const city = {id,name:r.name,state:stateCode,lat:Number(r.latitude),lon:Number(r.longitude)};
  const custom = loadCustomCities();
  if (!allCities().some(c => c.id === id)) {
    custom.push(city);
    localStorage.setItem("radarGM:customCities", JSON.stringify(custom));
  }
  const cities = allCities();
  $("citySelect").innerHTML = cities.map(c => `<option value="${c.id}">${c.name} • ${c.state}</option>`).join("");
  currentCity = cities.find(c => c.id === id) || city;
  $("citySelect").value = currentCity.id;
  updateCityUI(true);
  $("addCityDialog").close();
  loadWeather();
  loadCityOverview();
}
function initMap() {
  if (!window.L) { $("radarTime").textContent = "mapa indisponível"; return; }
  map = L.map("map", {zoomControl:true, preferCanvas:true}).setView([currentCity.lat, currentCity.lon], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, attribution:"© OpenStreetMap"}).addTo(map);
  cityMarker = L.circleMarker([currentCity.lat,currentCity.lon], {radius:7,weight:2,color:"#ffffff",fillColor:"#1977e9",fillOpacity:1}).addTo(map).bindTooltip(currentCity.name);
  loadRadar();
}
async function loadRadar() {
  if (!map) return;
  try {
    const j = await fetchJSON("https://api.rainviewer.com/public/weather-maps.json", 10000);
    radarFrames = (j.radar?.past || []).map(f => ({...f,host:j.host}));
    radarIndex = Math.max(0,radarFrames.length-1);
    $("radarSlider").max = Math.max(0,radarFrames.length-1);
    $("radarSlider").value = radarIndex;
    showRadarFrame(radarIndex);
  } catch (e) { console.warn("Radar",e); $("radarTime").textContent = "radar temporariamente indisponível"; }
}
function showRadarFrame(i) {
  if (!radarFrames.length || !map) return;
  radarIndex = Math.max(0,Math.min(i,radarFrames.length-1));
  const f = radarFrames[radarIndex];
  if (radarLayer) map.removeLayer(radarLayer);
  radarLayer = L.tileLayer(`${f.host}${f.path}/256/{z}/{x}/{y}/2/1_0.png`, {tileSize:256,opacity:.72,zIndex:5,maxZoom:7,attribution:"RainViewer"}).addTo(map);
  $("radarSlider").value = radarIndex;
  $("radarTime").textContent = new Date(f.time*1000).toLocaleString("pt-BR", {hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"});
}
function toggleRadarPlay() {
  if (radarTimer) { clearInterval(radarTimer); radarTimer=null; $("radarPlay").textContent="▶ Animar"; return; }
  $("radarPlay").textContent="⏸ Pausar";
  radarTimer=setInterval(()=>showRadarFrame(radarIndex>=radarFrames.length-1?0:radarIndex+1),700);
}
function setOverviewMode(mode) {
  overviewMode = mode;
  $("overviewAllBtn").classList.toggle("active", mode === "all");
  $("overviewFavBtn").classList.toggle("active", mode === "favorites");
  loadCityOverview();
}

$("refreshBtn").addEventListener("click", () => { loadWeather(); loadRadar(); loadCityOverview(); });
$("citySelect").addEventListener("change", e => selectCity(e.target.value));
$("favoriteBtn").addEventListener("click", toggleFavorite);
$("addCityBtn").addEventListener("click", () => { $("citySearchInput").value=""; $("citySearchResults").innerHTML=""; $("addCityDialog").showModal(); setTimeout(()=>$("citySearchInput").focus(),100); });
$("citySearchBtn").addEventListener("click", searchCities);
$("citySearchInput").addEventListener("keydown", e => { if (e.key === "Enter") searchCities(); });
$("overviewAllBtn").addEventListener("click", () => setOverviewMode("all"));
$("overviewFavBtn").addEventListener("click", () => setOverviewMode("favorites"));
$("radarPrev").addEventListener("click", () => showRadarFrame(radarIndex-1));
$("radarNext").addEventListener("click", () => showRadarFrame(radarIndex+1));
$("radarPlay").addEventListener("click", toggleRadarPlay);
$("radarSlider").addEventListener("input", e => showRadarFrame(Number(e.target.value)));
$("installHelp").addEventListener("click", () => $("installDialog").showModal());
$("aboutRisk").addEventListener("click", () => $("riskDialog").showModal());
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => $(b.dataset.close).close()));

populateCitySelect();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
initMap();
loadWeather();
loadCityOverview();
setInterval(loadWeather, 5*60*1000);
setInterval(loadRadar, 10*60*1000);
setInterval(loadCityOverview, 10*60*1000);
