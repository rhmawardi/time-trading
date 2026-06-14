// ============================================================================
// BACKTEST OPTIMIZER v2 — Async Multi-Parameter Grid Search
// ============================================================================
// Now runs asynchronously with chunked processing to prevent browser freeze.
// Expensive astro/planet computations are cached by the caller.
//
// Strategy:
//   Phase 1 (Coarse): ~1100 combinations with wide steps, async batching
//   Phase 2 (Fine):   ~100-300 more combos around top 5, async batching
//
// Ranking: F1-Score DESC → Tolerance ASC → AvgTiming ASC
// ============================================================================

const BATCH_SIZE = 25; // Process N combos then yield to UI thread

/**
 * Yield control back to the browser's event loop so UI can update
 */
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Run the full 2-phase grid search optimizer (ASYNC — won't freeze browser)
 * @param {Function} runTestCallback - (params) => backtestResult (synchronous, should be fast with caching)
 * @param {Function} onProgress - (progress) => void
 * @returns {Promise<Object>} { best, top5, totalTested, coarseTested, fineTested, durationMs, durationSec }
 */
export async function runGridSearchOptimizer(runTestCallback, onProgress = () => {}) {
  const startTime = Date.now();

  // ---- Phase 1: Coarse Search ----
  const coarseTolerances = [0, 0.5, 1.0, 1.5, 2.0];
  const coarseSwings = [14]; // swingLookback doesn't affect backtest calculation, hanya untuk Auto-Detect
  const coarseMinScores = [2.0, 5.0, 8.0, 12.0];
  const coarseProjections = [90, 180, 365];
  const dayModes = ['trading', 'calendar'];

  // Most meaningful toggle combinations (reduced from 8 to 4)
  const toggleCombos = [
    { useNatal: true,  useRetrograde: true,  useIngress: true  },
    { useNatal: true,  useRetrograde: true,  useIngress: false },
    { useNatal: false, useRetrograde: true,  useIngress: false },
    { useNatal: false, useRetrograde: false, useIngress: false },
  ];

  // Build coarse grid
  const coarseGrid = [];
  for (const tol of coarseTolerances) {
    for (const swing of coarseSwings) {
      for (const minScore of coarseMinScores) {
        for (const proj of coarseProjections) {
          for (const dm of dayModes) {
            for (const toggles of toggleCombos) {
              coarseGrid.push({
                confluenceTolerance: tol,
                swingLookback: swing,
                minSignalScore: minScore,
                projectionDays: proj,
                dayMode: dm,
                ...toggles,
              });
            }
          }
        }
      }
    }
  }

  const totalCoarse = coarseGrid.length;
  const allResults = [];
  let bestSoFar = null;

  // Run Phase 1 with async batching
  for (let i = 0; i < coarseGrid.length; i++) {
    const params = coarseGrid[i];
    try {
      const result = runTestCallback(params);
      if (result && typeof result.f1 === 'number') {
        const entry = {
          params: { ...params },
          f1: result.f1,
          precision: result.precision,
          recall: result.recall,
          avgTimingError: result.avgTimingError,
          totalHits: result.totalHits,
          totalClusters: result.totalClusters,
          totalReversals: result.totalReversals,
          capturedReversals: result.capturedReversals,
        };
        allResults.push(entry);

        if (!bestSoFar || compareResults(entry, bestSoFar) < 0) {
          bestSoFar = entry;
        }
      }
    } catch (err) {
      // Skip failed combinations silently
    }

    // Yield to UI every BATCH_SIZE iterations
    if ((i + 1) % BATCH_SIZE === 0 || i === coarseGrid.length - 1) {
      const percent = Math.round(((i + 1) / totalCoarse) * 50);
      onProgress({
        phase: 1,
        current: i + 1,
        total: totalCoarse,
        percent,
        bestSoFar: bestSoFar ? { f1: bestSoFar.f1, tolerance: bestSoFar.params.confluenceTolerance } : null,
      });
      await yieldToUI();
    }
  }

  // ---- Phase 2: Fine Tuning around top 5 coarse results ----
  const sortedCoarse = [...allResults].sort(compareResults);
  const top5Coarse = sortedCoarse.slice(0, 5);

  const fineGrid = [];
  const seenKeys = new Set(allResults.map(r => paramKey(r.params)));

  for (const topResult of top5Coarse) {
    const p = topResult.params;

    // Generate fine-grained neighbors around each top result
    const fineTols = uniqueClamp([p.confluenceTolerance - 0.5, p.confluenceTolerance, p.confluenceTolerance + 0.5], 0, 2.0);
    const fineSwings = uniqueClamp([p.swingLookback - 3, p.swingLookback - 1, p.swingLookback, p.swingLookback + 1, p.swingLookback + 3], 5, 30);
    const fineMinScores = uniqueClamp(
      [p.minSignalScore - 1.5, p.minSignalScore - 0.5, p.minSignalScore, p.minSignalScore + 0.5, p.minSignalScore + 1.5],
      1.0, 15.0
    ).map(v => Math.round(v * 2) / 2);
    const fineProjs = uniqueClamp([p.projectionDays - 30, p.projectionDays, p.projectionDays + 30], 30, 365);

    for (const tol of fineTols) {
      for (const swing of fineSwings) {
        for (const minScore of [...new Set(fineMinScores)]) {
          for (const proj of fineProjs) {
            const candidate = {
              confluenceTolerance: tol,
              swingLookback: swing,
              minSignalScore: minScore,
              projectionDays: proj,
              dayMode: p.dayMode,
              useNatal: p.useNatal,
              useRetrograde: p.useRetrograde,
              useIngress: p.useIngress,
            };
            const key = paramKey(candidate);
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              fineGrid.push(candidate);
            }
          }
        }
      }
    }
  }

  const totalFine = fineGrid.length;

  // Run Phase 2 with async batching
  for (let i = 0; i < fineGrid.length; i++) {
    const params = fineGrid[i];
    try {
      const result = runTestCallback(params);
      if (result && typeof result.f1 === 'number') {
        const entry = {
          params: { ...params },
          f1: result.f1,
          precision: result.precision,
          recall: result.recall,
          avgTimingError: result.avgTimingError,
          totalHits: result.totalHits,
          totalClusters: result.totalClusters,
          totalReversals: result.totalReversals,
          capturedReversals: result.capturedReversals,
        };
        allResults.push(entry);

        if (!bestSoFar || compareResults(entry, bestSoFar) < 0) {
          bestSoFar = entry;
        }
      }
    } catch (err) {
      // Skip silently
    }

    if ((i + 1) % BATCH_SIZE === 0 || i === fineGrid.length - 1) {
      const percent = 50 + Math.round(((i + 1) / Math.max(1, totalFine)) * 50);
      onProgress({
        phase: 2,
        current: i + 1,
        total: totalFine,
        percent,
        bestSoFar: bestSoFar ? { f1: bestSoFar.f1, tolerance: bestSoFar.params.confluenceTolerance } : null,
      });
      await yieldToUI();
    }
  }

  // ---- Final ranking ----
  allResults.sort(compareResults);

  const durationMs = Date.now() - startTime;

  return {
    best: allResults[0] || null,
    top5: allResults.slice(0, 5),
    totalTested: allResults.length,
    coarseTested: totalCoarse,
    fineTested: totalFine,
    durationMs,
    durationSec: Math.round(durationMs / 100) / 10,
  };
}

// ---- Helpers ----

/**
 * Compare two results for sorting.
 * Priority: F1-Score DESC → Tolerance ASC → AvgTiming ASC
 */
function compareResults(a, b) {
  if (b.f1 !== a.f1) return b.f1 - a.f1;
  if (a.params.confluenceTolerance !== b.params.confluenceTolerance) {
    return a.params.confluenceTolerance - b.params.confluenceTolerance;
  }
  const aTime = a.avgTimingError ?? 999;
  const bTime = b.avgTimingError ?? 999;
  return aTime - bTime;
}

function paramKey(p) {
  return `${p.confluenceTolerance}|${p.swingLookback}|${p.minSignalScore}|${p.projectionDays}|${p.dayMode}|${p.useNatal}|${p.useRetrograde}|${p.useIngress}`;
}

function uniqueClamp(values, min, max) {
  const result = [];
  const seen = new Set();
  for (const v of values) {
    const clamped = Math.max(min, Math.min(max, v));
    const rounded = Math.round(clamped * 10) / 10;
    if (!seen.has(rounded)) {
      seen.add(rounded);
      result.push(rounded);
    }
  }
  return result.sort((a, b) => a - b);
}

/**
 * Format toggle label for display
 */
export function formatToggleLabel(params) {
  const parts = [];
  if (params.useNatal) parts.push('Natal');
  if (params.useRetrograde) parts.push('Retro');
  if (params.useIngress) parts.push('Ingress');
  return parts.length > 0 ? parts.join(' + ') : 'Tanpa Astro Tambahan';
}
