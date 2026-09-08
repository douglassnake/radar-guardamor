(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));
  const TILE = 256;
  const ZOOM = 7;
  let canvas = null, ctx = null, canvasReady = false;
  let canvasTimer = null, canvasDelay = 850, canvasIndex = 0;
  const imageCache = new Map();

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
      const stats=[...card.querySelectorAll('.model-stat strong')].map(x=>parseFloat(x.textContent.replace(',','.'))).filter(Number.isFinite);
      const rain=stats[0]||0, gust=stats[1]||0, cape=stats[2]||0;
      const score=Math.max(clamp(rain/25*100),clamp(gust/70*100),clamp(cape/2500*100));
      card.style.setProperty('--model-width',`${Math.max(10,score)}%`);
    });
  }

  function improveRadarHeader(){
    const title=$('map')?.closest('section')?.querySelector('.section-title h2');
    if(title) title.textContent='Radar em tempo real';
  }

  function mercatorTile(lat, lon, z){
    const n=2**z;
    const x=(lon+180)/360*n;
    const phi=lat*Math.PI/180;
    const y=(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*n;
    return {x,y,n};
  }

  function loadImage(url, fallback){
    const key=url+'|'+(fallback||'');
    if(imageCache.has(key)) return imageCache.get(key);
    const p=new Promise(resolve=>{
      const img=new Image();
      img.decoding='async';
      img.onload=()=>resolve(img);
      img.onerror=()=>{
        if(!fallback){ resolve(null); return; }
        const img2=new Image();
        img2.decoding='async';
        img2.onload=()=>resolve(img2);
        img2.onerror=()=>resolve(null);
        img2.src=fallback;
      };
      img.src=url;
    });
    imageCache.set(key,p);
    return p;
  }

  function tileBounds(city){
    const cssW=Math.max(320,$('map').clientWidth||680);
    const cssH=Math.max(280,$('map').clientHeight||330);
    const c=mercatorTile(city.lat,city.lon,ZOOM);
    const centerPxX=c.x*TILE, centerPxY=c.y*TILE;
    const left=centerPxX-cssW/2, top=centerPxY-cssH/2;
    const x0=Math.floor(left/TILE), x1=Math.floor((left+cssW)/TILE);
    const y0=Math.floor(top/TILE), y1=Math.floor((top+cssH)/TILE);
    return {cssW,cssH,left,top,x0,x1,y0,y1,n:c.n};
  }

  function fitCanvas(){
    if(!canvas) return;
    const host=$('map');
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(320,host.clientWidth||680), h=Math.max(280,host.clientHeight||330);
    canvas.style.width=w+'px'; canvas.style.height=h+'px';
    if(canvas.width!==Math.round(w*dpr) || canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
      ctx=canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.imageSmoothingEnabled=true;
    }
  }

  async function renderCanvasFrame(index){
    if(!canvasReady || !canvas || !ctx) return;
    const city=(typeof currentCity!=='undefined' && currentCity) ? currentCity : {name:'Guarda-Mor',lat:-17.770833,lon:-47.097778};
    fitCanvas();
    const b=tileBounds(city);
    ctx.clearRect(0,0,b.cssW,b.cssH);
    ctx.fillStyle='#152033'; ctx.fillRect(0,0,b.cssW,b.cssH);

    const jobs=[];
    for(let ty=b.y0;ty<=b.y1;ty++){
      if(ty<0 || ty>=b.n) continue;
      for(let tx=b.x0;tx<=b.x1;tx++){
        const nx=((tx%b.n)+b.n)%b.n;
        const dx=tx*TILE-b.left, dy=ty*TILE-b.top;
        const sub='abcd'[(nx+ty)%4];
        const carto=`https://${sub}.basemaps.cartocdn.com/light_all/${ZOOM}/${nx}/${ty}.png`;
        const osm=`https://tile.openstreetmap.org/${ZOOM}/${nx}/${ty}.png`;
        jobs.push(loadImage(carto,osm).then(img=>({img,dx,dy,nx,ty})));
      }
    }
    const base=await Promise.all(jobs);
    base.forEach(t=>{ if(t.img) ctx.drawImage(t.img,t.dx,t.dy,TILE,TILE); });

    const frames=(typeof radarFrames!=='undefined' && Array.isArray(radarFrames)) ? radarFrames : [];
    if(frames.length){
      canvasIndex=Math.max(0,Math.min(index,frames.length-1));
      const f=frames[canvasIndex];
      const rjobs=[];
      for(let ty=b.y0;ty<=b.y1;ty++){
        if(ty<0 || ty>=b.n) continue;
        for(let tx=b.x0;tx<=b.x1;tx++){
          const nx=((tx%b.n)+b.n)%b.n;
          const dx=tx*TILE-b.left, dy=ty*TILE-b.top;
          const url=`${f.host}${f.path}/256/${ZOOM}/${nx}/${ty}/2/1_0.png`;
          rjobs.push(loadImage(url).then(img=>({img,dx,dy})));
        }
      }
      const radar=await Promise.all(rjobs);
      ctx.save(); ctx.globalAlpha=.72;
      radar.forEach(t=>{ if(t.img) ctx.drawImage(t.img,t.dx,t.dy,TILE,TILE); });
      ctx.restore();

      const slider=$('radarSlider'); if(slider) slider.value=canvasIndex;
      const stamp=new Date(f.time*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      const time=$('radarTime'); if(time) time.textContent=canvasIndex===frames.length-1?stamp+' · mais recente':stamp;
    }

    const cx=b.cssW/2, cy=b.cssH/2;
    ctx.beginPath(); ctx.arc(cx,cy,6,0,Math.PI*2); ctx.fillStyle='#1977e9'; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke();
  }

  async function canvasLoadRadar(){
    const time=$('radarTime'); if(time) time.textContent='atualizando radar…';
    try{
      const j=await fetchJSON('https://api.rainviewer.com/public/weather-maps.json',10000);
      radarFrames=(j.radar?.past||[]).map(f=>({...f,host:j.host}));
      if(!radarFrames.length) throw new Error('Sem quadros de radar');
      canvasIndex=radarFrames.length-1;
      radarIndex=canvasIndex;
      const slider=$('radarSlider');
      if(slider){ slider.max=radarFrames.length-1; slider.value=canvasIndex; }
      if($('radarStart')) $('radarStart').textContent=new Date(radarFrames[0].time*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      if($('radarEnd')) $('radarEnd').textContent=new Date(radarFrames.at(-1).time*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' · mais recente';
      await renderCanvasFrame(canvasIndex);
      prefetchAdjacent();
    }catch(e){ console.warn('Radar Canvas',e); if(time) time.textContent='radar temporariamente indisponível'; }
  }

  function prefetchAdjacent(){
    const frames=radarFrames||[];
    if(frames.length<2) return;
    const city=(typeof currentCity!=='undefined'&&currentCity)?currentCity:{lat:-17.770833,lon:-47.097778};
    const b=tileBounds(city);
    [canvasIndex-1,canvasIndex-2,0].filter(i=>i>=0&&frames[i]).forEach(i=>{
      const f=frames[i];
      for(let ty=b.y0;ty<=b.y1;ty++) for(let tx=b.x0;tx<=b.x1;tx++){
        if(ty<0||ty>=b.n) continue;
        const nx=((tx%b.n)+b.n)%b.n;
        loadImage(`${f.host}${f.path}/256/${ZOOM}/${nx}/${ty}/2/1_0.png`);
      }
    });
  }

  function stopCanvas(){
    if(canvasTimer) clearTimeout(canvasTimer);
    canvasTimer=null;
    if($('radarPlay')) $('radarPlay').textContent='▶ Animar';
  }

  function scheduleCanvas(){
    if(!canvasTimer) return;
    const frames=radarFrames||[];
    if(frames.length<2){ stopCanvas(); return; }
    const atEnd=canvasIndex>=frames.length-1;
    canvasTimer=setTimeout(async()=>{
      if(document.hidden){ scheduleCanvas(); return; }
      canvasIndex=atEnd?0:canvasIndex+1; radarIndex=canvasIndex;
      await renderCanvasFrame(canvasIndex);
      scheduleCanvas();
    },atEnd?Math.max(1500,canvasDelay*1.8):canvasDelay);
  }

  function startCanvas(){
    const frames=radarFrames||[];
    if(frames.length<2) return;
    if(canvasTimer){ stopCanvas(); return; }
    if($('radarPlay')) $('radarPlay').textContent='⏸ Pausar';
    canvasTimer=setTimeout(async()=>{
      canvasIndex=canvasIndex>=frames.length-1?0:canvasIndex+1; radarIndex=canvasIndex;
      await renderCanvasFrame(canvasIndex);
      scheduleCanvas();
    },canvasDelay);
  }

  function installCanvasRadar(){
    if(canvasReady) return;
    const host=$('map'); if(!host) return;
    try{ if(typeof map!=='undefined' && map?.remove) map.remove(); }catch(_){}
    try{ map=null; cityMarker=null; radarLayers=[]; }catch(_){}
    host.innerHTML='';
    host.style.position='relative';
    host.style.overflow='hidden';
    canvas=document.createElement('canvas');
    canvas.setAttribute('aria-label','Radar meteorológico observado');
    canvas.style.display='block';
    canvas.style.width='100%';
    canvas.style.height='100%';
    host.appendChild(canvas);
    canvasReady=true;

    try{
      loadRadar=canvasLoadRadar;
      showRadarFrame=(i,keepPlaying=false)=>{ canvasIndex=i; radarIndex=i; renderCanvasFrame(i); if(!keepPlaying) stopCanvas(); };
      toggleRadarPlay=startCanvas;
      stopRadarPlay=stopCanvas;
    }catch(_){}

    const intercept=(id,fn)=>$(id)?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();fn();},true);
    intercept('radarPlay',startCanvas);
    intercept('radarPrev',()=>{stopCanvas();canvasIndex=Math.max(0,canvasIndex-1);radarIndex=canvasIndex;renderCanvasFrame(canvasIndex);});
    intercept('radarNext',()=>{stopCanvas();canvasIndex=Math.min((radarFrames?.length||1)-1,canvasIndex+1);radarIndex=canvasIndex;renderCanvasFrame(canvasIndex);});
    $('radarSlider')?.addEventListener('input',e=>{e.stopImmediatePropagation();stopCanvas();canvasIndex=Number(e.target.value);radarIndex=canvasIndex;renderCanvasFrame(canvasIndex);},true);
    $('radarSpeed')?.addEventListener('change',e=>{canvasDelay=Number(e.target.value)||850;if(canvasTimer){stopCanvas();startCanvas();}},true);
    new ResizeObserver(()=>renderCanvasFrame(canvasIndex)).observe(host);
    setInterval(canvasLoadRadar,10*60*1000);
    canvasLoadRadar();
  }

  function apply(){
    document.body.classList.add('visual-v6');
    setMetricIcons(); classifySections(); updateRiskGauge(); updateV4Bars(); updateModelBars(); improveRadarHeader();
  }

  const boot=()=>{
    document.getElementById('radarFixCss')?.remove();
    document.getElementById('radarCriticalIsolation')?.remove();
    apply();
    installCanvasRadar();
    const observer=new MutationObserver(()=>requestAnimationFrame(apply));
    observer.observe(document.body,{subtree:true,childList:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
