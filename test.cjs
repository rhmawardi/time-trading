const fs = require('fs');

const DAY_MS = 86400000;
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

const PLANETS = {
  Mercury: { a: 0.387099, e: 0.205630, L0: 252.2509, peri: 77.4561, period: 87.9691 },
  Venus: { a: 0.723332, e: 0.006772, L0: 181.9798, peri: 131.5637, period: 224.7008 },
  Earth: { a: 1.0, e: 0.016709, L0: 100.4644, peri: 102.9373, period: 365.2564 },
  Mars: { a: 1.523679, e: 0.0934, L0: 355.4533, peri: 336.0602, period: 686.9796 },
  Jupiter: { a: 5.2026, e: 0.0489, L0: 34.3515, peri: 14.3312, period: 4332.59 },
  Saturn: { a: 9.5549, e: 0.0557, L0: 49.9489, peri: 92.4318, period: 10759.22 },
  Uranus: { a: 19.1913, e: 0.0472, L0: 312.56, peri: 170.96, period: 30685.4 },
  Neptune: { a: 30.0689, e: 0.0086, L0: 304.88, peri: 44.97, period: 60189.0 },
  Pluto: { a: 39.4820, e: 0.2488, L0: 238.92, peri: 224.07, period: 90560.0 },
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

function meanAnomaly(p, days) {
  return (((p.L0 + p.n * days - p.peri) % 360) + 360) % 360;
}

function getPerturbation(body, days) {
  const Mm = meanAnomaly(PLANETS.Mercury, days);
  const Mv = meanAnomaly(PLANETS.Venus, days);
  const Me = meanAnomaly(PLANETS.Earth, days);
  const Ma = meanAnomaly(PLANETS.Mars, days);
  const Mj = ((19.895 + 0.08309 * days) % 360 + 360) % 360; 

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

function helio(p, days, dLon) {
  const L = (p.L0 + p.n * days) % 360;
  const M = deg2rad((((L - p.peri) % 360) + 360) % 360);
  const e = p.e;
  const e2 = e * e, e3 = e2 * e, e4 = e3 * e, e5 = e4 * e;
  const nu = M
    + (2 * e - e3 / 4 + 5 * e5 / 96) * Math.sin(M)
    + (5 * e2 / 4 - 11 * e4 / 24) * Math.sin(2 * M)
    + (13 * e3 / 12 - 43 * e5 / 64) * Math.sin(3 * M)
    + 103 * e4 / 96 * Math.sin(4 * M)
    + 1097 * e5 / 960 * Math.sin(5 * M);
  const trueLong = deg2rad(p.peri) + nu + deg2rad(dLon || 0);
  const r = (p.a * (1 - e * e)) / (1 + e * Math.cos(nu));
  return { x: r * Math.cos(trueLong), y: r * Math.sin(trueLong) };
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
  return body === 'Sun' ? sunGeoLong(days) : geoLong(body, days);
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
        events.push({ ms, date: new Date(ms).toISOString().slice(0, 10), label: `${planet} Station Retrograde` });
      } else if (m1 < 0 && m2 >= 0) {
        events.push({ ms, date: new Date(ms).toISOString().slice(0, 10), label: `${planet} Station Direct` });
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
      const sPrev = Math.floor(lPrev / 30);
      const sCurr = Math.floor(lCurr / 30);
      
      if (sPrev !== sCurr) {
        events.push({ ms, date: new Date(ms).toISOString().slice(0, 10), label: `Ingress: ${planet} to ${SIGNS[sCurr]}` });
      }
    });
  }
  return events;
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
    { offset: 0, label: 'Bulan Baru (New Moon)' },
    { offset: 0.25, label: 'Kuartal Pertama (First Quarter)' },
    { offset: 0.5, label: 'Bulan Purnama (Full Moon)' },
    { offset: 0.75, label: 'Kuartal Terakhir (Last Quarter)' },
  ];
  for (let ki = k0; ; ki++) {
    const d0Ms = meeusPhaseMs(ki);
    if (d0Ms > maxTargetMs + 35 * DAY_MS) break;
    for (const p of phases) {
      const ms = meeusPhaseMs(ki + p.offset);
      if (ms >= minAnchorMs && ms <= maxTargetMs) {
        events.push({ date: new Date(ms), label: p.label });
      }
    }
  }
  return events;
}

function computePlanetEvents(minAnchorMs, maxTargetMs) {
  const events = [];
  const anchorDaysJ2000 = (minAnchorMs - J2000) / DAY_MS;
  const maxDays = Math.ceil((maxTargetMs - minAnchorMs) / DAY_MS);
  const bodies = ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  const PAIRS = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      PAIRS.push({ a: bodies[i], b: bodies[j], label: `${bodies[i]}-${bodies[j]}` });
    }
  }
  for (const pair of PAIRS) {
    let prevConj = null, prevOpp = null, prevSq1 = null, prevSq2 = null, prevTri1 = null, prevTri2 = null, prevSex1 = null, prevSex2 = null;
    for (let d = 0; d <= maxDays; d++) {
      const days = anchorDaysJ2000 + d;
      const la = getLong(pair.a, days);
      const lb = getLong(pair.b, days);
      const conj = norm180(la - lb), opp = norm180(la - lb - 180), sq1 = norm180(la - lb - 90), sq2 = norm180(la - lb + 90), tri1 = norm180(la - lb - 120), tri2 = norm180(la - lb + 120), sex1 = norm180(la - lb - 60), sex2 = norm180(la - lb + 60);
      
      if (d > 0) {
        if (Math.sign(prevConj) !== Math.sign(conj) && Math.abs(prevConj - conj) < 180) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Konjungsi (0°): ${pair.label}` });
        }
        if (Math.sign(prevOpp) !== Math.sign(opp) && Math.abs(prevOpp - opp) < 180) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Oposisi (180°): ${pair.label}` });
        }
        if ((Math.sign(prevSq1) !== Math.sign(sq1) && Math.abs(prevSq1 - sq1) < 180) || 
            (Math.sign(prevSq2) !== Math.sign(sq2) && Math.abs(prevSq2 - sq2) < 180)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Square (90°): ${pair.label}` });
        }
        if ((Math.sign(prevTri1) !== Math.sign(tri1) && Math.abs(prevTri1 - tri1) < 180) || 
            (Math.sign(prevTri2) !== Math.sign(tri2) && Math.abs(prevTri2 - tri2) < 180)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Trine (120°): ${pair.label}` });
        }
        if ((Math.sign(prevSex1) !== Math.sign(sex1) && Math.abs(prevSex1 - sex1) < 180) || 
            (Math.sign(prevSex2) !== Math.sign(sex2) && Math.abs(prevSex2 - sex2) < 180)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Sextile (60°): ${pair.label}` });
        }
      }
      prevConj = conj; prevOpp = opp; prevSq1 = sq1; prevSq2 = sq2; prevTri1 = tri1; prevTri2 = tri2; prevSex1 = sex1; prevSex2 = sex2;
    }
  }
  return events;
}

const targetDate = new Date('2026-06-15T00:00:00Z').getTime();
const startDate = targetDate - 2 * DAY_MS;
const endDate = targetDate + 2 * DAY_MS;

console.log("Moon:", computeMoonEvents(startDate, endDate));
console.log("Planets:", computePlanetEvents(startDate, endDate));
console.log("Ingress:", computeIngressEvents(startDate, endDate));
console.log("Retro:", computeRetrogradeEvents(startDate, endDate));

