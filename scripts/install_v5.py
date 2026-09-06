#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(encoding='utf-8')
    if new in text:
        return False
    if old not in text:
        raise SystemExit(f'Marcador não encontrado em {path}')
    p.write_text(text.replace(old,new,1),encoding='utf-8')
    return True

# V4 passa a aceitar pesos oficiais do servidor V5 quando estiverem ativos.
p=Path('site/v4.js'); text=p.read_text(encoding='utf-8')
marker='''    const base = normalise(BASE_WEIGHTS[metric] || BASE_WEIGHTS.dew, names);\n'''
extra='''    const external = window.RADAR_V5_WEIGHTS?.[city.id]?.[metric];\n    if (external?.active && external.values) return normalise(external.values, names);\n'''
if extra not in text:
    if marker not in text: raise SystemExit('weightsFor não localizado em v4.js')
    text=text.replace(marker,marker+extra,1)
p.write_text(text,encoding='utf-8')

# Carrega o módulo V5 depois do V4.
p=Path('site/index.html'); text=p.read_text(encoding='utf-8')
if '<script src="./v5.js"></script>' not in text:
    text=text.replace('  <script src="./v4.js"></script>','  <script src="./v4.js"></script>\n  <script src="./v5.js"></script>',1)
text=text.replace('motor numérico V4','motor numérico V5')
text=text.replace('<h2>Índice meteorológico V4</h2>','<h2>Índice meteorológico V5</h2>')
text=text.replace('Radar/nowcasting CPTEC/INPE continua como camada de validação separada e avisos oficiais sempre prevalecem.','A V5 acrescenta climatologia IDF oficial e skill persistente no servidor. Pesos externos só entram no índice quando houver observações oficiais suficientes. Radar/nowcasting CPTEC/INPE continua como camada de validação separada e avisos oficiais sempre prevalecem.')
p.write_text(text,encoding='utf-8')

# Estilos V5.
p=Path('site/styles.css'); text=p.read_text(encoding='utf-8')
css='''\n/* V5: calibração persistente e climatologia oficial */\n.v5-panel { border-color: rgba(50,213,131,.22); }\n.v5-source { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin:2px 0 12px; padding:10px 11px; border-radius:13px; background:rgba(255,255,255,.035); border:1px solid var(--line); }\n.v5-source strong { font-size:11px; white-space:nowrap; }\n.v5-source span { color:var(--muted); font-size:10px; text-align:right; line-height:1.35; }\n.v5-idf { margin:10px 0 14px; padding:11px; border-radius:13px; background:var(--panel2); border:1px solid var(--line); }\n.v5-idf strong,.v5-idf span,.v5-idf code { display:block; }\n.v5-idf strong { font-size:12px; }\n.v5-idf span { color:var(--muted); font-size:10px; margin:3px 0 7px; }\n.v5-idf code { font-size:10px; color:#b8d7ff; overflow-wrap:anywhere; }\n.v5-kind { display:block; color:var(--muted); font-size:8px; font-weight:500; margin-top:2px; }\n.v5-panel .v4-weight-wrap { overflow-x:auto; }\n.v5-panel table { min-width:650px; }\n@media (max-width:390px) { .v5-source { display:block; } .v5-source span { text-align:left; margin-top:4px; display:block; } }\n'''
if '/* V5: calibração persistente' not in text:
    text += css
p.write_text(text,encoding='utf-8')

# Atualiza shell/cache PWA.
p=Path('site/sw.js'); text=p.read_text(encoding='utf-8')
text=re.sub(r"const CACHE = '[^']+';","const CACHE = 'radar-gm-v5-calibracao';",text,count=1)
if "'./v5.js'" not in text:
    text=text.replace("'./cptec.js', './manifest.webmanifest'","'./cptec.js', './v4.js', './v5.js', './data/guardamor/v5.json', './manifest.webmanifest'",1)
elif "'./data/guardamor/v5.json'" not in text:
    text=text.replace("'./v5.js'","'./v5.js', './data/guardamor/v5.json'",1)
p.write_text(text,encoding='utf-8')

print('V5 instalado/atualizado com sucesso')
