(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  let radarMoved = false;
  let visualRadarTimer = null;
  let visualRadarControlsInstalled = false;
  let radarBufferLayers = [];
  let activeRadarBuffer = 0;
  let radarSwitchToken = 0;

  function ensureRadarIsolation(){
    if(!document.getElementById('radarFixCss')){
      const link=document.createElement('link');
      link.id='radarFixCss';
      link.rel='stylesheet';
      link.href='./radarfix.css?v=4';
      document.head.appendChild(link);
    }
    if(!document.getElementById('radarCriticalIsolation')){
      const style=document.createElement('style');
      style.id='radarCriticalIsolation';
      style.textContent=`
        .visual-v6 .radar-card{position:relative!important;overflow:hidden!important;isolation:isolate!important}
        .visual-v6 #map,.visual-v6 #map.leaflet-container{position:relative!important;overflow:hidden!important;isolation:isolate!important;z-index:1!important}
        .visual-v6 .radar-timeline-labels,.visual-v6 .radar-slider,.visual-v6 .radar-controls,.visual-v6 .radar-card>.source-note{position:relative!important;z-index:50!important;background:#061b2e!important}
        .visual-v6 .radar-controls button,.visual-v6 .radar-controls select,.visual-v6 .radar-controls label{position:relative!important;z-index:60!important;pointer-events:auto!important;touch-action:manipulation!important}
        .visual-v6 #map .leaflet-tile-pane{will-change:auto!important}
        .visual-v6 #map .leaflet-tile{backface-visibility:hidden;-webkit-backface-visibility:hidden}
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

  function invalidateRadarMap(){
    try {
      if(typeof map!=='undefined' && map){
        requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
        setTimeout(()=>map.invalidateSize({pan:false,animate:false}),120);
        setTimeout(()=>map.invalidateSize({pan:false,animate:false}),500);
      }
    } catch(_) {}
  }

  function reorder(){
    const official=document.querySelector('.official-card');
    const radar=$('map')?.closest('section');
    if(official && radar && official.nextElementSibling!==radar){
      official.insertAdjacentElement('afterend',radar);
      radarMoved=true;
      invalidateRadarMap();
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

  function radarUrl(frame){
    return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
  }

  function removeAllRadarLayers(){
    try {
      if(typeof radarLayers!=='undefined' && Array.isArray(radarLayers)){
        radarLayers.forEach(layer=>{ try{ if(map?.hasLayer(layer)) map.removeLayer(layer); }catch(_){} });
        radarLayers=[];
      }
    } catch(_) {}
    radarBufferLayers.forEach(layer=>{ try{ if(map?.hasLayer(layer)) map.removeLayer(layer); }catch(_){} });
    radarBufferLayers=[];
  }

  function createRadarBuffer(url, opacity){
    return L.tileLayer(url,{
      tileSize:256,
      opacity,
      zIndex:5,
      maxNativeZoom:7,
      maxZoom:7,
      keepBuffer:2,
      updateWhenIdle:false,
      updateWhenZooming:false,
      attribution:'RainViewer'
    }).addTo(map);
  }

  function installStableRadarEngine(){
    if(typeof L==='undefined' || typeof map==='undefined' || !map) return;

    try { if(typeof stopRadarPlay==='function') stopRadarPlay(); } catch(_) {}
    removeAllRadarLayers();

    try {
      clearRadarLayers = removeAllRadarLayers;
      buildRadarLayers = function(){
        removeAllRadarLayers();
        if(typeof radarFrames==='undefined' || !radarFrames.length || !map) return;
        const current=Math.max(0,Math.min(typeof radarIndex==='number'?radarIndex:radarFrames.length-1,radarFrames.length-1));
        radarBufferLayers=[
          createRadarBuffer(radarUrl(radarFrames[current]),.72),
          createRadarBuffer(radarUrl(radarFrames[current]),0)
        ];
        activeRadarBuffer=0;
        radarLayers=radarBufferLayers;
      };

      showRadarFrame = function(i,keepPlaying=false){
        if(typeof radarFrames==='undefined' || !radarFrames.length || !map) return;
        radarIndex=Math.max(0,Math.min(i,radarFrames.length-1));
        const f=radarFrames[radarIndex];
        const slider=$('radarSlider');
        if(slider) slider.value=radarIndex;
        const stamp=new Date(f.time*1000).toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
        const time=$('radarTime');
        if(time) time.textContent=radarIndex===radarFrames.length-1?stamp+' · mais recente':stamp;

        if(radarBufferLayers.length!==2) buildRadarLayers();
        if(radarBufferLayers.length!==2) return;

        const token=++radarSwitchToken;
        const nextBuffer=activeRadarBuffer===0?1:0;
        const incoming=radarBufferLayers[nextBuffer];
        const outgoing=radarBufferLayers[activeRadarBuffer];
        incoming.setOpacity(0);
        incoming.off('load');
        incoming.once('load',()=>{
          if(token!==radarSwitchToken) return;
          incoming.setOpacity(.72);
          outgoing.setOpacity(0);
          activeRadarBuffer=nextBuffer;
        });
        incoming.setUrl(radarUrl(f),false);

        setTimeout(()=>{
          if(token!==radarSwitchToken) return;
          if(activeRadarBuffer!==nextBuffer){
            incoming.setOpacity(.72);
            outgoing.setOpacity(0);
            activeRadarBuffer=nextBuffer;
          }
        },900);

        if(!keepPlaying) stopVisualRadar();
      };
    } catch(err){ console.warn('Radar estável',err); }

    invalidateRadarMap();
  }

  function stopVisualRadar(){
    if(visualRadarTimer) clearTimeout(visualRadarTimer);
    visualRadarTimer=null;
    const btn=$('radarPlay');
    if(btn) btn.textContent='▶ Animar';
  }

  function scheduleVisualRadar(){
    if(!visualRadarTimer) return;
    const atEnd=radarIndex>=radarFrames.length-1;
    const delay=Math.max(550,Number(typeof radarDelay!=='undefined'?radarDelay:850)||850);
    visualRadarTimer=setTimeout(()=>{
      if(document.hidden){ scheduleVisualRadar(); return; }
      const next=atEnd?0:radarIndex+1;
      showRadarFrame(next,true);
      scheduleVisualRadar();
    },atEnd?Math.max(1500,delay*1.7):delay);
  }

  function startVisualRadar(){
    if(typeof radarFrames==='undefined' || radarFrames.length<2 || typeof showRadarFrame!=='function') return;
    try { if(typeof stopRadarPlay==='function') stopRadarPlay(); } catch(_) {}
    if(radarIndex>=radarFrames.length-1) showRadarFrame(0,true);
    const btn=$('radarPlay');
    if(btn) btn.textContent='⏸ Pausar';
    visualRadarTimer=setTimeout(()=>{
      showRadarFrame(radarIndex>=radarFrames.length-1?0:radarIndex+1,true);
      scheduleVisualRadar();
    },Math.max(550,Number(typeof radarDelay!=='undefined'?radarDelay:850)||850));
  }

  function installRadarControls(){
    if(visualRadarControlsInstalled || !$('radarPlay')) return;
    visualRadarControlsInstalled=true;

    $('radarPlay').addEventListener('click',e=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      if(visualRadarTimer) stopVisualRadar(); else startVisualRadar();
    },true);

    $('radarPrev')?.addEventListener('click',e=>{
      e.preventDefault(); e.stopImmediatePropagation(); stopVisualRadar();
      showRadarFrame(Math.max(0,radarIndex-1),true);
    },true);

    $('radarNext')?.addEventListener('click',e=>{
      e.preventDefault(); e.stopImmediatePropagation(); stopVisualRadar();
      showRadarFrame(Math.min(radarFrames.length-1,radarIndex+1),true);
    },true);

    $('radarSlider')?.addEventListener('input',e=>{
      e.stopImmediatePropagation(); stopVisualRadar(); showRadarFrame(Number(e.target.value),true);
    },true);

    $('radarSpeed')?.addEventListener('change',()=>{
      if(!visualRadarTimer) return;
      stopVisualRadar();
      setTimeout(startVisualRadar,40);
    },true);

    document.addEventListener('visibilitychange',()=>{
      if(document.hidden) stopVisualRadar();
      else invalidateRadarMap();
    });
  }

  function installResizeGuard(){
    const card=$('map')?.closest('.radar-card');
    if(!card || card.dataset.resizeGuard) return;
    card.dataset.resizeGuard='1';
    if('ResizeObserver' in window){
      let pending=false;
      const ro=new ResizeObserver(()=>{
        if(pending) return;
        pending=true;
        requestAnimationFrame(()=>{ pending=false; invalidateRadarMap(); });
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
    installResizeGuard();
  }

  const boot=()=>{
    apply();
    setTimeout(()=>{
      installStableRadarEngine();
      try { if(typeof loadRadar==='function') loadRadar(); } catch(_) {}
    },700);
    setTimeout(invalidateRadarMap,1400);
    const observer=new MutationObserver(()=>requestAnimationFrame(apply));
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
