const https = require('https');

https.get('https://aa.usno.navy.mil/api/moon/phases/year?year=2026', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      const phases = parsed.phasedata.filter(p => p.month === 6 || p.month === 7);
      console.log(JSON.stringify(phases, null, 2));
    } catch (e) {
      console.error(e);
      console.log(data);
    }
  });
}).on('error', (e) => {
  console.error(e);
});
