(() => {
  const $ = id => document.getElementById(id);
  const clamp = (v,a=0,b=100) => Math.max(a,Math.min(b,Number(v)||0));

  function setMetricIcons(){
    const icons={tempNow:'🌡️',humidityNow:'💧',windNow:'💨',gustNow:'🌬️',rain6:'🌧️',gust6:'💨',cape6:'⚡',dew6:'💧'};
    Object.entries(icons).forEach(([id,icon])=>{
      const el=$(id)?.closest('.metric');
      if(el) el.dataset.icon=icon;
    });
  }

  function classifySections(){
    const map=$('map')?.closest('section'); if(map) map.classList.add('visual-radar-section');
    const now=$('tempNow')?.closest('section'); if(now) now.classList.add('visual-now-section');
    const next=$('rain6')?.closest('section'); if(next) next.classList.add('visual-next-section');
    const models=$('models')?.closest('section'); if(models) models.classList.add('visual-model-section');
    const cities=$('cityOverview')?.closest('section'); if(cities) cities.classList.add('visual-city-section');
  }

  function reorder(){
    const official=document.querySelector('.official-card');
    const radar=$('map')?.closest('section');
    if(official && radar && official.nextElementSibling!==radar) official.insertAdjacentElement('afterend',radar);

    const models=$('models')?.closest('section');
    const cptec=$('cptecPanel');
    if(models && cptec && models.nextElementSibling!==cptec) models.insertAdjacentElement('afterend',cptec);
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
    if(end && !end.dataset.visual){ end.dataset.visual='1'; }
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
  }

  const observer=new MutationObserver(()=>requestAnimationFrame(apply));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{
    apply(); observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
  },{once:true});
  else {
    apply(); observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
  }
})();
