(() => {
  const CPTEC = {
    radar: "https://sigma.cptec.inpe.br/radar/index.jsp?i=br",
    fortracc: "https://sigma.cptec.inpe.br/fortracc/",
    sigma: "https://sigma.cptec.inpe.br/",
    xmlBase: "https://servicos.cptec.inpe.br/XML/cidade/7dias"
  };

  const conditionLabels = {
    ec:"Encoberto com chuvas isoladas", ci:"Chuvas isoladas", c:"Chuva", in:"Instável",
    pp:"Possibilidade de pancadas", cm:"Chuva pela manhã", cn:"Chuva à noite",
    pt:"Pancadas à tarde", pm:"Pancadas pela manhã", np:"Nublado com pancadas",
    pc:"Pancadas de chuva", pn:"Parcialmente nublado", cv:"Chuvisco", ch:"Chuvoso",
    t:"Tempestade", ps:"Predomínio de sol", e:"Encoberto", n:"Nublado", cl:"Céu claro",
    nv:"Nevoeiro", g:"Geada", ne:"Neve", nd:"Não definido", pnt:"Pancadas à noite",
    psc:"Possibilidade de chuva", pcm:"Possibilidade de chuva pela manhã",
    pct:"Possibilidade de chuva à tarde", pcn:"Possibilidade de chuva à noite",
    npt:"Nublado com pancadas à tarde", npn:"Nublado com pancadas à noite",
    ncn:"Nublado com possibilidade de chuva à noite", nct:"Nublado com possibilidade de chuva à tarde",
    ncm:"Nublado com possibilidade de chuva pela manhã", npm:"Nublado com pancadas pela manhã",
    npp:"Nublado com possibilidade de chuva", vn:"Variação de nebulosidade",
    ct:"Chuva à tarde", ppn:"Possibilidade de pancadas à noite",
    ppt:"Possibilidade de pancadas à tarde", ppm:"Possibilidade de pancadas pela manhã"
  };

  let refreshToken = 0;

  function byId(id) { return document.getElementById(id); }

  function getCity() {
    try {
      if (typeof currentCity !== "undefined" && currentCity) return currentCity;
    } catch (_) {}
    return {name:"Guarda-Mor", state:"MG", lat:-17.770833, lon:-47.097778};
  }

  function cptecForecastURL(city) {
    return `${CPTEC.xmlBase}/${Number(city.lat).toFixed(4)}/${Number(city.lon).toFixed(4)}/previsaoLatLon.xml`;
  }

  async function fetchText(url, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, {cache:"no-store", signal:ctrl.signal});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function text(node, selector) {
    return node.querySelector(selector)?.textContent?.trim() || "";
  }

  function parseForecast(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML inválido");
    const root = doc.documentElement;
    const forecasts = [...doc.querySelectorAll("previsao")].map(node => ({
      day: text(node, "dia"),
      code: text(node, "tempo").toLowerCase(),
      max: text(node, "maxima"),
      min: text(node, "minima"),
      uv: text(node, "iuv")
    }));
    if (!forecasts.length) throw new Error("Sem previsão no XML");
    return {
      name: text(root, ":scope > nome") || text(doc, "nome"),
      state: text(root, ":scope > uf") || text(doc, "uf"),
      updated: text(root, ":scope > atualizacao") || text(doc, "atualizacao"),
      forecasts
    };
  }

  function formatDay(iso) {
    if (!iso) return "—";
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", {weekday:"short", day:"2-digit", month:"2-digit"});
  }

  function setStatus(label, mode = "idle") {
    const el = byId("cptecStatus");
    if (!el) return;
    el.textContent = label;
    el.dataset.mode = mode;
  }

  function renderLoading(city) {
    const wrap = byId("cptecForecast");
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="cptec-kicker">CAMADA OFICIAL • ${city.name.toUpperCase()} / ${city.state}</div>
      <div class="cptec-loading">Consultando previsão municipal do CPTEC/INPE…</div>`;
  }

  function renderForecast(city, data) {
    const wrap = byId("cptecForecast");
    if (!wrap) return;
    const cards = data.forecasts.slice(0, 3).map(item => {
      const label = conditionLabels[item.code] || item.code?.toUpperCase() || "—";
      const temps = item.min && item.max ? `${item.min}° / ${item.max}°` : "—";
      return `<article class="cptec-day"><span>${formatDay(item.day)}</span><strong>${label}</strong><small>${temps}</small></article>`;
    }).join("");
    wrap.innerHTML = `
      <div class="cptec-kicker">CPTEC/INPE • ${data.name || city.name} / ${data.state || city.state}</div>
      <div class="cptec-days">${cards}</div>
      <p class="cptec-update">Previsão municipal atualizada pelo CPTEC: ${data.updated || "data não informada"}. Para as próximas 0–2 h, use prioritariamente FORTRACC e Radar SIGMA.</p>`;
  }

  function renderFallback(city) {
    const wrap = byId("cptecForecast");
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="cptec-kicker">CAMADA OFICIAL • ${city.name.toUpperCase()} / ${city.state}</div>
      <div class="cptec-fallback"><strong>Produtos de nowcasting disponíveis</strong><span>O serviço XML municipal não respondeu diretamente no navegador. Radar SIGMA, FORTRACC e Satélite continuam acessíveis pelos botões abaixo.</span></div>`;
  }

  async function refreshCPTEC() {
    const myToken = ++refreshToken;
    const city = {...getCity()};
    renderLoading(city);
    setStatus("conectando…", "loading");
    try {
      const xml = await fetchText(cptecForecastURL(city));
      if (myToken !== refreshToken) return;
      const data = parseForecast(xml);
      renderForecast(city, data);
      setStatus("XML oficial conectado", "ok");
    } catch (error) {
      if (myToken !== refreshToken) return;
      console.warn("CPTEC/INPE XML:", error);
      renderFallback(city);
      setStatus("nowcasting oficial", "fallback");
    }
  }

  function bindLinks() {
    const links = {
      cptecRadarLink: CPTEC.radar,
      cptecFortraccLink: CPTEC.fortracc,
      cptecSigmaLink: CPTEC.sigma
    };
    for (const [id, href] of Object.entries(links)) {
      const el = byId(id);
      if (el) el.href = href;
    }
  }

  function init() {
    bindLinks();
    refreshCPTEC();
    byId("citySelect")?.addEventListener("change", () => setTimeout(refreshCPTEC, 80));
    byId("refreshBtn")?.addEventListener("click", () => setTimeout(refreshCPTEC, 80));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true});
  else init();
})();
