(() => {
  const CITY_ID = 'guarda-mor-mg';
  const DATA_URL = './data/guardamor/v5.json';
  const el = id => document.getElementById(id);
  let latestServer = null;
  let weightsHash = '';

  function cityId() {
    try { return currentCity?.id || CITY_ID; } catch (_) { return CITY_ID; }
  }
  function fmt(v, d=1, suffix='') {
    return Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}${suffix}` : '—';
  }
  function pct(v) { return Number.isFinite(Number(v)) ? `${Math.round(Number(v)*100)}%` : '—'; }
  function currentRainPeak() {
    try { return Number(lastData?.consensus?.rainPeak); } catch (_) { return NaN; }
  }
  function idfReturnYears(intensity, minutes=60) {
    if (!Number.isFinite(intensity) || intensity <= 0) return null;
    const a=778.7,b=0.1834,c=10,d=0.7399;
    return Math.pow((intensity*Math.pow(minutes+c,d))/a,1/b);
  }
  function returnLabel(T) {
    if (!Number.isFinite(T)) return '—';
    if (T < 2) return '< 2 anos';
    if (T > 100) return '> 100 anos';
    return `~${T < 10 ? T.toFixed(1) : Math.round(T)} anos`;
  }
  function ensurePanel() {
    if (el('v5Panel')) return el('v5Panel');
    const anchor=el('v4Panel');
    if (!anchor) return null;
    const section=document.createElement('section');
    section.id='v5Panel';
    section.className='v4-panel v5-panel glass';
    section.innerHTML=`
      <div class="section-title"><h2>Calibração V5</h2><span id="v5Status" class="muted">carregando servidor…</span></div>
      <div class="v5-source" id="v5Source"><strong>Observação</strong><span>verificando fonte oficial…</span></div>
      <div class="v4-index-grid v5-index-grid">
        <article class="v4-index"><span>IDF 1 h</span><strong id="v5Return">—</strong><small>tempo de retorno</small></article>
        <article class="v4-index"><span>Pico previsto</span><strong id="v5Peak">—</strong><small>mm/h</small></article>
        <article class="v4-index"><span>Verificações</span><strong id="v5Checks">—</strong><small>servidor</small></article>
        <article class="v4-index"><span>Oficiais chuva</span><strong id="v5Official">—</strong><small>amostras</small></article>
      </div>
      <div class="v5-idf"><strong>Estação Guarda-Mor 01747005 • CPRM/SGB</strong><span>Operação desde 1973 • série IDF 1974–2018</span><code>i = 778,7 × T^0,1834 / (t + 10)^0,7399</code></div>
      <div class="section-title"><h2 style="font-size:14px">Skill dos modelos</h2><span class="muted">MAE • RMSE • eventos</span></div>
      <div class="v4-weight-wrap"><table><thead><tr><th>Modelo</th><th>N</th><th>MAE chuva</th><th>RMSE chuva</th><th>POD</th><th>FAR</th><th>CSI</th><th>Brier</th></tr></thead><tbody id="v5Rows"><tr><td colspan="8">Coletando…</td></tr></tbody></table></div>
      <p id="v5Weights" class="v4-history">Pesos oficiais ainda não ativos.</p>
      <p class="v4-note">As métricas oficiais de chuva só entram no peso automático após 20 verificações por modelo. Enquanto não houver observação oficial fresca, as comparações permanecem provisórias e não alteram o risco. O Brier exibido é binário para chuva ≥ 1 mm/h.</p>`;
    anchor.insertAdjacentElement('afterend',section);
    return section;
  }
  function chosenMetric(m) {
    if ((m?.official?.rain_n || 0) > 0) return {...m.official,label:'oficial'};
    return {...(m?.all || {}),label:'provisória'};
  }
  function renderRows(data) {
    const tbody=el('v5Rows'); if(!tbody) return;
    tbody.innerHTML=['ECMWF','GFS','ICON'].map(name=>{
      const m=chosenMetric(data.metrics?.[name]);
      return `<tr><td>${name}<small class="v5-kind">${m.label}</small></td><td>${m.rain_n ?? 0}</td><td>${fmt(m.mae_rain,1,' mm')}</td><td>${fmt(m.rmse_rain,1,' mm')}</td><td>${pct(m.pod)}</td><td>${pct(m.far)}</td><td>${pct(m.csi)}</td><td>${fmt(m.brier,3)}</td></tr>`;
    }).join('');
  }
  function applyWeights(data) {
    const rain=data.weights?.rain;
    window.RADAR_V5_WEIGHTS ||= {};
    if (rain?.active) {
      window.RADAR_V5_WEIGHTS[CITY_ID] ||= {};
      window.RADAR_V5_WEIGHTS[CITY_ID].rain={active:true,values:rain.values};
      const h=JSON.stringify(rain.values);
      if (h!==weightsHash) {
        weightsHash=h;
        setTimeout(()=>{ try { if (cityId()===CITY_ID && typeof loadWeather==='function') loadWeather(); } catch (_) {} },350);
      }
    }
  }
  function renderLive() {
    const panel=ensurePanel(); if(!panel) return;
    panel.hidden=cityId()!==CITY_ID;
    if (panel.hidden) return;
    const peak=currentRainPeak();
    el('v5Peak').textContent=Number.isFinite(peak)?peak.toFixed(1):'—';
    el('v5Return').textContent=returnLabel(idfReturnYears(peak,60));
    if (!latestServer) return;
    const d=latestServer;
    el('v5Checks').textContent=d.counts?.verifications ?? 0;
    el('v5Official').textContent=d.counts?.official_rain ?? 0;
    const obs=d.observation || {};
    if (obs.official && obs.station) {
      el('v5Source').innerHTML=`<strong>Observação oficial</strong><span>CEMADEN • ${obs.station.name} • ${fmt(obs.station.distance_km,1,' km')} • 1 h: ${fmt(obs.rain,1,' mm')}</span>`;
    } else {
      el('v5Source').innerHTML='<strong>Calibração provisória</strong><span>Sem observação oficial autenticada/fresca; referência provisória não altera os pesos V4.</span>';
    }
    const date=new Date(d.generated_at);
    el('v5Status').textContent=Number.isNaN(date.getTime())?'servidor ativo':`servidor ${date.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
    renderRows(d);
    const rain=d.weights?.rain;
    if (rain?.active) {
      const parts=Object.entries(rain.values||{}).map(([k,v])=>`${k} ${Math.round(v*100)}%`);
      el('v5Weights').textContent=`Peso oficial de chuva ativo • ${parts.join(' • ')}`;
    } else {
      el('v5Weights').textContent=`Peso oficial de chuva aguardando amostras • ${rain?.reason || 'coleta em andamento'}. Rajada permanece provisória.`;
    }
  }
  async function fetchServer() {
    ensurePanel();
    if (cityId()!==CITY_ID) { renderLive(); return; }
    try {
      const r=await fetch(`${DATA_URL}?v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw new Error(`${r.status}`);
      latestServer=await r.json();
      applyWeights(latestServer);
      renderLive();
    } catch (e) {
      console.warn('V5 servidor',e);
      if(el('v5Status')) el('v5Status').textContent='servidor temporariamente indisponível';
    }
  }

  if (typeof render==='function') {
    const original=render;
    render=function(data,cached=false){ original(data,cached); setTimeout(renderLive,120); };
  }
  el('citySelect')?.addEventListener('change',()=>setTimeout(()=>{renderLive();fetchServer();},220));
  el('refreshBtn')?.addEventListener('click',()=>setTimeout(fetchServer,400));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{ensurePanel();fetchServer();},{once:true});
  else { ensurePanel(); fetchServer(); }
  setInterval(fetchServer,10*60*1000);
})();
