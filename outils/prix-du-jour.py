#!/usr/bin/env python3
"""Écrit prix.json : le prix de gros du jour (marché day-ahead), par quart d'heure,
pour la Belgique et les zones voisines (France, Pays-Bas, Allemagne-Luxembourg).

Source : Bundesnetzagentur | SMARD.de, via api.energy-charts.info (CC BY 4.0).
Le navigateur ne peut pas lire cette API directement : lancez ce script une fois par jour
(par exemple avec cron : `5 13 * * * python3 /chemin/outils/prix-du-jour.py`).
"""
import json, pathlib, time, urllib.error, urllib.request, datetime, zoneinfo

zones, day, source = {}, None, None
def fetch(url):  # the API rate-limits: wait and retry
    for wait in (0, 10, 30, 60):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
    raise SystemExit('api.energy-charts.info refuse les requêtes pour le moment, réessayez plus tard.')

for bzn in ['BE', 'FR', 'NL', 'DE-LU']:
    d = fetch(f'https://api.energy-charts.info/price?bzn={bzn}')
    time.sleep(2)
    zones[bzn] = [[t, p] for t, p in zip(d['unix_seconds'], d['price']) if p is not None]
    source = d.get('license_info')
    if bzn == 'BE':
        day = datetime.datetime.fromtimestamp(zones[bzn][len(zones[bzn]) // 2][0], zoneinfo.ZoneInfo('Europe/Brussels')).date().isoformat()
path = pathlib.Path(__file__).resolve().parent.parent / 'prix.json'
path.write_text(json.dumps({'date': day, 'unit': 'EUR / MWh', 'source': source, 'zones': zones}, separators=(',', ':')))
print(f"{path.name} : {', '.join(f'{z} {len(p)}' for z, p in zones.items())} valeurs pour le {day}")
