const DAY_MS = 86400000;
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_MONTH = 29.530588853;

// Mean orbital elements at epoch J2000 (good enough for cycle-timing purposes)
const PLANETS = {
  Mercury: { a: 0.387099, e: 0.205630, i: 7.0049, node: 48.3316, L0: 252.2509, peri: 77.4561, period: 87.9691 },
  Venus: { a: 0.723332, e: 0.006772, i: 3.3947, node: 76.6799, L0: 181.9798, peri: 131.5637, period: 224.7008 },
  Earth: { a: 1.0, e: 0.016709, i: 0.0, node: 0.0, L0: 100.4644, peri: 102.9373, period: 365.2564 },
  Mars: { a: 1.523679, e: 0.0934, i: 1.8497, node: 49.5574, L0: 355.4533, peri: 336.0602, period: 686.9796 },
  Jupiter: { a: 5.2026, e: 0.0489, i: 1.3030, node: 100.4542, L0: 34.3515, peri: 14.3312, period: 4332.59 },
  Saturn: { a: 9.5549, e: 0.0557, i: 2.4886, node: 113.6634, L0: 49.9489, peri: 92.4318, period: 10759.22 },
  Uranus: { a: 19.1913, e: 0.0472, i: 0.7733, node: 74.0005, L0: 312.56, peri: 170.96, period: 30685.4 },
  Neptune: { a: 30.0689, e: 0.0086, i: 1.7700, node: 131.7806, L0: 304.88, peri: 44.97, period: 60189.0 },
  Pluto: { a: 39.4820, e: 0.2488, i: 17.1417, node: 110.3035, L0: 238.92, peri: 224.07, period: 90560.0 },
};
Object.values(PLANETS).forEach((p) => { p.n = 360 / p.period; });

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => {
  let d = ((r * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
};
const norm180 = (deg) => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
};
const cosd = (d) => Math.cos(deg2rad(d));
const sind = (d) => Math.sin(deg2rad(d));

// Mean anomaly helper
function meanAnomaly(p, days) {
  return (((p.L0 + p.n * days - p.peri) % 360) + 360) % 360;
}

// Planetary perturbation corrections (Schlyter / Meeus, in degrees)
// Accounts for gravitational pull of Jupiter on inner planets
function getPerturbation(body, days) {
  const Mm = meanAnomaly(PLANETS.Mercury, days);
  const Mv = meanAnomaly(PLANETS.Venus, days);
  const Me = meanAnomaly(PLANETS.Earth, days);
  const Ma = meanAnomaly(PLANETS.Mars, days);
  const Mj = ((19.895 + 0.08309 * days) % 360 + 360) % 360; // Jupiter mean anomaly

  if (body === 'Mercury') {
    return 0.00204*cosd(5*Mv - 2*Mm + 12.220)
         + 0.00103*cosd(2*Mv - Mm - 160.692)
         + 0.00091*cosd(2*Mj - Mm - 37.003)
         + 0.00078*cosd(5*Mv - 3*Mm + 10.137);
  }
  if (body === 'Venus') {
    return 0.00313*cosd(2*Me - 2*Mv - 148.225)
         + 0.00198*cosd(3*Me - 3*Mv + 2.565)
         + 0.00136*cosd(Me - Mv - 119.107)
         + 0.00096*cosd(3*Me - 2*Mv - 135.912)
         + 0.00082*cosd(Mj - Mv - 208.087);
  }
  if (body === 'Mars') {
    return -0.01133*cosd(2*Mj - Ma - 17.680)
         + 0.00728*cosd(Mj)
         - 0.00330*cosd(Mj + Ma)
         + 0.00251*cosd(2*Mj - 2*Ma)
         - 0.00196*cosd(2*Mj - 3*Ma - 12.0);
  }
  return 0;
}

function solveKepler(M, e) {
  let E = M;
  let F, dF;
  for (let i = 0; i < 5; i++) {
    F = E - e * Math.sin(E) - M;
    dF = 1 - e * Math.cos(E);
    E = E - F / dF;
  }
  return E;
}

function helio(p, days, dLon) {
  const L = ((p.L0 + p.n * days) % 360 + 360) % 360;
  const M = deg2rad((((L - p.peri) % 360) + 360) % 360);
  const e = p.e;
  
  const E = solveKepler(M, e);
  const v = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));
  const r = (p.a * (1 - e * e)) / (1 + e * Math.cos(v));
  
  const omega = deg2rad(p.peri - p.node);
  const node = deg2rad(p.node);
  const i = deg2rad(p.i);
  const u = omega + v;
  
  const x = r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(i));
  const y = r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(i));
  const z = r * (Math.sin(u) * Math.sin(i));
  
  if (dLon !== 0) {
    const lon = Math.atan2(y, x) + deg2rad(dLon);
    const rxy = Math.sqrt(x*x + y*y);
    return { x: rxy * Math.cos(lon), y: rxy * Math.sin(lon), z };
  }
  return { x, y, z };
}
function geoLong(key, days) {
  const dLon = getPerturbation(key, days);
  const earth = helio(PLANETS.Earth, days, 0);
  const pl = helio(PLANETS[key], days, dLon);
  return rad2deg(Math.atan2(pl.y - earth.y, pl.x - earth.x));
}
function sunGeoLong(days) {
  const earth = helio(PLANETS.Earth, days, 0);
  return rad2deg(Math.atan2(-earth.y, -earth.x));
}
function getLong(body, days) {
  const T = days / 36525;
  const precession = 1.39697137 * T;
  const siderealLong = body === 'Sun' ? sunGeoLong(days) : geoLong(body, days);
  return ((siderealLong + precession) % 360 + 360) % 360;
}

function getDailyMotion(planet, ms) {
  const t = (ms - J2000) / DAY_MS;
  const l1 = geoLong(planet, t - 1);
  const l2 = geoLong(planet, t);
  return norm180(l2 - l1);
}

function computeRetrogradeEvents(minMs, maxMs) {
  const events = [];
  const startMs = minMs - DAY_MS;
  for (let ms = startMs; ms <= maxMs; ms += DAY_MS) {
    ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].forEach(planet => {
      const m1 = getDailyMotion(planet, ms - DAY_MS);
      const m2 = getDailyMotion(planet, ms);
      
      if (m1 >= 0 && m2 < 0) {
        const shift = Math.abs(m1) < Math.abs(m2) ? -DAY_MS : 0;
        events.push({
          ms: ms + shift,
          date: new Date(ms + shift).toISOString().slice(0, 10),
          type: 'retro',
          label: `${planet} Station Retrograde`,
          planet,
          weight: 2.5
        });
      } else if (m1 < 0 && m2 >= 0) {
        const shift = Math.abs(m1) < Math.abs(m2) ? -DAY_MS : 0;
        events.push({
          ms: ms + shift,
          date: new Date(ms + shift).toISOString().slice(0, 10),
          type: 'retro',
          label: `${planet} Station Direct`,
          planet,
          weight: 2.0
        });
      }
    });
  }
  return events;
}

function computeIngressEvents(minMs, maxMs) {
  const events = [];
  const startMs = minMs - DAY_MS;
  const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  
  for (let ms = startMs; ms <= maxMs; ms += DAY_MS) {
    const tPrev = (ms - DAY_MS - J2000) / DAY_MS;
    const tCurr = (ms - J2000) / DAY_MS;
    
    ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].forEach(planet => {
      const lPrev = getLong(planet, tPrev);
      const lCurr = getLong(planet, tCurr);
      const sPrev = Math.floor(((lPrev % 360) + 360) % 360 / 30) % 12;
      const sCurr = Math.floor(((lCurr % 360) + 360) % 360 / 30) % 12;
      
      if (sPrev !== sCurr) {
        const signName = SIGNS[sCurr];
        events.push({
          ms,
          date: new Date(ms).toISOString().slice(0, 10),
          type: 'ingress',
          label: `Ingress: ${planet} ➔ ${signName}`,
          weight: 1.5
        });
      }
    });
  }
  return events;
}

const FIB_DAYS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618];

const IPO_DATES = {
  '^JKSE': '1977-08-10',
  '^GSPC': '1957-03-04',
  'BBCA.JK': '2000-05-31',
  'BBRI.JK': '2003-11-10',
  'BMRI.JK': '2003-07-14',
  'BBNI.JK': '1996-11-25',
  'TLKM.JK': '1995-11-14',
  'ASII.JK': '1990-04-04',
  'AMMN.JK': '2023-07-07',
  'GOTO.JK': '2022-04-11',
  'BTC-USD': '2009-01-03',
  'ETH-USD': '2015-07-30',
  'GC=F': '2000-08-30',
  'XAUUSD=X': '2003-12-01'
};

// ---------------------------------------------------------------------------
// Computation helpers
// ---------------------------------------------------------------------------
const BEI_HOLIDAYS = [
  '2024-01-01', '2024-02-08', '2024-02-09', '2024-03-11', '2024-03-12', '2024-03-29', '2024-04-08', '2024-04-09', '2024-04-10', '2024-04-11', '2024-04-12', '2024-04-15', '2024-05-01', '2024-05-09', '2024-05-10', '2024-05-23', '2024-05-24', '2024-06-17', '2024-06-18', '2024-12-25', '2024-12-26',
  '2025-01-01', '2025-01-27', '2025-01-29', '2025-03-28', '2025-03-31', '2025-04-01', '2025-04-02', '2025-04-03', '2025-04-04', '2025-04-18', '2025-05-01', '2025-05-12', '2025-05-29', '2025-06-06', '2025-06-27', '2025-08-17', '2025-09-05', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-02-17', '2026-03-19', '2026-03-20', '2026-04-03', '2026-05-01', '2026-05-14', '2026-06-01', '2026-06-16', '2026-08-17', '2026-09-16', '2026-12-25', '2026-12-28'
];

const US_HOLIDAYS = [
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'
];

function addTradingDays(anchorMs, n, ticker = '^JKSE') {
  if (n <= 0) return new Date(anchorMs);
  
  if (ticker && ticker.includes('-USD')) {
    return new Date(anchorMs + n * DAY_MS);
  }
  
  let ms = anchorMs;
  let added = 0;
  
  const isBEI = ticker && (ticker.endsWith('.JK') || ticker === '^JKSE');
  const isUS = ticker && (ticker === '^GSPC' || ticker === 'GC=F');
  
  while (added < n) {
    ms += DAY_MS;
    const dateObj = new Date(ms);
    const dow = dateObj.getUTCDay();
    const dateStr = dateObj.toISOString().slice(0, 10);
    
    if (dow === 0 || dow === 6) continue;
    
    if (isBEI && BEI_HOLIDAYS.includes(dateStr)) continue;
    if (isUS && US_HOLIDAYS.includes(dateStr)) continue;
    
    added += 1;
  }
  return new Date(ms);
}

function computeFibZones(anchors, projectionDays, dayMode, ticker = '^JKSE') {
  const zones = [];
  anchors.forEach((a, idx) => {
    if (Number.isNaN(a.ms)) return;
    
    FIB_DAYS.forEach((f) => {
      const date = dayMode === 'trading' ? addTradingDays(a.ms, f, ticker) : new Date(a.ms + f * DAY_MS);
      const calDay = Math.round((date.getTime() - a.ms) / DAY_MS);
      if (calDay <= projectionDays) {
        const unit = dayMode === 'trading' ? 'hari bursa' : 'hari kalender';
        zones.push({ 
          anchorId: a.id, 
          day: f, 
          date, 
          label: `A${idx + 1} | H+${f} ${unit}`,
          ms: date.getTime()
        });
      }
    });
  });
  return zones.sort((x, y) => x.ms - y.ms);
}

function computeInterAnchorFib(anchors, minMs, maxMs) {
  const zones = [];
  const ratios = [0.618, 1.0, 1.618, 2.618, 4.236];
  for (let i = 0; i < anchors.length - 1; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const msA = anchors[i].ms;
      const msB = anchors[j].ms;
      const span = Math.abs(msB - msA) / DAY_MS;
      if (span < 5) continue;
      ratios.forEach(ratio => {
        const projMs = msB + (span * ratio * DAY_MS);
        if (projMs >= minMs && projMs <= maxMs) {
          zones.push({
            ms: projMs,
            date: new Date(projMs),
            label: `Inter-Fib: A${i+1}↔A${j+1} × ${ratio}`,
            anchorId: `inter-${anchors[i].id}-${anchors[j].id}`,
            weight: 3.5
          });
        }
      });
    }
  }
  return zones.sort((x, y) => x.ms - y.ms);
}

function computeFibLevels(high, low) {
  const range = high - low;
  return FIB_RATIOS.map((r) => ({
    ratio: r,
    fromLow: low + range * r,
    fromHigh: high - range * r,
  }));
}

function meeusPhaseMs(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let JDE = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;
  const Msun = deg2rad(((2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3) % 360 + 360) % 360);
  const Mmoon = deg2rad(((201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) % 360 + 360) % 360);
  const F = deg2rad(((160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) % 360 + 360) % 360);
  const Om = deg2rad(((124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) % 360 + 360) % 360);
  const frac = ((k % 1) + 1) % 1;
  let corr;
  if (frac < 0.01 || frac > 0.99) {
    corr = -0.40720*Math.sin(Mmoon) + 0.17241*E*Math.sin(Msun) + 0.01608*Math.sin(2*Mmoon) + 0.01039*Math.sin(2*F) + 0.00739*E*Math.sin(Mmoon-Msun) - 0.00514*E*Math.sin(Mmoon+Msun) + 0.00208*E2*Math.sin(2*Msun) - 0.00111*Math.sin(Mmoon-2*F) - 0.00057*Math.sin(Mmoon+2*F) + 0.00056*E*Math.sin(2*Mmoon+Msun) - 0.00042*Math.sin(3*Mmoon) + 0.00042*E*Math.sin(Msun+2*F) + 0.00038*E*Math.sin(Msun-2*F) - 0.00024*E*Math.sin(2*Mmoon-Msun) - 0.00017*Math.sin(Om) - 0.00007*Math.sin(Mmoon+2*Msun) + 0.00004*Math.sin(2*Mmoon-2*F) + 0.00004*Math.sin(3*Msun) + 0.00003*Math.sin(Mmoon+Msun-2*F) + 0.00003*Math.sin(2*Mmoon+2*F) - 0.00003*Math.sin(Mmoon+Msun+2*F) + 0.00003*Math.sin(Mmoon-Msun+2*F) - 0.00002*Math.sin(Mmoon-Msun-2*F) - 0.00002*Math.sin(3*Mmoon+Msun) + 0.00002*Math.sin(4*Mmoon);
  } else if (Math.abs(frac - 0.5) < 0.01) {
    corr = -0.40614*Math.sin(Mmoon) + 0.17302*E*Math.sin(Msun) + 0.01614*Math.sin(2*Mmoon) + 0.01043*Math.sin(2*F) + 0.00734*E*Math.sin(Mmoon-Msun) - 0.00515*E*Math.sin(Mmoon+Msun) + 0.00209*E2*Math.sin(2*Msun) - 0.00111*Math.sin(Mmoon-2*F) - 0.00057*Math.sin(Mmoon+2*F) + 0.00056*E*Math.sin(2*Mmoon+Msun) - 0.00042*Math.sin(3*Mmoon) + 0.00042*E*Math.sin(Msun+2*F) + 0.00038*E*Math.sin(Msun-2*F) - 0.00024*E*Math.sin(2*Mmoon-Msun) - 0.00017*Math.sin(Om) - 0.00007*Math.sin(Mmoon+2*Msun) + 0.00004*Math.sin(2*Mmoon-2*F) + 0.00004*Math.sin(3*Msun) + 0.00003*Math.sin(Mmoon+Msun-2*F) + 0.00003*Math.sin(2*Mmoon+2*F) - 0.00003*Math.sin(Mmoon+Msun+2*F) + 0.00003*Math.sin(Mmoon-Msun+2*F) - 0.00002*Math.sin(Mmoon-Msun-2*F) - 0.00002*Math.sin(3*Mmoon+Msun) + 0.00002*Math.sin(4*Mmoon);
  } else {
    corr = -0.62801*Math.sin(Mmoon) + 0.17172*E*Math.sin(Msun) - 0.01183*E*Math.sin(Mmoon+Msun) + 0.00862*Math.sin(2*Mmoon) + 0.00804*Math.sin(2*F) + 0.00454*E*Math.sin(Mmoon-Msun) + 0.00204*E2*Math.sin(2*Msun) - 0.00180*Math.sin(Mmoon-2*F) - 0.00070*Math.sin(Mmoon+2*F) - 0.00040*Math.sin(3*Mmoon) - 0.00034*E*Math.sin(2*Mmoon-Msun) + 0.00032*E*Math.sin(Msun+2*F) + 0.00032*E*Math.sin(Msun-2*F) - 0.00028*E2*Math.sin(Mmoon+2*Msun) + 0.00027*E*Math.sin(2*Mmoon+Msun) - 0.00017*Math.sin(Om) - 0.00005*Math.sin(Mmoon-Msun-2*F) + 0.00004*Math.sin(2*Mmoon+2*F) - 0.00004*Math.sin(Mmoon+Msun+2*F) + 0.00004*Math.sin(Mmoon-2*Msun) + 0.00003*Math.sin(Mmoon+Msun-2*F) + 0.00003*Math.sin(3*Msun) + 0.00002*Math.sin(2*Mmoon-2*F) + 0.00002*Math.sin(Mmoon-Msun+2*F) - 0.00002*Math.sin(3*Mmoon+Msun);
    const W = 0.00306 - 0.00038*E*Math.cos(Msun) + 0.00026*Math.cos(Mmoon) - 0.00002*Math.cos(Mmoon-Msun) + 0.00002*Math.cos(Mmoon+Msun) + 0.00002*Math.cos(2*F);
    corr += (Math.abs(frac - 0.25) < 0.01) ? W : -W;
  }
  JDE += corr;
  return J2000 + (JDE - 2451545.0) * DAY_MS;
}

function computeMoonEvents(minAnchorMs, maxTargetMs) {
  const events = [];
  const startDate = new Date(minAnchorMs);
  const startYear = startDate.getUTCFullYear() + (startDate.getUTCMonth() + startDate.getUTCDate() / 30) / 12;
  let k0 = Math.floor((startYear - 2000) * 12.3685) - 2;
  const phases = [
    { offset: 0, label: 'Bulan Baru (New Moon)', weight: 2.0 },
    { offset: 0.25, label: 'Kuartal Pertama (First Quarter)', weight: 0.5 },
    { offset: 0.5, label: 'Bulan Purnama (Full Moon)', weight: 2.0 },
    { offset: 0.75, label: 'Kuartal Terakhir (Last Quarter)', weight: 0.5 },
  ];
  for (let ki = k0; ; ki++) {
    const d0Ms = meeusPhaseMs(ki);
    if (d0Ms > maxTargetMs + 35 * DAY_MS) break;
    for (const p of phases) {
      const ms = meeusPhaseMs(ki + p.offset);
      if (ms >= minAnchorMs && ms <= maxTargetMs) {
        let isEclipse = false;
        if (p.offset === 0 || p.offset === 0.5) {
          const t = (ms - J2000) / DAY_MS;
          const T = t / 36525;
          const nodeLong = ((125.0445 - 1934.1363 * T) % 360 + 360) % 360;
          const sunLong = getLong('Sun', t);
          const dist = Math.abs(norm180(sunLong - nodeLong));
          // Eclipse limit: Solar ~15.5°, Lunar ~12.5° from node
          const eclipseThreshold = (p.offset === 0) ? 15.5 : 12.5;
          if (dist < eclipseThreshold || Math.abs(dist - 180) < eclipseThreshold) isEclipse = true;
        }
        events.push({ 
          date: new Date(ms), 
          label: isEclipse ? `Gerhana / Eclipse (${p.label})` : p.label, 
          weight: isEclipse ? 4.0 : p.weight 
        });
      }
    }
  }
  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}

function getMoonDeclination(days) {
  const T = days / 36525;
  const Lprime = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mprime = 134.9633964 + 477198.8675055 * T;
  const F = 93.2720950 + 483202.0175233 * T;
  
  const lambda = Lprime 
    + 6.289 * sind(Mprime) 
    + 1.274 * sind(2 * D - Mprime) 
    + 0.658 * sind(2 * D)
    + 0.214 * sind(2 * Mprime)
    - 0.186 * sind(M)
    - 0.114 * sind(2 * F);

  const beta = 5.128 * sind(F) 
    + 0.280 * sind(Mprime + F) 
    + 0.277 * sind(Mprime - F)
    + 0.173 * sind(2 * D - F);

  const epsilon = 23.439291 - 0.0130042 * T;

  const sinDec = sind(beta) * cosd(epsilon) + cosd(beta) * sind(epsilon) * sind(lambda);
  return (Math.asin(sinDec) * 180) / Math.PI;
}

function computeMoonDeclinationEvents(minMs, maxMs) {
  const events = [];
  const startDays = (minMs - J2000) / DAY_MS - 1;
  const maxDays = Math.ceil((maxMs - minMs) / DAY_MS) + 1;
  
  let prevDec = null;
  let prevTrend = null; // 1 for up, -1 for down
  
  for (let d = 0; d <= maxDays; d++) {
    const dec = getMoonDeclination(startDays + d);
    if (d > 0) {
      const ms = minMs + (d - 1) * DAY_MS;
      const date = new Date(ms);
      
      if (prevDec !== null) {
        // Zero cross
        if ((prevDec >= 0 && dec < 0) || (prevDec < 0 && dec >= 0)) {
          const shift = Math.abs(dec) < Math.abs(prevDec) ? 1 : 0;
          events.push({ date: new Date(ms + shift * DAY_MS), label: 'Deklinasi: Melintasi Ekuator (0°)', weight: 1.5 });
        }
        
        // OOB cross
        if (prevDec < 23.44 && dec >= 23.44) {
          const shift = Math.abs(dec - 23.44) < Math.abs(prevDec - 23.44) ? 1 : 0;
          events.push({ date: new Date(ms + shift * DAY_MS), label: 'Deklinasi: OOB Utara (> 23.44°)', weight: 2.0 });
        } else if (prevDec >= 23.44 && dec < 23.44) {
          const shift = Math.abs(dec - 23.44) < Math.abs(prevDec - 23.44) ? 1 : 0;
          events.push({ date: new Date(ms + shift * DAY_MS), label: 'Deklinasi: Re-enter dari Utara', weight: 2.5 });
        } else if (prevDec > -23.44 && dec <= -23.44) {
          const shift = Math.abs(dec + 23.44) < Math.abs(prevDec + 23.44) ? 1 : 0;
          events.push({ date: new Date(ms + shift * DAY_MS), label: 'Deklinasi: OOB Selatan (< -23.44°)', weight: 2.0 });
        } else if (prevDec <= -23.44 && dec > -23.44) {
          const shift = Math.abs(dec + 23.44) < Math.abs(prevDec + 23.44) ? 1 : 0;
          events.push({ date: new Date(ms + shift * DAY_MS), label: 'Deklinasi: Re-enter dari Selatan', weight: 2.5 });
        }
        
        // Maxima / Minima
        const trend = dec > prevDec ? 1 : -1;
        if (prevTrend !== null && trend !== prevTrend) {
          if (prevTrend === 1) {
            events.push({ date, label: `Deklinasi: Maksimum Utara (${prevDec.toFixed(1)}°)`, weight: 3.0 });
          } else {
            events.push({ date, label: `Deklinasi: Maksimum Selatan (${prevDec.toFixed(1)}°)`, weight: 3.0 });
          }
        }
        prevTrend = trend;
      }
    }
    prevDec = dec;
  }
  return events.filter(e => e.date.getTime() >= minMs && e.date.getTime() <= maxMs).sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Pasangan planet yang signifikan secara astrologi keuangan untuk aspek minor (Trine/Sextile)
const MAJOR_FINANCIAL_PAIRS = new Set([
  'Sun-Jupiter', 'Sun-Saturn', 'Sun-Mars', 'Sun-Uranus',
  'Venus-Uranus', 'Venus-Jupiter', 'Venus-Saturn',
  'Jupiter-Saturn', 'Mars-Jupiter', 'Mars-Saturn', 'Jupiter-Uranus'
]);

function computePlanetEvents(minAnchorMs, maxTargetMs) {
  const events = [];
  const anchorDaysJ2000 = (minAnchorMs - J2000) / DAY_MS;
  const maxDays = Math.ceil((maxTargetMs - minAnchorMs) / DAY_MS);
  const bodies = ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  
  // 1. Precalculate Ephemeris (O(N) Optimization)
  const ephemeris = new Array(maxDays + 1);
  for (let d = 0; d <= maxDays; d++) {
    const days = anchorDaysJ2000 + d;
    ephemeris[d] = {};
    for (const b of bodies) {
      ephemeris[d][b] = getLong(b, days);
    }
  }

  const PAIRS = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      PAIRS.push({ a: bodies[i], b: bodies[j], label: `${bodies[i]}-${bodies[j]}` });
    }
  }
  
  for (const pair of PAIRS) {
    const isMajorPair = MAJOR_FINANCIAL_PAIRS.has(pair.label);
    let prevConj = null, prevOpp = null, prevSq1 = null, prevSq2 = null, prevTri1 = null, prevTri2 = null, prevSex1 = null, prevSex2 = null;
    
    for (let d = 0; d <= maxDays; d++) {
      const la = ephemeris[d][pair.a];
      const lb = ephemeris[d][pair.b];
      const conj = norm180(la - lb), opp = norm180(la - lb - 180), sq1 = norm180(la - lb - 90), sq2 = norm180(la - lb + 90), tri1 = norm180(la - lb - 120), tri2 = norm180(la - lb + 120), sex1 = norm180(la - lb - 60), sex2 = norm180(la - lb + 60);
      
      if (d > 0) {
        const checkCross = (p, c) => {
          if (p !== null && c !== null && p * c <= 0 && Math.abs(p - c) < 180) {
            return Math.abs(p) < Math.abs(c) ? -1 : 0;
          }
          return null;
        };
        
        // Conjunction & Opposition: all pairs (high significance)
        const cConj = checkCross(prevConj, conj);
        if (cConj !== null) events.push({ date: new Date(minAnchorMs + (d + cConj) * DAY_MS), label: `Konjungsi (0°): ${pair.label}`, weight: 3.0 });
        
        const cOpp = checkCross(prevOpp, opp);
        if (cOpp !== null) events.push({ date: new Date(minAnchorMs + (d + cOpp) * DAY_MS), label: `Oposisi (180°): ${pair.label}`, weight: 2.5 });
        
        // Square: all pairs (medium significance)
        const cSq1 = checkCross(prevSq1, sq1);
        const cSq2 = checkCross(prevSq2, sq2);
        if (cSq1 !== null || cSq2 !== null) {
          const shift = cSq1 !== null ? cSq1 : cSq2;
          events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Square (90°): ${pair.label}`, weight: 1.5 });
        }
        
        // Trine & Sextile: only major financial pairs (reduces noise drastically)
        if (isMajorPair) {
          const cTri1 = checkCross(prevTri1, tri1);
          const cTri2 = checkCross(prevTri2, tri2);
          if (cTri1 !== null || cTri2 !== null) {
            const shift = cTri1 !== null ? cTri1 : cTri2;
            events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Trine (120°): ${pair.label}`, weight: 0.3 });
          }
          
          const cSex1 = checkCross(prevSex1, sex1);
          const cSex2 = checkCross(prevSex2, sex2);
          if (cSex1 !== null || cSex2 !== null) {
            const shift = cSex1 !== null ? cSex1 : cSex2;
            events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Sextile (60°): ${pair.label}`, weight: 0.1 });
          }
        }
      }
      prevConj = conj; prevOpp = opp; prevSq1 = sq1; prevSq2 = sq2; prevTri1 = tri1; prevTri2 = tri2; prevSex1 = sex1; prevSex2 = sex2;
    }
  }
  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}

function computeNatalEvents(ticker, minAnchorMs, maxTargetMs) {
  // Try to find IPO_DATES which might exist at global scope, if not return empty
  if (typeof IPO_DATES === 'undefined' || !IPO_DATES[ticker]) return [];
  const ipoDateMs = Date.parse(`${IPO_DATES[ticker]}T00:00:00Z`);
  if (Number.isNaN(ipoDateMs)) return [];
  
  const events = [];
  const ipoDaysJ2000 = (ipoDateMs - J2000) / DAY_MS;
  const natalPos = {
    Sun: getLong('Sun', ipoDaysJ2000),
    Mercury: getLong('Mercury', ipoDaysJ2000),
    Venus: getLong('Venus', ipoDaysJ2000),
    Mars: getLong('Mars', ipoDaysJ2000),
    Jupiter: getLong('Jupiter', ipoDaysJ2000),
    Saturn: getLong('Saturn', ipoDaysJ2000),
    Uranus: getLong('Uranus', ipoDaysJ2000),
    Neptune: getLong('Neptune', ipoDaysJ2000),
    Pluto: getLong('Pluto', ipoDaysJ2000),
  };
  
  const anchorDaysJ2000 = (minAnchorMs - J2000) / DAY_MS;
  const maxDays = Math.ceil((maxTargetMs - minAnchorMs) / DAY_MS);
  const transitPlanets = ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  
  const ephemeris = new Array(maxDays + 1);
  for (let d = 0; d <= maxDays; d++) {
    const days = anchorDaysJ2000 + d;
    ephemeris[d] = {};
    for (const b of transitPlanets) {
      ephemeris[d][b] = getLong(b, days);
    }
  }
  
  for (const tPlanet of transitPlanets) {
    for (const nPlanet of Object.keys(natalPos)) {
      // Skip fast-fast combos that happen too often, focus on slow planets or same planet return
      if (['Mercury', 'Venus'].includes(tPlanet) && tPlanet !== nPlanet) continue;
      
      let prevConj = null, prevOpp = null, prevSq1 = null, prevSq2 = null, prevTri1 = null, prevTri2 = null, prevSex1 = null, prevSex2 = null;
      for (let d = 0; d <= maxDays; d++) {
        const tLong = ephemeris[d][tPlanet];
        const nLong = natalPos[nPlanet];
        
        const conj = norm180(tLong - nLong);
        const opp = norm180(tLong - nLong - 180);
        const sq1 = norm180(tLong - nLong - 90);
        const sq2 = norm180(tLong - nLong + 90);
        const tri1 = norm180(tLong - nLong - 120);
        const tri2 = norm180(tLong - nLong + 120);
        const sex1 = norm180(tLong - nLong - 60);
        const sex2 = norm180(tLong - nLong + 60);
        
        if (d > 0) {
          const checkCross = (p, c) => {
            if (p !== null && c !== null && p * c <= 0 && Math.abs(p - c) < 180) {
              return Math.abs(p) < Math.abs(c) ? -1 : 0;
            }
            return null;
          };
          
          const labelPrefix = `Tr. ${tPlanet} ➔ Nat. ${nPlanet}`;
          
          const cConj = checkCross(prevConj, conj);
          if (cConj !== null) events.push({ date: new Date(minAnchorMs + (d + cConj) * DAY_MS), label: `Natal: Konjungsi (0°) ${labelPrefix}`, weight: 3.5 });
          
          const cOpp = checkCross(prevOpp, opp);
          if (cOpp !== null) events.push({ date: new Date(minAnchorMs + (d + cOpp) * DAY_MS), label: `Natal: Oposisi (180°) ${labelPrefix}`, weight: 3.0 });
          
          const cSq1 = checkCross(prevSq1, sq1);
          const cSq2 = checkCross(prevSq2, sq2);
          if (cSq1 !== null || cSq2 !== null) {
            const shift = cSq1 !== null ? cSq1 : cSq2;
            events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Natal: Square (90°) ${labelPrefix}`, weight: 2.0 });
          }
          
          const cTri1 = checkCross(prevTri1, tri1);
          const cTri2 = checkCross(prevTri2, tri2);
          if (cTri1 !== null || cTri2 !== null) {
            const shift = cTri1 !== null ? cTri1 : cTri2;
            events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Natal: Trine (120°) ${labelPrefix}`, weight: 1.2 });
          }
          
          const cSex1 = checkCross(prevSex1, sex1);
          const cSex2 = checkCross(prevSex2, sex2);
          if (cSex1 !== null || cSex2 !== null) {
            const shift = cSex1 !== null ? cSex1 : cSex2;
            events.push({ date: new Date(minAnchorMs + (d + shift) * DAY_MS), label: `Natal: Sextile (60°) ${labelPrefix}`, weight: 0.5 });
          }
        }
        prevConj = conj; prevOpp = opp; prevSq1 = sq1; prevSq2 = sq2; prevTri1 = tri1; prevTri2 = tri2; prevSex1 = sex1; prevSex2 = sex2;
      }
    }
  }
  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}


const startMs = new Date('2026-06-01T00:00:00Z').getTime();
const endMs = new Date('2026-06-30T00:00:00Z').getTime();

const retro = computeRetrogradeEvents(startMs, endMs);
console.log('Retrograde:', retro);
const ingress = computeIngressEvents(startMs, endMs);
console.log('Ingress:', ingress);
const moon = computeMoonEvents(startMs, endMs);
console.log('Moon Phases:', moon);
const dec = computeMoonDeclinationEvents(startMs, endMs);
console.log('Moon Declination:', dec);
const planets = computePlanetEvents(startMs, endMs);
console.log('Planetary Aspects:', planets);
