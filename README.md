# CLOUD TREND ALERT (Binance USDT-M Futures AI Trading Assistant)

## Run (VPS)
1) `cp .env.example .env` and set TELEGRAM_BOT_TOKEN + chat IDs.
2) `npm i`
3) `npm run sanity`
4) `pm2 start pm2.config.cjs`
5) `pm2 logs cloud-trend-alert`

## Commands
- /scan
- /scan BTCUSDT
- /scan BTCUSDT 1h
- /scan BTCUSDT 4h
- /top
- /help

## Notes
- WS is optional: if WS fails, bot runs REST-only (no crash).
- Chart renderer uses pngjs; if pngjs not available, fallback placeholder PNG.
- Decisions only on candle CLOSE.
- Daily recap date is YESTERDAY in UTC.
