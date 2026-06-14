const fs = require('fs');
const { runInNewContext } = require('vm');

const code = fs.readFileSync('fibo-astro-timing.jsx', 'utf8');
const mathStart = code.indexOf('// Astronomical & Fibonacci core math');
const mathEnd = code.indexOf('// UI subcomponents');
const codeBody = code.substring(mathStart, mathEnd);

const script = `
  ${codeBody}
  console.log('Moon Declinations:', computeMoonDeclinationEvents(Date.parse('2026-06-10T00:00:00Z'), Date.parse('2026-06-20T00:00:00Z')));
`;
const context = { console, Math, Date, Object, Array, Number, String, Set, IPO_DATES: {} };
runInNewContext(script, context);
