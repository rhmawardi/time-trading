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
    return 0.00204*cosd(5*Mv - 2*Mm + 12.220) + 0.00103*cosd(2*Mv - Mm - 160.692) + 0.00091*cosd(2*Mj - Mm - 37.003) + 0.00078*cosd(5*Mv - 3*Mm + 10.137);
  }
  if (body === 'Venus') {
    return 0.00313*cosd(2*Me - 2*Mv - 148.225) + 0.00198*cosd(3*Me - 3*Mv + 2.565) + 0.00136*cosd(Me - Mv - 119.107) + 0.00096*cosd(3*Me - 2*Mv - 135.912) + 0.00082*cosd(Mj - Mv - 208.087);
  }
  if (body === 'Mars') {
    return -0.01133*cosd(2*Mj - Ma - 17.680) + 0.00728*cosd(Mj) - 0.00330*cosd(Mj + Ma) + 0.00251*cosd(2*Mj - 2*Ma) - 0.00196*cosd(2*Mj - 3*Ma - 12.0);
  }
  return 0;
}

function helio(p, days, dLon) {
  const L = ((p.L0 + p.n * days) % 360 + 360) % 360;
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
  const T = days / 36525;
  const precession = 1.39697137 * T;
  const siderealLong = body === 'Sun' ? sunGeoLong(days) : geoLong(body, days);
  return ((siderealLong + precession) % 360 + 360) % 360;
}

function computeNatalEvents(ticker, minAnchorMs, maxTargetMs) {
  const IPO_DATES = { '^JKSE': '1977-08-10' };
  if (!IPO_DATES[ticker]) return [];
  const ipoDateMs = Date.parse(`${IPO_DATES[ticker]}T00:00:00Z`);
  
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
  
  for (const tPlanet of transitPlanets) {
    for (const nPlanet of Object.keys(natalPos)) {
      if (['Mercury', 'Venus'].includes(tPlanet) && tPlanet !== nPlanet) continue;
      
      let prevConj = null, prevOpp = null, prevSq1 = null, prevSq2 = null, prevTri1 = null, prevTri2 = null, prevSex1 = null, prevSex2 = null;
      for (let d = 0; d <= maxDays; d++) {
        const days = anchorDaysJ2000 + d;
        const tLong = getLong(tPlanet, days);
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
          const date = new Date(minAnchorMs + d * DAY_MS);
          const labelPrefix = `Tr. ${tPlanet} ➔ Nat. ${nPlanet}`;
          const isCross = (p, c) => p !== null && c !== null && p * c < 0 && Math.abs(p - c) < 180;
          if (isCross(prevConj, conj)) {
            events.push({ date, label: `Natal: Konjungsi (0°) ${labelPrefix}` });
          }
          if (isCross(prevOpp, opp)) {
            events.push({ date, label: `Natal: Oposisi (180°) ${labelPrefix}` });
          }
          if (isCross(prevSq1, sq1) || isCross(prevSq2, sq2)) {
            events.push({ date, label: `Natal: Square (90°) ${labelPrefix}` });
          }
          if (isCross(prevTri1, tri1) || isCross(prevTri2, tri2)) {
            events.push({ date, label: `Natal: Trine (120°) ${labelPrefix}` });
          }
          if (isCross(prevSex1, sex1) || isCross(prevSex2, sex2)) {
            events.push({ date, label: `Natal: Sextile (60°) ${labelPrefix}` });
          }
        }
        prevConj = conj; prevOpp = opp; prevSq1 = sq1; prevSq2 = sq2; prevTri1 = tri1; prevTri2 = tri2; prevSex1 = sex1; prevSex2 = sex2;
      }
    }
  }
  return events;
}

const targetMs = new Date('2026-06-15T00:00:00Z').getTime();
const startDate = targetMs - 2 * DAY_MS;
const endDate = targetMs + 2 * DAY_MS;

console.log("Natal Events:");
console.log(computeNatalEvents('^JKSE', startDate, endDate));

