// Données chiffrées : direct Elia (opendata.elia.be) + facture CREG.

// --- Facture : CREG, tableau de bord d'août 2026, 3 500 kWh/an mono-horaire
const BILL = {
  BE:  { total: 1350.28, parts: [41.82, 28.41, 24.11, 5.66] },
  VL:  { total: 1294.32, parts: [42.66, 27.39, 24.29, 5.66] },
  BR:  { total: 1418.65, parts: [42.50, 23.72, 28.12, 5.66] },
  WAL: { total: 1411.01, parts: [40.45, 31.31, 22.59, 5.65] },
};
const BILL_ROWS = [
  ['Énergie', 'le courant lui-même, facturé par votre fournisseur'],
  ['Réseau', 'transport par Elia et distribution dans votre région'],
  ['Taxes et surcharges', 'soutien aux renouvelables, cotisations, tarif social…'],
  ['TVA', '6 %'],
];
const eur = v => Math.round(v).toLocaleString('fr-BE') + ' €';

function showBill(r) {
  const b = BILL[r];
  document.getElementById('billTotal').textContent = eur(b.total);
  document.getElementById('bill').innerHTML = BILL_ROWS.map(([name, what], i) => `
    <li style="--w:${b.parts[i]}%">
      <span class="bname">${name}</span><span class="n">${eur(b.total * b.parts[i] / 100)}</span>
      <i></i><small>${Math.round(b.parts[i])} % · ${what}</small>
    </li>`).join('');
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.r === r));
  dispatchEvent(new CustomEvent('region', { detail: r })); // le calculateur suit la région choisie
}
document.querySelectorAll('.seg button').forEach(x => x.addEventListener('click', () => showBill(x.dataset.r)));
showBill('BE');

// --- Direct : dernières données publiées par Elia
const API = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets/';
// Sources de production, par catégorie ENTSO-E utilisée par Elia. twh2025 = production belge 2025 (Elia, ods201).
const SOURCES = [
  ['Nuclear', 'Nucléaire', 'var(--nuc)', 22.629],
  ['Fossil Gas', 'Gaz', 'var(--gas)', 16.015],
  ['Solar', 'Solaire', 'var(--sun)', 10.200],
  ['Wind Offshore', 'Éolien en mer', 'var(--wind)', 6.790],
  ['Wind Onshore', 'Éolien sur terre', 'var(--wind2)', 5.398],
  ['Biomass', 'Biomasse', 'var(--bio)', 2.316],
  ['Waste', 'Déchets incinérés', 'var(--waste)', 2.075],
  ['Other', "Gaz et chaleur récupérés de l'industrie", 'var(--ind)', 1.431],
  ['Hydro Pumped Storage', 'Pompage-turbinage (surtout Coo)', 'var(--hydro)', 0.857],
  ['Fossil Oil', 'Fioul et diesel', 'var(--oil)', 0.552],
  ['Energy Storage', 'Batteries', 'var(--batt)', 0.288],
  ['Hydro Run-of-river and poundage', "Centrales au fil de l'eau", 'var(--hydro)', 0.265],
];

// Dessine une barre empilée + sa légende. items: [{label, color, value}], fmt: texte de la valeur
function renderMix(barId, legendId, items, fmt) {
  const total = items.reduce((s, x) => s + x.value, 0);
  const bar = document.getElementById(barId);
  bar.innerHTML = items.map(x => `<i style="width:${100 * x.value / total}%;background:${x.color}"></i>`).join('');
  bar.setAttribute('aria-label', items.map(x => `${x.label} ${fmt(x.value, total)}`).join(', '));
  document.getElementById(legendId).innerHTML = items.map(x =>
    `<li style="--c:${x.color}">${x.label} <span class="n">${fmt(x.value, total)}</span></li>`).join('');
  return total;
}
const pct = (v, t) => (100 * v / t).toLocaleString('fr-BE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
renderMix('mix2025', 'legend2025', SOURCES.map(([, label, color, value]) => ({ label, color, value })), pct);
const COUNTRIES = { France: 'France', Netherlands: 'Pays-Bas', Germany: 'Allemagne', Luxembourg: 'Luxembourg', 'United Kingdom': 'Royaume-Uni' };
const mw = v => Math.round(Math.abs(v)).toLocaleString('fr-BE') + ' MW';
const hhmm = iso => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
const get = (ds, params) => fetch(API + ds + '/records?' + new URLSearchParams(params)).then(r => {
  if (!r.ok) throw new Error(r.status);
  return r.json();
}).then(j => j.results);

async function loadLive() {
  const status = document.getElementById('liveStatus');
  try {
    const [load] = await get('ods002', { where: 'measured is not null', order_by: 'datetime desc', limit: 1 });
    const [last] = await get('ods201', { order_by: 'datetime desc', limit: 1, select: 'datetime' });
    const gen = await get('ods201', {
      select: 'fueltypeentsoe, sum(generatedpower) as mw', group_by: 'fueltypeentsoe',
      where: `datetime = date'${last.datetime}'`, limit: 50,
    });
    const flows = await get('ods160', { order_by: 'datetime desc', limit: 40 });

    // consommation
    document.getElementById('liveLoad').textContent = mw(load.measured);

    // mix de production : seules les sources qui produisent (le pompage et la recharge des batteries sont négatifs)
    const items = gen.filter(g => g.mw > 0).sort((x, y) => y.mw - x.mw).map(g => {
      const src = SOURCES.find(x => x[0] === g.fueltypeentsoe);
      return { label: src ? src[1] : g.fueltypeentsoe, color: src ? src[2] : 'var(--muted)', value: g.mw };
    });
    const total = renderMix('liveMix', 'liveLegend', items, v => mw(v));
    document.getElementById('liveMixTime').textContent = `(dernière donnée publiée : ${hhmm(last.datetime)})`;

    // frontières : Elia compte + pour un export, − pour un import. France : pas de donnée publiée dans ce jeu.
    const seen = {};
    flows.forEach(f => { if (f.datetime && !(f.controlarea in seen)) seen[f.controlarea] = f.physicalflowatborder; });
    document.getElementById('liveBorders').innerHTML = Object.entries(COUNTRIES).map(([c, name]) =>
      `<li><span>${name}</span><span class="n">${c in seen ? (seen[c] < 0 ? 'on importe ' : 'on exporte ') + mw(seen[c]) : 'pas de donnée'}</span></li>`).join('');
    document.getElementById('liveGen').textContent = mw(total);

    status.textContent = `Consommation mesurée à ${hhmm(load.datetime)}, heure belge.`;
    document.getElementById('live').hidden = false;
  } catch (e) {
    status.textContent = "Les données en direct d'Elia ne sont pas accessibles ici. Elles s'affichent quand le site est ouvert depuis son dossier ou depuis un hébergement web.";
  }
}
loadLive();
setInterval(loadLive, 5 * 60 * 1000);

// --- Évolution annuelle : production belge par source (TWh), calculée depuis Elia ods201
const YEARS = {
  2020: { 'Nuclear': 32.793, 'Fossil Gas': 23.776, 'Solar': 4.257, 'Wind Offshore': 6.868, 'Wind Onshore': 4.091, 'Biomass': 2.371, 'Waste': 2.051, 'Other': 5.409, 'Hydro Pumped Storage': 1.033, 'Fossil Oil': 0.001, 'Hydro Run-of-river and poundage': 0.15 },
  2021: { 'Nuclear': 47.962, 'Fossil Gas': 22.778, 'Solar': 4.678, 'Wind Offshore': 6.779, 'Wind Onshore': 3.98, 'Biomass': 3.634, 'Waste': 1.995, 'Other': 0.007, 'Hydro Pumped Storage': 0.908, 'Fossil Oil': 0.236, 'Hydro Run-of-river and poundage': 0.329 },
  2022: { 'Nuclear': 41.744, 'Fossil Gas': 23.345, 'Solar': 6.42, 'Wind Offshore': 6.519, 'Wind Onshore': 4.377, 'Biomass': 3.482, 'Waste': 2.225, 'Other': 0.008, 'Hydro Pumped Storage': 1.23, 'Fossil Oil': 0.223, 'Hydro Run-of-river and poundage': 0.246 },
  2023: { 'Nuclear': 31.289, 'Fossil Gas': 18.871, 'Solar': 7.194, 'Wind Offshore': 7.879, 'Wind Onshore': 6.269, 'Biomass': 2.381, 'Waste': 2.081, 'Other': 1.569, 'Hydro Pumped Storage': 1.22, 'Fossil Oil': 0.591, 'Hydro Run-of-river and poundage': 0.414 },
  2024: { 'Nuclear': 29.732, 'Fossil Gas': 15.206, 'Solar': 8.326, 'Wind Offshore': 7.065, 'Wind Onshore': 5.535, 'Biomass': 2.243, 'Waste': 2.117, 'Other': 0.037, 'Hydro Pumped Storage': 1.033, 'Fossil Oil': 0.562, 'Hydro Run-of-river and poundage': 0.562 },
  2025: Object.fromEntries(SOURCES.map(([k, , , v]) => [k, v])),
};
{
  const tot = y => Object.values(YEARS[y]).reduce((s, v) => s + v, 0);
  const max = Math.max(...Object.keys(YEARS).map(tot));
  const twh = v => v.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' TWh';
  document.getElementById('years').innerHTML = Object.keys(YEARS).map(y => `
    <div class="year"><span class="n">${y}</span>
      <div class="ybar" style="width:${100 * tot(y) / max}%" role="img"
        aria-label="${y} : ${twh(tot(y))}, dont nucléaire ${twh(YEARS[y].Nuclear)} et solaire ${twh(YEARS[y].Solar)}">
        ${SOURCES.map(([k, label, color]) => `<i style="width:${100 * (YEARS[y][k] || 0) / tot(y)}%;background:${color}" title="${label}"></i>`).join('')}
      </div><span class="n">${twh(tot(y))}</span></div>`).join('');
  document.getElementById('yearsLegend').innerHTML = SOURCES
    .map(([, label, color]) => `<li style="--c:${color}">${label}</li>`).join('');
}

// --- Aujourd'hui et demain : consommation, solaire, éolien (mesures puis prévisions)
function brusselsMidnight(now) {
  // ponytail: décalage calculé sur l'heure actuelle, faux d'une heure le jour du changement d'heure
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).map(x => [x.type, +x.value]));
  const d = new Date(now - ((p.hour % 24) * 3600 + p.minute * 60 + p.second) * 1000);
  d.setMilliseconds(0);
  return d;
}
const daySeries = (ds, real, fcst, t0, t1, extra = '') => get(ds, {
  select: `datetime, sum(${real}) as r, sum(${fcst}) as f`, group_by: 'datetime', order_by: 'datetime', limit: 200,
  where: `datetime >= date'${t0.toISOString()}' and datetime < date'${t1.toISOString()}'${extra}`,
}).then(rows => rows.map(x => ({ t: new Date(x.datetime), v: x.r || x.f }))); // pas de mesure (futur) → prévision

function drawDay(svg, series, t0, t1, now) {
  const W = 600, H = 300, L = 52, R = 10, T = 22, B = 40;
  const top = Math.max(...series.flatMap(s => s.pts.map(p => p.v)));
  const step = Math.ceil(top / 4 / 1000) * 1000, maxY = step * 4;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = v => H - B - v / maxY * (H - B - T);
  let g = `<rect x="${x(now)}" y="${T}" width="${W - R - x(now)}" height="${H - B - T}" fill="var(--rule)" opacity=".45"/>`;
  for (let v = 0; v <= maxY; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/>
    <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v.toLocaleString('fr-BE')}</text>`;
  g += `<text x="${L - 6}" y="${T - 8}" text-anchor="end" class="ax">MW</text>`;
  for (let h = 0; h <= 48; h += 6) {
    const t = new Date(+t0 + h * 3600e3);
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${H - B}" y2="${H - B + 5}" stroke="var(--ink)"/>
      <text x="${x(t)}" y="${H - B + 18}" text-anchor="middle" class="ax">${h % 24} h</text>`;
  }
  g += `<text x="${x(new Date(+t0 + 12 * 3600e3))}" y="${H - 4}" text-anchor="middle" class="ax b">aujourd'hui</text>
    <text x="${x(new Date(+t0 + 36 * 3600e3))}" y="${H - 4}" text-anchor="middle" class="ax b">demain</text>
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--ink)"/>`;
  series.forEach(s => g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"
    points="${s.pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`);
  g += `<line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1.5"/>
    <text x="${x(now) + 5}" y="${T + 12}" class="ax b">maintenant</text>`;
  svg.innerHTML = g;
}

async function loadDay() {
  const now = new Date(), t0 = brusselsMidnight(now), t1 = new Date(+t0 + 48 * 3600e3);
  try {
    const [load, sun, wind] = await Promise.all([
      daySeries('ods002', 'measured', 'mostrecentforecast', t0, t1),
      daySeries('ods087', 'realtime', 'mostrecentforecast', t0, t1, " and region = 'Belgium'"),
      daySeries('ods086', 'realtime', 'mostrecentforecast', t0, t1),
    ]);
    drawDay(document.getElementById('daySvg'), [
      { pts: load, color: 'var(--ink)' }, { pts: sun, color: 'var(--sun)' }, { pts: wind, color: 'var(--wind)' },
    ], t0, t1, now);
    document.getElementById('dayChart').hidden = false;
    document.getElementById('dayStatus').hidden = true;
  } catch (e) {
    document.getElementById('dayStatus').textContent = "La courbe du jour vient d'Elia en direct : elle s'affiche quand le site est ouvert depuis son dossier ou depuis un hébergement web.";
  }
}
loadDay();
setInterval(loadDay, 15 * 60 * 1000);

// --- CO₂ par kWh consommé : jeu du jour (ods191), sinon dernière valeur historique (ods192)
async function loadCo2() {
  try {
    let [c] = await get('ods191', { order_by: 'datetime desc', limit: 1 }).catch(() => []);
    if (!c) [c] = await get('ods192', { order_by: 'datetime desc', limit: 1 });
    document.getElementById('liveCo2').textContent = Math.round(c.consumption) + ' g';
    dispatchEvent(new CustomEvent('co2', { detail: c.consumption })); // la carte se teinte selon l'intensité carbone
    const day = new Date(c.datetime).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long' });
    document.getElementById('liveCo2Txt').textContent = `de CO₂ par kWh consommé (dernière valeur publiée : ${day} à ${hhmm(c.datetime)})`;
  } catch (e) { /* la section « En ce moment » affiche déjà le message d'indisponibilité */ }
}
loadCo2();
setInterval(loadCo2, 15 * 60 * 1000);

// --- Météo en direct (Open-Meteo) : soleil, nuages et vent sur 11 points, envoyés à la carte 3D
const STATIONS = [[2.9, 51.6], [3.2, 51.2], [3.7, 51.05], [4.4, 51.2], [5.3, 51.1], [4.35, 50.85], [3.9, 50.5], [4.9, 50.45], [5.6, 50.6], [5.6, 50.1], [5.75, 49.7]];
async function loadWeather() {
  const txt = document.getElementById('meteoTxt');
  let detail;
  try {
    const q = new URLSearchParams({
      latitude: STATIONS.map(s => s[1]).join(','), longitude: STATIONS.map(s => s[0]).join(','),
      current: 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,shortwave_radiation', wind_speed_unit: 'kn', timezone: 'Europe/Brussels',
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    if (!r.ok) throw new Error(r.status);
    // couverture visible : les nuages hauts (voile fin) laissent voir le bleu, ils comptent pour 30 %
    const pts = (await r.json()).map(p => ({ ...p.current,
      cloud_cover: Math.max(p.current.cloud_cover_low, p.current.cloud_cover_mid, p.current.cloud_cover_high * 0.3) }));
    const avg = f => pts.reduce((s, p) => s + f(p), 0) / pts.length;
    detail = {
      live: true, stations: STATIONS,
      clouds: pts.map(p => p.cloud_cover), winds: pts.map(p => [p.wind_direction_10m, p.wind_speed_10m]),
      radiation: avg(p => p.shortwave_radiation),
    };
    txt.textContent = `Météo en direct à ${pts[0].time.slice(11)} : ciel couvert à ${Math.round(avg(p => p.cloud_cover))} % en moyenne, `
      + `vent moyen de ${Math.round(avg(p => p.wind_speed_10m) * 1.852)} km/h, soleil à ${Math.round(detail.radiation)} W/m².`;
  } catch (e) {
    // exemple affiché comme tel quand l'API n'est pas joignable (ex. aperçu claude.ai)
    detail = { live: false, stations: STATIONS, clouds: STATIONS.map((_, i) => 30 + (i * 37) % 50), winds: STATIONS.map((_, i) => [230 + (i % 3) * 15, 8 + (i * 7) % 14]), radiation: null };
    txt.textContent = "Météo d'exemple : la météo en direct n'est pas accessible ici. Elle s'affiche quand le site est ouvert depuis son dossier ou depuis un hébergement web.";
  }
  window.weather = detail;
  dispatchEvent(new CustomEvent('weather', { detail }));
}
loadWeather();
setInterval(loadWeather, 15 * 60 * 1000);

// --- Toute l'énergie finale consommée en Belgique en 2024, par source (Eurostat nrg_bal_c, ktep, FC_E)
renderMix('mixEnergy', 'legendEnergy', [
  { label: 'Pétrole (carburants, mazout)', color: 'var(--oil)', value: 12056.247 },
  { label: 'Gaz naturel', color: 'var(--gas)', value: 8678.653 },
  { label: 'Électricité', color: 'var(--volt)', value: 6613.947 },
  { label: 'Renouvelables et biocarburants', color: 'var(--bio)', value: 2481.097 },
  { label: 'Chaleur (réseaux de chaleur)', color: 'var(--hydro)', value: 317.371 },
  { label: 'Charbon', color: 'var(--ink)', value: 240.593 },
  { label: 'Gaz de hauts fourneaux et de cokerie', color: 'var(--ind)', value: 200.364 },
  { label: 'Déchets non renouvelables', color: 'var(--waste)', value: 153.076 },
], pct);

// --- Qui consomme l'électricité : Eurostat 2024, consommation finale par secteur (GWh)
{
  const SECTORS = [
    ['Industrie', 'chimie, métallurgie, alimentation, papier…', 34959.2],
    ['Commerces, bureaux et services publics', 'magasins, hôpitaux, écoles, administrations…', 20779.5],
    ['Ménages', 'éclairage, électroménager, chauffage électrique…', 16315.2],
    ['Transport', 'trains, trams, métros et voitures électriques', 3239.3],
    ['Agriculture et pêche', 'serres, élevages, bateaux', 1627.0],
  ];
  const total = SECTORS.reduce((s, x) => s + x[2], 0);
  document.getElementById('sectors').innerHTML = SECTORS.map(([name, what, gwh]) => `
    <li style="--w:${100 * gwh / SECTORS[0][2]}%">
      <span class="bname">${name}</span><span class="n">${(gwh / 1000).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} TWh</span>
      <i></i><small>${Math.round(100 * gwh / total)} % · ${what}</small>
    </li>`).join('');
}

// --- Calculateur : kWh par an = facteur × quantité. Hypothèses d'usage typiques, modifiables par le visiteur.
{
  // Prix par kWh : moyenne CREG tout compris de la région (facture annuelle / 3 500 kWh), ou prix saisi par le visiteur
  const REGIONS = { BE: 'la moyenne belge', VL: 'la Flandre', BR: 'Bruxelles', WAL: 'la Wallonie' };
  const regionSel = document.getElementById('calcRegion'), priceIn = document.getElementById('calcPrice');
  let custom = false;
  const cents = r => Math.round(BILL[r].total / 3500 * 1000) / 10;
  function setRegion(r) {
    regionSel.value = r;
    if (!custom) priceIn.value = cents(r);
    document.getElementById('calcPriceNote').textContent = custom
      ? 'Vous utilisez votre propre prix. Choisissez une région pour revenir à la moyenne de la CREG.'
      : `Prix moyen tout compris de la CREG pour ${REGIONS[r]} (août 2026) : énergie du fournisseur, réseau, taxes et TVA. Remplacez-le par le prix de votre facture si vous le connaissez.`;
  }
  regionSel.addEventListener('change', () => { custom = false; showBill(regionSel.value); });
  priceIn.addEventListener('input', () => { custom = true; setRegion(regionSel.value); update(); });
  addEventListener('region', e => { setRegion(e.detail); update(); });
  const A = [ // [id, nom, facteur kWh par unité, quantité par défaut, unité, explication, coché]
    ['frigo', 'Réfrigérateur-congélateur', 1, 250, 'kWh par an (voir l\'étiquette énergie)', 'toujours branché', true],
    ['ll', 'Lave-linge', 52, 4, 'cycles par semaine', '≈ 1 kWh par cycle à 40 °C', true],
    ['lv', 'Lave-vaisselle', 52, 4, 'cycles par semaine', '≈ 1 kWh par cycle', true],
    ['sl', 'Sèche-linge (pompe à chaleur)', 1.5 * 52, 3, 'cycles par semaine', '≈ 1,5 kWh par cycle', false],
    ['taques', 'Taques électriques', 1.5 * 365, 0.5, 'heures par jour', '1 500 W en moyenne', true],
    ['four', 'Four', 52, 2, 'utilisations par semaine', '≈ 1 kWh par utilisation', true],
    ['tv', 'Télévision', 0.1 * 365, 3, 'heures par jour', '100 W', true],
    ['pc', 'Ordinateur portable', 0.05 * 365, 4, 'heures par jour', '50 W', true],
    ['led', 'Éclairage LED (10 ampoules)', 0.08 * 365, 4, 'heures par jour', '10 × 8 W', true],
    ['box', 'Box internet et décodeur', 0.015 * 365, 24, 'heures par jour', '15 W, souvent allumés en continu', true],
    ['ve', 'Voiture électrique', 0.17, 10000, 'km par an', '≈ 17 kWh pour 100 km', false],
    ['pac', 'Pompe à chaleur (chauffage)', 1, 3500, 'kWh par an', 'maison moyenne bien isolée', false],
    ['boiler', 'Boiler électrique (eau chaude)', 1, 1800, 'kWh par an', 'pour 2 à 3 personnes', false],
  ];
  const kwh = v => Math.round(v).toLocaleString('fr-BE') + ' kWh';
  const eurY = v => Math.round(v).toLocaleString('fr-BE') + ' €';
  const ul = document.getElementById('calc');
  ul.innerHTML = A.map(([id, name, , qty, unit, how, on]) => `
    <li>
      <label class="cname"><input type="checkbox" id="c-${id}" ${on ? 'checked' : ''}> ${name}</label>
      <span class="cqty"><input type="number" id="q-${id}" value="${qty}" min="0" step="any" aria-label="${name} : ${unit}"> <small>${unit}</small></span>
      <span class="cres n" id="r-${id}"></span>
      <small class="chow">${how}</small>
    </li>`).join('');
  function update() {
    const PRICE = Math.max(0, +priceIn.value || 0) / 100; // €/kWh
    let total = 0;
    A.forEach(([id, , f]) => {
      const on = document.getElementById('c-' + id).checked;
      const v = f * Math.max(0, +document.getElementById('q-' + id).value || 0);
      if (on) total += v;
      document.getElementById('r-' + id).textContent = on ? `${kwh(v)} · ${eurY(v * PRICE)}` : '–';
    });
    document.getElementById('calcKwh').textContent = kwh(total) + ' par an';
    document.getElementById('calcEur').textContent = '≈ ' + eurY(total * PRICE) + ' par an';
  }
  ul.addEventListener('input', update);
  setRegion('BE');
  update();
}

// --- Fournisseurs d'électricité par région (listes officielles consultées le 24/09/2026)
{
  const SUP = {
    WAL: { // CWaPE : titulaires d'une licence électricité ; home = actifs auprès des ménages
      home: ['Aspiravi Energy', 'Bolt', 'Cociter', 'Dats 24', 'Ecofix', 'Eneco', 'EnergyVision', 'Engie', 'Luminus', 'Mega', 'Octa+', 'Sparki', 'TotalEnergies'],
      all: ['10S', '2Valorise Amel', '7C Solarparken Belgium', 'A & S Energie', 'Alix (Aya)', 'ArcelorMittal Energy', 'Aspiravi Energy', 'Axpo Benelux', 'Belgian Eco Energy', 'Bertemes', 'Besix Power', 'Biowanze', 'Bolt Energie', 'Burgo Energia', 'Calcaires Agri Energie', 'Cociter', 'D&B Green Solution Invest', 'Danske Commodities', 'Dats 24', 'Ecofix Gas & Power', 'Ecopower', 'Elexys', 'Elindus', 'Eneco Belgium', 'Enerdeal Solar Invest II', 'Energie.be', 'Energy Cluster', 'EnergyVision', 'Enersol', 'Engie Electrabel', 'Engie Sun4Business', 'Eni', 'Enwyse Belgium', 'Eoly', 'Fairwind', 'Getec Energie', 'Green Belgian Environmental Solutions', 'Green Energy Solutions Invest', 'Green for Power (Helios)', 'Green4Power', 'Île solaire du Perlonjour', "L'Oréal Libramont", 'Luminus', 'MyPower (Mydibel)', 'Next Kraftwerke', 'Octa+ Energie', 'Power Online (Mega)', 'Rabotage et Séchage du Bois', 'RWE Supply & Trading', 'Scholt Energy', 'Skysix', 'Skysun 2', 'Société européenne de gestion de l\'énergie', 'Solar Roof BE', 'Solarbuild 7 (EnergyVision)', 'Solea Invest', 'Sparki', 'Total Direct Énergie', 'TotalEnergies Gas & Power Western Europe', 'TotalEnergies Power & Gas Belgium', 'TotalEnergies Renewables DG Belgium Assetco 1', 'Trevion', 'Ukko Energy', 'Ventis', "Vents d'Houyet", 'Vlaams Energiebedrijf', 'Weerts Logistic Park BER 1', 'Yuso'],
    },
    BR: { // Brugel
      home: ['Bolt', 'Brusol (EnergyVision)', 'Eneco (plus de nouveaux clients)', 'Engie', 'Luminus', 'Mega', 'TotalEnergies'],
      all: ['Axpo Benelux', 'Aya Energy (Alix)', 'Belgian Eco Energy', 'Besix Power', 'Bolt Energie', 'Brusol (EnergyVision)', 'Dats 24', 'Ecopower', 'Elindus', 'Eneco', 'Energie.be', 'Energy Cluster', 'Engie Electrabel', 'Eni', 'Enwyse', 'Luminus', 'Octa+', 'Power Online (Mega)', 'RWE Supply & Trading', 'Scholt Energy', 'TotalEnergies', 'TotalEnergies Gas & Power Western Europe', 'Trevion', 'Ukko Energy', 'Yuso'],
    },
    VL: { // Vlaamse Nutsregulator, liste du 11 juin 2026 (électricité)
      all: ['Alix', 'Aspiravi Energy', 'Axpo Benelux', 'Belgian Eco Energy', 'Belvus', 'Bolt Energie', 'Dats 24', 'Dots Energy', 'Ecofix Gas & Power', 'Ecopower', 'Eddy Grid Belgium', 'Electrabel (Engie)', 'Elegant', 'Elektriciteitsbedrijf Merksplas', 'Elexys', 'Elindus', 'Eneco Belgium', 'Energie.be', 'EnergyVision', 'Energy Knights', 'Energy Together', 'Enwyse Belgium', 'Frank Energie België', 'Getec Energie', 'Luminus', 'Octa+ Energie', 'Power Online (Mega)', 'RWE Supply & Trading', 'Scholt Energy', 'Sparki', 'TotalEnergies Gas & Power Western Europe', 'TotalEnergies Gas & Power Limited', 'TotalEnergies Power & Gas Belgium', 'Trevion', 'Ukko Energy', 'Vlaams Energiebedrijf', 'Wase Wind', 'Yuso'],
    },
  };
  Object.entries(SUP).forEach(([r, { home, all }]) => {
    if (home) document.getElementById('sup' + r).innerHTML = home.map(n => `<li>${n}</li>`).join('');
    document.getElementById('sup' + r + 'n').textContent = `Tous les titulaires d'une licence (${all.length})`;
    document.getElementById('sup' + r + 'all').textContent = all.join(' · ');
  });
}

// --- Parties 4 à 6 : chiffres Eurostat 2024 (bilan énergétique nrg_bal_c, gaz nrg_ti_gas, émissions env_air_gge)
function renderBars(id, rows, unit, digits = 0) { // rows: [nom, détail, valeur] ; barres relatives à la plus grande
  const max = Math.max(...rows.map(r => r[2])), total = rows.reduce((s, r) => s + r[2], 0);
  document.getElementById(id).innerHTML = rows.map(([name, what, v]) => `
    <li style="--w:${100 * v / max}%">
      <span class="bname">${name}</span><span class="n">${v.toLocaleString('fr-BE', { maximumFractionDigits: digits })} ${unit}</span>
      <i></i><small>${Math.round(100 * v / total)} %${what ? ' · ' + what : ''}</small>
    </li>`).join('');
}
renderBars('ghg', [ // Mt éq. CO2, 2024
  ['Transports', 'voitures, camions, avions intérieurs', 24.9],
  ['Procédés industriels', 'chimie, ciment, acier : réactions, pas combustion', 15.7],
  ['Production d\'énergie', 'centrales électriques, raffineries', 14.8],
  ['Combustion dans l\'industrie', 'fours et chaudières des usines', 13.0],
  ['Chauffage des logements', 'gaz et mazout surtout', 12.6],
  ['Agriculture', 'élevage, engrais', 8.3],
  ['Chauffage des bureaux et commerces', '', 4.5],
  ['Machines agricoles et serres', '', 2.7],
  ['Déchets', 'décharges, eaux usées', 1.2],
  ['Fuites', 'gaz et pétrole', 0.3],
], 'Mt', 1);
renderMix('mixPrimary', 'legendPrimary', [ // ktep, consommation intérieure brute 2024
  { label: 'Pétrole', color: 'var(--oil)', value: 21036.4 },
  { label: 'Gaz naturel', color: 'var(--gas)', value: 11922.3 },
  { label: 'Nucléaire', color: 'var(--nuc)', value: 7514.5 },
  { label: 'Renouvelables et biocarburants', color: 'var(--bio)', value: 5384.9 },
  { label: 'Charbon', color: 'var(--ink)', value: 2629.4 },
  { label: 'Électricité importée (solde)', color: 'var(--volt)', value: 889.2 },
  { label: 'Déchets non renouvelables', color: 'var(--waste)', value: 606.6 },
  { label: 'Chaleur', color: 'var(--hydro)', value: 65.9 },
], pct);
renderBars('gasOrigin', [ // millions de m³, 2024
  ['Norvège', 'gazoducs sous la mer du Nord', 6294], ['Russie', 'gaz naturel liquéfié, par méthanier', 3445],
  ['Qatar', 'gaz naturel liquéfié', 2762], ['France', '', 2115], ['Pays-Bas', '', 1695],
  ['États-Unis', 'gaz naturel liquéfié', 1261], ['Royaume-Uni', '', 1204], ['Nigeria', '', 86], ['Danemark', '', 60], ['Allemagne', '', 30],
], 'Mm³');
renderBars('energySectors', [ // ktep, consommation finale d'énergie 2024
  ['Industrie', 'chimie, métallurgie, alimentation…', 9846.7],
  ['Transports', 'carburants surtout', 8920.9],
  ['Ménages', 'chauffage, eau chaude, électricité', 7099.3],
  ['Commerces et services', 'bureaux, magasins, hôpitaux, écoles', 3933.3],
  ['Agriculture, forêt et pêche', '', 908.7],
], 'ktep');

// --- Texte surligné ligne par ligne : chaque paragraphe reçoit un <span class="hl"> (rétabli si le texte est remplacé)
{
  const SEL = '.panel > p, .panel > h2, .part > p, .part > h2, .live > p';
  const wrap = el => {
    if (el.firstElementChild?.classList?.contains('hl') || el.querySelector(':scope > .hl')) return;
    const span = document.createElement('span');
    span.className = 'hl';
    [...el.childNodes].filter(n => !(n.nodeType === 1 && n.tagName.toLowerCase() === 'svg')).forEach(n => span.appendChild(n));
    if (span.textContent.trim()) el.appendChild(span);
  };
  document.querySelectorAll(SEL).forEach(wrap);
  new MutationObserver(ms => ms.forEach(m => m.target.matches?.(SEL) && wrap(m.target)))
    .observe(document.querySelector('.story'), { childList: true, subtree: true });
}
