from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from influxdb_client import InfluxDBClient
from datetime import datetime, timezone, timedelta
import io
import csv
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

INFLUX_URL    = "https://eu-central-1-1.aws.cloud2.influxdata.com"
INFLUX_TOKEN  = "h9Sw6VkCUdfCO-BZgeV6FH-64R6VEO-DRAIWDbKYiwHav-GPWcO0-4Wh57-HThlT24-3xX00rvMtCycmU_Eadg=="
INFLUX_ORG    = "pfe_agricole"
INFLUX_BUCKET = "energie"

client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
query_api = client.query_api()

SOURCES = {
    "total":   "total",
    "solaire": "solaire",
}

def get_measurement(source: str) -> str:
    return SOURCES.get(source, "total")

# =============================
# CACHE SIMPLE EN MEMOIRE
# =============================
_cache     = {}
_cache_ttl = {}

# Durées de cache selon endpoint
CACHE_DURATIONS = {
    "realtime":      5,    # 5 secondes (temps réel)
    "historique":    30,   # 30 secondes
    "cout":          30,   # 30 secondes
    "bilan":         60,   # 1 minute
    "co2":           60,   # 1 minute
    "energie":       60,   # 1 minute
}

def get_cache(key: str) -> dict | None:
    if key in _cache:
        duree = CACHE_DURATIONS.get(key.split("_")[0], 30)
        if time.time() - _cache_ttl.get(key, 0) < duree:
            return _cache[key]
    return None

def set_cache(key: str, value: dict) -> None:
    _cache[key]     = value
    _cache_ttl[key] = time.time()

# =============================
# TARIFS ONEE MT — AZURA
# =============================
TARIF_HN    = 0.85602    # Heures Normales DH/kWh HT
TARIF_HC    = 0.62695    # Heures Creuses DH/kWh HT
TARIF_HP    = 1.19975    # Heures de Pointe DH/kWh HT
TVA_ENERGIE = 1.18       # TVA 18%

PS_SOUSCRITE    = 50        # kVA puissance souscrite
TARIF_PS        = 36.20250  # DH/kVA/mois HT
TARIF_PENALITE  = 54.30375  # DH/kVA dépassement HT
FRAIS_ENTRETIEN = 326       # DH/mois HT + TVA 20%
FRAIS_LOCATION  = 187       # DH/mois HT + TVA 15%

# ✅ Fuseau horaire Maroc UTC+1
MAROC_TZ = timezone(timedelta(hours=1))

def get_periode(heure: int, jour_semaine: int) -> str:
    """Calcule la période tarifaire selon l'heure locale Maroc."""
    if jour_semaine == 6:         # Dimanche
        return "HC"
    if heure >= 23 or heure < 7:  # 23h-7h
        return "HC"
    if 17 <= heure < 21:          # 17h-21h
        return "HP"
    return "HN"

def get_periode_from_utc(t_utc) -> str:
    """✅ Convertit UTC → heure Maroc avant de calculer la période."""
    t_maroc = t_utc.astimezone(MAROC_TZ)
    return get_periode(t_maroc.hour, t_maroc.weekday())

# =============================
# TEST CONNEXION INFLUXDB
# =============================
@app.get("/api/test")
def test_influx():
    try:
        query = '''
        from(bucket: "energie")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "total")
          |> limit(n: 3)
        '''
        tables = query_api.query(query)
        count   = 0
        records = []
        for table in tables:
            for record in table.records:
                count += 1
                records.append({
                    "field": record.get_field(),
                    "value": record.get_value(),
                    "time":  record.get_time().isoformat()
                })
        return {"connexion_influx": "OK", "nombre_records": count, "records": records}
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# TEST FUSEAU HORAIRE
# =============================
@app.get("/api/test/heure")
def test_heure():
    now_utc   = datetime.now(timezone.utc)
    now_maroc = datetime.now(MAROC_TZ)
    return {
        "utc":           now_utc.strftime("%H:%M:%S"),
        "maroc":         now_maroc.strftime("%H:%M:%S"),
        "periode_utc":   get_periode(now_utc.hour,   now_utc.weekday()),
        "periode_maroc": get_periode(now_maroc.hour, now_maroc.weekday()),
    }

# =============================
# DONNEES TEMPS REEL
# =============================
@app.get("/api/realtime")
def get_realtime(source: str = "total"):
    cache_key = f"realtime_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    try:
        fields = [
            "tension", "courant", "frequence",
            "facteur_puissance", "puissance_active",
            "puissance_reactive", "puissance_apparente",
            "energie_active", "energie_reactive", "energie_apparente"
        ]
        result = {}
        for field in fields:
            query = f'''
            from(bucket: "energie")
              |> range(start: -1h)
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "{field}")
              |> last()
            '''
            tables = query_api.query(query)
            for table in tables:
                for record in table.records:
                    result[field]      = record.get_value()
                    result["timestamp"] = record.get_time().isoformat()
        if result:
            set_cache(cache_key, result)
            return result
        return {"error": "Aucune donnee"}
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# STATUT CONNEXION
# =============================
@app.get("/api/statut")
def get_statut(source: str = "total"):
    cache_key = f"statut_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: -10m)
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "tension")
          |> last()
        '''
        tables = query_api.query(query)
        for table in tables:
            for record in table.records:
                result = {"statut": "connecte", "derniere_mesure": record.get_time().isoformat()}
                set_cache(cache_key, result)
                return result
        return {"statut": "deconnecte", "derniere_mesure": None}
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# HISTORIQUE TENSION (1h)
# =============================
@app.get("/api/historique/tension")
def get_historique_tension(source: str = "total"):
    cache_key = f"historique_tension_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "tension")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        result = []
        for table in tables:
            for record in table.records:
                result.append({
                    "time":  record.get_time().isoformat(),
                    "value": record.get_value()
                })
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# HISTORIQUE PUISSANCE ACTIVE (1h)
# =============================
@app.get("/api/historique/puissance")
def get_historique_puissance(source: str = "total"):
    cache_key = f"historique_puissance_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "puissance_active")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        result = []
        for table in tables:
            for record in table.records:
                result.append({
                    "time":  record.get_time().isoformat(),
                    "value": record.get_value()
                })
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# HISTORIQUE PAR GRANDEUR ET PERIODE
# =============================
@app.get("/api/historique")
def get_historique(field: str = "tension", periode: str = "1h", source: str = "total"):
    cache_key = f"historique_{field}_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    periodes    = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-1h")
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "{field}")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        result = []
        for table in tables:
            for record in table.records:
                result.append({
                    "time":  record.get_time().isoformat(),
                    "value": record.get_value()
                })
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# HISTORIQUE MULTI-CHAMPS
# =============================
@app.get("/api/historique/multi")
def get_historique_multi(
    fields:  str = "puissance_active,puissance_reactive,puissance_apparente",
    periode: str = "1h",
    source:  str = "total"
):
    cache_key = f"historique_multi_{fields}_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    periodes    = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-1h")
    field_list  = fields.split(",")
    try:
        result = {}
        for field in field_list:
            query = f'''
            from(bucket: "energie")
              |> range(start: {start})
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "{field.strip()}")
              |> sort(columns: ["_time"])
            '''
            tables = query_api.query(query)
            points = []
            for table in tables:
                for record in table.records:
                    points.append({
                        "time":  record.get_time().isoformat(),
                        "value": record.get_value()
                    })
            result[field.strip()] = points
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# HISTORIQUE PAR PLAGE DE DATES
# =============================
@app.get("/api/historique/daterange")
def get_historique_daterange(
    field:      str = "tension",
    date_debut: str = "",
    date_fin:   str = "",
    source:     str = "total"
):
    measurement = get_measurement(source)
    try:
        if not date_debut or not date_fin:
            return {"erreur": "date_debut et date_fin requis"}
        query = f'''
        from(bucket: "energie")
          |> range(start: {date_debut}T00:00:00Z, stop: {date_fin}T23:59:59Z)
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "{field}")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        result = []
        for table in tables:
            for record in table.records:
                result.append({
                    "time":  record.get_time().isoformat(),
                    "value": record.get_value()
                })
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# ENERGIE TOTALE PAR PERIODE
# =============================
@app.get("/api/energie/total")
def get_energie_total(periode: str = "24h", source: str = "total"):
    cache_key = f"energie_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    periodes    = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-24h")
    try:
        query_first = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "energie_active")
          |> first()
        '''
        query_last = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "energie_active")
          |> last()
        '''
        val_first = 0
        tables = query_api.query(query_first)
        for table in tables:
            for record in table.records:
                val_first = record.get_value()

        val_last = 0
        tables = query_api.query(query_last)
        for table in tables:
            for record in table.records:
                val_last = record.get_value()

        consommation = max(val_last - val_first, 0)
        result = {
            "total_kwh":    round(consommation, 3),
            "valeur_debut": round(val_first, 3),
            "valeur_fin":   round(val_last, 3),
            "periode":      periode
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# CO2 TOTAL PAR PERIODE
# =============================
@app.get("/api/co2")
def get_co2(periode: str = "24h", source: str = "total"):
    cache_key = f"co2_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    periodes    = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-24h")
    try:
        query_first = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "energie_active")
          |> first()
        '''
        query_last = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "energie_active")
          |> last()
        '''
        val_first = 0
        tables = query_api.query(query_first)
        for table in tables:
            for record in table.records:
                val_first = record.get_value()

        val_last = 0
        tables = query_api.query(query_last)
        for table in tables:
            for record in table.records:
                val_last = record.get_value()

        kwh = max(val_last - val_first, 0)
        co2 = kwh * 0.233
        result = {
            "energie_kwh":       round(kwh, 2),
            "co2_kg":            round(co2, 2),
            "co2_tonnes":        round(co2 / 1000, 4),
            "equivalent_arbres": round(co2 / 21.7, 1),
            "periode":           periode
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# CO2 EVOLUTION DANS LE TEMPS
# =============================
@app.get("/api/co2/historique")
def get_co2_historique(periode: str = "24h", source: str = "total"):
    cache_key = f"co2_historique_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement = get_measurement(source)
    periodes    = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-24h")
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "energie_active")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        points = []
        for table in tables:
            for record in table.records:
                points.append({
                    "time":  record.get_time().isoformat(),
                    "value": record.get_value()
                })

        if not points:
            return []

        first_value = points[0]["value"]
        result = []
        for point in points:
            consommation = max(point["value"] - first_value, 0)
            result.append({
                "time":   point["time"],
                "co2_kg": round(consommation * 0.233, 3)
            })
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# COUT ENERGETIQUE
# =============================
@app.get("/api/cout")
def get_cout(source: str = "total", periode: str = "24h"):
    cache_key = f"cout_{source}_{periode}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement  = get_measurement(source)
    periodes_map = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start        = periodes_map.get(periode, "-24h")
    try:
        query = f'''
        from(bucket: "{INFLUX_BUCKET}")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "puissance_active")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)

        cout_HN = cout_HC = cout_HP = 0
        kwh_HN  = kwh_HC  = kwh_HP  = 0
        records = []

        for table in tables:
            for record in table.records:
                records.append({
                    "time":  record.get_time(),
                    "value": record.get_value() or 0
                })

        for i in range(len(records) - 1):
            t1        = records[i]["time"]
            t2        = records[i+1]["time"]
            puissance = records[i]["value"]
            duree_h   = (t2 - t1).total_seconds() / 3600
            kwh       = puissance * duree_h

            # ✅ Conversion UTC → heure Maroc
            periode_h = get_periode_from_utc(t1)

            if periode_h == "HN":
                kwh_HN  += kwh
                cout_HN += kwh * TARIF_HN * TVA_ENERGIE
            elif periode_h == "HC":
                kwh_HC  += kwh
                cout_HC += kwh * TARIF_HC * TVA_ENERGIE
            elif periode_h == "HP":
                kwh_HP  += kwh
                cout_HP += kwh * TARIF_HP * TVA_ENERGIE

        total_kwh  = kwh_HN + kwh_HC + kwh_HP
        total_cout = cout_HN + cout_HC + cout_HP

        frais_fixes = 0
        if source == "total":
            frais_fixes = (
                PS_SOUSCRITE * TARIF_PS * TVA_ENERGIE +
                FRAIS_ENTRETIEN * 1.20 +
                FRAIS_LOCATION  * 1.15
            )

        result = {
            "kwh_HN":           round(kwh_HN,  2),
            "kwh_HC":           round(kwh_HC,  2),
            "kwh_HP":           round(kwh_HP,  2),
            "kwh_jour":         round(total_kwh, 2),
            "cout_HN":          round(cout_HN, 2),
            "cout_HC":          round(cout_HC, 2),
            "cout_HP":          round(cout_HP, 2),
            "cout_jour":        round(total_cout, 2),
            "kwh_mois":         round(total_kwh * 30, 2),
            "cout_mois":        round(total_cout * 30, 2),
            "frais_fixes_mois": round(frais_fixes, 2),
            "cout_total_mois":  round(total_cout * 30 + frais_fixes, 2),
            "tarif_HN":         round(TARIF_HN * TVA_ENERGIE, 3),
            "tarif_HC":         round(TARIF_HC * TVA_ENERGIE, 3),
            "tarif_HP":         round(TARIF_HP * TVA_ENERGIE, 3),
            "co2_jour": round(total_kwh * 0.233, 2),
            "co2_mois": round(total_kwh * 30 * 0.233, 2),
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# COUT DETAIL PAR PERIODE
# =============================
@app.get("/api/cout/detail")
def get_cout_detail(periode: str = "24h", source: str = "total"):
    cache_key = f"cout_detail_{periode}_{source}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    measurement  = get_measurement(source)
    periodes_map = {"1h": "-1h", "24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start        = periodes_map.get(periode, "-24h")
    try:
        query = f'''
        from(bucket: "{INFLUX_BUCKET}")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> filter(fn: (r) => r._field == "puissance_active")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)

        cout_HN = cout_HC = cout_HP = 0
        kwh_HN  = kwh_HC  = kwh_HP  = 0
        records = []

        for table in tables:
            for record in table.records:
                records.append({
                    "time":  record.get_time(),
                    "value": record.get_value() or 0
                })

        for i in range(len(records) - 1):
            t1        = records[i]["time"]
            t2        = records[i+1]["time"]
            puissance = records[i]["value"]
            duree_h   = (t2 - t1).total_seconds() / 3600
            kwh       = puissance * duree_h

            # ✅ Conversion UTC → heure Maroc
            periode_h = get_periode_from_utc(t1)

            if periode_h == "HN":
                kwh_HN  += kwh
                cout_HN += kwh * TARIF_HN * TVA_ENERGIE
            elif periode_h == "HC":
                kwh_HC  += kwh
                cout_HC += kwh * TARIF_HC * TVA_ENERGIE
            elif periode_h == "HP":
                kwh_HP  += kwh
                cout_HP += kwh * TARIF_HP * TVA_ENERGIE

        total_kwh  = kwh_HN + kwh_HC + kwh_HP
        total_cout = cout_HN + cout_HC + cout_HP

        result = {
            "kwh_HN":    round(kwh_HN,  2),
            "kwh_HC":    round(kwh_HC,  2),
            "kwh_HP":    round(kwh_HP,  2),
            "kwh_total": round(total_kwh, 2),
            "cout_HN":   round(cout_HN,   2),
            "cout_HC":   round(cout_HC,   2),
            "cout_HP":   round(cout_HP,   2),
            "cout_total":round(total_cout, 2),
            "tarif_HN":  round(TARIF_HN * TVA_ENERGIE, 3),
            "tarif_HC":  round(TARIF_HC * TVA_ENERGIE, 3),
            "tarif_HP":  round(TARIF_HP * TVA_ENERGIE, 3),
            "pct_HN":    round(kwh_HN / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "pct_HC":    round(kwh_HC / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "pct_HP":    round(kwh_HP / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "periode":   periode,
            "source":    source,
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# BILAN ENERGETIQUE
# =============================
@app.get("/api/bilan")
def get_bilan(periode: str = "24h"):
    cache_key = f"bilan_{periode}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    periodes = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start    = periodes.get(periode, "-24h")
    try:
        def get_conso(measurement, start):
            q_first = f'''
            from(bucket: "energie")
              |> range(start: {start})
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "energie_active")
              |> first()
            '''
            q_last = f'''
            from(bucket: "energie")
              |> range(start: {start})
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "energie_active")
              |> last()
            '''
            first = 0
            tables = query_api.query(q_first)
            for t in tables:
                for r in t.records:
                    first = r.get_value()

            last = 0
            tables = query_api.query(q_last)
            for t in tables:
                for r in t.records:
                    last = r.get_value()

            return max(last - first, 0)

        kwh_total   = get_conso("total",   start)
        kwh_solaire = get_conso("solaire", start)
        kwh_reseau  = max(kwh_total - kwh_solaire, 0)

        co2_facteur  = 0.233
        tarif_HN_ttc = TARIF_HN * TVA_ENERGIE
        tarif_HC_ttc = TARIF_HC * TVA_ENERGIE
        tarif_HP_ttc = TARIF_HP * TVA_ENERGIE

        tarif_moyen   = (tarif_HN_ttc * 0.60) + (tarif_HC_ttc * 0.25) + (tarif_HP_ttc * 0.15)
        tarif_solaire = (tarif_HN_ttc * 0.80) + (tarif_HP_ttc * 0.20)

        cout_total   = round(kwh_total   * tarif_moyen,   2)
        cout_reseau  = round(kwh_reseau  * tarif_moyen,   2)
        cout_solaire = round(kwh_solaire * tarif_solaire, 2)

        co2_total  = round(kwh_total   * co2_facteur, 2)
        co2_reseau = round(kwh_reseau  * co2_facteur, 2)
        co2_evite  = round(kwh_solaire * co2_facteur, 2)

        taux = round((kwh_solaire / kwh_total * 100), 1) if kwh_total > 0 else 0

        result = {
            "kwh_total":     round(kwh_total,   3),
            "kwh_solaire":   round(kwh_solaire, 3),
            "kwh_reseau":    round(kwh_reseau,  3),
            "cout_total":    cout_total,
            "cout_reseau":   cout_reseau,
            "cout_sans":     cout_total,
            "cout_avec":     cout_reseau,
            "economies":     cout_solaire,
            "co2_total":     co2_total,
            "co2_reseau":    co2_reseau,
            "co2_evite":     co2_evite,
            "taux_solaire":  taux,
            "taux_auto":     taux,
            "taux_reseau":   round(100 - taux, 1),
            "periode":       periode,
            "tarif":         round(tarif_moyen,   3),
            "tarif_HN":      round(tarif_HN_ttc, 3),
            "tarif_HC":      round(tarif_HC_ttc, 3),
            "tarif_HP":      round(tarif_HP_ttc, 3),
            "tarif_solaire": round(tarif_solaire, 3),
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# BILAN HISTORIQUE
# =============================
@app.get("/api/bilan/historique")
def get_bilan_historique(periode: str = "24h"):
    cache_key = f"bilan_historique_{periode}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    periodes = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start    = periodes.get(periode, "-24h")
    try:
        def get_hist(measurement):
            query = f'''
            from(bucket: "energie")
              |> range(start: {start})
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "energie_active")
              |> aggregateWindow(every: 5m, fn: last, createEmpty: false)
              |> sort(columns: ["_time"])
            '''
            points = []
            tables = query_api.query(query)
            for table in tables:
                for record in table.records:
                    points.append({
                        "time":  record.get_time().isoformat(),
                        "value": record.get_value()
                    })
            return points

        def calc_diff(points):
            if len(points) < 2:
                return []
            result = []
            cumul  = 0
            for i in range(1, len(points)):
                diff = points[i]["value"] - points[i-1]["value"]
                if 0 <= diff <= 100:
                    cumul += diff
                result.append({"time": points[i]["time"], "value": round(cumul, 3)})
            return result

        hist_total   = calc_diff(get_hist("total"))
        hist_solaire = calc_diff(get_hist("solaire"))

        def parse_time(t):
            return datetime.fromisoformat(t.replace("Z", "+00:00"))

        result = []
        for p in hist_total:
            t_total  = parse_time(p["time"])
            best_sol = None
            best_d   = float("inf")
            for s in hist_solaire:
                t_sol = parse_time(s["time"])
                d     = abs((t_total - t_sol).total_seconds())
                if d < best_d and d <= 30:
                    best_d   = d
                    best_sol = s["value"]

            sol_val    = best_sol if best_sol is not None else 0
            reseau_val = round(max(p["value"] - sol_val, 0), 3)
            result.append({
                "time":    p["time"],
                "total":   p["value"],
                "solaire": round(sol_val, 3),
                "reseau":  reseau_val,
            })

        result = sorted(result, key=lambda x: x["time"])
        set_cache(cache_key, result)
        return result
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# BILAN PAR PLAGE DE DATES
# =============================
@app.get("/api/bilan/daterange")
def get_bilan_daterange(date_debut: str = "", date_fin: str = ""):
    try:
        if not date_debut or not date_fin:
            return {"erreur": "date_debut et date_fin requis"}

        def get_conso_dr(measurement):
            q_first = f'''
            from(bucket: "energie")
              |> range(start: {date_debut}T00:00:00Z, stop: {date_fin}T23:59:59Z)
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "energie_active")
              |> first()
            '''
            q_last = f'''
            from(bucket: "energie")
              |> range(start: {date_debut}T00:00:00Z, stop: {date_fin}T23:59:59Z)
              |> filter(fn: (r) => r._measurement == "{measurement}")
              |> filter(fn: (r) => r._field == "energie_active")
              |> last()
            '''
            first = 0
            tables = query_api.query(q_first)
            for t in tables:
                for r in t.records:
                    first = r.get_value()

            last = 0
            tables = query_api.query(q_last)
            for t in tables:
                for r in t.records:
                    last = r.get_value()

            return max(last - first, 0)

        kwh_total   = get_conso_dr("total")
        kwh_solaire = get_conso_dr("solaire")
        kwh_reseau  = max(kwh_total - kwh_solaire, 0)

        co2_facteur  = 0.233
        tarif_HN_ttc = TARIF_HN * TVA_ENERGIE
        tarif_HC_ttc = TARIF_HC * TVA_ENERGIE
        tarif_HP_ttc = TARIF_HP * TVA_ENERGIE
        tarif_moyen   = (tarif_HN_ttc * 0.60) + (tarif_HC_ttc * 0.25) + (tarif_HP_ttc * 0.15)
        tarif_solaire = (tarif_HN_ttc * 0.80) + (tarif_HP_ttc * 0.20)
        taux = round((kwh_solaire / kwh_total * 100), 1) if kwh_total > 0 else 0

        return {
            "kwh_total":    round(kwh_total,   3),
            "kwh_solaire":  round(kwh_solaire, 3),
            "kwh_reseau":   round(kwh_reseau,  3),
            "cout_total":   round(kwh_total   * tarif_moyen,   2),
            "cout_reseau":  round(kwh_reseau  * tarif_moyen,   2),
            "cout_sans":    round(kwh_total   * tarif_moyen,   2),
            "cout_avec":    round(kwh_reseau  * tarif_moyen,   2),
            "economies":    round(kwh_solaire * tarif_solaire, 2),
            "co2_total":    round(kwh_total   * co2_facteur, 2),
            "co2_reseau":   round(kwh_reseau  * co2_facteur, 2),
            "co2_evite":    round(kwh_solaire * co2_facteur, 2),
            "taux_solaire": taux,
            "taux_auto":    taux,
            "taux_reseau":  round(100 - taux, 1),
            "date_debut":   date_debut,
            "date_fin":     date_fin,
            "tarif":        round(tarif_moyen, 3),
        }
    except Exception as e:
        return {"erreur": str(e)}
# =============================
# BILAN COUT RESEAU PAR PERIODE
# =============================
@app.get("/api/bilan/cout/detail")
def get_bilan_cout_detail(periode: str = "24h"):
    cache_key = f"bilan_cout_detail_{periode}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    periodes_map = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start        = periodes_map.get(periode, "-24h")
    try:
        # ✅ Une seule requête avec aggregateWindow pour réduire les points
        query_total = f'''
        from(bucket: "{INFLUX_BUCKET}")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "total")
          |> filter(fn: (r) => r._field == "puissance_active")
          |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
          |> sort(columns: ["_time"])
        '''
        query_solaire = f'''
        from(bucket: "{INFLUX_BUCKET}")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "solaire")
          |> filter(fn: (r) => r._field == "puissance_active")
          |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
          |> sort(columns: ["_time"])
        '''

        tables_total   = query_api.query(query_total)
        tables_solaire = query_api.query(query_solaire)

        # ✅ Dictionnaire solaire indexé par minute (pas par timestamp exact)
        sol_dict = {}
        for table in tables_solaire:
            for record in table.records:
                t   = record.get_time()
                # Clé = minute arrondie
                key = t.replace(second=0, microsecond=0)
                sol_dict[key] = record.get_value() or 0

        cout_HN = cout_HC = cout_HP = 0
        kwh_HN  = kwh_HC  = kwh_HP  = 0
        records_total = []

        for table in tables_total:
            for record in table.records:
                records_total.append({
                    "time":  record.get_time(),
                    "value": record.get_value() or 0
                })

        for i in range(len(records_total) - 1):
            t1       = records_total[i]["time"]
            t2       = records_total[i+1]["time"]
            p_total  = records_total[i]["value"]

            # ✅ Lookup O(1) par clé minute
            key      = t1.replace(second=0, microsecond=0)
            p_sol    = sol_dict.get(key, 0)
            p_reseau = max(p_total - p_sol, 0)

            duree_h  = (t2 - t1).total_seconds() / 3600
            kwh      = p_reseau * duree_h

            periode_h = get_periode_from_utc(t1)

            if periode_h == "HN":
                kwh_HN  += kwh
                cout_HN += kwh * TARIF_HN * TVA_ENERGIE
            elif periode_h == "HC":
                kwh_HC  += kwh
                cout_HC += kwh * TARIF_HC * TVA_ENERGIE
            elif periode_h == "HP":
                kwh_HP  += kwh
                cout_HP += kwh * TARIF_HP * TVA_ENERGIE

        total_kwh  = kwh_HN + kwh_HC + kwh_HP
        total_cout = cout_HN + cout_HC + cout_HP

        result = {
            "kwh_HN":    round(kwh_HN,  2),
            "kwh_HC":    round(kwh_HC,  2),
            "kwh_HP":    round(kwh_HP,  2),
            "kwh_total": round(total_kwh, 2),
            "cout_HN":   round(cout_HN,   2),
            "cout_HC":   round(cout_HC,   2),
            "cout_HP":   round(cout_HP,   2),
            "cout_total":round(total_cout, 2),
            "tarif_HN":  round(TARIF_HN * TVA_ENERGIE, 3),
            "tarif_HC":  round(TARIF_HC * TVA_ENERGIE, 3),
            "tarif_HP":  round(TARIF_HP * TVA_ENERGIE, 3),
            "pct_HN":    round(kwh_HN / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "pct_HC":    round(kwh_HC / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "pct_HP":    round(kwh_HP / total_kwh * 100, 1) if total_kwh > 0 else 0,
            "periode":   periode,
        }
        set_cache(cache_key, result)
        return result

    except Exception as e:
        return {"erreur": str(e)}
# =============================
# EXPORT CSV
# =============================
@app.get("/api/export/csv")
def export_csv(periode: str = "24h", source: str = "total"):
    measurement = get_measurement(source)
    periodes    = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
    start       = periodes.get(periode, "-24h")
    try:
        query = f'''
        from(bucket: "energie")
          |> range(start: {start})
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        rows = []
        for table in tables:
            for record in table.records:
                rows.append({
                    "timestamp":           record.get_time().isoformat(),
                    "tension":             record.values.get("tension", 0),
                    "courant":             record.values.get("courant", 0),
                    "frequence":           record.values.get("frequence", 0),
                    "facteur_puissance":   record.values.get("facteur_puissance", 0),
                    "puissance_active":    record.values.get("puissance_active", 0),
                    "puissance_reactive":  record.values.get("puissance_reactive", 0),
                    "puissance_apparente": record.values.get("puissance_apparente", 0),
                    "energie_active":      record.values.get("energie_active", 0),
                    "energie_reactive":    record.values.get("energie_reactive", 0),
                    "energie_apparente":   record.values.get("energie_apparente", 0),
                })
        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=energie_{source}_{periode}.csv"}
        )
    except Exception as e:
        return {"erreur": str(e)}

# =============================
# EXPORT CSV PAR DATE
# =============================
@app.get("/api/export/csv/daterange")
def export_csv_daterange(date_debut: str = "", date_fin: str = "", source: str = "total"):
    measurement = get_measurement(source)
    try:
        if not date_debut or not date_fin:
            return {"erreur": "date_debut et date_fin requis"}
        query = f'''
        from(bucket: "energie")
          |> range(start: {date_debut}T00:00:00Z, stop: {date_fin}T23:59:59Z)
          |> filter(fn: (r) => r._measurement == "{measurement}")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])
        '''
        tables = query_api.query(query)
        rows = []
        for table in tables:
            for record in table.records:
                rows.append({
                    "timestamp":           record.get_time().isoformat(),
                    "tension":             record.values.get("tension", 0),
                    "courant":             record.values.get("courant", 0),
                    "frequence":           record.values.get("frequence", 0),
                    "facteur_puissance":   record.values.get("facteur_puissance", 0),
                    "puissance_active":    record.values.get("puissance_active", 0),
                    "puissance_reactive":  record.values.get("puissance_reactive", 0),
                    "puissance_apparente": record.values.get("puissance_apparente", 0),
                    "energie_active":      record.values.get("energie_active", 0),
                    "energie_reactive":    record.values.get("energie_reactive", 0),
                    "energie_apparente":   record.values.get("energie_apparente", 0),
                })
        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=energie_{source}_{date_debut}_{date_fin}.csv"}
        )
    except Exception as e:
        return {"erreur": str(e)}
