const fs = require('fs');
let code = fs.readFileSync('fibo-astro-timing.jsx', 'utf8');

// Find start
const startIndex = code.indexOf('const DAY_MS');
// Find end
const endIndex = code.indexOf('function buildConfluence');

code = code.substring(startIndex, endIndex);

code += `
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
`;
fs.writeFileSync('run-astro.js', code);
