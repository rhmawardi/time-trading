const { readFileSync } = require('fs');
const { runInNewContext } = require('vm');

const code = readFileSync('fibo-astro-timing.jsx', 'utf8');

const mathStart = code.indexOf('// Astronomical & Fibonacci core math');
const mathEnd = code.indexOf('// UI subcomponents');
const codeBody = code.substring(mathStart, mathEnd);

const script = `
  ${codeBody}
  
  const minTarget = Date.parse('2026-06-01T00:00:00Z');
  const maxTarget = Date.parse('2026-06-30T00:00:00Z');
  
  const pEvents = computePlanetEvents(minTarget, maxTarget);
  const mEvents = computeMoonEvents(minTarget, maxTarget);
  const retro = computeRetrogradeEvents(minTarget, maxTarget);
  const ingress = computeIngressEvents(minTarget, maxTarget);
  
  console.log("PLANET:", pEvents.map(e => ({date: e.date.toISOString().slice(0,10), label: e.label})));
  console.log("MOON:", mEvents.map(e => ({date: e.date.toISOString().slice(0,10), label: e.label})));
  console.log("RETRO:", retro.map(e => ({date: e.date, label: e.label})));
  console.log("INGRESS:", ingress.map(e => ({date: e.date, label: e.label})));
`;

const context = { console, Math, Date, Object, Array, Number, String, Set, IPO_DATES: {} };
try {
  runInNewContext(script, context);
} catch (e) {
  console.error("Error running script", e);
}
