# DCA-BOT (SHORT-only, multi-active per symbol)

Backend-only bot untuk strategi DCA SHORT di Bybit (testnet/mainnet).
Tanpa UI. Penyimpanan file-based. Multi-active antar-symbol (satu deal aktif per symbol).
Final journal hanya menulis hasil akhir deal (NDJSON per baris) ke `journal-YYYY-MM-DD.json`.

## Fitur Utama
- SHORT-only, leverage x10 (konstan)
- Multi-active antar-symbol; **single-active per symbol** (sinyal symbol yang sudah aktif diabaikan)
- Sinyal masuk via Discord adapter → disimpan ke `symbol.json` setelah lolos filter
- Planner berbasis **min order qty** Bybit (bukan USD)
- DCA grid dari entry: **+5% / +15% / +35%** dengan qty multiplier **1.5× / 2.25× / 3.4×**
- TP cascade relatif avg aktif:
  - **TP1**: 0.8% → trim 30% → **SL = BEP**
  - **TP2**: +1.6% dari TP1 → trim 30% → **SL = TP1**
  - **TP3**: +4% dari TP2 → trim 30% → **aktifkan trailing 3%**
  - **TP4**: 40% dari avg → trim 10%
- **SL pra-TP1**: avg × 1.5 (dinamis mengikuti avg saat DCA kena)
- **Window Skip**: funding ≤ −1% dan waktu **23:00–04:00 WIB** → sinyal diabaikan
- File-based locking per symbol: `active-<SYMBOL>.lock`

## Prasyarat
- Node.js **>= 20**
- API Key Bybit (Linear Perpetual), testnet disarankan

## Instalasi
npm install
cp .env.example .env
