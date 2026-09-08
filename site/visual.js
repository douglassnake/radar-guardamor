(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  const TILE = 256;
  const ZOOM = 7;
  let stage = null, baseLayer = null, radarA = null, radarB = null, marker = null;
  let front = 'A', ownTimer = null, ownDelay = 850, ownIndex = 0;
  let renderToken = 0, baseKey = '';

  function cityNow(){
    return (typeof currentCity !== 'undefined' && currentCity)
      ? currentCity
      : {name:'Guarda-Mor',lat:-17.770833,lon:-47.097778};
  }

  function setMetricIcons(){
    const icons={tempNow:'🌡️',humidityNow:'💧',windNow:'💨',gustNow:'🌬️',rain6:'🌧️',gust6:'💨',cape6:'⚡',dew6:'💧'};
    Object.entries(icons).forEach(([id,icon])=>{
      const el=$(id)?.closest('.metric');
      if(el) el.dataset.icon=icon;
    });
  }

  function updateRiskGauge(){
    const badge=$('riskBadge');
    const level=Number($('riskLevel')?.textContent);
    if(badge && Number.isFinite(level)) badge.style.setProperty('--gauge-pct',`${clamp(level/4*100)}%`);
  }

  function updateV4Bars(){
    ['v4RainIndex','v4GustIndex','v4ConvIndex','v4Confidence'].forEach(id=>{
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
        .map(x=>parseFloat(x.textContent.replace(',','.'))).filter(Number.isFinite);
      const score=Math.max(clamp((stats[0]||0)/25*100),clamp((stats[1]||0)/70*100),clamp((stats[2]||0)/2500*100));
      card.style.setProperty('--model-width',`${Math.max(10,score)}%`);
    });
  }

  function makeOwnRadarPrimary(){
    const radar=$('map')?.closest('section');
    if(!radar) return;
    radar.classList.add('visual-radar-section','own-radar-section');
    const official=document.querySelector('.official-card');
    if(official && official.nextElementSibling!==radar) official.insertAdjacentElement('afterend',radar);
    const title=radar.querySelector('.section-title h2');
    if(title) title.textContent='Nosso radar em tempo real';
    const card=radar.querySelector('.radar-card');
    if(card && !document.getElementById('ownRadarIdentity')){
      const identity=document.createElement('div');
      identity.id='ownRadarIdentity';
      identity.className='own-radar-identity';
      identity.innerHTML='<div><strong>RADAR GUARDA-MOR</strong><span>visualização própria dentro do aplicativo</span></div><span class="own-radar-live">● AO VIVO</span>';
      card.insertBefore(identity,card.firstChild);
    }
    const source=card?.querySelector('.source-note');
    if(source) source.textContent='Radar próprio do aplicativo. Mapa e animação são renderizados aqui; os ecos de precipitação usam a API RainViewer. SIGMA/FORTRACC ficam apenas como validação oficial opcional.';

    const cptec=$('cptecPanel');
    const cptecTitle=cptec?.querySelector('.section-title h2');
    if(cptecTitle) cptecTitle.textContent='Validação oficial (opcional)';
    const relabel=(id,strongText,spanText)=>{
      const a=$(id); if(!a) return;
      const s=a.querySelector('strong'), p=a.querySelector('span');
      if(s) s.textContent=strongText; if(p) p.textContent=spanText;
    };
    relabel('cptecRadarLink','Validar no SIGMA','abre o radar oficial');
    relabel('cptecFortraccLink','Validar no FORTRACC','trajetória oficial 0–120 min');
    relabel('cptecSigmaLink','Satélite oficial','consulta complementar');

    if(!document.getElementById('ownRadarStyles')){
      const style=document.createElement('style');
      style.id='ownRadarStyles';
      style.textContent=`
        .own-radar-section{margin-top:2px}.own-radar-section .radar-card{overflow:hidden}
        .own-radar-identity{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:linear-gradient(90deg,rgba(7,35,59,.98),rgba(7,27,47,.92));border-bottom:1px solid rgba(51,191,255,.22)}
        .own-radar-identity strong{display:block;font-size:11px;letter-spacing:.8px;color:#dff7ff}.own-radar-identity span{display:block;font-size:9px;color:#82a9c2;margin-top:2px}.own-radar-identity .own-radar-live{margin:0;color:#66e9c1;font-size:9px;font-weight:900;letter-spacing:.5px;white-space:nowrap}
        #map{position:relative;overflow:hidden;background:#142135;isolation:isolate}
        .own-radar-stage,.own-radar-layer{position:absolute;inset:0;overflow:hidden}.own-radar-stage{z-index:1}.own-radar-base{z-index:1}.own-radar-rain{z-index:2;transition:opacity .12s linear;pointer-events:none}.own-radar-tile{position:absolute;width:256px;height:256px;max-width:none!important;display:block;border:0;margin:0;padding:0;transform:none!important}.own-radar-marker{position:absolute;left:50%;top:50%;z-index:5;transform:translate(-50%,-50%);pointer-events:none;text-align:center}.own-radar-dot{width:14px;height:14px;border-radius:50%;background:#14a9ff;border:2px solid #fff;box-shadow:0 0 0 5px rgba(20,169,255,.18);margin:auto}.own-radar-name{display:inline-block;margin-top:7px;padding:3px 7px;border-radius:7px;background:rgba(5,20,35,.88);color:#fff;font-size:10px;font-weight:700;white-space:nowrap}.own-radar-loading{position:absolute;z-index:6;left:50%;top:50%;transform:translate(-50%,-50%);padding:7px 10px;border-radius:9px;background:rgba(5,20,35,.82);color:#cfe9ff;font-size:10px;pointer-events:none}.own-radar-loading[hidden]{display:none}
        #cptecPanel{opacity:.92}
      `;
      document.head.appendChild(style);
    }
  }

  function mercatorTile(lat,lon,z){
    const n=2**z, x=(lon+180)/360*n, phi=lat*Math.PI/180;
    const y=(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*n;
    return {x,y,n};
  }

  function boundsFor(city){
    const host=$('map');
    const w=Math.max(320,host?.clientWidth||680), h=Math.max(280,host?.clientHeight||330);
    const c=mercatorTile(city.lat,city.lon,ZOOM);
    const left=c.x*TILE-w/2, top=c.y*TILE-h/2;
    return {w,h,left,top,x0:Math.floor(left/TILE),x1:Math.floor((left+w)/TILE),y0:Math.floor(top/TILE),y1:Math.floor((top+h)/TILE),n:c.n};
  }

  function tileList(city){
    const b=boundsFor(city), out=[];
    for(let ty=b.y0;ty<=b.y1;ty++){
      if(ty<0||ty>=b.n) continue;
      for(let tx=b.x0;tx<=b.x1;tx++){
        const nx=((tx%b.n)+b.n)%b.n;
        out.push({x:nx,y:ty,left:tx*TILE-b.left,top:ty*TILE-b.top});
      }
    }
    return {b,tiles:out};
  }

  function tileImg(src,t){
    const img=document.createElement('img');
    img.className='own-radar-tile';
    img.alt=''; img.decoding='async'; img.loading='eager'; img.draggable=false;
    img.style.left=`${t.left}px`; img.style.top=`${t.top}px`;
    img.src=src;
    return img;
  }

  function rebuildBase(force=false){
    if(!baseLayer) return;
    const city=cityNow(), host=$('map');
    const key=`${city.id||city.name}|${host?.clientWidth}|${host?.clientHeight}`;
    if(!force && key===baseKey) return;
    baseKey=key; baseLayer.innerHTML='';
    const {tiles}=tileList(city);
    tiles.forEach(t=>{
      const sub='abcd'[(t.x+t.y)%4];
      const primary=`https://${sub}.basemaps.cartocdn.com/light_all/${ZOOM}/${t.x}/${t.y}.png`;
      const fallback=`https://tile.openstreetmap.org/${ZOOM}/${t.x}/${t.y}.png`;
      const img=tileImg(primary,t);
      let triedFallback=false;
      img.onerror=()=>{ if(!triedFallback){triedFallback=true;img.src=fallback;} };
      baseLayer.appendChild(img);
    });
    if(marker){
      const name=marker.querySelector('.own-radar-name');
      if(name) name.textContent=city.name||'Guarda-Mor';
    }
  }

  function loadRadarTile(url,t,layer){
    return new Promise(resolve=>{
      const img=tileImg(url,t);
      let done=false;
      const finish=ok=>{if(done)return;done=true;resolve(ok);};
      img.onload=()=>finish(true);
      img.onerror=()=>{img.remove();finish(false);};
      layer.appendChild(img);
      setTimeout(()=>finish(false),7000);
    });
  }

  async function renderOwnRadarFrame(index,keepPlaying=false){
    const frames=(typeof radarFrames!=='undefined'&&Array.isArray(radarFrames))?radarFrames:[];
    if(!stage||!frames.length) return;
    const token=++renderToken;
    ownIndex=Math.max(0,Math.min(Number(index)||0,frames.length-1));
    try{ radarIndex=ownIndex; }catch(_){}
    rebuildBase();
    const city=cityNow(), {tiles}=tileList(city), f=frames[ownIndex];
    const target=front==='A'?radarB:radarA;
    const visible=front==='A'?radarA:radarB;
    target.innerHTML=''; target.style.opacity='0';
    const loading=$('ownRadarLoading'); if(loading) loading.hidden=false;
    const jobs=tiles.map(t=>loadRadarTile(`${f.host}${f.path}/256/${ZOOM}/${t.x}/${t.y}/2/1_0.png`,t,target));
    const results=await Promise.all(jobs);
    if(token!==renderToken) return;
    const ok=results.filter(Boolean).length;
    target.style.opacity='.76'; visible.style.opacity='0'; front=front==='A'?'B':'A';
    if(loading) loading.hidden=true;
    const slider=$('radarSlider'); if(slider) slider.value=ownIndex;
    const stamp=new Date(f.time*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const time=$('radarTime');
    if(time) time.textContent=ok?`${stamp}${ownIndex===frames.length-1?' · mais recente':''}`:`${stamp} · ecos indisponíveis`;
    if(!keepPlaying) stopOwnRadar();
  }

  async function ownLoadRadar(){
    const time=$('radarTime'); if(time) time.textContent='atualizando nosso radar…';
    try{
      const j=await fetchJSON('https://api.rainviewer.com/public/weather-maps.json',10000);
      const frames=(j.radar?.past||[]).map(f=>({...f,host:j.host}));
      if(!frames.length) throw new Error('Sem quadros de radar');
      radarFrames=frames; ownIndex=frames.length-1; radarIndex=ownIndex;
      const slider=$('radarSlider'); if(slider){slider.max=frames.length-1;slider.value=ownIndex;}
      if($('radarStart')) $('radarStart').textContent=new Date(frames[0].time*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      if($('radarEnd')) $('radarEnd').textContent=new Date(frames.at(-1).time*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' · mais recente';
      await renderOwnRadarFrame(ownIndex,true);
      prefetchOwnRadar();
    }catch(e){
      console.warn('Nosso radar',e);
      const loading=$('ownRadarLoading'); if(loading){loading.hidden=false;loading.textContent='Fonte de radar indisponível';}
      if(time) time.textContent='nosso radar temporariamente indisponível';
    }
  }

  function prefetchOwnRadar(){
    const frames=radarFrames||[]; if(frames.length<2) return;
    const {tiles}=tileList(cityNow());
    [ownIndex-1,ownIndex-2,0].filter(i=>i>=0&&frames[i]).forEach(i=>{
      const f=frames[i];
      tiles.forEach(t=>{const img=new Image();img.src=`${f.host}${f.path}/256/${ZOOM}/${t.x}/${t.y}/2/1_0.png`;});
    });
  }

  function stopOwnRadar(){
    if(ownTimer) clearTimeout(ownTimer);
    ownTimer=null; if($('radarPlay')) $('radarPlay').textContent='▶ Animar';
  }

  function scheduleOwnRadar(){
    if(!ownTimer) return;
    const frames=radarFrames||[]; if(frames.length<2){stopOwnRadar();return;}
    const atEnd=ownIndex>=frames.length-1;
    ownTimer=setTimeout(async()=>{
      if(document.hidden){scheduleOwnRadar();return;}
      await renderOwnRadarFrame(atEnd?0:ownIndex+1,true); scheduleOwnRadar();
    },atEnd?Math.max(1500,ownDelay*1.8):ownDelay);
  }

  function toggleOwnRadar(){
    if(ownTimer){stopOwnRadar();return;}
    const frames=radarFrames||[]; if(frames.length<2) return;
    if($('radarPlay')) $('radarPlay').textContent='⏸ Pausar';
    ownTimer=setTimeout(async()=>{await renderOwnRadarFrame(ownIndex>=frames.length-1?0:ownIndex+1,true);scheduleOwnRadar();},ownDelay);
  }

  function installOwnRadar(){
    if(stage) return;
    const host=$('map'); if(!host) return;
    try{ if(typeof map!=='undefined'&&map?.remove) map.remove(); }catch(_){}
    try{ map=null;cityMarker=null;radarLayers=[]; }catch(_){}
    host.innerHTML='';
    stage=document.createElement('div'); stage.className='own-radar-stage';
    baseLayer=document.createElement('div'); baseLayer.className='own-radar-layer own-radar-base';
    radarA=document.createElement('div'); radarA.className='own-radar-layer own-radar-rain'; radarA.style.opacity='1';
    radarB=document.createElement('div'); radarB.className='own-radar-layer own-radar-rain'; radarB.style.opacity='0';
    marker=document.createElement('div'); marker.className='own-radar-marker'; marker.innerHTML='<div class="own-radar-dot"></div><div class="own-radar-name">Guarda-Mor</div>';
    const loading=document.createElement('div'); loading.id='ownRadarLoading'; loading.className='own-radar-loading'; loading.textContent='Carregando radar…';
    stage.append(baseLayer,radarA,radarB,marker,loading); host.appendChild(stage);
    rebuildBase(true);

    try{
      loadRadar=ownLoadRadar;
      buildRadarLayers=()=>{};
      clearRadarLayers=()=>{};
      showRadarFrame=(i,keep=false)=>renderOwnRadarFrame(i,keep);
      toggleRadarPlay=toggleOwnRadar;
      stopRadarPlay=stopOwnRadar;
    }catch(_){}

    const intercept=(id,fn)=>$(id)?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();fn();},true);
    intercept('radarPlay',toggleOwnRadar);
    intercept('radarPrev',()=>{stopOwnRadar();renderOwnRadarFrame(Math.max(0,ownIndex-1));});
    intercept('radarNext',()=>{stopOwnRadar();renderOwnRadarFrame(Math.min((radarFrames?.length||1)-1,ownIndex+1));});
    $('radarSlider')?.addEventListener('input',e=>{e.stopImmediatePropagation();stopOwnRadar();renderOwnRadarFrame(Number(e.target.value));},true);
    $('radarSpeed')?.addEventListener('change',e=>{ownDelay=Number(e.target.value)||850;if(ownTimer){stopOwnRadar();toggleOwnRadar();}},true);
    if('ResizeObserver' in window) new ResizeObserver(()=>{rebuildBase(true);renderOwnRadarFrame(ownIndex,true);}).observe(host);
    setInterval(ownLoadRadar,10*60*1000);
    ownLoadRadar();
    setTimeout(ownLoadRadar,1800);
  }

  function applyVisuals(){
    document.body.classList.add('visual-v6');
    setMetricIcons(); makeOwnRadarPrimary(); updateRiskGauge(); updateV4Bars(); updateModelBars();
    const now=$('tempNow')?.closest('section'); if(now) now.classList.add('visual-now-section');
    const next=$('rain6')?.closest('section'); if(next) next.classList.add('visual-next-section');
    const models=$('models')?.closest('section'); if(models) models.classList.add('visual-model-section');
    const cities=$('cityOverview')?.closest('section'); if(cities) cities.classList.add('visual-city-section');
  }

  const boot=()=>{
    document.getElementById('radarFixCss')?.remove();
    document.getElementById('radarCriticalIsolation')?.remove();
    applyVisuals(); installOwnRadar();
    const observer=new MutationObserver(()=>requestAnimationFrame(applyVisuals));
    observer.observe(document.body,{subtree:true,childList:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
