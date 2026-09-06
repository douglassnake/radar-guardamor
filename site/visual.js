(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  let radarFixInstalled = false;
  let activeRadarLayer = null;
  let radarFrameSeq = 0;

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
      if (typeof map !== 'undefined' && map) {
        requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
        setTimeout(()=>map.invalidateSize({pan:false,animate:false}),180);
      }
    } catch (_) {}
  }

  function reorder(){
    let moved=false;
    const official=document.querySelector('.official-card');
    const radar=$('map')?.closest('section');
    if(official && radar && official.nextElementSibling!==radar){
      official.insertAdjacentElement('afterend',radar);
      moved=true;
    }

    const models=$('models')?.closest('section');
    const cptec=$('cptecPanel');
    if(models && cptec && models.nextElementSibling!==cptec){
      models.insertAdjacentElement('afterend',cptec);
      moved=true;
    }
    if(moved) invalidateRadarMap();
  }

  function updateRiskGauge(){
    const badge=$('riskBadge');
    const level=Number($('riskLevel')?.textContent);
    if(!badge || !Number.isFinite(level)) return;
    badge.style.setProperty('--gauge-pct',`${clamp(level/4*100)}%`);
    const eyebrow=document.querySelector('.risk-copy .eyebrow');
    if(eyebrow) eyebrow.textContent='RISCO NUMÉRICO V5 • 6 H';
  }

  function updateV4Bars(){
    const ids=['v4RainIndex','v4GustIndex','v4ConvIndex','v4Confidence'];
    ids.forEach(id=>{
      const value=parseFloat($(id)?.textContent?.replace(',','.'));
      const card=$(id)?.closest('.v4-index');
      if(card && Number.isFinite(value)) card.style.setProperty('--visual-pct',clamp(value));
    });
    const title=$('v4Panel')?.querySelector('.section-title h2');
    if(title) title.textContent='Análise numérica V5';
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
    if(title) title.textContent='Radar em tempo real';
    const end=$('radarEnd');
    if(end && !end.dataset.visual) end.dataset.visual='1';
  }

  function radarTileUrl(frame){
    return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
  }

  function removeRadarLayer(layer){
    try {
      if(layer && typeof map!=='undefined' && map?.hasLayer(layer)) map.removeLayer(layer);
    } catch (_) {}
  }

  function makeRadarLayer(index){
    if(!radarFrames?.[index] || typeof L==='undefined' || typeof map==='undefined' || !map) return null;
    const existing=radarLayers?.[index];
    if(existing) return existing;
    const frame=radarFrames[index];
    const layer=L.tileLayer(radarTileUrl(frame),{
      tileSize:256,
      opacity:.001,
      zIndex:5,
      maxNativeZoom:7,
      maxZoom:9,
      keepBuffer:2,
      updateWhenIdle:true,
      updateWhenZooming:false,
      crossOrigin:true,
      attribution:'RainViewer'
    });
    layer.__radarReady=false;
    layer.on('load',()=>{ layer.__radarReady=true; });
    layer.addTo(map);
    radarLayers[index]=layer;
    return layer;
  }

  function pruneRadarLayers(keepIndexes){
    const keep=new Set(keepIndexes.filter(i=>i>=0));
    radarLayers.forEach((layer,idx)=>{
      if(layer && !keep.has(idx)){
        removeRadarLayer(layer);
        radarLayers[idx]=null;
      }
    });
  }

  function installRadarFix(){
    if(radarFixInstalled) return;
    try {
      if(typeof L==='undefined' || typeof loadRadar!=='function' || typeof showRadarFrame!=='function') return;
    } catch (_) { return; }
    radarFixInstalled=true;

    clearRadarLayers=function(){
      try { (radarLayers||[]).forEach(removeRadarLayer); } catch (_) {}
      radarLayers=[];
      activeRadarLayer=null;
      radarFrameSeq++;
    };

    buildRadarLayers=function(){
      clearRadarLayers();
      radarLayers=new Array(radarFrames.length).fill(null);
      if(radarFrames.length){
        makeRadarLayer(radarFrames.length-1);
        if(radarFrames.length>1) makeRadarLayer(0);
      }
      invalidateRadarMap();
    };

    showRadarFrame=function(i,keepPlaying=false){
      if(!radarFrames.length || typeof map==='undefined' || !map) return;
      radarIndex=Math.max(0,Math.min(Number(i)||0,radarFrames.length-1));
      const seq=++radarFrameSeq;
      const target=makeRadarLayer(radarIndex);
      if(!target) return;

      const frame=radarFrames[radarIndex];
      if($('radarSlider')) $('radarSlider').value=radarIndex;
      const stamp=new Date(frame.time*1000).toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
      if($('radarTime')) $('radarTime').textContent=`${stamp}${radarIndex===radarFrames.length-1?' · mais recente':''}`;

      const commit=()=>{
        if(seq!==radarFrameSeq) return;
        const previous=activeRadarLayer;
        target.setOpacity(.74);
        activeRadarLayer=target;
        if(previous && previous!==target) previous.setOpacity(0);

        const nextIndex=radarIndex>=radarFrames.length-1?0:radarIndex+1;
        const previousIndex=radarIndex<=0?radarFrames.length-1:radarIndex-1;
        makeRadarLayer(nextIndex);
        pruneRadarLayers([radarIndex,nextIndex,previousIndex]);
        invalidateRadarMap();
      };

      if(target.__radarReady) commit();
      else {
        target.once('load',commit);
        setTimeout(commit,1300);
      }
      if(!keepPlaying) stopRadarPlay();
    };

    scheduleRadarFrame=function(){
      if(!radarTimer || radarFrames.length<2) return;
      const atEnd=radarIndex>=radarFrames.length-1;
      const wait=atEnd?Math.max(1500,radarDelay*1.7):Math.max(500,radarDelay);
      radarTimer=setTimeout(()=>{
        if(!radarTimer) return;
        showRadarFrame(atEnd?0:radarIndex+1,true);
        scheduleRadarFrame();
      },wait);
    };

    window.addEventListener('resize',invalidateRadarMap,{passive:true});
    window.addEventListener('orientationchange',()=>setTimeout(invalidateRadarMap,250),{passive:true});
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden) setTimeout(invalidateRadarMap,120);
    });

    setTimeout(()=>{
      invalidateRadarMap();
      try { loadRadar(); } catch (_) {}
    },250);
  }

  function apply(){
    document.body.classList.add('visual-v6');
    setMetricIcons();
    classifySections();
    reorder();
    updateRiskGauge();
    updateV4Bars();
    updateModelBars();
    improveRadarHeader();
    installRadarFix();
  }

  const observer=new MutationObserver(()=>requestAnimationFrame(apply));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{
    apply();
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
  },{once:true});
  else {
    apply();
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
  }
})();
