# 📊 IHSG Parameter Optimizer — Grid Search Guide

## Overview

**Grid Search Optimizer** adalah tool untuk menemukan kombinasi parameter optimal:
1. **Toleransi Konfluensi** (±0.5 – 3.0 hari)
2. **Sensitivitas Swing** (7 – 21 candles)

yang menghasilkan **Hit Rate tertinggi** pada data historis IHSG.

---

## Prerequisites

Sebelum menjalankan optimizer, pastikan sudah:

1. ✅ **Auto Deteksi Data**: Klik tombol "📥 Tarik Data IHSG" untuk load historical data dari Yahoo Finance
2. ✅ **Input Reversals**: Masukkan minimal **3-5 tanggal reversal aktual** (pivot point/turning point) dari chart IHSG historis
3. ✅ **Data Validation**: Pastikan data reversal Anda mencakup periode yang cukup (minimal 6 bulan – 1 tahun)

### Mengapa data reversal penting?

- Optimizer akan **backtest** setiap kombinasi parameter terhadap reversal aktual yang Anda input
- Hit Rate = % reversal yang berhasil ditangkap oleh confluence points dalam tolerance window
- Semakin akurat reversal data Anda → semakin akurat rekomendasi parameter

---

## Cara Menggunakan

### Step 1: Siapkan Data IHSG

```
1. Di bagian "Pengaturan Analisis", pastikan ticker = "^JKSE" (IHSG)
2. Klik tombol "📥 Tarik Data IHSG" (Auto Deteksi)
3. Tunggu hingga 3-5 anchor point otomatis terdeteksi
4. Verifikasi anchor point sesuai major/medium/minor swing
```

### Step 2: Input Reversal Historis

```
1. Buka chart IHSG historis (TradingView, Yahoo Finance, dll)
2. Identifikasi 5-10 reversal point signifikan dari tahun lalu
3. Di section "Data Reversal Aktual (Backtest)", input tanggalnya
4. Pastikan reversal mencakup berbagai timeframe:
   - Reversal jangka panjang (6-12 bulan)
   - Reversal menengah (1-3 bulan)
   - Reversal pendek (2-4 minggu)
```

**Contoh reversal IHSG:**
- 2025-06-15: Major reversal (swing low)
- 2025-08-22: Intermediate reversal
- 2025-10-03: Minor reversal
- 2025-12-18: Major reversal (swing high)
- 2026-02-14: Intermediate reversal

### Step 3: Jalankan Grid Search

```
1. Scroll ke section "🔧 Grid Search Optimizer"
2. Review parameter range:
   - Toleransi Konfluensi: ±0.5, 1.0, 1.5, 2.0, 2.5, 3.0 hari
   - Swing Lookback: 7, 10, 14, 17, 21 candles
   - Total kombinasi: 6 × 5 = 30 tests
3. Klik "Jalankan Grid Search (30 kombinasi)"
4. Tunggu hingga selesai (biasanya 5-10 detik)
```

### Step 4: Analisis Hasil

Grid search akan menampilkan:

**🏆 Best Configuration**
- Parameter kombinasi dengan Hit Rate tertinggi
- Rekomendasi utama untuk Anda gunakan

**🥈 Top 5 Alternatives**
- 4 kombinasi alternatif lainnya (ranked by Hit Rate)
- Pilih salah satu jika best configuration terlalu restrictive

**📈 Full Grid Results**
- Tabel lengkap semua 30 kombinasi
- Sortir dari Hit Rate tertinggi ke terendah

---

## Interpretasi Hasil

### Hit Rate

- **Hit Rate = % reversal yang tertangkap confluence points**
- Formula: `(Total Hits / Total Clusters) × 100%`
- Contoh: 60% = 6 dari 10 reversal tertangkap

### Parameter Trade-off

**Toleransi Konfluensi ↑ (lebih loose)**
- ✅ Hit Rate cenderung naik (tangkap lebih banyak reversal)
- ❌ False positives naik (noise bertambah)

**Toleransi Konfluensi ↓ (lebih tight)**
- ✅ Sinyal lebih presisi (fewer false positives)
- ❌ Hit Rate turun (miss beberapa reversal)

**Swing Lookback ↑ (lebih sensitive)**
- ✅ Detect lebih banyak swing points
- ❌ False swings bertambah

**Swing Lookback ↓ (less sensitive)**
- ✅ Filter noise/spike
- ❌ Miss swing poin minor

---

## Rekomendasi Praktis

### Untuk Conservative Traders (prefer precision)
- **Target Hit Rate**: 50-60%
- **Strategy**: Pilih Toleransi terendah yang masih hit rate >50%
- **Rationale**: Prefer fewer, higher-quality signals

### Untuk Aggressive Traders (want more signals)
- **Target Hit Rate**: 65-75%
- **Strategy**: Pilih Toleransi medium-high (2.0-3.0 hari)
- **Rationale**: Catch lebih banyak reversal, filter via confluence strength

### Untuk Balanced Traders
- **Target Hit Rate**: 60-65%
- **Strategy**: Pick middle option dari Top 5
- **Rationale**: Balance antara precision dan coverage

---

## Best Practices

1. **Test Multiple Asset Classes**
   - Run optimizer untuk IHSG, BCA, BRI, crypto, S&P 500
   - Parameter optimal berbeda per aset
   - Dokumentasi hasil untuk quick reference

2. **Validate Out-of-Sample**
   - Optimizer backtest data historis (in-sample)
   - Validasi recommended parameters pada data baru (out-of-sample)
   - Jika hit rate drop >15%, re-run optimizer dengan data lebih panjang

3. **Combine Signals**
   - Jangan rely hanya pada Hit Rate
   - Perhatikan juga confluence strength (Fibo score)
   - Filter dengan volume, volatility, trend confirmation

4. **Monitor & Adjust**
   - Hit Rate bisa berubah seiring market condition
   - Re-run optimizer quarterly atau saat market regime change
   - Document parameter perubahan untuk audit trail

---

## Troubleshooting

**Q: Grid search tidak jalan / button disabled**
- A: Pastikan sudah:
  1. Klik "Auto Deteksi" dan data loaded ✅
  2. Input minimal 1 reversal date di Backtest section ✅
  3. Reload page jika masih error

**Q: Semua Hit Rate sangat rendah (<30%)**
- A: Kemungkinan:
  1. Reversal dates tidak akurat → double-check vs chart
  2. Data IHSG tidak tercakup periode reversal → expand projection days
  3. Anchor point salah → re-run auto deteksi atau adjust manual

**Q: Hasil berbeda setiap kali jalankan**
- A: Normal — terdapat randomisasi dalam swing detection
  - Jalankan 2-3 kali dan bandingkan top 3 results
  - Pilih parameter yang consistently ranking tinggi

**Q: Best Hit Rate hanya 40%, should I use it?**
- A: Depends on trade setup:
  - Jika Hit Rate <40% → signal quality buruk → improve reversal data / extend backtest period
  - Jika sudah best effort → gunakan dengan confluence filter (strength >3.5)

---

## Technical Details

### Grid Search Algorithm

```javascript
for each tolerance in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]:
  for each lookback in [7, 10, 14, 17, 21]:
    1. Re-detect swings dengan lookback baru
    2. Build anchors dari swings (3-tier strategy)
    3. Compute Fib/Astro zones dengan tolerance baru
    4. Run backtest: count reversal captures
    5. Calculate Hit Rate
    
Sort results by Hit Rate DESC
Return top 5 + all 30 results
```

### Backtest Methodology

- **In-Sample**: Test pada historical data yang sama dengan reversal input
- **Tolerance Window**: Confluence point dianggap "hit" jika dalam ±tolerance hari dari reversal date
- **Break-Even**: Tidak count partial hits — harus clear hit

---

## Output Format

Hasil optimizer ditampilkan dalam format markdown table:

```
# 📊 GRID SEARCH RESULTS — IHSG Parameter Optimization

**Test Summary:**
- Total Tested: 30/30 combinations
- Duration: 2.45s

## 🏆 Best Configuration

| Parameter | Value |
|-----------|-------|
| **Confluence Tolerance** | ±1.5 hari |
| **Swing Lookback** | 14 candles |
| **Hit Rate** | **63.33%** |
| **Total Clusters Tested** | 45 |
| **Successful Hits** | 19 |

## 🥈 Top 5 Alternatives

| Rank | Tolerance | Lookback | Hit Rate | Clusters | Hits |
|------|-----------|----------|----------|----------|------|
| 1 | ±1.5d | 14 | 63.33% | 45 | 19 |
| 2 | ±2.0d | 14 | 60.00% | 42 | 25 |
| 3 | ±1.5d | 17 | 58.82% | 34 | 20 |
| 4 | ±1.0d | 14 | 55.56% | 54 | 15 |
| 5 | ±2.0d | 17 | 52.94% | 34 | 17 |
```

---

## Next Steps

1. ✅ Apply recommended parameters ke app (update sliders)
2. ✅ Run live backtest untuk validasi
3. ✅ Monitor confluence signal performance next 1-2 months
4. ✅ Re-run optimizer jika market condition change significantly
5. ✅ Document results untuk future reference

---

**Last Updated**: June 12, 2026  
**Version**: 1.0  
**Author**: Fibo-Astro Timing System
