(() => {
  const STORAGE = {
    queue: city => `radarGM:v4:queue:${city.id}`,
    skill: city => `radarGM:v4:skill:${city.id}`
  };
  const MIN_SAMPLES = 20;
  const BASE_WEIGHTS = {
    rain: {ECMWF:0.40, GFS:0.30, ICON:0.30},
    gust: {ECMWF:0.35, GFS:0.30, ICON:0.35},
    cape: {ECMWF:0.35, GFS:0.30, ICON:0.35},
    dew:  {ECMWF:0.35, GFS:0.30, ICON:0.35}
  };
  const RINGS = [15, 30, 60, 100];
  const BEARINGS = [0,45,90,135,180,225,270,315];
  const DIR = ["N","NE","L","SE","S","SO","O","NO"];
  let spatialToken = 0;
  let refreshTimer = null;
  let lastSpatial = null;

  const el = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a, Math.min(b, Number(v) || 0));
  const finite = v => Number.isFinite(Number(v));
  const values = arr => arr.map(Number).filter(Number.isFinite);
  const max = arr => { const a=values(arr); return a.length ? Math.max(...a) : null; };
  const sum = arr => { const a=values(arr); return a.length ? a.reduce((x,y)=>x+y,0) : null; };
  const avg = arr => { const a=values(arr); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; };
  const fmt = (v,d=0,s="") => finite(v) ? `${Number(v).toFixed(d)}${s}` : "—";

  function cityNow() {
    try { if (typeof currentCity !== "undefined" && currentCity) return {...currentCity}; } catch (_) {}
    return {id:"guarda-mor-mg",name:"Guarda-Mor",state:"MG",lat:-17.770833,lon:-47.097778};
  }
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }
  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function normalise(weights, names) {
    const out = {};
    let total = 0;
    names.forEach(n => { const v = Math.max(0, Number(weights[n]) || 0); out[n]=v; total += v; });
    if (!total) { names.forEach(n => out[n] = 1/names.length); return out; }
    names.forEach(n => out[n] /= total);
    return out;
  }
  function emptySkill() {
    const metric = () => ({ECMWF:{n:0,abs:0},GFS:{n:0,abs:0},ICON:{n:0,abs:0}});
    return {rain:metric(), gust:metric(), updatedAt:null};
  }
  function getSkill(city) {
    const s = loadJSON(STORAGE.skill(city), emptySkill());
    for (const metric of ["rain","gust"]) {
      s[metric] ||= emptySkill()[metric];
      for (const m of ["ECMWF","GFS","ICON"]) s[metric][m] ||= {n:0,abs:0};
    }
    return s;
  }
  function metricReady(skill, metric, names) {
    return names.length > 1 && names.every(n => (skill?.[metric]?.[n]?.n || 0) >= MIN_SAMPLES);
  }
  function weightsFor(city, metric, names) {
    const base = normalise(BASE_WEIGHTS[metric] || BASE_WEIGHTS.dew, names);
    const external = window.RADAR_V5_WEIGHTS?.[city.id]?.[metric];
    if (external?.active && external.values) return normalise(external.values, names);
    if (metric === "cape" || metric === "dew") return base;
    const skill = getSkill(city);
    if (!metricReady(skill, metric, names)) return base;
    const scale = metric === "rain" ? 3 : 15;
    const adjusted = {};
    names.forEach(name => {
      const st = skill[metric][name];
      const mae = st.n ? st.abs / st.n : scale;
      adjusted[name] = base[name] * (1 / (1 + mae / scale));
    });
    return normalise(adjusted, names);
  }
  function wavg(items, weights, getter) {
    let num=0, den=0;
    items.forEach(item => {
      const v = Number(getter(item));
      const w = Number(weights[item.name] ?? 0);
      if (Number.isFinite(v) && w > 0) { num += v*w; den += w; }
    });
    return den ? num/den : null;
  }
  function interpolate(v, points) {
    v = Number(v);
    if (!Number.isFinite(v)) return 0;
    if (v <= points[0][0]) return points[0][1];
    for (let i=1;i<points.length;i++) {
      if (v <= points[i][0]) {
        const [x0,y0]=points[i-1], [x1,y1]=points[i];
        return y0 + (y1-y0) * ((v-x0)/(x1-x0));
      }
    }
    return points.at(-1)[1];
  }
  function rainIndex(c) {
    const peak = interpolate(c.rainPeak ?? 0, [[0,0],[1,8],[3,20],[5,35],[10,60],[20,85],[30,100]]);
    const total = interpolate(c.rainSum ?? 0, [[0,0],[3,10],[8,25],[15,45],[30,70],[50,90],[70,100]]);
    const prob = clamp((c.rainProb ?? 0) * .72);
    return clamp(Math.max(peak, total*.9, prob));
  }
  function gustIndex(c) {
    return clamp(interpolate(c.gustMax ?? 0, [[0,0],[20,5],[30,15],[40,30],[55,55],[70,80],[90,100]]));
  }
  function convIndex(c) {
    let idx = interpolate(c.capeMax ?? 0, [[0,0],[250,8],[500,18],[1000,38],[1500,55],[2500,78],[3500,92],[5000,100]]);
    const dew = Number(c.dewMax);
    if (Number.isFinite(dew)) idx *= dew >= 22 ? 1.12 : dew >= 19 ? 1.06 : dew < 14 ? .78 : 1;
    const thunder = Number(c.thunderProb);
    if (Number.isFinite(thunder)) idx = Math.max(idx, thunder*.9);
    return clamp(idx);
  }
  function threat(indices) {
    return clamp(indices.conv*.40 + indices.gust*.35 + indices.rain*.25);
  }
  function levelFor(score) { return score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0; }
  function confidenceFor(models, historyReady) {
    const ms = Object.values(models || {});
    if (ms.length < 2) return 35;
    const ranges = [
      (() => { const a=values(ms.map(m=>m.gustMax)); return a.length>1 ? (Math.max(...a)-Math.min(...a))/35 : 0; })(),
      (() => { const a=values(ms.map(m=>m.capeMax)); return a.length>1 ? (Math.max(...a)-Math.min(...a))/1800 : 0; })(),
      (() => { const a=values(ms.map(m=>m.rainSum)); return a.length>1 ? (Math.max(...a)-Math.min(...a))/(avg(a)+5) : 0; })()
    ];
    const disagreement = clamp(avg(ranges.map(x=>clamp(x,0,1))) * 100, 0, 100);
    return Math.round(clamp(78 - disagreement*.38 + (historyReady ? 8 : 0), 35, 92));
  }

  function applyWeightedConsensus(data, city) {
    const items = Object.values(data.models || {});
    const names = items.map(m=>m.name);
    if (!items.length) return data;
    const wr = weightsFor(city,"rain",names), wg=weightsFor(city,"gust",names), wc=weightsFor(city,"cape",names), wd=weightsFor(city,"dew",names);
    const c = data.consensus;
    c.rainSum = wavg(items,wr,m=>m.rainSum);
    c.rainPeak = wavg(items,wr,m=>m.rainPeak);
    c.rainProb = wavg(items,wr,m=>m.rainProb);
    c.gustMax = wavg(items,wg,m=>m.gustMax);
    c.capeMax = wavg(items,wc,m=>m.capeMax);
    c.dewMax = wavg(items,wd,m=>m.dewMax);
    c.humidityMax = wavg(items,wd,m=>m.humidityMax);
    c.thunderProb = wavg(items,wc,m=>m.thunderProb);
    for (let i=0;i<data.hourly.length;i++) {
      const rows = items.map(m=>({name:m.name,row:m.rows?.[i]})).filter(x=>x.row);
      data.hourly[i].precipitation = wavg(rows,wr,x=>x.row.precipitation);
      data.hourly[i].wind_gusts_10m = wavg(rows,wg,x=>x.row.wind_gusts_10m);
      data.hourly[i].cape = wavg(rows,wc,x=>x.row.cape);
    }
    const indices = {rain:rainIndex(c),gust:gustIndex(c),conv:convIndex(c)};
    const center = threat(indices);
    const skill = getSkill(city);
    const historyReady = metricReady(skill,"rain",names) && metricReady(skill,"gust",names);
    const conf = confidenceFor(data.models,historyReady);
    const level = levelFor(center);
    const labels = ["Normal","Atenção","Alerta","Perigo","Severo"];
    data.risk = {
      level, label:labels[level], score:center,
      summary:`Índice V4 ${Math.round(center)}/100 • confiança ${conf}% • análise central antes da malha espacial.`,
      reasons:[`chuva ${Math.round(indices.rain)}/100`,`rajada ${Math.round(indices.gust)}/100`,`convecção ${Math.round(indices.conv)}/100`]
    };
    data.v4 = {weights:{rain:wr,gust:wg,cape:wc},indices,centerThreat:center,confidence:conf,historyReady};
    return data;
  }

  function destination(lat, lon, km, bearing) {
    const R=6371, d=km/R, br=bearing*Math.PI/180, p1=lat*Math.PI/180, l1=lon*Math.PI/180;
    const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
    const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
    return {lat:p2*180/Math.PI, lon:((l2*180/Math.PI+540)%360)-180};
  }
  function grid(city) {
    const out=[{lat:city.lat,lon:city.lon,ring:0,dir:"Centro"}];
    RINGS.forEach(r => BEARINGS.forEach((b,i) => out.push({...destination(city.lat,city.lon,r,b),ring:r,dir:DIR[i]})));
    return out;
  }
  async function getJSON(url, timeout=14000) {
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),timeout);
    try { const r=await fetch(url,{cache:"no-store",signal:ctrl.signal}); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return await r.json(); }
    finally { clearTimeout(timer); }
  }
  function spatialURL(points) {
    const p=new URLSearchParams({
      latitude:points.map(x=>x.lat.toFixed(4)).join(','),
      longitude:points.map(x=>x.lon.toFixed(4)).join(','),
      timezone:'America/Sao_Paulo', forecast_hours:'6', wind_speed_unit:'kmh',
      hourly:'precipitation,precipitation_probability,wind_gusts_10m,cape,convective_inhibition,dew_point_2m'
    });
    return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
  }
  function summariseSpatial(meta, raw) {
    const h=raw?.hourly || {};
    const rain=sum(h.precipitation || []), peak=max(h.precipitation || []), prob=max(h.precipitation_probability || []);
    const gust=max(h.wind_gusts_10m || []), cape=max(h.cape || []), dew=max(h.dew_point_2m || []);
    const cinVals=values(h.convective_inhibition || []);
    const cinBest=cinVals.length ? Math.max(...cinVals) : null;
    const c={rainSum:rain,rainPeak:peak,rainProb:prob,gustMax:gust,capeMax:cape,dewMax:dew,cinBest};
    const indices={rain:rainIndex(c),gust:gustIndex(c),conv:convIndex(c)};
    const rawThreat=threat(indices);
    const distanceFactor = meta.ring===0 ? 1 : meta.ring<=15 ? 1 : meta.ring<=30 ? .92 : meta.ring<=60 ? .72 : .48;
    return {...meta,...c,indices,rawThreat,weightedThreat:rawThreat*distanceFactor,distanceFactor};
  }
  async function loadSpatial(city) {
    const token=++spatialToken;
    if (el('v4Status')) el('v4Status').textContent='malha 0–100 km…';
    const points=grid(city);
    const raw=await getJSON(spatialURL(points),18000);
    if (token!==spatialToken || city.id!==cityNow().id) return null;
    const list=Array.isArray(raw)?raw:[raw];
    const summaries=list.map((r,i)=>summariseSpatial(points[i],r)).filter(Boolean);
    if (!summaries.length) throw new Error('Malha sem dados');
    const hotspot=summaries.reduce((a,b)=>b.weightedThreat>a.weightedThreat?b:a,summaries[0]);
    const maxima={
      rain:max(summaries.map(x=>x.rainSum)), gust:max(summaries.map(x=>x.gustMax)), cape:max(summaries.map(x=>x.capeMax)),
      rainIndex:max(summaries.map(x=>x.indices.rain*x.distanceFactor)), gustIndex:max(summaries.map(x=>x.indices.gust*x.distanceFactor)), convIndex:max(summaries.map(x=>x.indices.conv*x.distanceFactor))
    };
    lastSpatial={cityId:city.id,hotspot,maxima,summaries,generatedAt:new Date().toISOString()};
    return lastSpatial;
  }

  function hourKey(iso) { return String(iso || '').slice(0,13); }
  function savePredictions(data) {
    const city=data.city || cityNow();
    let q=loadJSON(STORAGE.queue(city),[]);
    const seen=new Set(q.map(x=>x.key));
    for (const m of Object.values(data.models || {})) {
      [2,5].forEach((idx) => {
        const row=m.rows?.[idx];
        if (!row?.time) return;
        const lead=idx===2?3:6;
        const key=`${m.name}|${row.time}|${lead}`;
        if (seen.has(key)) return;
        q.push({key,model:m.name,target:row.time,lead,issuedAt:data.generatedAt,rain:Number(row.precipitation),gust:Number(row.wind_gusts_10m)});
        seen.add(key);
      });
    }
    q=q.slice(-500);
    saveJSON(STORAGE.queue(city),q);
  }
  async function fetchReference(city) {
    const p=new URLSearchParams({latitude:city.lat,longitude:city.lon,timezone:'America/Sao_Paulo',past_hours:'24',forecast_hours:'1',hourly:'precipitation,wind_gusts_10m',wind_speed_unit:'kmh'});
    return getJSON(`https://api.open-meteo.com/v1/forecast?${p.toString()}`,12000);
  }
  async function verifyMatured(city) {
    let q=loadJSON(STORAGE.queue(city),[]);
    if (!q.length) return getSkill(city);
    let ref;
    try { ref=await fetchReference(city); } catch { return getSkill(city); }
    const h=ref.hourly || {}, map=new Map();
    (h.time || []).forEach((t,i)=>map.set(hourKey(t),{rain:Number(h.precipitation?.[i]),gust:Number(h.wind_gusts_10m?.[i])}));
    const skill=getSkill(city), keep=[];
    for (const item of q) {
      const r=map.get(hourKey(item.target));
      if (!r) { keep.push(item); continue; }
      for (const metric of ['rain','gust']) {
        const pred=Number(item[metric]), obs=Number(r[metric]);
        if (!Number.isFinite(pred) || !Number.isFinite(obs)) continue;
        const st=skill[metric][item.model] ||= {n:0,abs:0};
        st.n += 1; st.abs += Math.abs(pred-obs);
      }
    }
    skill.updatedAt=new Date().toISOString();
    saveJSON(STORAGE.skill(city),skill);
    saveJSON(STORAGE.queue(city),keep.slice(-500));
    return skill;
  }

  function mae(skill,metric,model) {
    const s=skill?.[metric]?.[model];
    return s?.n ? s.abs/s.n : null;
  }
  function weightRows(weights,skill) {
    return ['ECMWF','GFS','ICON'].map(name=>`<tr><td>${name}</td><td>${fmt((weights.rain?.[name]||0)*100,0,'%')}</td><td>${fmt((weights.gust?.[name]||0)*100,0,'%')}</td><td>${fmt((weights.cape?.[name]||0)*100,0,'%')}</td><td>${fmt(mae(skill,'rain',name),1,' mm')}</td><td>${fmt(mae(skill,'gust',name),0,' km/h')}</td></tr>`).join('');
  }
  function confidenceLabel(v) { return v>=75?'alta':v>=55?'moderada':'baixa'; }

  function updateRiskUI(data, spatial) {
    const base=data.v4;
    if (!base) return;
    let indices={...base.indices}, spatialThreat=0, hotspot=null;
    if (spatial?.hotspot) {
      hotspot=spatial.hotspot;
      spatialThreat=hotspot.weightedThreat;
      indices.rain=Math.max(indices.rain, spatial.maxima.rainIndex);
      indices.gust=Math.max(indices.gust, spatial.maxima.gustIndex);
      indices.conv=Math.max(indices.conv, spatial.maxima.convIndex);
    }
    let overall=clamp(base.centerThreat*.68 + spatialThreat*.32);
    if (hotspot?.ring<=30 && hotspot.rawThreat>=70) overall=Math.max(overall,65);
    if (hotspot?.ring<=15 && hotspot.rawThreat>=82) overall=Math.max(overall,81);
    const level=levelFor(overall), labels=['Normal','Atenção','Alerta','Perigo','Severo'];
    el('riskLevel').textContent=level;
    el('riskLabel').textContent=labels[level];
    el('riskBadge').className=`risk-badge level-${level}`;
    const hot=hotspot ? `${hotspot.ring===0?'centro':`${hotspot.ring} km ${hotspot.dir}`}` : 'malha indisponível';
    el('riskSummary').textContent=`Índice V4 ${Math.round(overall)}/100 • confiança ${base.confidence}% (${confidenceLabel(base.confidence)}) • setor crítico: ${hot}.`;
    el('riskReasons').innerHTML=[`chuva ${Math.round(indices.rain)}/100`,`rajada ${Math.round(indices.gust)}/100`,`convecção ${Math.round(indices.conv)}/100`,hotspot?`hotspot ${Math.round(hotspot.rawThreat)}/100`:null].filter(Boolean).map(x=>`<span class="chip">${x}</span>`).join('');
    const eyebrow=document.querySelector('.risk-copy .eyebrow');
    if (eyebrow) eyebrow.textContent='RISCO NUMÉRICO V4 • 6 H';
  }
  function renderV4(data, spatial, skill) {
    const v=data.v4; if(!v) return;
    const hotspot=spatial?.hotspot;
    el('v4RainIndex').textContent=`${Math.round(v.indices.rain)}`;
    el('v4GustIndex').textContent=`${Math.round(v.indices.gust)}`;
    el('v4ConvIndex').textContent=`${Math.round(v.indices.conv)}`;
    el('v4Confidence').textContent=`${v.confidence}%`;
    el('v4Hotspot').textContent=hotspot ? (hotspot.ring===0?'Centro':`${hotspot.ring} km ${hotspot.dir}`) : '—';
    el('v4HotThreat').textContent=hotspot ? `${Math.round(hotspot.rawThreat)}/100` : '—';
    el('v4HotCape').textContent=hotspot ? fmt(hotspot.capeMax,0,' J/kg') : '—';
    el('v4HotGust').textContent=hotspot ? fmt(hotspot.gustMax,0,' km/h') : '—';
    el('v4HotRain').textContent=hotspot ? fmt(hotspot.rainSum,1,' mm/6h') : '—';
    const names=Object.keys(data.models || {});
    const wr=weightsFor(data.city,'rain',names), wg=weightsFor(data.city,'gust',names), wc=weightsFor(data.city,'cape',names);
    el('v4WeightRows').innerHTML=weightRows({rain:wr,gust:wg,cape:wc},skill);
    const sampleRain=Math.min(...names.map(n=>skill?.rain?.[n]?.n||0));
    const sampleGust=Math.min(...names.map(n=>skill?.gust?.[n]?.n||0));
    const sample=Math.min(sampleRain,sampleGust);
    el('v4History').textContent=sample>=MIN_SAMPLES ? `${sample} amostras • pesos autoajustáveis ativos` : `${sample}/${MIN_SAMPLES} amostras • pesos ainda nos valores iniciais`;
    el('v4Status').textContent=spatial ? '33 pontos • 0–100 km' : 'malha indisponível';
    updateRiskUI(data,spatial);
  }

  async function run(data) {
    if (!data?.city || data.city.id!==cityNow().id) return;
    const city=data.city;
    savePredictions(data);
    const skillPromise=verifyMatured(city);
    let spatial=null;
    try { spatial=await loadSpatial(city); } catch (e) { console.warn('V4 espacial',e); }
    const skill=await skillPromise;
    if (city.id!==cityNow().id) return;
    renderV4(data,spatial,skill);
  }
  function schedule(data=lastData) {
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>{ if(data) run(data); },120);
  }

  if (typeof buildConsensus === 'function') {
    const originalBuild=buildConsensus;
    buildConsensus=function(currentRaw,rawModels,city){ return applyWeightedConsensus(originalBuild(currentRaw,rawModels,city),city); };
  }
  if (typeof render === 'function') {
    const originalRender=render;
    render=function(data,cached=false){ originalRender(data,cached); schedule(data); };
  }
  el('citySelect')?.addEventListener('change',()=>setTimeout(()=>schedule(lastData),180));
  el('refreshBtn')?.addEventListener('click',()=>setTimeout(()=>schedule(lastData),250));
  setTimeout(()=>{ if (typeof lastData!=='undefined' && lastData) schedule(lastData); },500);
})();
