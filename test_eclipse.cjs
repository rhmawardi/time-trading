const { readFileSync } = require('fs');
const { runInNewContext } = require('vm');

const code = readFileSync('fibo-astro-timing.jsx', 'utf8');
const mathStart = code.indexOf('// Astronomical & Fibonacci core math');
const mathEnd = code.indexOf('// UI subcomponents');
const codeBody = code.substring(mathStart, mathEnd);

const script = `
  ${codeBody}
  const t = (Date.parse('2026-06-15T00:00:00Z') - J2000) / DAY_MS;
  const T = t / 36525;
  const nodeLong = ((125.0445 - 1934.1363 * T) % 360 + 360) % 360;
  const sunLong = getLong('Sun', t);
  const dist = Math.abs(norm180(sunLong - nodeLong));
  
  console.log({
    t, T, nodeLong, sunLong, dist, 
    isEclipse: dist < 15.5 || Math.abs(dist - 180) < 15.5
  });
`;

const context = { console, Math, Date, Object, Array, Number, String, Set };
try {
  runInNewContext(script, context);
} catch (e) {
  console.error("Error", e);
}
