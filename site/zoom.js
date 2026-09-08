(() => {
  const MIN_SCALE = 1;
  const MAX_SCALE = 2.25;
  const STEP = 0.25;
  let scale = 1;

  const $ = id => document.getElementById(id);

  function ensureStyles() {
    if (document.getElementById('radarZoomStyles')) return;
    const style = document.createElement('style');
    style.id = 'radarZoomStyles';
    style.textContent = `
      .radar-zoom-controls{position:absolute;z-index:20;right:10px;top:10px;display:flex;align-items:center;gap:4px;padding:4px;border-radius:12px;background:rgba(5,20,35,.86);border:1px solid rgba(120,200,255,.28);box-shadow:0 5px 18px rgba(0,0,0,.24);backdrop-filter:blur(8px)}
      .radar-zoom-btn,.radar-zoom-level{height:32px;min-width:34px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;font-size:16px;display:grid;place-items:center}
      .radar-zoom-btn{cursor:pointer}.radar-zoom-btn:hover{background:rgba(35,184,255,.24)}.radar-zoom-btn:active{transform:scale(.94)}
      .radar-zoom-btn:disabled{opacity:.35;cursor:default}.radar-zoom-level{min-width:46px;font-size:10px;color:#b9d7ea;cursor:pointer}
      .own-radar-base,.own-radar-rain{transform-origin:50% 50%;will-change:transform;transition:transform .18s ease}
      @media(max-width:520px){.radar-zoom-controls{right:7px;top:7px}.radar-zoom-btn,.radar-zoom-level{height:30px;min-width:31px}.radar-zoom-level{min-width:43px}}
    `;
    document.head.appendChild(style);
  }

  function applyScale() {
    document.querySelectorAll('.own-radar-base,.own-radar-rain').forEach(layer => {
      layer.style.transform = `scale(${scale})`;
    });
    const level = $('radarZoomLevel');
    if (level) level.textContent = `${scale.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`;
    if ($('radarZoomOut')) $('radarZoomOut').disabled = scale <= MIN_SCALE;
    if ($('radarZoomIn')) $('radarZoomIn').disabled = scale >= MAX_SCALE;
  }

  function setScale(next) {
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(next * 100) / 100));
    applyScale();
  }

  function install() {
    ensureStyles();
    const map = $('map');
    if (!map) return;
    if (!map.style.position) map.style.position = 'relative';
    if (!$('radarZoomControls')) {
      const controls = document.createElement('div');
      controls.id = 'radarZoomControls';
      controls.className = 'radar-zoom-controls';
      controls.setAttribute('aria-label', 'Zoom do radar');
      controls.innerHTML = `
        <button id="radarZoomOut" class="radar-zoom-btn" type="button" aria-label="Diminuir zoom">−</button>
        <button id="radarZoomLevel" class="radar-zoom-level" type="button" aria-label="Restaurar zoom">1×</button>
        <button id="radarZoomIn" class="radar-zoom-btn" type="button" aria-label="Aumentar zoom">+</button>
      `;
      map.appendChild(controls);
      $('radarZoomOut').addEventListener('click', () => setScale(scale - STEP));
      $('radarZoomIn').addEventListener('click', () => setScale(scale + STEP));
      $('radarZoomLevel').addEventListener('click', () => setScale(1));
    }
    applyScale();
  }

  const observer = new MutationObserver(() => {
    const map = $('map');
    if (!map) return;
    if (!$('radarZoomControls') || !document.querySelector('.own-radar-base')) install();
    else applyScale();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      install();
      observer.observe(document.body, {subtree:true, childList:true});
    }, {once:true});
  } else {
    install();
    observer.observe(document.body, {subtree:true, childList:true});
  }
})();
