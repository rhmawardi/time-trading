// ============================================================================
// BACKTEST OPTIMIZER FOR IHSG — Parameter Grid Search
// ============================================================================
// Mencari kombinasi optimal Toleransi Konfluensi & Swing Sensitivity
// untuk maximize Hit Rate pada data IHSG historis.
//
// Parameters to optimize:
// 1. confluenceTolerance: 0.5 - 3.0 hari (step 0.5)
// 2. swingLookback: 7 - 21 hari (step 1)
//
// Output: Grid hasil dengan Hit Rate untuk setiap kombinasi
// ============================================================================

const DAY_MS = 86400000;

export function optimizeParametersGrid(
  toleranceRange,
  lookbackRange,
  runTestCallback
) {
  const results = [];
  const testStart = Date.now();

  for (const tolerance of toleranceRange) {
    for (const lookback of lookbackRange) {
      try {
        const backtest = runTestCallback(lookback, tolerance);
        if (!backtest) continue;

        results.push({
          tolerance: tolerance,
          swingLookback: lookback,
          hitRate: backtest.hitRate,
          totalClusters: backtest.totalClusters,
          totalHits: backtest.totalHits,
          averageConfidenceScore: backtest.averageConfidenceScore || 0
        });

      } catch (err) {
        console.warn(`Grid cell (tol=${tolerance}, lookback=${lookback}) failed:`, err.message);
      }
    }
  }

  // Sort by Hit Rate descending
  results.sort((a, b) => {
    // If hit rate is equal, prefer the one with more hits
    if (b.hitRate === a.hitRate) return b.totalHits - a.totalHits;
    return b.hitRate - a.hitRate;
  });

  return {
    results,
    best: results[0] || null,
    gridSize: toleranceRange.length * lookbackRange.length,
    completedTests: results.length,
    testDurationMs: Date.now() - testStart,
    recommendedNext: results.slice(0, 5) // Top 5 combinations
  };
}

/**
 * Format hasil grid untuk display di UI
 * @param {Object} gridResult - Result dari optimizeParametersGrid
 * @returns {String} Formatted markdown report
 */
export function formatGridReport(gridResult) {
  if (!gridResult.results || gridResult.results.length === 0) {
    return '❌ Optimization gagal: Tidak ada hasil yang valid.';
  }

  const best = gridResult.best;
  let report = `# 📊 GRID SEARCH RESULTS — IHSG Parameter Optimization\n\n`;

  report += `**Test Summary:**\n`;
  report += `- Total Tested: ${gridResult.completedTests}/${gridResult.gridSize} combinations\n`;
  report += `- Duration: ${(gridResult.testDurationMs / 1000).toFixed(2)}s\n\n`;

  report += `## 🏆 Best Configuration\n`;
  report += `| Parameter | Value |\n`;
  report += `|-----------|-------|\n`;
  report += `| **Confluence Tolerance** | ±${best.tolerance} hari |\n`;
  report += `| **Swing Lookback** | ${best.swingLookback} candles |\n`;
  report += `| **Hit Rate** | **${best.hitRate.toFixed(2)}%** |\n`;
  report += `| **Total Clusters Tested** | ${best.totalClusters} |\n`;
  report += `| **Successful Hits** | ${best.totalHits} |\n\n`;

  report += `## 🥈 Top 5 Alternatives\n`;
  report += `| Rank | Tolerance | Lookback | Hit Rate | Clusters | Hits |\n`;
  report += `|------|-----------|----------|----------|----------|------|\n`;

  gridResult.recommendedNext.slice(0, 5).forEach((result, idx) => {
    report += `| ${idx + 1} | ±${result.tolerance}d | ${result.swingLookback} | `;
    report += `${result.hitRate.toFixed(2)}% | ${result.totalClusters} | ${result.totalHits} |\n`;
  });

  report += `\n## 📈 Full Grid Results\n`;
  report += `| Tolerance | Lookback | Hit Rate | Clusters | Hits |\n`;
  report += `|-----------|----------|----------|----------|------|\n`;

  gridResult.results.forEach(result => {
    report += `| ±${result.tolerance}d | ${result.swingLookback} | `;
    report += `${result.hitRate.toFixed(2)}% | ${result.totalClusters} | ${result.totalHits} |\n`;
  });

  return report;
}

/**
 * Validate grid result dan extract actionable insights
 * @param {Object} gridResult - Result dari optimizeParametersGrid
 * @returns {Object} Validated result dengan insights
 */
export function validateAndEnhanceResult(gridResult) {
  if (!gridResult.best) {
    return { ...gridResult, valid: false, reason: 'No valid results' };
  }

  const best = gridResult.best;
  const top5 = gridResult.recommendedNext.slice(0, 5);

  // Check consistency dalam top results
  const toleranceConsistency = top5.filter(r => r.tolerance === best.tolerance).length;
  const lookbackConsistency = top5.filter(r => r.swingLookback === best.swingLookback).length;

  return {
    ...gridResult,
    valid: true,
    insights: {
      bestIsConsistent: toleranceConsistency >= 2 || lookbackConsistency >= 2,
      recommendedAction: best.hitRate >= 65 ? 'APPLY_IMMEDIATELY' : best.hitRate >= 50 ? 'REVIEW_AND_TEST' : 'IMPROVE_DATA',
      confidence: Math.min(100, best.totalClusters * 3),
      caveat: best.totalClusters < 20 ? 'Low cluster count - extend projection days' : null
    }
  };
}

/**
 * Export grid result sebagai CSV untuk further analysis
 * @param {Object} gridResult - Result dari optimizeParametersGrid
 * @returns {String} CSV formatted data
 */
export function exportGridResultAsCSV(gridResult) {
  let csv = 'Tolerance (days),Swing Lookback,Hit Rate (%),Total Clusters,Successful Hits,Rank\n';
  
  gridResult.results.forEach((result, idx) => {
    csv += `${result.tolerance},${result.swingLookback},${result.hitRate.toFixed(2)},`;
    csv += `${result.totalClusters},${result.totalHits},${idx + 1}\n`;
  });

  return csv;
}

/**
 * Download CSV hasil grid search
 * @param {Object} gridResult - Result dari optimizeParametersGrid
 * @param {String} filename - Output filename
 */
export function downloadGridResultCSV(gridResult, filename = 'grid-result-ihsg.csv') {
  const csv = exportGridResultAsCSV(gridResult);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default { optimizeParametersGrid, formatGridReport, validateAndEnhanceResult, exportGridResultAsCSV, downloadGridResultCSV };
