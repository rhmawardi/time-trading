const fs = require('fs');
const { runInNewContext } = require('vm');

const code = fs.readFileSync('fibo-astro-timing.jsx', 'utf8');
const mathStart = code.indexOf('// Astronomical & Fibonacci core math');
const mathEnd = code.indexOf('// UI subcomponents');
let codeBody = code.substring(mathStart, mathEnd);

const script = `
  ${codeBody}
  const minTarget = Date.parse('2026-06-01T00:00:00Z');
  const maxTarget = Date.parse('2026-06-30T00:00:00Z');
  
  const pEvents = computePlanetEvents(minTarget, maxTarget);
  const mEvents = computeMoonEvents(minTarget, maxTarget);
  const mDecEvents = computeMoonDeclinationEvents(minTarget, maxTarget);
  const retro = computeRetrogradeEvents(minTarget, maxTarget);
  const ingress = computeIngressEvents(minTarget, maxTarget);
  
  const allMoonEvents = [...mEvents, ...mDecEvents].sort((a, b) => a.date.getTime() - b.date.getTime());
  
  const { all, clusters } = buildConfluence([], [], allMoonEvents, pEvents, [], retro, ingress, [], [], 3);
  const ranked = rankClusters(clusters);
  
  console.log('Top Clusters in June 2026:');
  ranked.forEach(c => {
    console.log(\`Score: \${c.score} | Dates: \${c.date.toISOString().slice(0,10)} to \${c.endDate.toISOString().slice(0,10)}\`);
    c.events.forEach(e => console.log(\`  - \${e.date.toISOString().slice(0,10)}: \${e.label} (w: \${e.weight})\`));
  });
`;
const context = { console, Math, Date, Object, Array, Number, String, Set, IPO_DATES: {} };
runInNewContext(script, context);
