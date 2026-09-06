#!/usr/bin/env python3
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

CITY = {"id":"guarda-mor-mg","name":"Guarda-Mor","state":"MG","lat":-17.770833,"lon":-47.097778}
TZ_OFFSET = timedelta(hours=-3)
STATE_PATH = Path("data/v5_state.json")
SUMMARY_PATH = Path("site/data/guardamor/v5.json")
MAX_QUEUE = 2500
MAX_VERIFICATIONS = 5000
MIN_OFFICIAL_SAMPLES = 20
RAIN_EVENT_MM_H = 1.0

MODELS = {
    "ECMWF": ("https://api.open-meteo.com/v1/ecmwf", 0.40, 0.35),
    "GFS": ("https://api.open-meteo.com/v1/gfs", 0.30, 0.30),
    "ICON": ("https://api.open-meteo.com/v1/dwd-icon", 0.30, 0.35),
}

IDF = {
    "station_code":"01747005",
    "station_name":"Guarda-Mor",
    "operator":"CPRM / Serviço Geológico do Brasil",
    "lat":-17.7725,
    "lon":-47.098611,
    "operation_since":1973,
    "series":"1974–2018",
    "a":778.7,
    "b":0.1834,
    "c":10.0,
    "d":0.7399,
    "valid_minutes":[5,1440],
    "valid_return_years":[2,100],
}


def now_local():
    return datetime.now(timezone(TZ_OFFSET)).replace(tzinfo=None)


def iso_hour(dt):
    return dt.replace(minute=0, second=0, microsecond=0).isoformat(timespec="minutes")


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def http_json(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent":"RadarGuardaMor/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def qs_url(base, params):
    return base + "?" + urllib.parse.urlencode(params)


def finite(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def haversine(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2-lat1), math.radians(lon2-lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(a))


def parse_dt(value):
    if not value:
        return None
    s = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo:
            dt = dt.astimezone(timezone(TZ_OFFSET)).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def model_fetch(name, endpoint):
    params = {
        "latitude": CITY["lat"], "longitude": CITY["lon"],
        "timezone":"America/Sao_Paulo", "forecast_hours":18,
        "wind_speed_unit":"kmh",
        "hourly":"precipitation,wind_gusts_10m,cape,dew_point_2m",
    }
    raw = http_json(qs_url(endpoint, params))
    h = raw.get("hourly", {})
    return {"name":name, "time":h.get("time",[]), "rain":h.get("precipitation",[]), "gust":h.get("wind_gusts_10m",[]), "cape":h.get("cape",[]), "dew":h.get("dew_point_2m",[])}


def future_targets(model, issued):
    times = model["time"]
    future = []
    for i, t in enumerate(times):
        dt = parse_dt(t)
        if dt and dt >= issued - timedelta(minutes=5):
            future.append((i, dt))
    out=[]
    for lead in (3,6):
        if len(future) <= lead-1:
            continue
        i, target = future[lead-1]
        out.append({
            "lead":lead, "target":target.isoformat(timespec="minutes"),
            "rain":finite(model["rain"][i] if i < len(model["rain"]) else None),
            "gust":finite(model["gust"][i] if i < len(model["gust"]) else None),
            "cape":finite(model["cape"][i] if i < len(model["cape"]) else None),
            "dew":finite(model["dew"][i] if i < len(model["dew"]) else None),
        })
    return out


def reference_fetch():
    params = {
        "latitude":CITY["lat"], "longitude":CITY["lon"], "timezone":"America/Sao_Paulo",
        "past_hours":30, "forecast_hours":1, "wind_speed_unit":"kmh",
        "hourly":"precipitation,wind_gusts_10m",
    }
    raw = http_json(qs_url("https://api.open-meteo.com/v1/forecast", params))
    h=raw.get("hourly",{})
    return {str(t)[:13]: {"rain":finite(h.get("precipitation",[])[i] if i < len(h.get("precipitation",[])) else None),
                          "gust":finite(h.get("wind_gusts_10m",[])[i] if i < len(h.get("wind_gusts_10m",[])) else None),
                          "time":t}
            for i,t in enumerate(h.get("time",[]))}


def cemaden_observation(token):
    if not token:
        return None
    base="https://sws.cemaden.gov.br/PED/rest/"
    headers={"token":token}
    try:
        stations=http_json(qs_url(base+"pcds-cadastro/dados-cadastrais", {"uf":"MG","tipoestacao":"1","formato":"JSON"}), headers=headers)
        if isinstance(stations, dict):
            stations=stations.get("data") or stations.get("dados") or []
        candidates=[]
        for s in stations or []:
            lat,lon=finite(s.get("latitude")),finite(s.get("longitude"))
            if lat is None or lon is None: continue
            dist=haversine(CITY["lat"],CITY["lon"],lat,lon)
            if dist<=180:
                candidates.append((dist,s))
        candidates.sort(key=lambda x:x[0])
        for dist,s in candidates[:12]:
            code=s.get("codestacao")
            ibge=s.get("codibge")
            if not code or not ibge: continue
            rec=http_json(qs_url(base+"pcds-acum/acumulados-recentes", {"codibge":ibge,"codestacao":code,"formato":"JSON"}), headers=headers)
            if isinstance(rec, dict): rec=rec.get("data") or rec.get("dados") or [rec]
            if not rec: continue
            r=rec[0]
            stamp=parse_dt(r.get("datahora") or s.get("dh_ultima_remessa"))
            rain=finite(r.get("acc1hr"))
            if rain is None or stamp is None: continue
            age=abs((now_local()-stamp).total_seconds())/3600
            if age>3.0: continue
            return {"rain":rain,"time":stamp.isoformat(timespec="minutes"),"station":{
                "name":s.get("nome") or code,"code":code,"ibge":ibge,"lat":finite(s.get("latitude")),"lon":finite(s.get("longitude")),"distance_km":round(dist,1),"network":"CEMADEN"},"official":True}
    except Exception as exc:
        print("CEMADEN indisponível:", exc)
    return None


def idf_intensity(return_years, minutes):
    a,b,c,d=IDF["a"],IDF["b"],IDF["c"],IDF["d"]
    return a*(return_years**b)/((minutes+c)**d)


def metric_summary(records, model, official_only=False):
    rr=[r for r in records if r.get("model")==model and (not official_only or r.get("rain_official"))]
    rain_err=[r["rain_error"] for r in rr if finite(r.get("rain_error")) is not None]
    gust_err=[r["gust_error"] for r in rr if finite(r.get("gust_error")) is not None]
    def mae(vals): return sum(abs(x) for x in vals)/len(vals) if vals else None
    def rmse(vals): return math.sqrt(sum(x*x for x in vals)/len(vals)) if vals else None
    events=[r for r in rr if r.get("event_obs") is not None and r.get("event_pred") is not None]
    hits=sum(1 for r in events if r["event_obs"] and r["event_pred"])
    miss=sum(1 for r in events if r["event_obs"] and not r["event_pred"])
    fa=sum(1 for r in events if not r["event_obs"] and r["event_pred"])
    pod=hits/(hits+miss) if hits+miss else None
    far=fa/(hits+fa) if hits+fa else None
    csi=hits/(hits+miss+fa) if hits+miss+fa else None
    brier=sum((float(r["event_pred"])-float(r["event_obs"]))**2 for r in events)/len(events) if events else None
    return {"n":len(rr),"rain_n":len(rain_err),"gust_n":len(gust_err),"mae_rain":mae(rain_err),"rmse_rain":rmse(rain_err),"mae_gust":mae(gust_err),"rmse_gust":rmse(gust_err),"events_n":len(events),"pod":pod,"far":far,"csi":csi,"brier":brier}


def adaptive_weights(metrics, metric):
    base={name:(MODELS[name][1] if metric=="rain" else MODELS[name][2]) for name in MODELS}
    key="rmse_rain" if metric=="rain" else "rmse_gust"
    nkey="rain_n" if metric=="rain" else "gust_n"
    ready=all((metrics[name]["official"].get(nkey) or 0)>=MIN_OFFICIAL_SAMPLES for name in MODELS)
    if not ready:
        return {"active":False,"values":base,"reason":f"mínimo {MIN_OFFICIAL_SAMPLES} observações oficiais por modelo"}
    scale=3.0 if metric=="rain" else 15.0
    raw={}
    for name in MODELS:
        rmse=metrics[name]["official"].get(key)
        raw[name]=base[name]*(1/(1+(rmse or scale)/scale))
    total=sum(raw.values()) or 1
    return {"active":True,"values":{k:v/total for k,v in raw.items()},"reason":"ponderação por RMSE oficial"}


def main():
    issued=now_local().replace(minute=0,second=0,microsecond=0)
    state=load_json(STATE_PATH,{"queue":[],"verifications":[]})
    state.setdefault("queue",[]); state.setdefault("verifications",[])

    models={}
    for name,(endpoint,_,_) in MODELS.items():
        try:
            models[name]=model_fetch(name,endpoint)
        except Exception as exc:
            print(name,"indisponível:",exc)

    seen={q.get("key") for q in state["queue"]}
    for name,m in models.items():
        for target in future_targets(m,issued):
            key=f"{name}|{iso_hour(issued)}|{target['lead']}"
            if key in seen: continue
            state["queue"].append({"key":key,"model":name,"issued":iso_hour(issued),**target})
            seen.add(key)
    state["queue"]=state["queue"][-MAX_QUEUE:]

    try: ref=reference_fetch()
    except Exception as exc:
        print("Referência indisponível:",exc); ref={}
    cem=cemaden_observation(os.getenv("CEMADEN_TOKEN","").strip())

    keep=[]
    now=now_local()
    for q in state["queue"]:
        target=parse_dt(q.get("target"))
        if not target or target>now+timedelta(minutes=10):
            keep.append(q); continue
        key=str(q.get("target",""))[:13]
        r=ref.get(key)
        if not r:
            if target>now-timedelta(hours=36): keep.append(q)
            continue
        obs_rain=r.get("rain"); rain_official=False; rain_source="Open-Meteo referência assimilada/modelada"
        if cem:
            ctime=parse_dt(cem.get("time"))
            if ctime and abs((ctime-target).total_seconds())<=5400:
                obs_rain=cem.get("rain"); rain_official=True; rain_source="CEMADEN pluviômetro automático"
        obs_gust=r.get("gust")
        pred_rain=finite(q.get("rain")); pred_gust=finite(q.get("gust"))
        rec={**q,
             "verified":now.isoformat(timespec="minutes"),
             "obs_rain":obs_rain,"obs_gust":obs_gust,
             "rain_official":rain_official,"rain_source":rain_source,
             "gust_official":False,"gust_source":"Open-Meteo referência assimilada/modelada",
             "rain_error":(pred_rain-obs_rain) if pred_rain is not None and obs_rain is not None else None,
             "gust_error":(pred_gust-obs_gust) if pred_gust is not None and obs_gust is not None else None,
             "event_pred":(pred_rain>=RAIN_EVENT_MM_H) if pred_rain is not None else None,
             "event_obs":(obs_rain>=RAIN_EVENT_MM_H) if obs_rain is not None else None}
        state["verifications"].append(rec)
    state["queue"]=keep[-MAX_QUEUE:]
    state["verifications"]=state["verifications"][-MAX_VERIFICATIONS:]

    metrics={}
    for name in MODELS:
        metrics[name]={"all":metric_summary(state["verifications"],name,False),"official":metric_summary(state["verifications"],name,True)}

    latest_models={}
    for name,m in models.items():
        targets=future_targets(m,issued)
        latest_models[name]={"targets":targets}

    summary={
        "version":"5.0",
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "city":CITY,
        "observation": cem if cem else {"official":False,"rain":None,"time":None,"station":None,"note":"CEMADEN exige JWT; sem token o servidor mantém apenas referência provisória para verificação."},
        "idf":{**IDF,"equation":"i = 778.7 * T^0.1834 / (t + 10)^0.7399","thresholds_1h_mm_h":{str(T):round(idf_intensity(T,60),1) for T in (2,5,10,25,50,100)}},
        "event_definition":{"rain_event_mm_h":RAIN_EVENT_MM_H,"brier":"binário/determinístico para o mesmo limiar"},
        "metrics":metrics,
        "weights":{"rain":adaptive_weights(metrics,"rain"),"gust":adaptive_weights(metrics,"gust")},
        "counts":{"queue":len(state["queue"]),"verifications":len(state["verifications"]),"official_rain":sum(1 for r in state["verifications"] if r.get("rain_official"))},
        "latest_forecasts":latest_models,
        "sources":{"idf":"SGB/CPRM Atlas Pluviométrico – estação Guarda-Mor 01747005","official_rain_candidate":"CEMADEN PED","provisional_reference":"Open-Meteo"}
    }
    save_json(STATE_PATH,state)
    save_json(SUMMARY_PATH,summary)
    print(json.dumps({"models":list(models),"queue":len(state['queue']),"verified":len(state['verifications']),"cemaden":bool(cem)},ensure_ascii=False))

if __name__=="__main__":
    main()
