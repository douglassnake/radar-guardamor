#!/usr/bin/env python3
from pathlib import Path
import re

# V4 passa a aceitar pesos oficiais do servidor V5 quando estiverem ativos.
p=Path('site/v4.js'); text=p.read_text(encoding='utf-8')
marker='''    const base = normalise(BASE_WEIGHTS[metric] || BASE_WEIGHTS.dew, names);\n'''
extra='''    const external = window.RADAR_V5_WEIGHTS?.[city.id]?.[metric];\n    if (external?.active && external.values) return normalise(external.values, names);\n'''
if extra not in text:
    if marker not in text: raise SystemExit('weightsFor não localizado em v4.js')
    text=text.replace(marker,marker+extra,1)
p.write_text(text,encoding='utf-8')

# Carrega o módulo V5 depois do V4 e mantém a explicação idempotente.
p=Path('site/index.html'); text=p.read_text(encoding='utf-8')
if '<script src="./v5.js"></script>' not in text:
    text=text.replace('  <script src="./v4.js"></script>','  <script src="./v4.js"></script>\n  <script src="./v5.js"></script>',1)
text=text.replace('motor numérico V4','motor numérico V5')
text=text.replace('<h2>Índice meteorológico V4</h2>','<h2>Índice meteorológico V5</h2>')
base_note='Radar/nowcasting CPTEC/INPE continua como camada de validação separada e avisos oficiais sempre prevalecem.'
v5_note='A V5 acrescenta climatologia IDF oficial e skill persistente no servidor. Pesos externos só entram no índice quando houver observações oficiais suficientes.'
while f'{v5_note} {v5_note}' in text:
    text=text.replace(f'{v5_note} {v5_note}',v5_note)
if f'{v5_note} {base_note}' not in text:
    text=text.replace(base_note,f'{v5_note} {base_note}',1)
p.write_text(text,encoding='utf-8')

# Estilos V5.
p=Path('site/styles.css'); text=p.read_text(encoding='utf-8')
css='''\n/* V5: calibração persistente e climatologia oficial */\n.v5-panel { border-color: rgba(50,213,131,.22); }\n.v5-source { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin:2px 0 12px; padding:10px 11px; border-radius:13px; background:rgba(255,255,255,.035); border:1px solid var(--line); }\n.v5-source strong { font-size:11px; white-space:nowrap; }\n.v5-source span { color:var(--muted); font-size:10px; text-align:right; line-height:1.35; }\n.v5-idf { margin:10px 0 14px; padding:11px; border-radius:13px; background:var(--panel2); border:1px solid var(--line); }\n.v5-idf strong,.v5-idf span,.v5-idf code { display:block; }\n.v5-idf strong { font-size:12px; }\n.v5-idf span { color:var(--muted); font-size:10px; margin:3px 0 7px; }\n.v5-idf code { font-size:10px; color:#b8d7ff; overflow-wrap:anywhere; }\n.v5-kind { display:block; color:var(--muted); font-size:8px; font-weight:500; margin-top:2px; }\n.v5-panel .v4-weight-wrap { overflow-x:auto; }\n.v5-panel table { min-width:650px; }\n@media (max-width:390px) { .v5-source { display:block; } .v5-source span { text-align:left; margin-top:4px; display:block; } }\n'''
if '/* V5: calibração persistente' not in text:
    text += css
p.write_text(text,encoding='utf-8')

# Atualiza shell/cache PWA preservando a camada visual V6 e o isolamento rígido do radar.
p=Path('site/sw.js'); text=p.read_text(encoding='utf-8')
visual = Path('site/visual.js').exists() and Path('site/visual.css').exists()
radarfix = Path('site/radarfix.css').exists()
cache_name = 'radar-gm-v6-radarfix3' if visual and radarfix else ('radar-gm-v6-visual' if visual else 'radar-gm-v5-calibracao')
text=re.sub(r"const CACHE = '[^']+';",f"const CACHE = '{cache_name}';",text,count=1)

required = ["'./v5.js'", "'./data/guardamor/v5.json'"]
if visual:
    required += ["'./visual.css'", "'./visual.js'"]
if radarfix:
    required += ["'./radarfix.css'"]

for item in required:
    if item in text:
        continue
    if "'./manifest.webmanifest'" not in text:
        raise SystemExit('Lista SHELL não reconhecida em sw.js')
    text=text.replace("'./manifest.webmanifest'",f"{item}, './manifest.webmanifest'",1)

p.write_text(text,encoding='utf-8')

print(f'V5 instalado/atualizado com sucesso • cache {cache_name}')
