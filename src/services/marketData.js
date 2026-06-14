export async function fetchMarketData(ticker = '^JKSE') {
  // Prevent double-encoding of '=' which breaks Yahoo Finance (e.g., GC=F becomes GC%253DF and 404s)
  const safeTicker = encodeURIComponent(ticker).replace(/%3D/g, '=');
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${safeTicker}?interval=1d&range=2y`;
  
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  ];
  
  let yahooData = null;
  let lastError = null;

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      yahooData = await res.json();
      break; 
    } catch (err) {
      lastError = err;
      console.warn("Proxy gagal, mencoba jalur lain...", proxyUrl);
    }
  }

  if (!yahooData) {
    try {
      const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(fallbackUrl);
      if (!res.ok) throw new Error("Fallback HTTP " + res.status);
      const data = await res.json();
      yahooData = JSON.parse(data.contents);
    } catch (err) {
      throw new Error(lastError ? lastError.message : "Semua jalur koneksi proxy gagal diblokir.");
    }
  }
  
  try {
    const result = yahooData?.chart?.result?.[0];
    if (!result) throw new Error("Saham tidak ditemukan di Yahoo Finance");
    
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    
    const chartData = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] !== null) {
        // Convert UNIX timestamp (seconds) to Date string
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        chartData.push({
          date,
          close: quotes.close[i],
          high: quotes.high[i] !== null ? quotes.high[i] : quotes.close[i],
          low: quotes.low[i] !== null ? quotes.low[i] : quotes.close[i],
        });
      }
    }
    return chartData;
  } catch (error) {
    console.error("fetchIHSGData Error:", error);
    throw error;
  }
}

export function detectSwings(data, lookbackWindow = 14) {
  const swings = [];
  const pivotThreshold = 0.85; // 85% of surrounding bars must confirm
  const significanceThreshold = 0.02; // Swing range must be >= 2% of avg price to filter noise
  
  for (let i = lookbackWindow; i < data.length; i++) {
    const currentHigh = data[i].high;
    const currentLow = data[i].low;
    
    let higherCount = 0;
    let lowerCount = 0;
    
    // Left window is always full lookbackWindow
    // Right window is full lookbackWindow OR whatever is left until the end of data
    const rightWindow = Math.min(lookbackWindow, data.length - 1 - i);
    
    for (let j = 1; j <= lookbackWindow; j++) {
      if (currentHigh >= data[i - j].high) higherCount++;
      if (currentLow <= data[i - j].low) lowerCount++;
    }
    
    for (let j = 1; j <= rightWindow; j++) {
      if (currentHigh >= data[i + j].high) higherCount++;
      if (currentLow <= data[i + j].low) lowerCount++;
    }
    
    const totalBarsChecked = lookbackWindow + rightWindow;
    const highStrength = higherCount / totalBarsChecked;
    const lowStrength = lowerCount / totalBarsChecked;
    
    // Require a minimum amount of right-side confirmation to avoid premature signals
    // Note: For production, we require confirmation even for the last bar to avoid false signals
    const minRightBarsRequired = Math.min(3, lookbackWindow);
    if (rightWindow < minRightBarsRequired) {
      continue; // Skip swings without sufficient right-side confirmation
    }
    
    // Significance filter: price range relative to local average
    const windowSlice = data.slice(
      Math.max(0, i - lookbackWindow),
      Math.min(data.length, i + rightWindow + 1)
    );
    const avgPrice = windowSlice.reduce((s, d) => s + d.close, 0) / windowSlice.length;
    
    if (highStrength >= pivotThreshold && rightWindow >= 1) {
      const windowLow = Math.min(...windowSlice.map(d => d.low));
      const range = currentHigh - windowLow;
      if (avgPrice > 0 && range / avgPrice >= significanceThreshold) {
        swings.push({ date: data[i].date, type: 'high', value: currentHigh, strength: Math.round(highStrength * 100) });
      }
    } else if (lowStrength >= pivotThreshold && rightWindow >= 1) {
      const windowHigh = Math.max(...windowSlice.map(d => d.high));
      const range = windowHigh - currentLow;
      if (avgPrice > 0 && range / avgPrice >= significanceThreshold) {
        swings.push({ date: data[i].date, type: 'low', value: currentLow, strength: Math.round(lowStrength * 100) });
      }
    }
  }
  
  // Post-process to remove adjacent swings of the same type
  const filteredSwings = [];
  let lastType = null;
  for (const s of swings) {
    if (filteredSwings.length > 0 && s.type === lastType) {
      const lastSwing = filteredSwings[filteredSwings.length - 1];
      if ((s.type === 'high' && s.value > lastSwing.value) || 
          (s.type === 'low' && s.value < lastSwing.value)) {
        filteredSwings[filteredSwings.length - 1] = s;
      }
      continue;
    }
    filteredSwings.push(s);
    lastType = s.type;
  }
  
  return filteredSwings;
}
