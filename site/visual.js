(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  let baseMapReplaced = false;

  function setMetricIcons(){
    const icons={tempNow:'🌡️',humidityNow:'💧',windNow:'💨',gustNow:'🌬️',rain6:'🌧️',gust6:'💨',cape6:'⚡',dew6:'💧'};
    Object.entries(icons).forEach(([id,icon])=>{
      const el=$(id)?.closest('.metric');
      if(el) el.dataset.icon=icon;
    });
  }

  function classifySections(){
    const mapEl=$('map')?.closest('section'); if(mapEl) mapEl.classList.add('visual-radar-section');
    const now=$('tempNow')?.closest('section'); if(now) now.classList.add('visual-now-section');
    const next=$('rain6')?.closest('section'); if(next) next.classList.add('visual-next-section');
    const models=$('models')?.closest('section'); if(models) models.classList.add('visual-model-section');
    const cities=$('cityOverview')?.closest('section'); if(cities) cities.classList.add('visual-city-section');
  }

  function updateRiskGauge(){
    const badge=$('riskBadge');
    const level=Number($('riskLevel')?.textContent);
    if(!badge || !Number.isFinite(level)) return;
    badge.style.setProperty('--gauge-pct',`${clamp(level/4*100)}%`);
  }

  function updateV4Bars(){
    const ids=['v4RainIndex','v4GustIndex','v4ConvIndex','v4Confidence'];
    ids.forEach(id=>{
      const value=parseFloat($(id)?.textContent?.replace(',','.'));
      const card=$(id)?.closest('.v4-index');
      if(card && Number.isFinite(value)) card.style.setProperty('--visual-pct',clamp(value));
    });
  }

  function updateModelBars(){
    document.querySelectorAll('.model-card').forEach(card=>{
      const name=card.querySelector('h3')?.textContent?.trim();
      if(name) card.dataset.model=name;
      const stats=[...card.querySelectorAll('.model-stat strong')]
        .map(x=>parseFloat(x.textContent.replace(',','.')))
        .filter(Number.isFinite);
      const rain=stats[0]||0, gust=stats[1]||0, cape=stats[2]||0;
      const score=Math.max(clamp(rain/25*100),clamp(gust/70*100),clamp(cape/2500*100));
      card.style.setProperty('--model-width',`${Math.max(10,score)}%`);
    });
  }

  function improveRadarHeader(){
    const radar=$('map')?.closest('section');
    const title=radar?.querySelector('.section-title h2');
    if(title) title.textContent='Radar em tempo real';
  }

  function replaceBaseMap(){
    if(baseMapReplaced) return;
    try {
      if(typeof map==='undefined' || !map || typeof L==='undefined') return;
      const remove=[];
      map.eachLayer(layer=>{
        if(!(layer instanceof L.TileLayer)) return;
        const attribution=String(layer.options?.attribution||'');
        if(/OpenStreetMap/i.test(attribution) && !/RainViewer/i.test(attribution)) remove.push(layer);
      });
      remove.forEach(layer=>map.removeLayer(layer));
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
        subdomains:'abcd',
        maxZoom:20,
        updateWhenIdle:false,
        updateWhenZooming:false,
        keepBuffer:4,
        crossOrigin:true,
        attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(map).bringToBack();
      baseMapReplaced=true;
      requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
      setTimeout(()=>map.invalidateSize({pan:false,animate:false}),250);
    } catch(err){
      console.warn('Mapa base alternativo',err);
    }
  }

  function apply(){
    document.body.classList.add('visual-v6');
    setMetricIcons();
    classifySections();
    updateRiskGauge();
    updateV4Bars();
    updateModelBars();
    improveRadarHeader();
    replaceBaseMap();
  }

  const boot=()=>{
    document.getElementById('radarFixCss')?.remove();
    document.getElementById('radarCriticalIsolation')?.remove();
    apply();
    setTimeout(replaceBaseMap,350);
    setTimeout(replaceBaseMap,1000);
    const observer=new MutationObserver(()=>requestAnimationFrame(apply));
    observer.observe(document.body,{subtree:true,childList:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
