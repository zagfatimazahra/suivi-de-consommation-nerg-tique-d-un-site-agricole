from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from influxdb_client import InfluxDBClient
from datetime import datetime, timezone, timedelta
import io, csv, time, calendar, warnings, json
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_absolute_error
warnings.filterwarnings('ignore')

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

INFLUX_URL    = "https://eu-central-1-1.aws.cloud2.influxdata.com"
INFLUX_TOKEN  = "h9Sw6VkCUdfCO-BZgeV6FH-64R6VEO-DRAIWDbKYiwHav-GPWcO0-4Wh57-HThlT24-3xX00rvMtCycmU_Eadg=="
INFLUX_ORG    = "pfe_agricole"
INFLUX_BUCKET = "energie"
client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
query_api = client.query_api()
SOURCES   = {"total": "total", "solaire": "solaire"}
def get_measurement(s): return SOURCES.get(s, "total")

# =============================
# CACHE
# =============================
_cache, _cache_ttl = {}, {}
CACHE_DURATIONS = {"realtime":5,"historique":120,"cout":180,"bilan":180,"co2":180,"energie":180,"prediction":600,"ia":600,"comparaison":180,"statut":30}
def get_cache(key):
    if key in _cache:
        if time.time()-_cache_ttl.get(key,0) < CACHE_DURATIONS.get(key.split("_")[0],60): return _cache[key]
    return None
def set_cache(key,value): _cache[key]=value; _cache_ttl[key]=time.time()

# =============================
# TARIFS ONEE MT
# =============================
TARIF_HN=0.85602; TARIF_HC=0.62695; TARIF_HP=1.19975; TVA=1.18
PS_SOUSCRITE=50; TARIF_PS=36.20250; TARIF_PENALITE=54.30375
FRAIS_ENTRETIEN=326; FRAIS_LOCATION=187
MAROC_TZ=timezone(timedelta(hours=1))
TARIF_MOY = TARIF_HN*TVA*0.60 + TARIF_HC*TVA*0.25 + TARIF_HP*TVA*0.15
MAX_PUISSANCE_KW = 100

def get_periode(h,j):
    if j==6 or h>=23 or h<7: return "HC"
    if 17<=h<21: return "HP"
    return "HN"
def get_periode_from_utc(t):
    tm=t.astimezone(MAROC_TZ); return get_periode(tm.hour,tm.weekday())

def get_window(periode):
    return {"1h":"1m","24h":"5m","7d":"30m","30d":"2h"}.get(periode,"5m")
def get_periode_flux(periode):
    return {"1h":"-1h","24h":"-24h","7d":"-7d","30d":"-30d"}.get(periode,"-24h")

# ==============================================
# ⭐ HELPER : récupérer points energie_active
# ==============================================
def get_points_energie(measurement, periode):
    """Retourne les points energie_active triés avec aggregateWindow."""
    p = get_periode_flux(periode); w = get_window(periode)
    points = []
    try:
        query = (
            f'from(bucket:"energie")'
            f'|>range(start:{p})'
            f'|>filter(fn:(r)=>r._measurement=="{measurement}")'
            f'|>filter(fn:(r)=>r._field=="energie_active")'
            f'|>aggregateWindow(every:{w}, fn:last, createEmpty:false)'
            f'|>sort(columns:["_time"])'
        )
        for t in query_api.query(query):
            for r in t.records:
                v = r.get_value()
                if v is not None and v >= 0:
                    points.append({"time": r.get_time(), "value": float(v)})
    except Exception as e:
        print(f"⚠️  get_points_energie: {e}")
    return points

def get_points_energie_daterange(measurement, date_debut, date_fin):
    points = []
    try:
        query = (
            f'from(bucket:"energie")'
            f'|>range(start:{date_debut}T00:00:00Z,stop:{date_fin}T23:59:59Z)'
            f'|>filter(fn:(r)=>r._measurement=="{measurement}")'
            f'|>filter(fn:(r)=>r._field=="energie_active")'
            f'|>aggregateWindow(every:30m, fn:last, createEmpty:false)'
            f'|>sort(columns:["_time"])'
        )
        for t in query_api.query(query):
            for r in t.records:
                v = r.get_value()
                if v is not None and v >= 0:
                    points.append({"time": r.get_time(), "value": float(v)})
    except:
        pass
    return points

# ==============================================
# ⭐ CALCUL ÉNERGIE ROBUSTE — SOURCE UNIQUE
# ==============================================
def somme_deltas_valides(points):
    """Somme les deltas positifs et bornés entre points consécutifs."""
    if len(points) < 2: return 0.0
    total = 0.0
    for i in range(1, len(points)):
        delta = points[i]["value"] - points[i-1]["value"]
        dt_h = (points[i]["time"] - points[i-1]["time"]).total_seconds() / 3600
        if dt_h <= 0 or dt_h > 6: continue
        max_d = MAX_PUISSANCE_KW * dt_h
        if 0 <= delta <= max_d:
            total += delta
    return total

def calculer_energie_robuste(measurement, periode):
    """kWh total sur la période."""
    return somme_deltas_valides(get_points_energie(measurement, periode))

def calculer_energie_robuste_daterange(measurement, date_debut, date_fin):
    return somme_deltas_valides(get_points_energie_daterange(measurement, date_debut, date_fin))

# ==============================================
# ⭐ CALCUL COÛT PAR PÉRIODE HN/HC/HP — COHÉRENT
# Garantit : kHN + kHC + kHP = total kWh
# ==============================================
def calculer_cout_par_periode_source(measurement, periode):
    """
    Calcule kWh et coût par période tarifaire HN/HC/HP pour UNE source.
    Utilise energie_active deltas — cohérent avec calculer_energie_robuste.
    """
    points = get_points_energie(measurement, periode)
    
    kHN = kHC = kHP = 0
    cHN = cHC = cHP = 0
    
    for i in range(1, len(points)):
        delta = points[i]["value"] - points[i-1]["value"]
        dt_h = (points[i]["time"] - points[i-1]["time"]).total_seconds() / 3600
        if dt_h <= 0 or dt_h > 6: continue
        max_d = MAX_PUISSANCE_KW * dt_h
        if not (0 <= delta <= max_d): continue
        
        per = get_periode_from_utc(points[i-1]["time"])
        if per == "HN":
            kHN += delta; cHN += delta * TARIF_HN * TVA
        elif per == "HC":
            kHC += delta; cHC += delta * TARIF_HC * TVA
        elif per == "HP":
            kHP += delta; cHP += delta * TARIF_HP * TVA
    
    return kHN, kHC, kHP, cHN, cHC, cHP

def calculer_cout_par_periode_reseau(periode):
    """
    Calcule kWh et coût RÉSEAU (= total - solaire) par période HN/HC/HP.
    Garantit : kHN + kHC + kHP = bilan.kwh_reseau
    """
    b = calculer_bilan_complet(periode)
    return b["kHN"], b["kHC"], b["kHP"], b["cHN"], b["cHC"], b["cHP"]

# ⭐⭐⭐ FONCTION CENTRALE — SOURCE UNIQUE DE VÉRITÉ ⭐⭐⭐
# Garantit cohérence entre /api/bilan et /api/bilan/cout/detail
def calculer_bilan_complet(periode):
    """
    Calcule TOUS les indicateurs énergétiques de façon cohérente.
    UNE SEULE source de calcul → garantit que :
      kwh_reseau (bilan card)  =  kHN + kHC + kHP (cout detail card)
    
    Méthode : pour chaque intervalle [t-1, t]
      delta_total   = energie_active_total[t] - energie_active_total[t-1]
      delta_solaire = energie_active_solaire[t] - energie_active_solaire[t-1]
      delta_reseau  = max(delta_total - delta_solaire, 0)  ← par intervalle
      → Cumul par période tarifaire HN/HC/HP
    """
    pts_total = get_points_energie("total", periode)
    pts_sol = get_points_energie("solaire", periode)
    
    # Index solaire par timestamp arrondi à la minute
    sol_idx = {}
    for s in pts_sol:
        key = s["time"].replace(second=0, microsecond=0)
        sol_idx[key] = s["value"]
    
    kwh_total = 0.0
    kwh_solaire = 0.0
    kHN = kHC = kHP = 0.0
    cHN = cHC = cHP = 0.0
    
    for i in range(1, len(pts_total)):
        delta_t = pts_total[i]["value"] - pts_total[i-1]["value"]
        dt_h = (pts_total[i]["time"] - pts_total[i-1]["time"]).total_seconds() / 3600
        if dt_h <= 0 or dt_h > 6: continue
        max_d = MAX_PUISSANCE_KW * dt_h
        if not (0 <= delta_t <= max_d): continue
        
        # Delta solaire correspondant
        key_curr = pts_total[i]["time"].replace(second=0, microsecond=0)
        key_prev = pts_total[i-1]["time"].replace(second=0, microsecond=0)
        v_sol_curr = sol_idx.get(key_curr)
        v_sol_prev = sol_idx.get(key_prev)
        delta_s = 0
        if v_sol_curr is not None and v_sol_prev is not None:
            ds = v_sol_curr - v_sol_prev
            if 0 <= ds <= max_d: delta_s = ds
        
        # Delta réseau (énergie achetée à ONEE) — par intervalle
        delta_r = max(delta_t - delta_s, 0)
        
        # Cumul totaux
        kwh_total   += delta_t
        kwh_solaire += delta_s
        
        # Cumul par période tarifaire (sur réseau uniquement)
        per = get_periode_from_utc(pts_total[i-1]["time"])
        if per == "HN":
            kHN += delta_r; cHN += delta_r * TARIF_HN * TVA
        elif per == "HC":
            kHC += delta_r; cHC += delta_r * TARIF_HC * TVA
        elif per == "HP":
            kHP += delta_r; cHP += delta_r * TARIF_HP * TVA
    
    # GARANTI : kHN + kHC + kHP = kwh_reseau (par construction)
    kwh_reseau = kHN + kHC + kHP

    # ⭐ FIX : garantir kwh_total = kwh_reseau + kwh_solaire (Conso totale = Achete + Produit)
    # kwh_total accumule independamment pouvait differer legerement de kwh_reseau+kwh_solaire
    # quand delta_solaire > delta_total sur un intervalle (delta_r alors clippe a 0).
    kwh_total = kwh_reseau + kwh_solaire
    
    return {
        "kwh_total":   kwh_total,
        "kwh_solaire": kwh_solaire,
        "kwh_reseau":  kwh_reseau,
        "kHN": kHN, "kHC": kHC, "kHP": kHP,
        "cHN": cHN, "cHC": cHC, "cHP": cHP,
    }

SEUIL_COUVERTURE_COMPLET = 90  # %

def verifier_jour_complet(date_str):
    debut = f"{date_str}T00:00:00Z"; fin = f"{date_str}T23:59:59Z"
    points = []
    try:
        query = (
            f'from(bucket:"energie")'
            f'|>range(start:{debut},stop:{fin})'
            f'|>filter(fn:(r)=>r._measurement=="total")'
            f'|>filter(fn:(r)=>r._field=="energie_active")'
            f'|>aggregateWindow(every:5m, fn:last, createEmpty:false)'
            f'|>sort(columns:["_time"])'
        )
        for t in query_api.query(query):
            for r in t.records:
                if r.get_value() is not None:
                    points.append(r.get_time())
    except: pass
    nb = len(points); cov = round(nb/288*100, 1)
    if nb == 0: return {"complet": False, "nb_points": 0, "couverture_pct": 0, "statut": "vide"}
    if cov < SEUIL_COUVERTURE_COMPLET:
        return {"complet": False, "nb_points": nb, "couverture_pct": cov, "statut": "tronque"}
    return {"complet": True, "nb_points": nb, "couverture_pct": cov, "statut": "complet"}
# =============================
# FICHIERS
# =============================
DATA_DIR=Path("data"); PREDICTIONS_FILE=DATA_DIR/"predictions_history.json"
DATA_DIR.mkdir(exist_ok=True)

# =============================
# DONNÉES HISTORIQUES
# =============================
TOTAUX_MOIS_HIST = {
    "2025-01":13332.2,"2025-02":19690.6,"2025-03":19704.6,
    "2025-04":30414.3,"2025-05":35372.2,"2025-06":17286.3,
    "2025-07":14731.8,"2025-08":23255.4,"2025-09":24966.2,
    "2025-10":17702.4,"2025-11":11935.2,"2025-12": 9941.1,
    "2026-01": 9692.3,"2026-02": 8061.3,"2026-03": 9146.4,
    "2026-04":11415.5,"2026-05": 6317.4,
}
TOTAUX_MOIS_SOLAIRE_HIST = {
    "2025-01":6422.1,"2025-02":9232.5,"2025-03":9738.9,
    "2025-04":10222.1,"2025-05":11341.5,"2025-06":6671.9,
    "2025-07":2382.4,"2025-08":6371.1,"2025-09":5085.4,
    "2025-10":5064.3,"2025-11":5761.0,"2025-12":4747.2,
    "2026-01":4842.9,"2026-02":3856.7,"2026-03":5051.2,
    "2026-04":5815.6,"2026-05":4091.5,
}

# =============================
# PRÉDICTIONS
# =============================
def charger_predictions():
    if not PREDICTIONS_FILE.exists(): return {}
    try:
        with open(PREDICTIONS_FILE) as f: return json.load(f)
    except: return {}

def sauvegarder_prediction(cle,kwh_predit,type_pred,details=None):
    h=charger_predictions()
    h[cle]={"kwh_predit":round(kwh_predit,2),"type":type_pred,"predit_le":datetime.now(MAROC_TZ).isoformat(),"details":details or {}}
    with open(PREDICTIONS_FILE,"w") as f: json.dump(h,f,indent=2,ensure_ascii=False)

def obtenir_reel_jour(date_str):
    return calculer_energie_robuste_daterange("total", date_str, date_str)

def obtenir_reel_mois(mois_str):
    if mois_str in TOTAUX_MOIS_HIST: return TOTAUX_MOIS_HIST[mois_str]
    try:
        an,m=mois_str.split("-"); nb_j=calendar.monthrange(int(an),int(m))[1]
        debut=f"{mois_str}-01"; fin=f"{mois_str}-{nb_j:02d}"
        return calculer_energie_robuste_daterange("total", debut, fin)
    except: return 0.0

# =============================
# MODELE ML
# =============================
PROFIL_T = np.array([0.0224,0.0197,0.018,0.0162,0.0162,0.018,0.0224,0.0359,0.0494,0.0583,0.0628,0.0673,0.0646,0.061,0.0583,0.0557,0.0521,0.0539,0.0521,0.0494,0.0449,0.0404,0.0341,0.0269])
PROFIL_S = np.array([0.0,0.0,0.0,0.0,0.0,0.0,0.0085,0.0339,0.0678,0.1017,0.1271,0.1356,0.1356,0.1271,0.1017,0.0763,0.0508,0.0254,0.0085,0.0,0.0,0.0,0.0,0.0])
PROFIL_T = PROFIL_T / PROFIL_T.sum()
PROFIL_S = PROFIL_S / PROFIL_S.sum()
COEFF_JOUR = {0:0.851,1:1.030,2:1.067,3:0.942,4:1.109,5:1.049,6:0.958}
COEFF_SOL  = {0:0.828,1:1.030,2:1.049,3:0.975,4:1.120,5:1.073,6:0.930}

class ModeleEnergie:
    def __init__(self): self._entrainer()

    def _make_features(self,mois,idx,lag1,lag12):
        moy=np.mean(list(TOTAUX_MOIS_HIST.values()))
        return [mois,idx,np.sin(2*np.pi*mois/12),np.cos(2*np.pi*mois/12),lag1 if lag1 is not None else moy,lag12 if lag12 is not None else moy]

    def _entrainer(self):
        keys=list(TOTAUX_MOIS_HIST.keys()); dates=pd.to_datetime([f"{k}-01" for k in keys])
        values=np.array(list(TOTAUX_MOIS_HIST.values()))
        sol_v=np.array([TOTAUX_MOIS_SOLAIRE_HIST.get(k,0) for k in keys])
        self.keys=keys; self.dates=dates; self.values=values; self.sol_v=sol_v; self.n=len(values)
        X=np.array([self._make_features(dates[i].month,i,values[i-1] if i>0 else values.mean(),values[i-12] if i>=12 else values.mean()) for i in range(self.n)])
        self.rf=RandomForestRegressor(n_estimators=200,max_depth=5,random_state=42,min_samples_leaf=2); self.rf.fit(X,values)
        self.rf_s=RandomForestRegressor(n_estimators=200,max_depth=5,random_state=42,min_samples_leaf=2); self.rf_s.fit(X,sol_v)
        y_pred=self.rf.predict(X)
        self.r2=float(r2_score(values,y_pred)); self.mae=float(mean_absolute_error(values,y_pred))
        self.mape=float(np.mean(np.abs((values-y_pred)/(values+1e-6)))*100); self.precision=round(100-self.mape,1)
        self.mean_v=float(values.mean()); self.std_v=float(values.std())
        print(f"✅ Modèle RF — R²={self.r2:.3f} — Précision={self.precision}% — {self.n} mois")

    def predire_mois_kwh(self,mois,annee,prev_val=None):
        cle=f"{annee}-{mois:02d}"
        if cle in TOTAUX_MOIS_HIST:
            kwh_t=TOTAUX_MOIS_HIST[cle]; kwh_s=TOTAUX_MOIS_SOLAIRE_HIST.get(cle,0)
            kwh_r=max(kwh_t-kwh_s,0); nb_j=calendar.monthrange(annee,mois)[1]
            return {"kwh_total":round(kwh_t,1),"kwh_solaire":round(kwh_s,1),"kwh_reseau":round(kwh_r,1),"cout":round(kwh_r*TARIF_MOY,2),"nb_jours":nb_j,"est_reel":True,"cle":cle}
        now=datetime.now(MAROC_TZ); offset=(annee-now.year)*12+(mois-now.month); idx=self.n+offset
        lag12_i=idx-12; lag12=self.values[lag12_i] if 0<=lag12_i<self.n else self.mean_v
        lag1=prev_val if prev_val is not None else self.values[-1]
        X=[self._make_features(mois,idx,lag1,lag12)]
        kwh_t=max(float(self.rf.predict(X)[0]),1000); kwh_s=max(float(self.rf_s.predict(X)[0]),200)
        kwh_r=max(kwh_t-kwh_s,0); nb_j=calendar.monthrange(annee,mois)[1]
        return {"kwh_total":round(kwh_t,1),"kwh_solaire":round(kwh_s,1),"kwh_reseau":round(kwh_r,1),"cout":round(kwh_r*TARIF_MOY,2),"nb_jours":nb_j,"est_reel":False,"cle":cle,"intervalle_bas":round(kwh_t*0.88,1),"intervalle_haut":round(kwh_t*1.12,1)}

    def predire_jour_kwh(self,date):
        mois_d=self.predire_mois_kwh(date.month,date.year); nb_j=mois_d["nb_jours"]
        moy_j_t=mois_d["kwh_total"]/nb_j; moy_j_s=mois_d["kwh_solaire"]/nb_j
        wd=date.weekday(); coef_t=COEFF_JOUR[wd]; coef_s=COEFF_SOL[wd]
        kwh_t=moy_j_t*coef_t; kwh_s=moy_j_s*coef_s; kwh_r=max(kwh_t-kwh_s,0)
        return {"kwh_total":round(kwh_t,1),"kwh_solaire":round(kwh_s,1),"kwh_reseau":round(kwh_r,1),"cout":round(kwh_r*TARIF_MOY,2),"moy_j_t":round(moy_j_t,2),"moy_j_s":round(moy_j_s,2)}

    def predire_24h(self):
        now_m=datetime.now(MAROC_TZ); jour_d=self.predire_jour_kwh(now_m+timedelta(days=1))
        moy_j_t=jour_d["moy_j_t"]; moy_j_s=jour_d["moy_j_s"]; preds=[]; h0=now_m.hour
        for i in range(24):
            h=(h0+i)%24; dt=now_m+timedelta(hours=i)
            kwh_t=moy_j_t*PROFIL_T[h]; kwh_s=moy_j_s*PROFIL_S[h]; kwh_r=max(kwh_t-kwh_s,0)
            per=get_periode(h,dt.weekday()); tarif={"HN":TARIF_HN,"HC":TARIF_HC,"HP":TARIF_HP}[per]*TVA
            preds.append({"heure":f"{h:02d}:00","timestamp":dt.isoformat(),"kwh_total":round(kwh_t,2),"kwh_solaire":round(kwh_s,2),"kwh_reseau":round(kwh_r,2),"cout":round(kwh_r*tarif,2),"periode":per})
        return preds

    def predire_7j(self):
        now=datetime.now(MAROC_TZ); jours_fr=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]; preds=[]
        for i in range(1,8):
            d=now+timedelta(days=i); jour_d=self.predire_jour_kwh(d); wd=d.weekday()
            preds.append({"jour":f"{jours_fr[wd]} {d.day}/{d.month:02d}","date":d.strftime("%Y-%m-%d"),"kwh_total":jour_d["kwh_total"],"kwh_solaire":jour_d["kwh_solaire"],"kwh_reseau":jour_d["kwh_reseau"],"cout":jour_d["cout"],"is_weekend":wd>=5})
        return preds

    def predire_mois_liste(self,n=12):
        now=datetime.now(MAROC_TZ); prev=self.values[-1]; preds=[]
        for i in range(n):
            mc=(now.month+i-1)%12+1; an=now.year+(now.month+i-1)//12
            md=self.predire_mois_kwh(mc,an,prev)
            mn=["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"][mc-1]
            reel=TOTAUX_MOIS_HIST.get(md["cle"]); reel_s=TOTAUX_MOIS_SOLAIRE_HIST.get(md["cle"])
            preds.append({"mois":f"{mn} {an}","mois_num":mc,"annee":an,"cle":md["cle"],"nb_jours":md["nb_jours"],"kwh_predit":md["kwh_total"],"kwh_sol_predit":md["kwh_solaire"],"kwh_reseau":md["kwh_reseau"],"cout_predit":md["cout"],"kwh_reel":round(reel,1) if reel else None,"kwh_sol_reel":round(reel_s,1) if reel_s else None,"est_futur":reel is None,"intervalle_bas":md.get("intervalle_bas"),"intervalle_haut":md.get("intervalle_haut")})
            if not reel: prev=md["kwh_total"]
        return preds

    def predire_annee(self):
        now=datetime.now(MAROC_TZ); preds=[]
        for an in [now.year,now.year+1]:
            kwh_t=kwh_s=0; prev=self.values[-1]
            for mc in range(1,13):
                md=self.predire_mois_kwh(mc,an,prev); kwh_t+=md["kwh_total"]; kwh_s+=md["kwh_solaire"]
                if not md["est_reel"]: prev=md["kwh_total"]
            kwh_r=max(kwh_t-kwh_s,0); reel=sum(v for k,v in TOTAUX_MOIS_HIST.items() if k.startswith(str(an)))
            preds.append({"annee":an,"kwh_predit":round(kwh_t,1),"kwh_solaire":round(kwh_s,1),"kwh_reseau":round(kwh_r,1),"cout_predit":round(kwh_r*TARIF_MOY,2),"kwh_reel":round(reel,1) if reel>0 else None,"est_futur":an>now.year})
        return preds

    def score_sante(self,rt):
        score=100; alertes=[]
        t=rt.get("tension",230) or 230; fp=rt.get("facteur_puissance",1) or 1
        pa=rt.get("puissance_apparente",0) or 0; fr=rt.get("frequence",50) or 50
        if not(207<=t<=233): score-=20; alertes.append(f"Tension hors plage : {t:.1f}V")
        if fp!=-1:
            if fp<0.85: score-=25; alertes.append(f"FP bas : {fp:.2f}")
            elif fp<0.90: score-=10; alertes.append(f"FP légèrement bas : {fp:.2f}")
        if pa>50: score-=30; alertes.append(f"Dépassement PS : {pa:.1f} kVA")
        elif pa>42: score-=10; alertes.append(f"PS proche limite : {pa:.1f}/50 kVA")
        if fr<49.5 or fr>50.5: score-=15; alertes.append(f"Fréquence instable : {fr:.1f}Hz")
        niv="Excellent" if score>=90 else "Bon" if score>=70 else "Moyen" if score>=50 else "Critique"
        col="#10b981" if score>=90 else "#3b82f6" if score>=70 else "#f59e0b" if score>=50 else "#ef4444"
        return {"score":max(0,score),"niveau":niv,"couleur":col,"alertes":alertes}

    def detecter_anomalies(self):
        z=np.abs((self.values-self.mean_v)/(self.std_v+1e-6)); res=[]
        for i,(cle,val) in enumerate(TOTAUX_MOIS_HIST.items()):
            if z[i]>1.5:
                an,m=cle.split("-")
                mn=["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"][int(m)-1]
                res.append({"mois":f"{mn} {an}","valeur":round(val,1),"z_score":round(float(z[i]),2),"type":"haute" if val>self.mean_v else "basse","ecart_pct":round((val-self.mean_v)/self.mean_v*100,1)})
        return sorted(res,key=lambda x:x["z_score"],reverse=True)

modele = ModeleEnergie()

def auto_sauvegarder():
    now=datetime.now(MAROC_TZ)
    for i in range(0,8):
        d=now+timedelta(days=i); ds=d.strftime("%Y-%m-%d")
        h=charger_predictions()
        if ds not in h:
            pred=modele.predire_jour_kwh(d)
            sauvegarder_prediction(ds,pred["kwh_total"],"jour",{"kwh_solaire":pred["kwh_solaire"],"kwh_reseau":pred["kwh_reseau"],"cout":pred["cout"]})
    for i in range(0,7):
        mc=(now.month+i-1)%12+1; an=now.year+(now.month+i-1)//12; cle=f"{an}-{mc:02d}"
        h=charger_predictions()
        if cle not in h:
            md=modele.predire_mois_kwh(mc,an)
            sauvegarder_prediction(cle,md["kwh_total"],"mois",{"kwh_solaire":md["kwh_solaire"],"kwh_reseau":md["kwh_reseau"],"cout":md["cout"]})
    print(f"✅ {len(charger_predictions())} prédictions sauvegardées")

auto_sauvegarder()

# =============================
# ENDPOINTS IA
# =============================
@app.get("/api/ia/prediction/24h")
def pred_24h():
    ck="pred_24h"; c=get_cache(ck)
    if c: return c
    preds=modele.predire_24h()
    r={"predictions":preds,"total_kwh":round(sum(p["kwh_total"] for p in preds),1),"solaire_kwh":round(sum(p["kwh_solaire"] for p in preds),1),"reseau_kwh":round(sum(p["kwh_reseau"] for p in preds),1),"cout_total":round(sum(p["cout"] for p in preds),2),"precision":modele.precision,"genere_le":datetime.now(MAROC_TZ).isoformat()}
    set_cache(ck,r); return r

@app.get("/api/ia/prediction/7j")
def pred_7j():
    ck="pred_7j"; c=get_cache(ck)
    if c: return c
    preds=modele.predire_7j()
    r={"predictions":preds,"total_kwh":round(sum(p["kwh_total"] for p in preds),1),"solaire_kwh":round(sum(p["kwh_solaire"] for p in preds),1),"reseau_kwh":round(sum(p["kwh_reseau"] for p in preds),1),"cout_total":round(sum(p["cout"] for p in preds),2),"genere_le":datetime.now(MAROC_TZ).isoformat()}
    set_cache(ck,r); return r

@app.get("/api/ia/prediction/mois")
def pred_mois(nb_mois:int=12):
    ck=f"pred_mois_{nb_mois}"; c=get_cache(ck)
    if c: return c
    preds=modele.predire_mois_liste(nb_mois)
    r={"predictions":preds,"r2":round(modele.r2,3),"precision":modele.precision,"n":modele.n,"genere_le":datetime.now(MAROC_TZ).isoformat()}
    set_cache(ck,r); return r

@app.get("/api/ia/prediction/annee")
def pred_annee():
    ck="pred_annee"; c=get_cache(ck)
    if c: return c
    r={"predictions":modele.predire_annee(),"r2":round(modele.r2,3),"precision":modele.precision,"genere_le":datetime.now(MAROC_TZ).isoformat()}
    set_cache(ck,r); return r

@app.get("/api/ia/score")
def ia_score(source:str="total"):
    rt=get_realtime(source); score=modele.score_sante(rt)
    now=datetime.now(MAROC_TZ); md=modele.predire_mois_kwh(now.month,now.year)
    score["prevision_mois"]=md["kwh_total"]; score["prevision_mois_solaire"]=md["kwh_solaire"]
    score["prevision_mois_reseau"]=md["kwh_reseau"]; score["prevision_mois_cout"]=md["cout"]
    score["precision_modele"]=modele.precision; score["r2"]=round(modele.r2,3)
    return score

@app.get("/api/ia/anomalies")
def ia_anomalies():
    ck="ia_anomalies"; c=get_cache(ck)
    if c: return c
    r={"anomalies":modele.detecter_anomalies(),"moyenne":round(modele.mean_v,1),"ecart_type":round(modele.std_v,1)}
    set_cache(ck,r); return r

@app.get("/api/ia/comparaison")
def get_comparaison():
    ck="comparaison_pvr"; c=get_cache(ck)
    if c: return c
    history=charger_predictions(); now=datetime.now(MAROC_TZ)
    comp_jours=[]; comp_mois=[]; precision_total=[]

    for cle,pred in sorted(history.items()):
        kwh_predit=pred["kwh_predit"]; type_pred=pred["type"]; details=pred.get("details",{})

        if type_pred=="jour":
            try:
                date_pred=datetime.strptime(cle,"%Y-%m-%d").replace(tzinfo=MAROC_TZ)
                label=date_pred.strftime("%d %b")
                if date_pred.date()==now.date():
                    comp_jours.append({"date":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"aujourd_hui","details":details})
                elif date_pred.date()>now.date():
                    comp_jours.append({"date":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"futur","details":details})
                else:
                    info_jour = verifier_jour_complet(cle)
                    if not info_jour["complet"]:
                        comp_jours.append({"date":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"incomplet","details":details,"info_completude":info_jour})
                    else:
                        kwh_reel = obtenir_reel_jour(cle)
                        if kwh_reel > 0:
                            err = abs(kwh_reel-kwh_predit)/kwh_reel*100; prec = round(100-err,1)
                            precision_total.append(prec)
                            comp_jours.append({"date":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":round(kwh_reel,1),"precision":prec,"erreur_pct":round(err,1),"statut":"reel","details":details})
                        else:
                            comp_jours.append({"date":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"attente","details":details})
            except Exception as e:
                print(f"Erreur comparaison {cle}: {e}")

        elif type_pred=="mois":
            try:
                an,m=[int(x) for x in cle.split("-")]
                now_n=now.year*12+now.month; pred_n=an*12+m
                mn=["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"][m-1]
                label=f"{mn} {an}"
                if pred_n>= now_n:
                    comp_mois.append({"cle":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"futur","details":details})
                else:
                    kwh_reel=obtenir_reel_mois(cle)
                    if kwh_reel>0:
                        err=abs(kwh_reel-kwh_predit)/kwh_reel*100; prec=round(100-err,1)
                        comp_mois.append({"cle":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":round(kwh_reel,1),"precision":prec,"erreur_pct":round(err,1),"statut":"reel","details":details})
                    else:
                        comp_mois.append({"cle":cle,"label":label,"kwh_predit":round(kwh_predit,1),"kwh_reel":None,"precision":None,"statut":"attente","details":details})
            except: pass

    result={"jours":comp_jours[-14:],"mois":comp_mois[-12:],"precision_moy":round(sum(precision_total)/len(precision_total),1) if precision_total else None,"nb_comparaisons":len(precision_total),"genere_le":datetime.now(MAROC_TZ).isoformat()}
    set_cache(ck,result); return result

@app.post("/api/ia/prediction/sauvegarder")
def sauvegarder_pred(date_cible:str,kwh_predit:float,type_pred:str="jour"):
    sauvegarder_prediction(date_cible,kwh_predit,type_pred)
    return {"ok":True}

@app.get("/api/ia/analyse")
async def ia_analyse(source:str="total",periode:str="24h"):
    ck=f"ia_analyse_{source}_{periode}"; c=get_cache(ck)
    if c: return c
    try:
        import httpx; rt=get_realtime(source); cout=get_cout(source,periode); bil=get_bilan(periode); sc=modele.score_sante(rt)
        now=datetime.now(MAROC_TZ); md=modele.predire_mois_kwh(now.month,now.year)
        prompt=f"""Expert supervision énergétique Maroc. Site agricole AZURA. Score:{sc.get('score')}/100.
Tension:{rt.get('tension','--')}V | FP:{rt.get('facteur_puissance','--')} | PA:{rt.get('puissance_apparente','--')} kVA/50kVA
Prévision mois: {md['kwh_total']:.0f} kWh total, {md['kwh_solaire']:.0f} kWh solaire
Solaire={bil.get('taux_auto','--')}% | Économies={bil.get('economies','--')} DH
JSON sans markdown: {{"resume":"phrase courte","recommandations":[{{"titre":"...","description":"...chiffres","impact":"X DH/mois","priorite":"haute|moyenne|faible"}}],"alerte_principale":null}}"""
        async with httpx.AsyncClient(timeout=30) as hc:
            resp=await hc.post("https://api.anthropic.com/v1/messages",headers={"Content-Type":"application/json"},json={"model":"claude-sonnet-4-20250514","max_tokens":800,"messages":[{"role":"user","content":prompt}]})
            import json as jl; analyse=jl.loads(resp.json()["content"][0]["text"])
            r={"analyse":analyse,"score":sc,"genere_le":datetime.now(MAROC_TZ).isoformat()}
            set_cache(ck,r); return r
    except Exception as e:
        r={"analyse":{"resume":f"Site AZURA — Score {modele.score_sante(get_realtime(source)).get('score','--')}/100","recommandations":[{"titre":"Optimiser heures de pointe","description":f"HP={TARIF_HP*TVA:.3f} vs HN={TARIF_HN*TVA:.3f} DH/kWh. Déplacez charges lourdes hors 17h-21h","impact":"500-1500 DH/mois","priorite":"haute"},{"titre":"Améliorer facteur puissance","description":"Condensateurs pour FP>0.90 évite pénalités ONEE","impact":"200-800 DH/mois","priorite":"moyenne"},{"titre":"Surveiller puissance souscrite","description":f"Rester sous 50 kVA. Pénalité={TARIF_PENALITE} DH/kVA","impact":"Évite 2000+ DH","priorite":"haute"}],"alerte_principale":None},"score":modele.score_sante(get_realtime(source)),"genere_le":datetime.now(MAROC_TZ).isoformat(),"note":"Mode hors ligne"}
        set_cache(ck,r); return r

@app.get("/api/ia/modele")
def ia_modele():
    return {"r2":round(modele.r2,3),"precision":modele.precision,"mae":round(modele.mae,0),"n":modele.n,"periode":f"{min(modele.keys)} → {max(modele.keys)}","source_excel":(DATA_DIR/"report_historique.xlsx").exists(),"predictions_sauvegardees":len(charger_predictions())}

# =============================
# ENDPOINTS DE BASE
# =============================
@app.get("/api/test")
def test_influx():
    try: count=sum(1 for t in query_api.query('from(bucket:"energie")|>range(start:-1h)|>filter(fn:(r)=>r._measurement=="total")|>limit(n:3)') for r in t.records); return {"connexion_influx":"OK","nombre_records":count}
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/test/heure")
def test_heure():
    nu=datetime.now(timezone.utc); nm=datetime.now(MAROC_TZ)
    return {"utc":nu.strftime("%H:%M:%S"),"maroc":nm.strftime("%H:%M:%S"),"periode_maroc":get_periode(nm.hour,nm.weekday())}

@app.get("/api/realtime")
def get_realtime(source:str="total"):
    ck=f"realtime_{source}"; c=get_cache(ck)
    if c: return c
    m=get_measurement(source)
    try:
        fields=["tension","courant","frequence","facteur_puissance","puissance_active","puissance_reactive","puissance_apparente","energie_active","energie_reactive","energie_apparente"]; result={}
        for field in fields:
            for t in query_api.query(f'from(bucket:"energie")|>range(start:-1h)|>filter(fn:(r)=>r._measurement=="{m}")|>filter(fn:(r)=>r._field=="{field}")|>last()'):
                for r in t.records: result[field]=r.get_value(); result["timestamp"]=r.get_time().isoformat()
        if result: set_cache(ck,result); return result
        return {"error":"Aucune donnee"}
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/statut")
def get_statut(source:str="total"):
    ck=f"statut_{source}"; c=get_cache(ck)
    if c: return c
    m=get_measurement(source)
    try:
        for t in query_api.query(f'from(bucket:"energie")|>range(start:-10m)|>filter(fn:(r)=>r._measurement=="{m}")|>filter(fn:(r)=>r._field=="tension")|>last()'):
            for r in t.records:
                result={"statut":"connecte","derniere_mesure":r.get_time().isoformat()}; set_cache(ck,result); return result
        return {"statut":"deconnecte","derniere_mesure":None}
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/historique")
def get_historique(field:str="tension",periode:str="1h",source:str="total"):
    ck=f"historique_{field}_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    m=get_measurement(source); p=get_periode_flux(periode); w=get_window(periode)
    try:
        result=[]
        query = f'from(bucket:"energie")|>range(start:{p})|>filter(fn:(r)=>r._measurement=="{m}")|>filter(fn:(r)=>r._field=="{field}")|>aggregateWindow(every:{w}, fn:mean, createEmpty:false)|>sort(columns:["_time"])'
        for t in query_api.query(query):
            for r in t.records: result.append({"time":r.get_time().isoformat(),"value":r.get_value()})
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/historique/multi")
def get_historique_multi(fields:str="puissance_active,puissance_reactive,puissance_apparente",periode:str="1h",source:str="total"):
    ck=f"historique_multi_{fields}_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    m=get_measurement(source); p=get_periode_flux(periode); w=get_window(periode)
    try:
        result={}
        for field in fields.split(","):
            pts=[]
            query = f'from(bucket:"energie")|>range(start:{p})|>filter(fn:(r)=>r._measurement=="{m}")|>filter(fn:(r)=>r._field=="{field.strip()}")|>aggregateWindow(every:{w}, fn:mean, createEmpty:false)|>sort(columns:["_time"])'
            for t in query_api.query(query):
                for r in t.records: pts.append({"time":r.get_time().isoformat(),"value":r.get_value()})
            result[field.strip()]=pts
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/historique/daterange")
def get_historique_daterange(field:str="tension",date_debut:str="",date_fin:str="",source:str="total"):
    if not date_debut or not date_fin: return {"erreur":"requis"}
    m=get_measurement(source)
    try:
        result=[]
        query = f'from(bucket:"energie")|>range(start:{date_debut}T00:00:00Z,stop:{date_fin}T23:59:59Z)|>filter(fn:(r)=>r._measurement=="{m}")|>filter(fn:(r)=>r._field=="{field}")|>aggregateWindow(every:30m, fn:mean, createEmpty:false)|>sort(columns:["_time"])'
        for t in query_api.query(query):
            for r in t.records: result.append({"time":r.get_time().isoformat(),"value":r.get_value()})
        return result
    except Exception as e: return {"erreur":str(e)}

# ⭐ ÉNERGIE TOTAL — Source unique cohérente
@app.get("/api/energie/total")
def get_energie_total(periode:str="24h",source:str="total"):
    ck=f"energie_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    try:
        kwh = calculer_energie_robuste(get_measurement(source), periode)
        result = {"total_kwh": round(kwh, 3), "periode": periode}
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/co2")
def get_co2(periode:str="24h",source:str="total"):
    ck=f"co2_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    try:
        kwh = calculer_energie_robuste(get_measurement(source), periode)
        co2 = kwh * 0.233
        result = {"energie_kwh":round(kwh,2),"co2_kg":round(co2,2),"co2_tonnes":round(co2/1000,4),"equivalent_arbres":round(co2/21.7,1),"co2_jour":round(kwh*0.233,2),"co2_mois":round(kwh*30*0.233,2),"periode":periode}
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/co2/historique")
def get_co2_historique(periode:str="24h",source:str="total"):
    ck=f"co2_historique_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    try:
        points = get_points_energie(get_measurement(source), periode)
        if not points: return []
        cumul = 0; result = []
        for i in range(1, len(points)):
            dh = (points[i]["time"] - points[i-1]["time"]).total_seconds() / 3600
            delta = points[i]["value"] - points[i-1]["value"]
            if 0 <= dh <= 6 and 0 <= delta <= MAX_PUISSANCE_KW * dh:
                cumul += delta
            result.append({"time": points[i]["time"].isoformat(), "co2_kg": round(cumul * 0.233, 3)})
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

# ⭐ COÛT — Utilise energie_active deltas (cohérent)
@app.get("/api/cout")
def get_cout(source:str="total",periode:str="24h"):
    ck=f"cout_{source}_{periode}"; c=get_cache(ck)
    if c: return c
    try:
        kHN,kHC,kHP,cHN,cHC,cHP = calculer_cout_par_periode_source(get_measurement(source), periode)
        tk=kHN+kHC+kHP; tc=cHN+cHC+cHP
        ff=(PS_SOUSCRITE*TARIF_PS*TVA+FRAIS_ENTRETIEN*1.20+FRAIS_LOCATION*1.15) if source=="total" else 0
        result={"kwh_HN":round(kHN,2),"kwh_HC":round(kHC,2),"kwh_HP":round(kHP,2),"kwh_jour":round(tk,2),"cout_HN":round(cHN,2),"cout_HC":round(cHC,2),"cout_HP":round(cHP,2),"cout_jour":round(tc,2),"kwh_mois":round(tk*30,2),"cout_mois":round(tc*30,2),"frais_fixes_mois":round(ff,2),"cout_total_mois":round(tc*30+ff,2),"tarif_HN":round(TARIF_HN*TVA,3),"tarif_HC":round(TARIF_HC*TVA,3),"tarif_HP":round(TARIF_HP*TVA,3),"co2_jour":round(tk*0.233,2),"co2_mois":round(tk*30*0.233,2)}
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/cout/detail")
def get_cout_detail(periode:str="24h",source:str="total"):
    """
    ⭐ COHÉRENT avec /api/energie/total
    Méthode :
    1. Total RÉEL via calculer_energie_robuste (energie_active)
    2. Proportions HN/HC/HP via puissance × dt
    3. Scaling : HN/HC/HP × (total_réel / total_proportions)
    Résultat : HN + HC + HP = total_réel ✅
    """
    ck=f"cout_detail_{periode}_{source}"; c=get_cache(ck)
    if c: return c
    m=get_measurement(source); p=get_periode_flux(periode); w=get_window(periode)
    try:
        # ÉTAPE 1 : Total RÉEL (source unique)
        kwh_total_reel = calculer_energie_robuste(m, periode)

        # ÉTAPE 2 : Proportions HN/HC/HP via puissance × dt
        recs=[]
        query = (
            f'from(bucket:"{INFLUX_BUCKET}")'
            f'|>range(start:{p})'
            f'|>filter(fn:(r)=>r._measurement=="{m}")'
            f'|>filter(fn:(r)=>r._field=="puissance_active")'
            f'|>aggregateWindow(every:{w}, fn:mean, createEmpty:false)'
            f'|>sort(columns:["_time"])'
        )
        for t in query_api.query(query):
            for r in t.records: recs.append({"time":r.get_time(),"value":r.get_value() or 0})

        kHN_p=kHC_p=kHP_p=0
        for i in range(len(recs)-1):
            dh=(recs[i+1]["time"]-recs[i]["time"]).total_seconds()/3600
            if dh <= 0 or dh > 6: continue
            kwh=recs[i]["value"]*dh; ph=get_periode_from_utc(recs[i]["time"])
            if ph=="HN": kHN_p+=kwh
            elif ph=="HC": kHC_p+=kwh
            elif ph=="HP": kHP_p+=kwh

        total_p = kHN_p + kHC_p + kHP_p

        # ÉTAPE 3 : Scaling pour matcher le total réel
        if total_p > 0:
            ratio = kwh_total_reel / total_p
            kHN = kHN_p * ratio
            kHC = kHC_p * ratio
            kHP = kHP_p * ratio
        else:
            kHN = kHC = kHP = 0

        # ÉTAPE 4 : Coûts avec tarifs
        cHN = kHN * TARIF_HN * TVA
        cHC = kHC * TARIF_HC * TVA
        cHP = kHP * TARIF_HP * TVA

        tk = kHN + kHC + kHP  # = kwh_total_reel ✅
        tc = cHN + cHC + cHP

        result={"kwh_HN":round(kHN,2),"kwh_HC":round(kHC,2),"kwh_HP":round(kHP,2),"kwh_total":round(tk,2),"cout_HN":round(cHN,2),"cout_HC":round(cHC,2),"cout_HP":round(cHP,2),"cout_total":round(tc,2),"tarif_HN":round(TARIF_HN*TVA,3),"tarif_HC":round(TARIF_HC*TVA,3),"tarif_HP":round(TARIF_HP*TVA,3),"pct_HN":round(kHN/tk*100,1) if tk>0 else 0,"pct_HC":round(kHC/tk*100,1) if tk>0 else 0,"pct_HP":round(kHP/tk*100,1) if tk>0 else 0,"periode":periode,"source":source}
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/bilan")
def get_bilan(periode:str="24h"):
    ck=f"bilan_{periode}"; c=get_cache(ck)
    if c: return c
    try:
        # ⭐ UTILISE LA SOURCE UNIQUE — cohérent avec /api/bilan/cout/detail
        b = calculer_bilan_complet(periode)
        kt = b["kwh_total"]
        ks = b["kwh_solaire"]
        kr = b["kwh_reseau"]  # = kHN + kHC + kHP (par construction)
        # Coût réseau EXACT par période tarifaire (somme des coûts HN/HC/HP)
        cout_reseau_exact = b["cHN"] + b["cHC"] + b["cHP"]
        tHN=TARIF_HN*TVA; tHC=TARIF_HC*TVA; tHP=TARIF_HP*TVA
        tm=tHN*0.60+tHC*0.25+tHP*0.15; ts=tHN*0.80+tHP*0.20
        taux=round(ks/kt*100,1) if kt>0 else 0
        result={"kwh_total":round(kt,3),"kwh_solaire":round(ks,3),"kwh_reseau":round(kr,3),"cout_total":round(kt*tm,2),"cout_reseau":round(cout_reseau_exact,2),"cout_sans":round(kt*tm,2),"cout_avec":round(cout_reseau_exact,2),"economies":round(kt*tm - cout_reseau_exact,2),"co2_total":round(kt*0.233,2),"co2_reseau":round(kr*0.233,2),"co2_evite":round(ks*0.233,2),"taux_solaire":taux,"taux_auto":taux,"taux_reseau":round(100-taux,1),"periode":periode,"tarif":round(tm,3),"tarif_HN":round(tHN,3),"tarif_HC":round(tHC,3),"tarif_HP":round(tHP,3),"tarif_solaire":round(ts,3)}
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/bilan/historique")
def get_bilan_historique(periode:str="24h"):
    ck=f"bilan_historique_{periode}"; c=get_cache(ck)
    if c: return c
    try:
        pts_t = get_points_energie("total", periode)
        pts_s = get_points_energie("solaire", periode)
        def cumul(pts):
            if len(pts)<2: return []
            res=[]; c=0
            for i in range(1,len(pts)):
                dh = (pts[i]["time"]-pts[i-1]["time"]).total_seconds()/3600
                d = pts[i]["value"]-pts[i-1]["value"]
                if 0 <= dh <= 6 and 0 <= d <= MAX_PUISSANCE_KW * dh:
                    c += d
                res.append({"time":pts[i]["time"].isoformat(),"value":round(c,3)})
            return res
        ht=cumul(pts_t); hs=cumul(pts_s)
        def pt(t): return datetime.fromisoformat(t.replace("Z","+00:00"))
        result=[]
        for p2 in ht:
            tt=pt(p2["time"]); bs=None; bd=float("inf")
            for s in hs:
                d=abs((tt-pt(s["time"])).total_seconds())
                if d<bd and d<=60: bd=d; bs=s["value"]
            sv=bs if bs is not None else 0
            result.append({"time":p2["time"],"total":p2["value"],"solaire":round(sv,3),"reseau":round(max(p2["value"]-sv,0),3)})
        result=sorted(result,key=lambda x:x["time"]); set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/bilan/daterange")
def get_bilan_daterange(date_debut:str="",date_fin:str=""):
    if not date_debut or not date_fin: return {"erreur":"requis"}
    try:
        kt = calculer_energie_robuste_daterange("total", date_debut, date_fin)
        ks = calculer_energie_robuste_daterange("solaire", date_debut, date_fin)
        kr = max(kt - ks, 0)
        tHN=TARIF_HN*TVA; tHC=TARIF_HC*TVA; tHP=TARIF_HP*TVA
        tm=tHN*0.60+tHC*0.25+tHP*0.15; ts=tHN*0.80+tHP*0.20
        taux=round(ks/kt*100,1) if kt>0 else 0
        return {"kwh_total":round(kt,3),"kwh_solaire":round(ks,3),"kwh_reseau":round(kr,3),"cout_total":round(kt*tm,2),"cout_reseau":round(kr*tm,2),"cout_sans":round(kt*tm,2),"cout_avec":round(kr*tm,2),"economies":round(kt*tm - kr*tm,2),"co2_total":round(kt*0.233,2),"co2_reseau":round(kr*0.233,2),"co2_evite":round(ks*0.233,2),"taux_solaire":taux,"taux_auto":taux,"taux_reseau":round(100-taux,1),"date_debut":date_debut,"date_fin":date_fin,"tarif":round(tm,3)}
    except Exception as e: return {"erreur":str(e)}

# ⭐ BILAN COÛT DÉTAIL — VERSION CORRIGÉE
# Réutilise DIRECTEMENT calculer_bilan_complet() — garantit une cohérence
# PARFAITE avec /api/bilan :
#   kwh_HN + kwh_HC + kwh_HP  ==  bilan.kwh_reseau   (exactement)
#   cout_HN + cout_HC + cout_HP  ==  bilan.cout_avec  (exactement)
#
# (L'ancienne version recalculait via puissance_active x dt + un "kr_reel"
#  independant de b["kwh_reseau"], d'ou les ecarts observes : 51.32 vs 49.69 kWh,
#  44.94 vs 43.79 DH. La version ci-dessous elimine cette double source de calcul.)
@app.get("/api/bilan/cout/detail")
def get_bilan_cout_detail(periode:str="24h"):
    ck=f"bilan_cout_detail_{periode}"; c=get_cache(ck)
    if c: return c
    try:
        # ⭐ SOURCE UNIQUE — meme calcul que /api/bilan
        b = calculer_bilan_complet(periode)

        kHN, kHC, kHP = b["kHN"], b["kHC"], b["kHP"]
        cHN, cHC, cHP = b["cHN"], b["cHC"], b["cHP"]
        tk = kHN + kHC + kHP   # == b["kwh_reseau"] == bilan.kwh_reseau
        tc = cHN + cHC + cHP   # == bilan.cout_avec

        result = {
            "kwh_HN": round(kHN,2), "kwh_HC": round(kHC,2), "kwh_HP": round(kHP,2),
            "kwh_total": round(tk,2),
            "cout_HN": round(cHN,2), "cout_HC": round(cHC,2), "cout_HP": round(cHP,2),
            "cout_total": round(tc,2),
            "tarif_HN": round(TARIF_HN*TVA,3), "tarif_HC": round(TARIF_HC*TVA,3), "tarif_HP": round(TARIF_HP*TVA,3),
            "pct_HN": round(kHN/tk*100,1) if tk>0 else 0,
            "pct_HC": round(kHC/tk*100,1) if tk>0 else 0,
            "pct_HP": round(kHP/tk*100,1) if tk>0 else 0,
            "periode": periode,
        }
        set_cache(ck,result); return result
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/export/csv")
def export_csv(periode:str="24h",source:str="total"):
    m=get_measurement(source); p=get_periode_flux(periode)
    try:
        rows=[]
        for t in query_api.query(f'from(bucket:"energie")|>range(start:{p})|>filter(fn:(r)=>r._measurement=="{m}")|>pivot(rowKey:["_time"],columnKey:["_field"],valueColumn:"_value")|>sort(columns:["_time"])'):
            for r in t.records: rows.append({"timestamp":r.get_time().isoformat(),"tension":r.values.get("tension",0),"courant":r.values.get("courant",0),"frequence":r.values.get("frequence",0),"facteur_puissance":r.values.get("facteur_puissance",0),"puissance_active":r.values.get("puissance_active",0),"puissance_reactive":r.values.get("puissance_reactive",0),"puissance_apparente":r.values.get("puissance_apparente",0),"energie_active":r.values.get("energie_active",0),"energie_reactive":r.values.get("energie_reactive",0),"energie_apparente":r.values.get("energie_apparente",0)})
        out=io.StringIO()
        if rows: w=csv.DictWriter(out,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
        out.seek(0)
        return StreamingResponse(io.BytesIO(out.getvalue().encode("utf-8")),media_type="text/csv",headers={"Content-Disposition":f"attachment; filename=energie_{source}_{periode}.csv"})
    except Exception as e: return {"erreur":str(e)}

@app.get("/api/export/csv/daterange")
def export_csv_daterange(date_debut:str="",date_fin:str="",source:str="total"):
    if not date_debut or not date_fin: return {"erreur":"requis"}
    m=get_measurement(source)
    try:
        rows=[]
        for t in query_api.query(f'from(bucket:"energie")|>range(start:{date_debut}T00:00:00Z,stop:{date_fin}T23:59:59Z)|>filter(fn:(r)=>r._measurement=="{m}")|>pivot(rowKey:["_time"],columnKey:["_field"],valueColumn:"_value")|>sort(columns:["_time"])'):
            for r in t.records: rows.append({"timestamp":r.get_time().isoformat(),"tension":r.values.get("tension",0),"courant":r.values.get("courant",0),"frequence":r.values.get("frequence",0),"facteur_puissance":r.values.get("facteur_puissance",0),"puissance_active":r.values.get("puissance_active",0),"puissance_reactive":r.values.get("puissance_reactive",0),"puissance_apparente":r.values.get("puissance_apparente",0),"energie_active":r.values.get("energie_active",0),"energie_reactive":r.values.get("energie_reactive",0),"energie_apparente":r.values.get("energie_apparente",0)})
        out=io.StringIO()
        if rows: w=csv.DictWriter(out,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
        out.seek(0)
        return StreamingResponse(io.BytesIO(out.getvalue().encode("utf-8")),media_type="text/csv",headers={"Content-Disposition":f"attachment; filename=energie_{source}_{date_debut}_{date_fin}.csv"})
    except Exception as e: return {"erreur":str(e)}
