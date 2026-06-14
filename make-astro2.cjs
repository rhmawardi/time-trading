const fs = require('fs');
let code = fs.readFileSync('fibo-astro-timing.jsx', 'utf8');

const startIndex = code.indexOf('const DAY_MS');
const endIndex = code.indexOf('function buildConfluence');
code = code.substring(startIndex, endIndex);

code = code.replace('return rad2deg(Math.asin(sinDec));', 'return (Math.asin(sinDec) * 180) / Math.PI;');

code += `
const startMs = new Date('2026-06-01T00:00:00Z').getTime();
const endMs = new Date('2026-06-30T00:00:00Z').getTime();

const dec = computeMoonDeclinationEvents(startMs, endMs);
console.log('Moon Declination:', dec);
`;
fs.writeFileSync('run-astro2.js', code);
