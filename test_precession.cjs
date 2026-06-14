const fs = require('fs');
const { runInNewContext } = require('vm');

const code = fs.readFileSync('fibo-astro-timing.jsx', 'utf8');
const mathStart = code.indexOf('// Astronomical & Fibonacci core math');
const mathEnd = code.indexOf('// UI subcomponents');
let codeBody = code.substring(mathStart, mathEnd);

// Inject precession correction
codeBody = codeBody.replace(
  "return body === 'Sun' ? sunGeoLong(days) : geoLong(body, days);",
  "const T = days / 36525;\n  const precession = 1.396971 * T;\n  const sidereal = body === 'Sun' ? sunGeoLong(days) : geoLong(body, days);\n  return (sidereal + precession) % 360;"
);

const script = `
  ${codeBody}
  const minTarget = Date.parse('2026-06-01T00:00:00Z');
  const maxTarget = Date.parse('2026-06-30T00:00:00Z');
  console.log("INGRESS (Tropical):", computeIngressEvents(minTarget, maxTarget).map(e => ({date: e.date, label: e.label})));
`;
const context = { console, Math, Date, Object, Array, Number, String, Set, IPO_DATES: {} };
runInNewContext(script, context);
