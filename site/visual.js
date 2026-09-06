(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  let radarMoved = false;
  let radarRebuilt = false;
  let visualRadarTimer = null;
  let visualRadarControlsInstalled = false;

  function ensureRadarIsolation(){
    if(!document.getElementById('radarFixCss')){
      const link=document.createElement('link');
      link.id='radarFixCss';
      link.rel='stylesheet';
      link.href='./radarfix.css?v=3';
      document.head.appendChild(link);
    }
    if(!document.getElementById('radarCriticalIsolation')){
      const style=document.createElement('style');
      style.id='radarCriticalIsolation';
      style.textContent=`
        .visual-v6 .radar-card{position:relative!important;overflow:hidden!important;isolation:isolate!important;contain:layout paint!important}
        .visual-v6 #map,.visual-v6 #map.leaflet-container{position:relative!important;overflow:hidden!important;contain:layout paint size!important;clip-path:inset(0)!important;-webkit-clip-path:inset(0)!important;isolation:isolate!important;z-index:1!important}
        .visual-v6 .radar-timeline-labels,.visual-v6 .radar-slider,.visual-v6 .radar-controls,.visual-v6 .radar-card>.source-note{position:relative!important;z-index:50!important;background:#061b2e!important}
        .visual-v6 .radar-controls button,.visual-v6 .radar-controls select,.visual-v6 .radar-controls label{position:relative!important;z-index:60!important;pointer-events:auto!important;touch-action:manipulation!important}
      `;
      document.head.appendChild(style);
    }
  }

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

  function reorder(){
    const official=document.querySelector('.official-card');
    const radar=$('map')?.closest('section');
    if(official && radar && official.nextElementSibling!==radar){
      official.insertAdjacentElement('afterend',radar);
      radarMoved=true;
    }

    const models=$('models')?.closest('section');
    const cptec=$('cptecPanel');
    if(models && cptec && models.nextElementSibling!==cptec){
      models.insertAdjacentElement('afterend',cptec);
    }
  }

  function updateRiskGauge(){
    const badge=$('riskBadge');
    const level=Number($('riskLevel')?.textContent);
    if(!badge || !Number.isFinite(level)) return;
    badge.style.setProperty('--gauge-pct',`${clamp(level/4*100)}%`);
    const eyebrow=document.querySelector('.risk-copy .eyebrow');
    if(eyebrow && eyebrow.textContent!=='RISCO NUMÉRICO V5 • 6 H') eyebrow.textContent='RISCO NUMÉRICO V5 • 6 H';
  }

  function updateV4Bars(){
    const ids=['v4RainIndex','v4GustIndex','v4ConvIndex','v4Confidence'];
    ids.forEach(id=>{
      const value=parseFloat($(id)?.textContent?.replace(',','.'));
      const card=$(id)?.closest('.v4-index');
      if(card && Number.isFinite(value)) card.style.setProperty('--visual-pct',clamp(value));
    });
    const title=$('v4Panel')?.querySelector('.section-title h2');
    if(title && title.textContent!=='Análise numérica V5') title.textContent='Análise numérica V5';
  }

  function updateModelBars(){
    document.querySelectorAll('.model-card').forEach(card=>{
      const name=card.querySelector('h3')?.textContent?.trim();
      if(name) card.dataset.model=name;
      const stats=[...card.querySelectorAll('.model-stat strong')].map(x=>parseFloat(x.textContent.replace(',','.'))).filter(Number.isFinite);
      const rain=stats[0]||0, gust=stats[1]||0, cape=stats[2]||0;
      const score=Math.max(clamp(rain/25*100),clamp(gust/70*100),clamp(cape/2500*100));
      card.style.setProperty('--model-width',`${Math.max(10,score)}%`);
    });
  }

  function improveRadarHeader(){
    const radar=$('map')?.closest('section');
    const title=radar?.querySelector('.section-title h2');
    if(title && title.textContent!=='Radar em tempo real') title.textContent='Radar em tempo real';
  }

  function stopVisualRadar(){
    if(visualRadarTimer) clearInterval(visualRadarTimer);
    visualRadarTimer=null;
    const btn=$('radarPlay');
    if(btn) btn.textContent='▶ Animar';
  }

  function startVisualRadar(){
    if(typeof radarFrames==='undefined' || radarFrames.length<2 || typeof showRadarFrame!=='function') return;
    try { if(typeof stopRadarPlay==='function') stopRadarPlay(); } catch(_) {}
    if(radarIndex>=radarFrames.length-1) showRadarFrame(0,true);
    const btn=$('radarPlay');
    if(btn) btn.textContent='⏸ Pausar';
    const delay=Math.max(500,Number(typeof radarDelay!=='undefined'?radarDelay:850)||850);
    visualRadarTimer=setInterval(()=>{
      if(document.hidden) return;
      if(typeof radarFrames==='undefined' || radarFrames.length<2) return;
      const next=radarIndex>=radarFrames.length-1?0:radarIndex+1;
      showRadarFrame(next,true);
    },delay);
  }

  function installRadarControls(){
    if(visualRadarControlsInstalled || !$('radarPlay')) return;
    visualRadarControlsInstalled=true;

    $('radarPlay').addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      if(visualRadarTimer) stopVisualRadar(); else startVisualRadar();
    },true);

    $('radarSpeed')?.addEventListener('change',()=>{
      if(!visualRadarTimer) return;
      stopVisualRadar();
      setTimeout(startVisualRadar,40);
    },true);

    document.addEventListener('visibilitychange',()=>{
      if(document.hidden) return;
      try { if(typeof map!=='undefined' && map) setTimeout(()=>map.invalidateSize({pan:false,animate:false}),80); } catch(_) {}
    });
  }

  function createStableLeafletMap(){
    const mapEl=$('map');
    if(!mapEl || typeof L==='undefined' || typeof currentCity==='undefined' || !currentCity) return false;

    map=L.map(mapEl,{
      zoomControl:true,
      preferCanvas:true,
      zoomAnimation:false,
      fadeAnimation:false,
      markerZoomAnimation:false,
      inertia:false,
      trackResize:true
    }).setView([currentCity.lat,currentCity.lon],7,{animate:false});

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      updateWhenIdle:true,
      updateWhenZooming:false,
      keepBuffer:1,
      attribution:'© OpenStreetMap'
    }).addTo(map);

    cityMarker=L.circleMarker([currentCity.lat,currentCity.lon],{
      radius:7,weight:2,color:'#ffffff',fillColor:'#1977e9',fillOpacity:1
    }).addTo(map).bindTooltip(currentCity.name);

    requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
    setTimeout(()=>map.invalidateSize({pan:false,animate:false}),180);
    setTimeout(()=>map.invalidateSize({pan:false,animate:false}),650);
    if(typeof loadRadar==='function') loadRadar();
    return true;
  }

  function rebuildRadarMap(){
    if(radarRebuilt || !radarMoved) return;
    try {
      if(typeof L==='undefined' || typeof map==='undefined') return;
      radarRebuilt=true;
      stopVisualRadar();
      try { if(typeof stopRadarPlay==='function') stopRadarPlay(); } catch(_) {}
      try { if(map) map.remove(); } catch(_) {}
      map=null;
      try { cityMarker=null; } catch(_) {}
      try { radarLayers=[]; radarFrames=[]; radarIndex=0; } catch(_) {}
      const mapEl=$('map');
      if(mapEl){
        mapEl.innerHTML='';
        mapEl.className='';
        if(mapEl._leaflet_id) delete mapEl._leaflet_id;
      }
      requestAnimationFrame(()=>{
        if(!createStableLeafletMap()) radarRebuilt=false;
      });
    } catch(err){
      console.warn('Reconstrução do radar V6',err);
      radarRebuilt=false;
    }
  }

  function installResizeGuard(){
    const card=$('map')?.closest('.radar-card');
    if(!card || card.dataset.resizeGuard) return;
    card.dataset.resizeGuard='1';
    if('ResizeObserver' in window){
      const ro=new ResizeObserver(()=>{
        try { if(typeof map!=='undefined' && map) map.invalidateSize({pan:false,animate:false}); } catch(_) {}
      });
      ro.observe(card);
    }
  }

  function apply(){
    document.body.classList.add('visual-v6');
    ensureRadarIsolation();
    setMetricIcons();
    classifySections();
    reorder();
    updateRiskGauge();
    updateV4Bars();
    updateModelBars();
    improveRadarHeader();
    installRadarControls();
    rebuildRadarMap();
    installResizeGuard();
  }

  const observer=new MutationObserver(()=>requestAnimationFrame(apply));
  const boot=()=>{
    apply();
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    setInterval(apply,1200);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
