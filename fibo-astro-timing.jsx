import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Moon, Orbit, CalendarRange, TrendingUp, Crosshair, Info, Target, Plus, Trash2, History, CheckCircle2, XCircle, Download, Loader2, Zap, Sparkles, RotateCcw, Milestone, Camera, Search, Settings, Trophy, Medal, ArrowRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ComposedChart, Line
} from 'recharts';
import { fetchMarketData, detectSwings } from './src/services/marketData.js';
import { runGridSearchOptimizer, formatToggleLabel } from './src/services/backtestOptimizer.js';

// ---------------------------------------------------------------------------
// Astronomical & Fibonacci core math
// ---------------------------------------------------------------------------
const DAY_MS = 86400000;
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_MONTH = 29.530588853;

// Mean orbital elements at epoch J2000 (good enough for cycle-timing purposes)
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

function helio(p, days, dLon) {
  const L = (p.L0 + p.n * days) % 360;
  const M = deg2rad((((L - p.peri) % 360) + 360) % 360);
  const e = p.e;
  const e2 = e * e, e3 = e2 * e, e4 = e3 * e, e5 = e4 * e;
  // 5th-order equation of center (upgraded from 3rd-order for Mercury precision)
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
        events.push({
          ms,
          date: new Date(ms).toISOString().slice(0, 10),
          type: 'retro',
          label: `${planet} Station Retrograde`,
          planet,
          weight: 2.5
        });
      } else if (m1 < 0 && m2 >= 0) {
        events.push({
          ms,
          date: new Date(ms).toISOString().slice(0, 10),
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
      const sPrev = Math.floor(lPrev / 30);
      const sCurr = Math.floor(lCurr / 30);
      
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
  'ETH-USD': '2015-07-30'
};

// ---------------------------------------------------------------------------
// Computation helpers
// ---------------------------------------------------------------------------
const BEI_HOLIDAYS = [
  '2024-01-01', '2024-02-08', '2024-02-09', '2024-03-11', '2024-03-12', '2024-03-29', '2024-04-08', '2024-04-09', '2024-04-10', '2024-04-11', '2024-04-12', '2024-04-15', '2024-05-01', '2024-05-09', '2024-05-10', '2024-05-23', '2024-05-24', '2024-06-17', '2024-06-18', '2024-12-25', '2024-12-26',
  '2025-01-01', '2025-01-27', '2025-01-29', '2025-03-28', '2025-03-31', '2025-04-01', '2025-04-02', '2025-04-03', '2025-04-04', '2025-04-18', '2025-05-01', '2025-05-12', '2025-05-29', '2025-06-06', '2025-06-27', '2025-08-17', '2025-09-05', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-02-17', '2026-03-19', '2026-03-20', '2026-04-03', '2026-05-01', '2026-05-14', '2026-06-01', '2026-08-17', '2026-12-25'
];

function addTradingDays(anchorMs, n) {
  let ms = anchorMs;
  let added = 0;
  while (added < n) {
    ms += DAY_MS;
    const dateObj = new Date(ms);
    const dow = dateObj.getUTCDay();
    const dateStr = dateObj.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !BEI_HOLIDAYS.includes(dateStr)) {
      added += 1;
    }
  }
  return new Date(ms);
}

function computeFibZones(anchors, projectionDays, dayMode) {
  const zones = [];
  anchors.forEach((a, idx) => {
    if (Number.isNaN(a.ms)) return;
    
    FIB_DAYS.forEach((f) => {
      const date = dayMode === 'trading' ? addTradingDays(a.ms, f) : new Date(a.ms + f * DAY_MS);
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
          const L0 = ((218.3165 + 481267.8813 * T) % 360 + 360) % 360;
          const dist = Math.abs(norm180(L0 - nodeLong));
          if (dist < 15 || Math.abs(dist - 180) < 15) isEclipse = true;
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

// Pasangan planet yang signifikan secara astrologi keuangan untuk aspek minor (Trine/Sextile)
const MAJOR_FINANCIAL_PAIRS = new Set([
  'Sun-Jupiter', 'Sun-Saturn', 'Sun-Mars',
  'Jupiter-Saturn', 'Mars-Jupiter', 'Mars-Saturn',
]);

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
    const isMajorPair = MAJOR_FINANCIAL_PAIRS.has(pair.label);
    let prevConj = null, prevOpp = null, prevSq1 = null, prevSq2 = null, prevTri1 = null, prevTri2 = null, prevSex1 = null, prevSex2 = null;
    for (let d = 0; d <= maxDays; d++) {
      const days = anchorDaysJ2000 + d;
      const la = getLong(pair.a, days);
      const lb = getLong(pair.b, days);
      const conj = norm180(la - lb), opp = norm180(la - lb - 180), sq1 = norm180(la - lb - 90), sq2 = norm180(la - lb + 90), tri1 = norm180(la - lb - 120), tri2 = norm180(la - lb + 120), sex1 = norm180(la - lb - 60), sex2 = norm180(la - lb + 60);
      
      if (d > 0) {
        const isCross = (p, c) => p !== null && c !== null && (p >= 0 ? 1 : -1) !== (c >= 0 ? 1 : -1) && Math.abs(p - c) < 180;
        
        // Conjunction & Opposition: all pairs (high significance)
        if (isCross(prevConj, conj)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Konjungsi (0°): ${pair.label}`, weight: 3.0 });
        }
        if (isCross(prevOpp, opp)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Oposisi (180°): ${pair.label}`, weight: 2.5 });
        }
        // Square: all pairs (medium significance)
        if (isCross(prevSq1, sq1) || isCross(prevSq2, sq2)) {
          events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Square (90°): ${pair.label}`, weight: 1.5 });
        }
        // Trine & Sextile: only major financial pairs (reduces noise drastically)
        if (isMajorPair) {
          if (isCross(prevTri1, tri1) || isCross(prevTri2, tri2)) {
            events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Trine (120°): ${pair.label}`, weight: 0.3 });
          }
          if (isCross(prevSex1, sex1) || isCross(prevSex2, sex2)) {
            events.push({ date: new Date(minAnchorMs + d * DAY_MS), label: `Sextile (60°): ${pair.label}`, weight: 0.1 });
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
  
  for (const tPlanet of transitPlanets) {
    for (const nPlanet of Object.keys(natalPos)) {
      // Skip fast-fast combos that happen too often, focus on slow planets or same planet return
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
          const isCross = (p, c) => p !== null && c !== null && (p >= 0 ? 1 : -1) !== (c >= 0 ? 1 : -1) && Math.abs(p - c) < 180;
          const date = new Date(minAnchorMs + d * DAY_MS);
          const labelPrefix = `Tr. ${tPlanet} ➔ Nat. ${nPlanet}`;
          if (isCross(prevConj, conj)) {
            events.push({ date, label: `Natal: Konjungsi (0°) ${labelPrefix}`, weight: 3.5 });
          }
          if (isCross(prevOpp, opp)) {
            events.push({ date, label: `Natal: Oposisi (180°) ${labelPrefix}`, weight: 3.0 });
          }
          if (isCross(prevSq1, sq1) || isCross(prevSq2, sq2)) {
            events.push({ date, label: `Natal: Square (90°) ${labelPrefix}`, weight: 2.0 });
          }
          if (isCross(prevTri1, tri1) || isCross(prevTri2, tri2)) {
            events.push({ date, label: `Natal: Trine (120°) ${labelPrefix}`, weight: 1.2 });
          }
          if (isCross(prevSex1, sex1) || isCross(prevSex2, sex2)) {
            events.push({ date, label: `Natal: Sextile (60°) ${labelPrefix}`, weight: 0.5 });
          }
        }
        prevConj = conj; prevOpp = opp; prevSq1 = sq1; prevSq2 = sq2; prevTri1 = tri1; prevTri2 = tri2; prevSex1 = sex1; prevSex2 = sex2;
      }
    }
  }
  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}

function buildConfluence(fibZones, interFibZones, moonEvents, planetEvents, natalEvents, retroEvents, ingressEvents, tolerance) {
  const all = [
    ...fibZones.map((f) => ({ date: f.date, ms: f.ms, label: f.label, type: 'fibo', weight: 3.0, anchorId: f.anchorId })),
    ...interFibZones.map((f) => ({ date: f.date, ms: f.ms, label: f.label, type: 'interfibo', weight: f.weight || 2.5, anchorId: f.anchorId })),
    ...moonEvents.map((m) => ({ date: m.date, ms: m.date.getTime(), label: m.label, type: 'bulan', weight: m.weight || 1.5 })),
    ...planetEvents.map((p) => ({ date: p.date, ms: p.date.getTime(), label: p.label, type: 'planet', weight: p.weight || 1.0 })),
    ...(natalEvents || []).map((n) => ({ date: n.date, ms: n.date.getTime(), label: n.label, type: 'natal', weight: n.weight || 2.5 })),
    ...(retroEvents || []).map((r) => ({ date: new Date(r.ms), ms: r.ms, label: r.label, type: 'retro', weight: r.weight || 2.0 })),
    ...(ingressEvents || []).map((i) => ({ date: new Date(i.ms), ms: i.ms, label: i.label, type: 'ingress', weight: i.weight || 1.5 })),
  ].sort((a, b) => a.ms - b.ms);

  const clusters = [];
  let current = [];
  for (const ev of all) {
    if (current.length === 0) {
      current.push(ev);
    } else {
      const distFromLast = (ev.ms - current[current.length - 1].ms) / DAY_MS;
      const totalSpan = (ev.ms - current[0].ms) / DAY_MS;
      // Event must be within tolerance of the last event AND total span must not exceed tolerance * 2
      if (distFromLast <= tolerance && totalSpan <= tolerance * 2) {
        current.push(ev);
      } else {
        if (current.length >= 2) clusters.push(current);
        current = [ev];
      }
    }
  }
  if (current.length >= 2) clusters.push(current);
  return { all, clusters };
}

function rankClusters(clusters) {
  return clusters.map(c => {
    let weightedScore = 0;
    let fiboCount = 0;
    let bulanCount = 0;
    let planetCount = 0;
    let natalCount = 0;
    let retroCount = 0;
    let ingressCount = 0;
    const typesPresent = new Set();
    const uniqueAnchors = new Set();
    
    const weightsByType = {};
    
    c.forEach(ev => {
      const type = ev.type;
      if (!weightsByType[type]) weightsByType[type] = [];
      weightsByType[type].push(ev.weight || 1.0);
      
      typesPresent.add(type);
      if (ev.anchorId) uniqueAnchors.add(ev.anchorId);
      
      if (type === 'fibo' || type === 'interfibo') fiboCount++;
      if (type === 'bulan') bulanCount++;
      if (type === 'planet') planetCount++;
      if (type === 'natal') natalCount++;
      if (type === 'retro') retroCount++;
      if (type === 'ingress') ingressCount++;
    });
    
    // Calculate weighted score with diminishing returns for events of the same type
    for (const type in weightsByType) {
      // Sort weights descending so strongest events contribute most
      const sortedWeights = weightsByType[type].sort((a, b) => b - a);
      
      sortedWeights.forEach((w, idx) => {
        let multiplier = 1.0;
        if (idx === 1) multiplier = 0.75;
        else if (idx === 2) multiplier = 0.50;
        else if (idx >= 3) multiplier = 0.25;
        
        weightedScore += w * multiplier;
      });
    }
    
    // Diversity bonus: non-linear exponential scaling for robust confluence
    // 1 type = 1.0x, 2 types = ~1.2x, 3 types = ~1.56x, 4 types = ~2.04x
    const diversityMultiplier = 1 + Math.pow(typesPresent.size - 1, 1.5) * 0.2;
    
    // Multi-anchor bonus: Fibo from different anchors is more meaningful
    const anchorBonus = uniqueAnchors.size > 1 ? 1 + Math.pow(uniqueAnchors.size - 1, 1.2) * 0.15 : 1;
    
    let rawScore = weightedScore * diversityMultiplier * anchorBonus;
    
    // Synergy Check: Fibo + Astro combinations yield the highest accuracy
    const hasFibo = typesPresent.has('fibo') || typesPresent.has('interfibo');
    const hasAstro = typesPresent.has('bulan') || typesPresent.has('planet') || typesPresent.has('retro') || typesPresent.has('ingress') || typesPresent.has('natal');
    
    if (hasFibo && hasAstro) {
      rawScore *= 1.5; // High confidence synergy
    } else if (!hasFibo) {
      rawScore *= 0.8; // Astro without Fibo is noisy, but don't penalize too much
    } else if (!hasAstro) {
      rawScore *= 0.8; // Fibo without Astro is less reliable
    }
    
    const score = Math.round(rawScore * 10) / 10;
    
    return { 
      events: c, 
      score, 
      fiboCount, 
      bulanCount, 
      planetCount,
      natalCount,
      retroCount,
      ingressCount,
      diversityTypes: typesPresent.size,
      uniqueAnchors: uniqueAnchors.size,
      ms: c[0].ms,
      date: c[0].date,
      endMs: c[c.length - 1].ms,
      endDate: c[c.length - 1].date,
    };
  }).sort((a, b) => {
    if (b.score === a.score) {
      // Tie-breaker 1: more diverse signal types win
      if (b.diversityTypes !== a.diversityTypes) return b.diversityTypes - a.diversityTypes;
      // Tie-breaker 2: more events
      return b.events.length - a.events.length;
    }
    return b.score - a.score;
  });
}

function computeBacktest(clusters, actualReversals, tolerance) {
  if (actualReversals.length === 0 || clusters.length === 0) {
    return { hitRate: 0, precision: 0, recall: 0, f1: 0, avgTimingError: null, details: [], totalHits: 0, totalClusters: clusters.length, totalReversals: 0 };
  }
  
  const revMs = actualReversals.map(d => Date.parse(`${d.date}T00:00:00Z`)).filter(ms => !Number.isNaN(ms));
  
  let truePositives = 0;
  const matchedReversals = new Set();
  const timingErrors = [];
  
  const details = clusters.map(c => {
    const totalWeight = c.reduce((sum, ev) => sum + (ev.weight || 1.0), 0);
    const clusterCenter = c.reduce((sum, ev) => sum + ev.ms * (ev.weight || 1.0), 0) / totalWeight;
    const minC = clusterCenter - tolerance * DAY_MS;
    const maxC = clusterCenter + tolerance * DAY_MS;
    
    // Find only the NEAREST unmatched reversal within the tolerance window (prevents Recall inflation)
    const candidateRevs = revMs
      .filter(ms => ms >= minC && ms <= maxC && !matchedReversals.has(ms))
      .sort((a, b) => Math.abs(a - clusterCenter) - Math.abs(b - clusterCenter));
    
    const nearestRev = candidateRevs.length > 0 ? candidateRevs[0] : null;
    const isHit = nearestRev !== null;
    if (isHit) {
      truePositives++;
      matchedReversals.add(nearestRev);
      timingErrors.push(Math.abs(nearestRev - clusterCenter) / DAY_MS);
    }
    
    return {
      cluster: c,
      isHit,
      hitDates: isHit ? [new Date(nearestRev)] : []
    };
  });
  
  const precision = clusters.length > 0 ? (truePositives / clusters.length) : 0;
  const recall = revMs.length > 0 ? (matchedReversals.size / revMs.length) : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall / (precision + recall)) : 0;
  const avgTimingError = timingErrors.length > 0
    ? Math.round((timingErrors.reduce((a, b) => a + b, 0) / timingErrors.length) * 10) / 10
    : null;
  
  return {
    hitRate: precision * 100, // hitRate is now Precision-based for backward compat
    precision: Math.round(precision * 1000) / 10,
    recall: Math.round(recall * 1000) / 10,
    f1: Math.round(f1 * 1000) / 10,
    avgTimingError,
    details,
    totalHits: truePositives,
    totalClusters: clusters.length,
    totalReversals: revMs.length,
    capturedReversals: matchedReversals.size
  };
}

function buildDaily(all, minAnchorMs, maxTargetMs, actualReversals, marketData = []) {
  if (all.length === 0) return [];
  const totalDays = Math.max(1, Math.ceil((maxTargetMs - minAnchorMs) / DAY_MS));
  const counts = Array.from({ length: totalDays + 1 }, (_, i) => ({
    hari: new Date(minAnchorMs + i * DAY_MS).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    fibo: 0, bulan: 0, planet: 0, natal: 0, retro: 0, ingress: 0, isReversal: false, ihsgClose: null,
    ms: minAnchorMs + i * DAY_MS
  }));
  
  const revMs = actualReversals.map(d => Date.parse(`${d.date}T00:00:00Z`)).filter(ms => !Number.isNaN(ms));
  revMs.forEach(ms => {
    const d = Math.floor((ms - minAnchorMs) / DAY_MS);
    if (d >= 0 && d <= totalDays) counts[d].isReversal = true;
  });

  all.forEach((ev) => {
    const d = Math.floor((ev.ms - minAnchorMs) / DAY_MS);
    if (d >= 0 && d <= totalDays) counts[d][ev.type] += 1;
  });

  marketData.forEach(md => {
    const ms = Date.parse(`${md.date}T00:00:00Z`);
    if (!Number.isNaN(ms)) {
      const d = Math.floor((ms - minAnchorMs) / DAY_MS);
      if (d >= 0 && d <= totalDays) counts[d].ihsgClose = md.close;
    }
  });

  return counts;
}

function buildWeekly(all, minAnchorMs, maxTargetMs, actualReversals, marketData = []) {
  if (all.length === 0) return [];
  const totalDays = Math.max(1, Math.ceil((maxTargetMs - minAnchorMs) / DAY_MS));
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const counts = Array.from({ length: weeks }, () => ({ fibo: 0, bulan: 0, planet: 0, natal: 0, retro: 0, ingress: 0, isReversal: false, ihsgClose: null }));
  
  const revMs = actualReversals.map(d => Date.parse(`${d.date}T00:00:00Z`)).filter(ms => !Number.isNaN(ms));
  revMs.forEach(ms => {
    const daysFromStart = (ms - minAnchorMs) / DAY_MS;
    if (daysFromStart >= 0 && daysFromStart <= totalDays) {
      const w = Math.max(0, Math.min(weeks - 1, Math.floor(daysFromStart / 7)));
      counts[w].isReversal = true;
    }
  });

  all.forEach((ev) => {
    const daysFromStart = (ev.ms - minAnchorMs) / DAY_MS;
    const w = Math.max(0, Math.min(weeks - 1, Math.floor(daysFromStart / 7)));
    counts[w][ev.type] += 1;
  });

  marketData.forEach(md => {
    const ms = Date.parse(`${md.date}T00:00:00Z`);
    if (!Number.isNaN(ms)) {
      const daysFromStart = (ms - minAnchorMs) / DAY_MS;
      if (daysFromStart >= 0 && daysFromStart <= totalDays) {
        const w = Math.max(0, Math.min(weeks - 1, Math.floor(daysFromStart / 7)));
        counts[w].ihsgClose = md.close;
      }
    }
  });

  return counts.map((c, i) => ({ minggu: c.isReversal ? `M${i + 1} ⭐` : `M${i + 1}`, ...c }));
}

function attachProjections(dailyData, topPicks) {
  let lastPrice = null;
  let lastPriceIdx = -1;
  for (let i = dailyData.length - 1; i >= 0; i--) {
    if (dailyData[i].ihsgClose != null) {
      lastPrice = dailyData[i].ihsgClose;
      lastPriceIdx = i;
      break;
    }
  }
  if (lastPrice === null) return dailyData;

  let initialTrendDown = false;
  if (lastPriceIdx >= 5) {
    const prevPrice = dailyData[lastPriceIdx - 5].ihsgClose || dailyData[lastPriceIdx - 1].ihsgClose;
    if (prevPrice !== null && lastPrice < prevPrice) initialTrendDown = true;
  }

  const futurePicks = topPicks.filter(p => p.ms > dailyData[lastPriceIdx].ms).sort((a, b) => a.ms - b.ms);
  const enriched = dailyData.map(d => ({...d}));
  enriched[lastPriceIdx].projectedPrice = lastPrice;

  if (futurePicks.length === 0) return enriched;

  let currentStartIdx = lastPriceIdx;
  let currentStartPrice = lastPrice;
  let isGoingDown = initialTrendDown;
  const amplitudePct = 0.04;

  for (let i = 0; i < futurePicks.length; i++) {
    const targetIdx = enriched.findIndex(d => d.ms >= futurePicks[i].ms);
    if (targetIdx <= currentStartIdx) continue;
    const targetPrice = isGoingDown ? currentStartPrice * (1 - amplitudePct) : currentStartPrice * (1 + amplitudePct);
    const steps = targetIdx - currentStartIdx;
    for (let j = 1; j <= steps; j++) {
      enriched[currentStartIdx + j].projectedPrice = currentStartPrice + (targetPrice - currentStartPrice) * (j / steps);
    }
    currentStartIdx = targetIdx;
    currentStartPrice = targetPrice;
    isGoingDown = !isGoingDown;
  }

  const finalSteps = enriched.length - 1 - currentStartIdx;
  if (finalSteps > 0) {
    const finalTargetPrice = isGoingDown ? currentStartPrice * (1 - amplitudePct) : currentStartPrice * (1 + amplitudePct);
    for (let j = 1; j <= finalSteps; j++) {
      enriched[currentStartIdx + j].projectedPrice = currentStartPrice + (finalTargetPrice - currentStartPrice) * (j / (finalSteps * 2));
    }
  }
  return enriched;
}

function attachProjectionsWeekly(weeklyData, dailyWithProj) {
  return weeklyData.map((w, i) => {
    const daysInWeek = dailyWithProj.slice(i * 7, i * 7 + 7);
    const lastValidProj = [...daysInWeek].reverse().find(d => d.projectedPrice != null);
    return { ...w, projectedPrice: lastValidProj ? lastValidProj.projectedPrice : null };
  });
}

const handleExportChart = (chartId, filename) => {
  const chartWrapper = document.getElementById(chartId);
  if (!chartWrapper) return;
  const svg = chartWrapper.querySelector('svg');
  if (!svg) return;
  
  svg.setAttribute('style', 'background-color: #0f172a; font-family: sans-serif;');
  const svgData = new XMLSerializer().serializeToString(svg);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
};

const fmtDate = (d) => d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtNum = (n) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

// Golden-ratio logarithmic spiral path for header ornament
const SPIRAL_PATH = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const b = Math.log(phi) / (Math.PI / 2);
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const theta = (i / 80) * Math.PI * 3;
    const r = 2 * Math.exp(b * theta);
    pts.push(`${(r * Math.cos(theta)).toFixed(2)},${(r * Math.sin(theta)).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
})();

// ---------------------------------------------------------------------------
// UI subcomponents
// ---------------------------------------------------------------------------
function StatCard({ value, label, color, icon: Icon, delay = 0 }) {
  return (
    <div
      className="glass rounded-xl p-4 text-center animate-fade-in-up hover:scale-[1.02] transition-all duration-300"
      style={{ animationDelay: `${delay}s` }}
    >
      {Icon && <Icon className={`w-5 h-5 mx-auto mb-1.5 ${color}`} />}
      <div className={`font-display text-3xl ${color} font-bold`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}

function Section({ icon: Icon, title, accent, hint, children, glowBorder = false, delay = 0 }) {
  const iconBgMap = {
    'text-amber-400': 'bg-amber-400/10',
    'text-cyan-400': 'bg-cyan-400/10',
    'text-rose-400': 'bg-rose-400/10',
    'text-indigo-400': 'bg-indigo-400/10',
    'text-purple-400': 'bg-purple-400/10',
  };
  return (
    <div
      className={`glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up transition-all duration-300 hover:bg-midnight-900/80 ${
        glowBorder ? 'border-amber-400/20' : ''
      }`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-3 mb-1">
        <div className={`p-2 rounded-lg ${iconBgMap[accent] || 'bg-slate-800'}`}>
          <Icon className={`w-5 h-5 ${accent}`} />
        </div>
        <h2 className="font-display text-lg text-slate-100 tracking-wide">{title}</h2>
      </div>
      {hint && <p className="text-sm text-slate-400 ml-11 mb-4 leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Hooks
// ---------------------------------------------------------------------------
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) return JSON.parse(item);
      return initialValue instanceof Function ? initialValue() : initialValue;
    } catch (error) {
      console.warn('Error reading localStorage', error);
      return initialValue instanceof Function ? initialValue() : initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const [anchors, setAnchors] = useLocalStorage('fibo-astro-anchors', () => [
    { id: Date.now(), date: new Date().toISOString().slice(0, 10), high: '', low: '' }
  ]);
  const [projectionDays, setProjectionDays] = useLocalStorage('fibo-astro-proj-days', 180);
  const [dayMode, setDayMode] = useLocalStorage('fibo-astro-day-mode', 'trading');
  const [confluenceTolerance, setConfluenceTolerance] = useLocalStorage('fibo-astro-tolerance', 1);
  const [actualReversals, setActualReversals] = useLocalStorage('fibo-astro-reversals', []);
  const [marketData, setMarketData] = useLocalStorage('fibo-astro-market-data', []);
  const [swingLookback, setSwingLookback] = useLocalStorage('fibo-astro-swing-lookback', 14);
  const [ticker, setTicker] = useLocalStorage('fibo-astro-ticker', '^JKSE');
  const [useNatal, setUseNatal] = useLocalStorage('fibo-astro-use-natal', true);
  const [useRetrograde, setUseRetrograde] = useLocalStorage('fibo-astro-use-retro', true);
  const [useIngress, setUseIngress] = useLocalStorage('fibo-astro-use-ingress', false);
  const [minSignalScore, setMinSignalScore] = useLocalStorage('fibo-astro-min-score', 6.0);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [gridSearchResult, setGridSearchResult] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState({ phase: 0, percent: 0, bestSoFar: null });

  const parsedAnchors = useMemo(() => {
    return anchors.map(a => ({
      ...a,
      ms: Date.parse(`${a.date}T00:00:00Z`),
      highNum: parseFloat(a.high),
      lowNum: parseFloat(a.low),
    })).filter(a => !Number.isNaN(a.ms));
  }, [anchors]);

  const minAnchorMs = useMemo(() => {
    if (parsedAnchors.length === 0) return Date.now();
    return Math.min(...parsedAnchors.map(a => a.ms));
  }, [parsedAnchors]);

  const maxTargetMs = useMemo(() => {
    if (parsedAnchors.length === 0) return Date.now() + projectionDays * DAY_MS;
    return Math.max(...parsedAnchors.map(a => a.ms + projectionDays * DAY_MS));
  }, [parsedAnchors, projectionDays]);

  const fibZones = useMemo(() => computeFibZones(parsedAnchors, projectionDays, dayMode), [parsedAnchors, projectionDays, dayMode]);
  const interFibZones = useMemo(() => computeInterAnchorFib(parsedAnchors, minAnchorMs, maxTargetMs), [parsedAnchors, minAnchorMs, maxTargetMs]);
  const moonEvents = useMemo(() => computeMoonEvents(minAnchorMs, maxTargetMs), [minAnchorMs, maxTargetMs]);
  const planetEvents = useMemo(() => computePlanetEvents(minAnchorMs, maxTargetMs), [minAnchorMs, maxTargetMs]);
  const natalEvents = useMemo(() => useNatal ? computeNatalEvents(ticker, minAnchorMs, maxTargetMs) : [], [useNatal, ticker, minAnchorMs, maxTargetMs]);
  const retroEvents = useMemo(() => useRetrograde ? computeRetrogradeEvents(minAnchorMs, maxTargetMs) : [], [useRetrograde, minAnchorMs, maxTargetMs]);
  const ingressEvents = useMemo(() => useIngress ? computeIngressEvents(minAnchorMs, maxTargetMs) : [], [useIngress, minAnchorMs, maxTargetMs]);
  
  const { all, clusters } = useMemo(
    () => buildConfluence(fibZones, interFibZones, moonEvents, planetEvents, natalEvents, retroEvents, ingressEvents, confluenceTolerance),
    [fibZones, interFibZones, moonEvents, planetEvents, natalEvents, retroEvents, ingressEvents, confluenceTolerance]
  );
  
  const ranked = useMemo(() => rankClusters(clusters), [clusters]);
  const topPicks = useMemo(() => {
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const strongest10 = ranked.filter(c => c.ms > todayMs).slice(0, 10);
    return strongest10.sort((a, b) => a.ms - b.ms);
  }, [ranked]);
  const weeklyBase = useMemo(() => buildWeekly(all, minAnchorMs, maxTargetMs, actualReversals, marketData), [all, minAnchorMs, maxTargetMs, actualReversals, marketData]);
  const dailyBase = useMemo(() => buildDaily(all, minAnchorMs, maxTargetMs, actualReversals, marketData), [all, minAnchorMs, maxTargetMs, actualReversals, marketData]);
  
  const daily = useMemo(() => attachProjections(dailyBase, topPicks), [dailyBase, topPicks]);
  const weekly = useMemo(() => attachProjectionsWeekly(weeklyBase, daily), [weeklyBase, daily]);

  const backtestResult = useMemo(
    () => computeBacktest(ranked.filter(c => c.score >= minSignalScore).map(c => c.events), actualReversals, confluenceTolerance),
    [ranked, actualReversals, confluenceTolerance, minSignalScore]
  );

  const handleAddAnchor = () => {
    setAnchors([...anchors, { id: Date.now(), date: new Date().toISOString().slice(0, 10), high: '', low: '' }]);
  };

  // ---- Grid Search Optimizer ----
  const handleRunGridSearch = useCallback(async () => {
    if (parsedAnchors.length === 0 || actualReversals.filter(r => r.date).length === 0) {
      alert('Silakan muat data terlebih dahulu (Auto-Detect) dan pastikan ada data reversal aktual untuk backtest!');
      return;
    }
    setIsOptimizing(true);
    setGridSearchResult(null);
    setOptimizerProgress({ phase: 0, percent: 0, bestSoFar: null });

    try {
      // Caches for expensive computations (keyed by projectionDays / dayMode)
      const astroCache = new Map();
      const fibCache = new Map();
      const testMinAnchorMs = Math.min(...parsedAnchors.map(a => a.ms));

      const result = await runGridSearchOptimizer(
        (params) => {
          const testMaxTargetMs = Math.max(...parsedAnchors.map(a => a.ms + params.projectionDays * DAY_MS));

          // Cache expensive astro computations by projectionDays (only varies ~3 times)
          const astroKey = String(params.projectionDays);
          let astro = astroCache.get(astroKey);
          if (!astro) {
            astro = {
              moonEvents: computeMoonEvents(testMinAnchorMs, testMaxTargetMs),
              planetEvents: computePlanetEvents(testMinAnchorMs, testMaxTargetMs),
              natalEvents: computeNatalEvents(ticker, testMinAnchorMs, testMaxTargetMs),
              retroEvents: computeRetrogradeEvents(testMinAnchorMs, testMaxTargetMs),
              ingressEvents: computeIngressEvents(testMinAnchorMs, testMaxTargetMs),
              interFibZones: computeInterAnchorFib(parsedAnchors, testMinAnchorMs, testMaxTargetMs),
            };
            astroCache.set(astroKey, astro);
          }

          // Cache fibZones by projectionDays + dayMode (only varies ~6 times)
          const fibKey = `${params.projectionDays}|${params.dayMode}`;
          let testFibZones = fibCache.get(fibKey);
          if (!testFibZones) {
            testFibZones = computeFibZones(parsedAnchors, params.projectionDays, params.dayMode);
            fibCache.set(fibKey, testFibZones);
          }

          // Cheap: buildConfluence + rankClusters + computeBacktest
          const { clusters: testClusters } = buildConfluence(
            testFibZones, astro.interFibZones, astro.moonEvents, astro.planetEvents,
            params.useNatal ? astro.natalEvents : [],
            params.useRetrograde ? astro.retroEvents : [],
            params.useIngress ? astro.ingressEvents : [],
            params.confluenceTolerance
          );
          const testRanked = rankClusters(testClusters);
          const filteredClusters = testRanked.filter(c => c.score >= params.minSignalScore).map(c => c.events);
          return computeBacktest(filteredClusters, actualReversals, params.confluenceTolerance);
        },
        (progress) => {
          setOptimizerProgress(progress);
        }
      );
      setGridSearchResult(result);
    } catch (err) {
      console.error('Grid Search Error:', err);
      alert('Grid Search gagal: ' + err.message);
    } finally {
      setIsOptimizing(false);
    }
  }, [parsedAnchors, actualReversals, ticker]);

  const handleApplyBestConfig = useCallback((config) => {
    if (!config || !config.params) return;
    const p = config.params;
    setConfluenceTolerance(p.confluenceTolerance);
    setSwingLookback(p.swingLookback);
    setMinSignalScore(p.minSignalScore);
    setProjectionDays(p.projectionDays);
    setDayMode(p.dayMode);
    setUseNatal(p.useNatal);
    setUseRetrograde(p.useRetrograde);
    setUseIngress(p.useIngress);
  }, []);

  const handleAutoDetect = async (strategy = 'normal') => {
    if (typeof strategy !== 'string') strategy = 'normal';
    
    if (!ticker.trim()) return alert('Silakan masukkan kode aset (ticker) terlebih dahulu!');
    setIsLoadingData(true);
    try {
      const data = await fetchMarketData(ticker.trim().toUpperCase());
      setMarketData(data);
      const swings = detectSwings(data, swingLookback);
      
      setActualReversals(swings.map((s, i) => ({ id: Date.now() + i, date: s.date })));
      
      if (swings.length > 0) {
        let selectedSwings = [];
        
        if (strategy === 'golden') {
          const minor = swings[swings.length - 1];
          let absHigh = swings[0];
          let absLow = swings[0];
          swings.forEach(s => {
            if (s.type === 'high' && s.value > absHigh.value) absHigh = s;
            if (s.type === 'low' && s.value < absLow.value) absLow = s;
          });
          const major = new Date(absHigh.date) < new Date(absLow.date) ? absHigh : absLow;

          let medium = null;
          const midCandidates = swings.filter(s => new Date(s.date) > new Date(major.date) && new Date(s.date) < new Date(minor.date));
          if (midCandidates.length > 0) {
            let bestMid = midCandidates[0];
            midCandidates.forEach(s => {
              if (major.type === 'low') {
                if (s.type === 'high' && s.value > bestMid.value) bestMid = s;
              } else {
                if (s.type === 'low' && s.value < bestMid.value) bestMid = s;
              }
            });
            medium = bestMid;
          }

          const strategySwings = [major, medium, minor].filter(Boolean);
          const seenDates = new Set();
          strategySwings.forEach(s => {
            if (!seenDates.has(s.date)) {
              seenDates.add(s.date);
              selectedSwings.push(s);
            }
          });
          alert(`Setelan Emas diterapkan! Berhasil menarik ${selectedSwings.length} Titik Emas (Strategi Multi-Timeframe) dari total ${swings.length} swing untuk aset ${ticker.toUpperCase()}.`);
        } else {
          selectedSwings = swings.slice(-15);
          alert(`Berhasil ditarik! Mengaplikasikan ${selectedSwings.length} Titik Swing terbaru dari total ${swings.length} swing untuk aset ${ticker.toUpperCase()}.`);
        }

        setAnchors(selectedSwings.map((s, i) => ({
          id: Date.now() + i,
          date: s.date,
          high: s.type === 'high' ? String(s.value.toFixed(2)) : '',
          low: s.type === 'low' ? String(s.value.toFixed(2)) : '',
        })));
      }
    } catch (error) {
      alert("Gagal menarik data. Pastikan kode ticker valid di Yahoo Finance: " + error.message);
    } finally {
      setIsLoadingData(false);
    }
  };


  return (
    <div className="min-h-screen bg-midnight-950 text-slate-100 p-4 sm:p-6 relative overflow-hidden">
      {/* Animated aurora/nebula background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-amber-500/5 via-transparent to-cyan-500/5 animate-aurora rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-rose-500/5 via-transparent to-indigo-500/5 animate-aurora rounded-full blur-3xl" style={{ animationDelay: '-7s' }} />
        {/* Stars */}
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              opacity: Math.random() * 0.5 + 0.1,
              animation: `twinkle ${Math.random() * 4 + 3}s ease-in-out infinite`,
              animationDelay: Math.random() * 5 + 's',
            }}
          />
        ))}
      </div>
      <div className="max-w-2xl mx-auto relative z-10">

        {/* Header */}
        <header className="relative overflow-hidden bg-gradient-to-br from-midnight-900 via-midnight-900 to-amber-950/30 rounded-2xl p-6 sm:p-8 mb-5 animate-fade-in border border-amber-500/10 glow-border">
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-full blur-2xl animate-pulse-glow" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-cyan-500/10 to-transparent rounded-full blur-2xl animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
          <svg viewBox="-40 -40 80 80" className="absolute right-4 top-4 w-48 h-48 text-amber-400/20 animate-float" aria-hidden="true" style={{ animationDuration: '6s' }}>
            <path d={SPIRAL_PATH} fill="none" stroke="currentColor" strokeWidth="0.5" />
          </svg>
          <div className="relative flex flex-col items-center">
            <img src="/logo.png" alt="Time-Trading Logo" className="w-20 h-20 mb-3 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] hover:scale-105 transition-transform duration-300 rounded-2xl" />
            <div className="flex w-full items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-400 font-medium">Time Cycle Analysis</p>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
            </div>
            <h1 className="font-display text-3xl sm:text-4xl text-center text-slate-50 tracking-wide mb-3">
              <span className="text-gradient">Time-Trading</span><br />
              <span className="text-gradient-cyan text-2xl">Fibo–Astro</span>
            </h1>
            <p className="text-sm text-slate-400 text-center max-w-lg mx-auto leading-relaxed">
              Memproyeksikan tanggal-tanggal potensi titik balik IHSG dengan menggabungkan zona waktu Fibonacci
              (hari bursa Senin–Jumat), siklus bulan, dan siklus planet — pendekatan time-cycle ala Astronacci.
            </p>
          </div>
        </header>

        {/* Global Settings */}
        <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-1">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <h2 className="font-display text-lg text-slate-100 tracking-wide">Pengaturan Analisis</h2>
            <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
              <select 
                value={ticker} 
                onChange={(e) => setTicker(e.target.value)} 
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 font-mono text-xs sm:text-sm w-full sm:w-40 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <optgroup label="Indeks">
                  <option value="^JKSE">IHSG (^JKSE)</option>
                  <option value="^GSPC">S&P 500 (^GSPC)</option>
                </optgroup>
                <optgroup label="Saham Blue Chip">
                  <option value="BBCA.JK">BCA (BBCA)</option>
                  <option value="BBRI.JK">BRI (BBRI)</option>
                  <option value="BMRI.JK">Mandiri (BMRI)</option>
                  <option value="BBNI.JK">BNI (BBNI)</option>
                  <option value="TLKM.JK">Telkom (TLKM)</option>
                  <option value="ASII.JK">Astra (ASII)</option>
                  <option value="AMMN.JK">Amman (AMMN)</option>
                  <option value="GOTO.JK">GoTo (GOTO)</option>
                </optgroup>
                <optgroup label="Kripto">
                  <option value="BTC-USD">Bitcoin (BTC)</option>
                  <option value="ETH-USD">Ethereum (ETH)</option>
                </optgroup>
              </select>
              <div className="flex gap-2 w-full sm:w-auto">
                <button 
                  onClick={() => handleAutoDetect('normal')} 
                  disabled={isLoadingData}
                  className="flex-1 sm:flex-none flex items-center justify-center whitespace-nowrap gap-1.5 text-xs bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-indigo-800 disabled:to-indigo-800 text-white px-3 py-2 rounded-lg font-medium transition-all duration-200 shadow-lg shadow-indigo-600/20 hover:shadow-indigo-500/40 disabled:shadow-none"
                >
                  {isLoadingData ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {isLoadingData ? 'Menarik...' : 'Auto-Detect (15 Titik)'}
                </button>
                <button 
                  onClick={() => handleAutoDetect('golden')} 
                  disabled={isLoadingData}
                  className="flex-1 sm:flex-none flex items-center justify-center whitespace-nowrap gap-1.5 text-xs bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:from-amber-800 disabled:to-amber-800 text-white px-3 py-2 rounded-lg font-medium transition-all duration-200 shadow-lg shadow-amber-600/20 hover:shadow-amber-500/40 disabled:shadow-none"
                  title="Gunakan pengaturan terbaik (3-Anchor) untuk akurasi optimal"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Setelan Emas (3 Titik)
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-5 mt-5">
            {/* Baris 1: Slider Pengaturan Dasar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Proyeksi ke depan: <span className="text-amber-400 font-mono-custom font-medium">{projectionDays} hari</span></span>
                <input type="range" min="30" max="365" step="5" value={projectionDays} onChange={(e) => setProjectionDays(Number(e.target.value))} className="mt-1 accent-amber-400 h-1.5 rounded-full appearance-none bg-midnight-800 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-amber-400/30 [&::-webkit-slider-thumb]:cursor-pointer" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Toleransi Konfluensi: <span className="text-amber-400 font-mono-custom font-medium">±{confluenceTolerance} hari</span></span>
                <input type="range" min="0" max="2" step="0.5" value={confluenceTolerance} onChange={(e) => setConfluenceTolerance(Number(e.target.value))} className="mt-1 accent-amber-400 h-1.5 rounded-full appearance-none bg-midnight-800 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-amber-400/30 [&::-webkit-slider-thumb]:cursor-pointer" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Sensitivitas Swing: <span className="text-indigo-400 font-mono-custom font-medium">{swingLookback} hari</span></span>
                <input type="range" min="5" max="30" step="1" value={swingLookback} onChange={(e) => setSwingLookback(Number(e.target.value))} className="mt-1 accent-indigo-400 h-1.5 rounded-full appearance-none bg-midnight-800 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-indigo-400/30 [&::-webkit-slider-thumb]:cursor-pointer" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Min. Skor Sinyal: <span className="text-rose-400 font-mono-custom font-medium">{minSignalScore.toFixed(1)}</span></span>
                <input type="range" min="1.0" max="15.0" step="0.5" value={minSignalScore} onChange={(e) => setMinSignalScore(Number(e.target.value))} className="mt-1 accent-rose-400 h-1.5 rounded-full appearance-none bg-midnight-800 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-rose-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-rose-400/30 [&::-webkit-slider-thumb]:cursor-pointer" />
              </label>
            </div>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />

            {/* Baris 2: Toggle Indikator Astro & Fibo */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              <div className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Satuan Zona Fibo</span>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setDayMode('trading')} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${dayMode === 'trading' ? 'bg-amber-400 text-slate-900 border-amber-400 shadow-lg shadow-amber-400/20' : 'bg-midnight-800 text-slate-300 border-slate-700/50 hover:border-slate-600'}`}>Hari Bursa</button>
                  <button type="button" onClick={() => setDayMode('calendar')} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${dayMode === 'calendar' ? 'bg-amber-400 text-slate-900 border-amber-400 shadow-lg shadow-amber-400/20' : 'bg-midnight-800 text-slate-300 border-slate-700/50 hover:border-slate-600'}`}>Kalender</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Siklus IPO (Natal)</span>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setUseNatal(true)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${useNatal ? 'bg-purple-500 text-white border-purple-500 shadow-lg shadow-purple-500/20' : 'bg-midnight-800 text-slate-300 border-slate-700/50 hover:border-slate-600'}`}>ON</button>
                  <button type="button" onClick={() => setUseNatal(false)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${!useNatal ? 'bg-slate-700 text-slate-200 border-slate-600 shadow-inner' : 'bg-midnight-800 text-slate-400 border-slate-700/50 hover:border-slate-600'}`}>OFF</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Fase Retrograde</span>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setUseRetrograde(true)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${useRetrograde ? 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/20' : 'bg-midnight-800 text-slate-300 border-slate-700/50 hover:border-slate-600'}`}>ON</button>
                  <button type="button" onClick={() => setUseRetrograde(false)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${!useRetrograde ? 'bg-slate-700 text-slate-200 border-slate-600 shadow-inner' : 'bg-midnight-800 text-slate-400 border-slate-700/50 hover:border-slate-600'}`}>OFF</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm text-slate-400">
                <span>Planet Ingress</span>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setUseIngress(true)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${useIngress ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-midnight-800 text-slate-300 border-slate-700/50 hover:border-slate-600'}`}>ON</button>
                  <button type="button" onClick={() => setUseIngress(false)} className={`px-2 py-1.5 rounded-lg text-[11px] font-mono-custom border flex-1 transition-all duration-200 ${!useIngress ? 'bg-slate-700 text-slate-200 border-slate-600 shadow-inner' : 'bg-midnight-800 text-slate-400 border-slate-700/50 hover:border-slate-600'}`}>OFF</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Anchors */}
        <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-2">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display text-lg text-slate-100 tracking-wide">Titik Anchor (Swing Point)</h2>
            <div className="flex gap-2">
              {anchors.length > 0 && (
                <button onClick={() => setAnchors([])} className="flex items-center gap-1 text-sm bg-rose-950/50 hover:bg-rose-900/50 text-rose-400 px-3 py-1.5 rounded-lg border border-rose-900/50 transition-all duration-200 hover:shadow-lg hover:shadow-rose-900/20">
                  <Trash2 className="w-4 h-4" /> Hapus Semua
                </button>
              )}
              {anchors.length < 15 && (
                <button 
                  onClick={handleAddAnchor}
                  className="flex items-center gap-1 text-sm bg-midnight-800 hover:bg-midnight-900 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-all duration-200"
                >
                  <Plus className="w-4 h-4" /> Tambah Titik
                </button>
              )}
            </div>
          </div>
          <div className="space-y-4">
            {anchors.map((anchor, index) => (
              <div key={anchor.id} className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 border border-slate-700/30 bg-midnight-950/50 rounded-xl relative group hover:border-amber-400/20 transition-all duration-300">
                {anchors.length > 1 && (
                  <button onClick={() => setAnchors(anchors.filter(a => a.id !== anchor.id))} className="absolute top-2 right-2 text-slate-500 hover:text-rose-400 p-1 rounded transition-colors" title="Hapus Anchor">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <div className="sm:col-span-1 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                    <span className="text-xs font-mono-custom text-amber-400 font-bold">{index + 1}</span>
                  </div>
                  <span className="font-display text-amber-400 text-sm">Anchor {index + 1}</span>
                </div>
                <label className="flex flex-col gap-1.5 text-sm text-slate-400 sm:col-span-1 font-medium">
                  Tanggal
                  <input type="date" value={anchor.date} onChange={(e) => setAnchors(anchors.map(a => a.id === anchor.id ? { ...a, date: e.target.value } : a))} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-amber-400 font-mono font-medium text-sm outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-200 shadow-inner" style={{colorScheme: 'dark'}} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-slate-400 sm:col-span-1 font-medium">
                  Swing High (opsional)
                  <input type="number" inputMode="decimal" placeholder="contoh: 7350" value={anchor.high} onChange={(e) => setAnchors(anchors.map(a => a.id === anchor.id ? { ...a, high: e.target.value } : a))} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-emerald-400 placeholder-slate-600 font-mono font-medium text-sm outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-200 shadow-inner" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-slate-400 sm:col-span-1 font-medium">
                  Swing Low (opsional)
                  <input type="number" inputMode="decimal" placeholder="contoh: 7100" value={anchor.low} onChange={(e) => setAnchors(anchors.map(a => a.id === anchor.id ? { ...a, low: e.target.value } : a))} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-rose-400 placeholder-slate-600 font-mono font-medium text-sm outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-200 shadow-inner" />
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-midnight-950/50 p-1.5 rounded-xl mb-6 border border-slate-700/30 overflow-x-auto hide-scrollbar relative z-10">
          <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 px-4 text-sm font-display tracking-wide rounded-lg whitespace-nowrap transition-all duration-300 ${activeTab === 'overview' ? 'bg-gradient-to-r from-amber-600/20 to-amber-500/10 text-amber-400 shadow-sm border border-amber-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-midnight-800/50'}`}>Ringkasan & Grafik</button>
          <button onClick={() => setActiveTab('backtest')} className={`flex-1 py-2.5 px-4 text-sm font-display tracking-wide rounded-lg whitespace-nowrap transition-all duration-300 ${activeTab === 'backtest' ? 'bg-gradient-to-r from-indigo-600/20 to-indigo-500/10 text-indigo-400 shadow-sm border border-indigo-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-midnight-800/50'}`}>Laporan Backtesting</button>
          <button onClick={() => setActiveTab('zones')} className={`flex-1 py-2.5 px-4 text-sm font-display tracking-wide rounded-lg whitespace-nowrap transition-all duration-300 ${activeTab === 'zones' ? 'bg-gradient-to-r from-cyan-600/20 to-cyan-500/10 text-cyan-400 shadow-sm border border-cyan-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-midnight-800/50'}`}>Detail Siklus Waktu</button>
        </div>

        {/* ================= TAB 1: OVERVIEW ================= */}
        {activeTab === 'overview' && (
          <div className="animate-fade-in">
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
              <StatCard value={fibZones.length} label="Zona Fibo" color="text-amber-400" icon={CalendarRange} delay={0.1} />
              <StatCard value={moonEvents.length} label="Siklus Bulan" color="text-cyan-400" icon={Moon} delay={0.2} />
              <StatCard value={planetEvents.length} label="Siklus Planet" color="text-cyan-400" icon={Orbit} delay={0.3} />
              <StatCard value={natalEvents.length} label="Siklus Natal" color="text-purple-400" icon={Sparkles} delay={0.35} />
              <StatCard value={retroEvents.length} label="Siklus Retrograde" color="text-orange-400" icon={RotateCcw} delay={0.38} />
              <StatCard value={ingressEvents.length} label="Planet Ingress" color="text-emerald-400" icon={Milestone} delay={0.39} />
              <StatCard value={clusters.length} label="Konfluensi" color="text-rose-400" icon={Crosshair} delay={0.4} />
            </div>

            {/* Conclusion: highest-ranked reversal dates */}
            <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-4 glow-border-rose">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-lg bg-rose-400/10">
                  <Target className="w-5 h-5 text-rose-400" />
                </div>
                <h2 className="font-display text-lg text-slate-100 tracking-wide">Kesimpulan: Potensi Pembalikan Tertinggi</h2>
              </div>
              {topPicks.length === 0 ? (
                <p className="text-sm text-slate-400 ml-11">
                  Belum ada titik konfluensi pada rentang proyeksi ini. Coba perpanjang periode proyeksi atau ganti satuan
                  Zona Waktu Fibonacci.
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-400 ml-11 mb-4 leading-relaxed">
                    Tanggal-tanggal berikut memiliki jumlah siklus (Fibonacci, bulan, planet) yang bertumpuk paling
                    banyak — diurutkan dari yang terkuat.
                  </p>
                  <div className="space-y-3">
                    {topPicks.map((c, i) => (
                      <div key={i} className="flex gap-4 rounded-xl p-4 bg-gradient-to-r from-rose-950/20 to-transparent border border-rose-900/40 hover:border-rose-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-rose-900/10 animate-fade-in" style={{ animationDelay: `${0.5 + i * 0.1}s` }}>
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center shadow-lg shadow-rose-500/20">
                          <span className="font-display text-sm text-white font-bold">{i + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-mono-custom text-rose-300 text-sm font-medium">
                              {fmtDate(c.date)}
                              {c.endMs !== c.ms ? ` – ${fmtDate(c.endDate)}` : ''}
                            </span>
                            <span className="text-[11px] bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full text-rose-300 font-mono-custom font-medium">Skor: {c.score ? c.score.toFixed(1) : 0}</span>
                            {c.diversityTypes >= 3 && <span className="text-[10px] bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 rounded-full text-amber-300 font-mono-custom font-bold">🎯 {c.diversityTypes} Tipe</span>}
                            {c.uniqueAnchors >= 2 && <span className="text-[10px] bg-cyan-500/15 border border-cyan-500/25 px-2 py-0.5 rounded-full text-cyan-300 font-mono-custom font-bold">⚓ {c.uniqueAnchors} Anchor</span>}
                            {c.events.some(e => e.type === 'interfibo') && <span className="text-[10px] bg-fuchsia-500/15 border border-fuchsia-500/25 px-2 py-0.5 rounded-full text-fuchsia-300 font-mono-custom font-bold">📐 Inter-Fib</span>}
                            {c.events.some(e => e.label.includes('Gerhana')) && <span className="text-[10px] bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 rounded-full text-rose-200 font-mono-custom font-bold drop-shadow-md animate-pulse">🌑 GERHANA</span>}
                            <div className="flex flex-wrap gap-1.5 mt-1 sm:mt-0">
                                {c.ingressCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">{c.ingressCount} Ingress</span>}
                                {c.retroCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 uppercase tracking-wider">{c.retroCount} Retro</span>}
                                {c.natalCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">{c.natalCount} Natal</span>}
                                {c.fiboCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">{c.fiboCount} Fibo</span>}
                                {c.bulanCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase tracking-wider">{c.bulanCount} Bulan</span>}
                                {c.planetCount > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">{c.planetCount} Planet</span>}
                            </div>
                          </div>
                          <ul className="text-sm text-slate-300 mt-1.5 space-y-0.5">
                            {c.events.map((ev, j) => (
                              <li key={j} className="flex items-start gap-2">
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                  ev.type === 'fibo' ? 'bg-amber-400' : ev.type === 'bulan' ? 'bg-cyan-400' : ev.type === 'natal' ? 'bg-purple-400' : ev.type === 'retro' ? 'bg-orange-400' : ev.type === 'ingress' ? 'bg-emerald-400' : 'bg-indigo-400'
                                }`} />
                                <span className="text-slate-300">{ev.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Daily density chart */}
            <Section
              icon={TrendingUp}
              title="Kepadatan Sinyal per Hari"
              accent="text-cyan-400"
              hint="Resolusi harian dari grafik tumpukan siklus. Garis putus-putus menunjukkan proyeksi pergerakan harga menuju tanggal konfluensi."
              delay={0.5}
            >
              <div className="flex justify-end mb-2">
                <button 
                  onClick={() => handleExportChart('daily-chart', 'proyeksi-harian-fibo-astro.png')}
                  className="flex items-center gap-1.5 text-[11px] bg-slate-800 hover:bg-cyan-900/40 text-cyan-400 px-3 py-1.5 rounded-lg border border-slate-700/50 hover:border-cyan-500/50 transition-all duration-200"
                >
                  <Camera className="w-3.5 h-3.5" /> Simpan Gambar
                </button>
              </div>
              {daily.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Data belum tersedia.</p>
              ) : (
                <div id="daily-chart" className="bg-midnight-950/50 rounded-xl p-3 border border-slate-700/20 relative">
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="hari" tick={{ fill: '#94a3b8', fontSize: 11 }} interval={Math.max(0, Math.ceil(daily.length / 15) - 1)} />
                        <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                        {marketData.length > 0 && (
                          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fill: '#6366f1', fontSize: 11 }} />
                        )}
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                        {daily.filter(d => d.isReversal).map((d, idx) => (
                          <ReferenceArea yAxisId="left" key={idx} x1={d.hari} x2={d.hari} fill="#10b981" fillOpacity={0.4} />
                        ))}
                        <Bar yAxisId="left" dataKey="fibo" stackId="a" fill="#fbbf24" name="Fibonacci" />
                        <Bar yAxisId="left" dataKey="bulan" stackId="a" fill="#22d3ee" name="Bulan" />
                        <Bar yAxisId="left" dataKey="planet" stackId="a" fill="#fb7185" name="Planet" />
                        <Bar yAxisId="left" dataKey="ingress" stackId="a" fill="#34d399" name="Ingress" />
                        <Bar yAxisId="left" dataKey="retro" stackId="a" fill="#f97316" name="Retrograde" />
                        <Bar yAxisId="left" dataKey="natal" stackId="a" fill="#c084fc" name="Natal" radius={[4, 4, 0, 0]} />
                        {marketData.length > 0 && (
                          <>
                            <Line yAxisId="right" type="monotone" dataKey="ihsgClose" stroke="#6366f1" strokeWidth={2} dot={false} name={ticker.toUpperCase()} />
                            <Line yAxisId="right" type="monotone" dataKey="projectedPrice" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Proyeksi (Simulasi)" />
                          </>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </Section>

            {/* Weekly density chart */}
            <Section
              icon={TrendingUp}
              title="Kepadatan Sinyal per Minggu"
              accent="text-amber-400"
              hint="Grafik tumpukan siklus per minggu. Garis putus-putus merepresentasikan lintasan proyeksi tren mingguan."
              delay={0.6}
            >
              <div className="flex justify-end mb-2">
                <button 
                  onClick={() => handleExportChart('weekly-chart', 'proyeksi-mingguan-fibo-astro.png')}
                  className="flex items-center gap-1.5 text-[11px] bg-slate-800 hover:bg-amber-900/40 text-amber-400 px-3 py-1.5 rounded-lg border border-slate-700/50 hover:border-amber-500/50 transition-all duration-200"
                >
                  <Camera className="w-3.5 h-3.5" /> Simpan Gambar
                </button>
              </div>
              {weekly.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Data belum tersedia.</p>
              ) : (
                <div id="weekly-chart" className="bg-midnight-950/50 rounded-xl p-3 border border-slate-700/20 relative">
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={weekly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="minggu" tick={{ fill: '#94a3b8', fontSize: 11 }} interval={Math.max(0, Math.ceil(weekly.length / 12) - 1)} />
                        <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                        {marketData.length > 0 && (
                          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fill: '#6366f1', fontSize: 11 }} />
                        )}
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                        {weekly.filter(w => w.isReversal).map((w, idx) => (
                          <ReferenceArea yAxisId="left" key={idx} x1={w.minggu} x2={w.minggu} fill="#10b981" fillOpacity={0.15} />
                        ))}
                        <Bar yAxisId="left" dataKey="fibo" stackId="a" fill="#fbbf24" name="Fibonacci" />
                        <Bar yAxisId="left" dataKey="bulan" stackId="a" fill="#22d3ee" name="Bulan" />
                        <Bar yAxisId="left" dataKey="planet" stackId="a" fill="#fb7185" name="Planet" />
                        <Bar yAxisId="left" dataKey="ingress" stackId="a" fill="#34d399" name="Ingress" />
                        <Bar yAxisId="left" dataKey="retro" stackId="a" fill="#f97316" name="Retrograde" />
                        <Bar yAxisId="left" dataKey="natal" stackId="a" fill="#c084fc" name="Natal" radius={[4, 4, 0, 0]} />
                        {marketData.length > 0 && (
                          <>
                            <Line yAxisId="right" type="monotone" dataKey="ihsgClose" stroke="#6366f1" strokeWidth={2} dot={false} name={ticker.toUpperCase()} />
                            <Line yAxisId="right" type="monotone" dataKey="projectedPrice" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Proyeksi (Simulasi)" />
                          </>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ================= TAB 2: BACKTEST ================= */}
        {activeTab === 'backtest' && (
          <div className="animate-fade-in">
            {/* Backtest Input */}
            <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-1">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-display text-lg text-slate-100 tracking-wide flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-400" />
                  Data Reversal Aktual (Backtest)
                </h2>
                <div className="flex gap-2">
                  {actualReversals.length > 0 && (
                    <button onClick={() => setActualReversals([])} className="flex items-center gap-1 text-sm bg-rose-950/50 hover:bg-rose-900/50 text-rose-400 px-3 py-1.5 rounded-lg border border-rose-900/50 transition-all duration-200 hover:shadow-lg hover:shadow-rose-900/20">
                      <Trash2 className="w-4 h-4" /> Hapus Semua
                    </button>
                  )}
                  <button onClick={() => setActualReversals([...actualReversals, { id: Date.now(), date: '' }])} className="flex items-center gap-1 text-sm bg-midnight-800 hover:bg-midnight-900 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-all duration-200">
                    <Plus className="w-4 h-4" /> Tambah Tanggal
                  </button>
                </div>
              </div>
              {actualReversals.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Tambahkan histori tanggal pembalikan arah IHSG untuk memverifikasi akurasi proyeksi konfluensi.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {actualReversals.map((rev, index) => (
                    <div key={rev.id} className="flex items-center gap-2 bg-midnight-950/50 p-2 rounded-lg border border-slate-700/30 hover:border-indigo-400/20 transition-all duration-200">
                      <span className="text-xs text-slate-500 w-6 font-mono-custom">#{index + 1}</span>
                      <input type="date" value={rev.date} onChange={(e) => setActualReversals(actualReversals.map(r => r.id === rev.id ? { ...r, date: e.target.value } : r))} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-indigo-400 font-mono font-medium text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 shadow-inner" style={{colorScheme: 'dark'}} />
                      <button onClick={() => setActualReversals(actualReversals.filter(r => r.id !== rev.id))} className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors" title="Hapus">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Backtest Report */}
            {actualReversals.filter(r => r.date).length > 0 && clusters.length > 0 && (
              <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-2 glow-border-indigo">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-400/10">
                      <History className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h2 className="font-display text-lg text-slate-100 tracking-wide">Laporan Backtesting</h2>
                  </div>
                  <div className={`px-3 py-1.5 rounded-full text-sm font-mono-custom border font-bold ${
                    backtestResult.f1 >= 50 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                    backtestResult.f1 >= 30 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                    'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}>
                    F1-Score: {backtestResult.f1.toFixed(1)}%
                  </div>
                </div>
                
                {/* Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 ml-11 mb-4">
                  <div className="bg-midnight-950/60 rounded-xl p-3 border border-indigo-500/20 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Precision</div>
                    <div className="font-mono-custom text-lg font-bold text-indigo-300">{backtestResult.precision.toFixed(1)}%</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{backtestResult.totalHits}/{backtestResult.totalClusters} cluster</div>
                  </div>
                  <div className="bg-midnight-950/60 rounded-xl p-3 border border-cyan-500/20 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Recall</div>
                    <div className="font-mono-custom text-lg font-bold text-cyan-300">{backtestResult.recall.toFixed(1)}%</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{backtestResult.capturedReversals || 0}/{backtestResult.totalReversals || 0} reversal</div>
                  </div>
                  <div className="bg-midnight-950/60 rounded-xl p-3 border border-amber-500/20 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">F1-Score</div>
                    <div className={`font-mono-custom text-lg font-bold ${
                      backtestResult.f1 >= 50 ? 'text-emerald-300' : backtestResult.f1 >= 30 ? 'text-amber-300' : 'text-rose-300'
                    }`}>{backtestResult.f1.toFixed(1)}%</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">harmonic mean</div>
                  </div>
                  <div className="bg-midnight-950/60 rounded-xl p-3 border border-purple-500/20 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Avg. Timing</div>
                    <div className="font-mono-custom text-lg font-bold text-purple-300">{backtestResult.avgTimingError !== null ? `±${backtestResult.avgTimingError}` : '—'}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">hari error</div>
                  </div>
                </div>

                <p className="text-sm text-slate-400 ml-11 mb-4 leading-relaxed">
                  <strong className="text-slate-300">Precision</strong>: {backtestResult.precision.toFixed(1)}% cluster mengenai reversal aktual. <strong className="text-slate-300">Recall</strong>: {backtestResult.capturedReversals || 0} dari {backtestResult.totalReversals || 0} reversal berhasil ditangkap ({backtestResult.recall.toFixed(1)}%). Toleransi: ±{confluenceTolerance} hari.
                </p>
                
                <div className="space-y-2">
                  {backtestResult.details.map((detail, idx) => (
                    <div key={idx} className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 hover:scale-[1.01] ${
                      detail.isHit 
                        ? 'bg-gradient-to-r from-emerald-950/30 to-transparent border-emerald-800/50 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/10' 
                        : 'bg-midnight-950/30 border-slate-700/30 hover:border-slate-600/50'
                    }`}>
                      <div>
                        <div className="font-mono-custom text-sm text-slate-200">
                          {fmtDate(detail.cluster[0].date)}
                          {detail.cluster[detail.cluster.length - 1].ms !== detail.cluster[0].ms ? ` – ${fmtDate(detail.cluster[detail.cluster.length - 1].date)}` : ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {detail.cluster.length} sinyal bertepatan
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {detail.isHit ? (
                          <>
                            <span className="text-xs text-emerald-400 hidden sm:inline font-medium">Cocok dengan {detail.hitDates.map(fmtDate).join(', ')}</span>
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 drop-shadow-lg drop-shadow-emerald-500/20" />
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-500 hidden sm:inline">Miss</span>
                            <XCircle className="w-5 h-5 text-slate-600" />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ======== GRID SEARCH OPTIMIZER ======== */}
            <div className="glass rounded-2xl p-5 sm:p-6 mb-5 animate-fade-in-up stagger-3 border border-dashed border-amber-500/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-400/10">
                    <Settings className="w-5 h-5 text-amber-400 animate-spin" style={{ animationDuration: '8s' }} />
                  </div>
                  <div>
                    <h2 className="font-display text-lg text-slate-100 tracking-wide">🔧 Grid Search Optimizer</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Cari otomatis settingan paling optimal (F1-Score tinggi, Toleransi kecil)</p>
                  </div>
                </div>
                <button
                  onClick={handleRunGridSearch}
                  disabled={isOptimizing || actualReversals.filter(r => r.date).length === 0}
                  className="flex items-center gap-2 text-sm bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:from-slate-700 disabled:to-slate-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-lg shadow-amber-600/20 hover:shadow-amber-500/40 disabled:shadow-none hover:scale-[1.02] active:scale-95"
                >
                  {isOptimizing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Mencari...</>
                  ) : (
                    <><Search className="w-4 h-4" /> Jalankan Grid Search</>
                  )}
                </button>
              </div>

              {/* Progress Bar */}
              {isOptimizing && (
                <div className="mb-4 animate-fade-in">
                  <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                    <span>Fase {optimizerProgress.phase || 1}: {optimizerProgress.phase === 2 ? 'Fine Tuning...' : 'Coarse Search...'}</span>
                    <span className="font-mono-custom text-amber-400">{optimizerProgress.percent || 0}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-midnight-800 rounded-full overflow-hidden border border-slate-700/30">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 rounded-full transition-all duration-500 ease-out relative"
                      style={{ width: `${optimizerProgress.percent || 0}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse" style={{ animationDuration: '1.5s' }} />
                    </div>
                  </div>
                  {optimizerProgress.bestSoFar && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      Terbaik sementara: F1-Score <span className="text-emerald-400 font-mono-custom font-bold">{optimizerProgress.bestSoFar.f1.toFixed(1)}%</span> | Toleransi ±{optimizerProgress.bestSoFar.tolerance}
                    </p>
                  )}
                </div>
              )}

              {/* Results */}
              {gridSearchResult && !isOptimizing && (
                <div className="animate-fade-in space-y-4">
                  {/* Stats Summary */}
                  <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>✅ Diuji: <span className="text-amber-400 font-mono-custom font-bold">{gridSearchResult.totalTested}</span> kombinasi</span>
                    <span>⏱️ Durasi: <span className="text-cyan-400 font-mono-custom font-bold">{gridSearchResult.durationSec}s</span></span>
                    <span>🔍 Fase 1: {gridSearchResult.coarseTested} | Fase 2: {gridSearchResult.fineTested}</span>
                  </div>

                  {/* Best Configuration */}
                  {gridSearchResult.best && (
                    <div className="bg-gradient-to-br from-amber-950/30 via-midnight-900 to-emerald-950/20 rounded-xl p-5 border border-amber-500/30 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-full blur-2xl" />
                      <div className="relative">
                        <div className="flex items-center gap-2 mb-3">
                          <Trophy className="w-5 h-5 text-amber-400" />
                          <h3 className="font-display text-base text-amber-300 tracking-wide">Konfigurasi Terbaik</h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                          <div className="bg-midnight-950/60 rounded-lg p-3 text-center border border-emerald-500/20">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">F1-Score</div>
                            <div className={`font-mono-custom text-xl font-bold ${gridSearchResult.best.f1 >= 50 ? 'text-emerald-300' : gridSearchResult.best.f1 >= 30 ? 'text-amber-300' : 'text-rose-300'}`}>{gridSearchResult.best.f1.toFixed(1)}%</div>
                          </div>
                          <div className="bg-midnight-950/60 rounded-lg p-3 text-center border border-indigo-500/20">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Precision</div>
                            <div className="font-mono-custom text-xl font-bold text-indigo-300">{gridSearchResult.best.precision.toFixed(1)}%</div>
                          </div>
                          <div className="bg-midnight-950/60 rounded-lg p-3 text-center border border-cyan-500/20">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Recall</div>
                            <div className="font-mono-custom text-xl font-bold text-cyan-300">{gridSearchResult.best.recall.toFixed(1)}%</div>
                          </div>
                          <div className="bg-midnight-950/60 rounded-lg p-3 text-center border border-purple-500/20">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Avg Timing</div>
                            <div className="font-mono-custom text-xl font-bold text-purple-300">{gridSearchResult.best.avgTimingError !== null ? `±${gridSearchResult.best.avgTimingError}` : '—'}</div>
                          </div>
                        </div>

                        {/* Parameter Details */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4">
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30">
                            <span className="text-slate-500">Toleransi:</span>
                            <span className="text-amber-400 font-mono-custom font-bold ml-1">±{gridSearchResult.best.params.confluenceTolerance} hari</span>
                          </div>
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30">
                            <span className="text-slate-500">Swing:</span>
                            <span className="text-indigo-400 font-mono-custom font-bold ml-1">{gridSearchResult.best.params.swingLookback} hari</span>
                          </div>
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30">
                            <span className="text-slate-500">Min Skor:</span>
                            <span className="text-rose-400 font-mono-custom font-bold ml-1">{gridSearchResult.best.params.minSignalScore.toFixed(1)}</span>
                          </div>
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30">
                            <span className="text-slate-500">Proyeksi:</span>
                            <span className="text-emerald-400 font-mono-custom font-bold ml-1">{gridSearchResult.best.params.projectionDays} hari</span>
                          </div>
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30">
                            <span className="text-slate-500">Zona Fibo:</span>
                            <span className="text-amber-400 font-mono-custom font-bold ml-1">{gridSearchResult.best.params.dayMode === 'trading' ? 'Hari Bursa' : 'Kalender'}</span>
                          </div>
                          <div className="bg-midnight-950/40 rounded-lg px-3 py-2 border border-slate-700/30 sm:col-span-3">
                            <span className="text-slate-500">Astro:</span>
                            <span className="text-purple-400 font-mono-custom font-bold ml-1">{formatToggleLabel(gridSearchResult.best.params)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleApplyBestConfig(gridSearchResult.best)}
                          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white py-3 rounded-xl font-bold text-sm transition-all duration-300 shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.99]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          ✅ Terapkan Settingan Terbaik
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Top 5 Alternatives */}
                  {gridSearchResult.top5 && gridSearchResult.top5.length > 1 && (
                    <div className="bg-midnight-950/30 rounded-xl p-4 border border-slate-700/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Medal className="w-4 h-4 text-slate-400" />
                        <h3 className="font-display text-sm text-slate-300 tracking-wide">Top 5 Alternatif</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono-custom min-w-[600px]">
                          <thead>
                            <tr className="text-slate-500 text-left border-b border-slate-700/50">
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">#</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">F1</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Prec.</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Recall</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Timing</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Tol.</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Swing</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Min Skor</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Proy.</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Fibo</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider">Astro</th>
                              <th className="py-1.5 pb-2 font-medium text-[10px] uppercase tracking-wider"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {gridSearchResult.top5.map((r, idx) => (
                              <tr key={idx} className={`border-b border-slate-700/20 last:border-0 transition-colors ${idx === 0 ? 'bg-amber-500/5' : 'hover:bg-slate-800/30'}`}>
                                <td className="py-2">
                                  {idx === 0 ? <span className="text-amber-400">🏆</span> : <span className="text-slate-500">{idx + 1}</span>}
                                </td>
                                <td className={`py-2 font-bold ${r.f1 >= 50 ? 'text-emerald-400' : r.f1 >= 30 ? 'text-amber-400' : 'text-rose-400'}`}>{r.f1.toFixed(1)}%</td>
                                <td className="py-2 text-indigo-300">{r.precision.toFixed(1)}%</td>
                                <td className="py-2 text-cyan-300">{r.recall.toFixed(1)}%</td>
                                <td className="py-2 text-purple-300">{r.avgTimingError !== null ? `±${r.avgTimingError}` : '—'}</td>
                                <td className="py-2 text-amber-300">±{r.params.confluenceTolerance}</td>
                                <td className="py-2 text-slate-300">{r.params.swingLookback}</td>
                                <td className="py-2 text-slate-300">{r.params.minSignalScore.toFixed(1)}</td>
                                <td className="py-2 text-slate-300">{r.params.projectionDays}</td>
                                <td className="py-2 text-slate-400">{r.params.dayMode === 'trading' ? 'Bursa' : 'Kal.'}</td>
                                <td className="py-2 text-slate-500 text-[10px] max-w-[80px] truncate">{formatToggleLabel(r.params)}</td>
                                <td className="py-2">
                                  <button
                                    onClick={() => handleApplyBestConfig(r)}
                                    className="text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-md border border-emerald-500/20 hover:border-emerald-500/40 transition-all duration-200 font-bold whitespace-nowrap"
                                  >
                                    Terapkan
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {!gridSearchResult && !isOptimizing && (
                <div className="text-center py-6">
                  <Search className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Klik <strong className="text-amber-400">"Jalankan Grid Search"</strong> untuk mencari settingan paling optimal secara otomatis.</p>
                  <p className="text-xs text-slate-600 mt-1.5">Sistem akan menguji ratusan kombinasi parameter dan mencari F1-Score tertinggi dengan Toleransi terkecil.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 3: ZONES & CYCLES ================= */}
        {activeTab === 'zones' && (
          <div className="animate-fade-in">
            {/* Confluence Details */}
            <Section
              icon={Crosshair}
              title="Titik Konfluensi (Potensi Reversal)"
              accent="text-rose-400"
              hint="Tanggal di mana dua atau lebih siklus bertepatan — area dengan probabilitas perubahan arah lebih tinggi menurut pendekatan ini."
              delay={0.1}
            >
              {clusters.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Belum ada konfluensi pada rentang proyeksi ini. Coba perpanjang periode proyeksi.</p>
              ) : (
                <div className="space-y-2">
                  {clusters.map((c, i) => (
                    <div key={i} className="bg-midnight-800/40 rounded-xl p-3.5 border border-rose-900/30 hover:border-rose-500/30 transition-all duration-200 animate-fade-in" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>
                      <div className="font-mono-custom text-rose-300 text-sm mb-1.5 font-medium">
                        {fmtDate(c[0].date)}
                        {c[c.length - 1].ms !== c[0].ms ? ` – ${fmtDate(c[c.length - 1].date)}` : ''}
                      </div>
                      <ul className="text-sm text-slate-300 space-y-0.5">
                        {c.map((ev, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                              ev.type === 'fibo' ? 'bg-amber-400' : ev.type === 'bulan' ? 'bg-cyan-400' : ev.type === 'natal' ? 'bg-purple-400' : ev.type === 'retro' ? 'bg-orange-400' : ev.type === 'ingress' ? 'bg-emerald-400' : 'bg-indigo-400'
                            }`} />
                            <span>{ev.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Fibonacci time zones */}
            <Section
              icon={CalendarRange}
              title="Zona Waktu Fibonacci"
              accent="text-amber-400"
              hint="Tanggal potensi perubahan arah, dihitung H+(angka Fibonacci) dari masing-masing titik anchor."
              delay={0.2}
            >
              {fibZones.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Tidak ada zona Fibo pada rentang ini.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {fibZones.map((f, i) => (
                    <div key={`${f.anchorId}-${f.day}-${i}`} className="flex justify-between items-center bg-midnight-800/60 rounded-xl px-3 py-2.5 border border-slate-700/30 hover:border-amber-400/20 transition-all duration-200 animate-fade-in" style={{ animationDelay: `${0.2 + i * 0.03}s` }}>
                      <span className="font-mono-custom">
                        <span className="text-amber-400">{f.label.split(' | ')[0]}</span>
                        <span className="text-slate-600 mx-1">|</span>
                        <span className="text-slate-400">{f.label.split(' | ')[1]}</span>
                      </span>
                      <span className="font-mono-custom text-slate-200 text-xs">{fmtDate(f.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Fibonacci price levels */}
            {parsedAnchors.some(a => !Number.isNaN(a.highNum) && !Number.isNaN(a.lowNum) && a.highNum > a.lowNum) && (
              <Section
                icon={TrendingUp}
                title="Level Harga Fibonacci"
                accent="text-amber-400"
                hint="Retracement & ekstensi dari swing low ke swing high per anchor."
                delay={0.3}
              >
                <div className="space-y-4">
                  {parsedAnchors.filter(a => !Number.isNaN(a.highNum) && !Number.isNaN(a.lowNum) && a.highNum > a.lowNum).map((a, idx) => {
                    const globalIndex = anchors.findIndex(anc => anc.id === a.id);
                    return (
                      <div key={a.id} className="bg-midnight-950/50 p-4 rounded-xl border border-slate-700/30 hover:border-amber-400/20 transition-all duration-200">
                        <h3 className="text-sm font-display text-slate-300 mb-3">Anchor {globalIndex + 1} <span className="text-slate-500">(</span>{fmtNum(a.lowNum)}<span className="text-slate-500"> – </span>{fmtNum(a.highNum)}<span className="text-slate-500">)</span></h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm font-mono-custom min-w-[300px]">
                            <thead>
                              <tr className="text-slate-500 text-left border-b border-slate-700/50">
                                <th className="py-1 pb-2 font-medium text-xs uppercase tracking-wider">Rasio</th>
                                <th className="py-1 pb-2 text-right font-medium text-xs uppercase tracking-wider">Dari Low</th>
                                <th className="py-1 pb-2 text-right font-medium text-xs uppercase tracking-wider">Dari High</th>
                              </tr>
                            </thead>
                            <tbody>
                              {computeFibLevels(a.highNum, a.lowNum).map((l) => (
                                <tr key={l.ratio} className="border-b border-slate-700/20 last:border-0 hover:bg-amber-400/5 transition-colors">
                                  <td className="py-1.5 text-amber-400 font-medium">{l.ratio}</td>
                                  <td className="py-1.5 text-right text-slate-200">{fmtNum(l.fromLow)}</td>
                                  <td className="py-1.5 text-right text-slate-200">{fmtNum(l.fromHigh)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Lunar cycles */}
            <Section
              icon={Moon}
              title="Siklus Bulan"
              accent="text-cyan-400"
              hint="New Moon & Full Moon kerap dipakai sebagai sinyal pembalikan jangka pendek."
              delay={0.4}
            >
              {moonEvents.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Tidak ada siklus bulan pada rentang ini.</p>
              ) : (
                <div className="space-y-2">
                  {moonEvents.map((m, i) => (
                    <div key={i} className="flex justify-between items-center bg-midnight-800/60 rounded-xl px-3 py-2.5 border border-slate-700/30 hover:border-cyan-400/20 transition-all duration-200 animate-fade-in" style={{ animationDelay: `${0.4 + i * 0.05}s` }}>
                      <span className="text-cyan-300 text-sm font-medium">{m.label}</span>
                      <span className="font-mono-custom text-slate-200 text-xs">{fmtDate(m.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Planetary cycles */}
            <Section
              icon={Orbit}
              title="Siklus Planet"
              accent="text-cyan-400"
              hint="Konjungsi & oposisi Merkurius, Venus, dan Mars terhadap Matahari — dihitung dari elemen orbit rata-rata."
              delay={0.5}
            >
              {planetEvents.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Tidak ada event planet pada rentang proyeksi ini.</p>
              ) : (
                <div className="space-y-2">
                  {planetEvents.map((p, i) => (
                    <div key={i} className="flex justify-between items-center bg-midnight-800/60 rounded-xl px-3 py-2.5 border border-slate-700/30 hover:border-cyan-400/20 transition-all duration-200 animate-fade-in" style={{ animationDelay: `${0.5 + i * 0.03}s` }}>
                      <span className="text-cyan-300 text-sm font-medium">{p.label}</span>
                      <span className="font-mono-custom text-slate-200 text-xs">{fmtDate(p.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex gap-3 glass rounded-2xl p-4 text-xs text-slate-500 leading-relaxed animate-fade-in" style={{ animationDelay: '1.4s' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
          <p>
            Mode &quot;Hari Bursa&quot; telah memasukkan daftar libur BEI statis hingga tahun 2026. Posisi planet dihitung dari elemen orbit rata-rata J2000 dengan koreksi perturbasi planet dan Equation of Center orde ke-5 (akurasi ~0.1°). Fase bulan menggunakan algoritma Jean Meeus (akurasi ±2 jam). Alat ini meniru pendekatan time-cycle ala
            Astronacci (Fibonacci time zone + siklus bulan/planet) untuk eksplorasi pola, bukan sinyal beli/jual
            dan bukan nasihat keuangan. Gunakan bersama analisis lain dan manajemen risiko.
          </p>
        </div>

      </div>
    </div>
  );
}
