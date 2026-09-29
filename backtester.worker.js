import { TRADING_CONFIG, getKyivHour } from './config.js';
import { NetworkManager } from './api.js';
import { TechnicalIndicators } from './indicators.js';
import { BacktesterMath } from './btMath.js';


self.onmessage = async function (e) {
    if (e.data.cmd === 'run') {
        const log = msg => self.postMessage({ type: 'log', msg });
        const { tf, limit, offsetMonths } = e.data;

        let TP = 1.25, SL = 1.5, TRAIL = 0.75;
        let HORIZON = 5, MIN_MOVE = 0.005;
        if (tf === '15m') { HORIZON = 8; MIN_MOVE = 0.0025; TP = 0.75; SL = 1.0; TRAIL = 0.35; }
        else if (tf === '1h') { HORIZON = 6; MIN_MOVE = 0.004; TP = 1.5; SL = 1.5; TRAIL = 0.75; }
        else if (tf === '1d') { HORIZON = 1000; MIN_MOVE = 0.02; TP = 10.0; SL = 5.0; TRAIL = 2.5; }
        else if (tf === '4h') { HORIZON = 1000; MIN_MOVE = 0.005; TP = 3.0; SL = 1.5; TRAIL = 0.75; }

        log(`⏳ Loading ${limit} candles [${tf}] ${offsetMonths > 0 ? '(offset: -' + offsetMonths + 'm)' : ''} from Binance...`);
        try {
            let all = [];
            let currentEndTime = offsetMonths > 0 ? (() => { let d = new Date(); d.setMonth(d.getMonth() - offsetMonths); return d.getTime(); })() : Date.now();
            let remaining = limit;
            
            while (remaining > 0) {
                const fetchSize = Math.min(remaining, 1000);
                const url = `https://api.binance.com/api/v3/klines?symbol=${TRADING_CONFIG.SYMBOL}&interval=${tf}&limit=${fetchSize}&endTime=${currentEndTime}`;
                const json = await NetworkManager.fetchJSON(url);
                if (!json || json.length === 0) break;
                
                const chunk = json.map(k => ({
                    open: parseFloat(k[1]), high: parseFloat(k[2]),
                    low: parseFloat(k[3]), close: parseFloat(k[4]),
                    volume: parseFloat(k[5]), time: k[0]
                }));
                all = chunk.concat(all); // Prepend because we fetch backwards in time
                
                currentEndTime = json[0][0] - 1; // Before the oldest candle in this chunk
                remaining -= json.length;
                
                if (json.length < fetchSize) break; // Reached the beginning of available history
                if (remaining > 0) {
                    log(`⏳ Pagination: loading next batch... (${all.length} / ${limit})`);
                    await new Promise(r => setTimeout(r, 200)); // Respect API limits
                }
            }
            if (all.length === 0) throw new Error("Failed to fetch candles");

            const W = 250, H = HORIZON;
            const fmt = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
            log(`✅ Loaded: ${all.length} candles`);
            log(`📅 Period: ${fmt(all[0].time)} -> ${fmt(all[all.length - 1].time)}`);
            log(`🔧 Warmup: ${W} | Horizon: ${H} candles forward`);
            log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            log(`⚙️  Simulation running...`);

            const results = [];
            for (let i = W; i < all.length - H; i += 2) {
                if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));

                let trendAge = 0;
                for (let j = i; j >= Math.max(0, i - 30); j--) {
                    const a = TechnicalIndicators.calculateADX(all.slice(Math.max(0, j - 50), j + 1));
                    if (a && a.adx > TRADING_CONFIG.ADX_TREND_THRESHOLD) trendAge++; else break;
                }

                let adxIncreasing = false;
                const ADX_SLOPE_CONFIRM_CANDLES = 2;
                if (i >= ADX_SLOPE_CONFIRM_CANDLES) {
                    const adx0 = TechnicalIndicators.calculateADX(all.slice(0, i + 1))?.adx;
                    const adx1 = TechnicalIndicators.calculateADX(all.slice(0, i))?.adx;
                    const adx2 = TechnicalIndicators.calculateADX(all.slice(0, i - 1))?.adx;
                    if (adx0 !== undefined && adx1 !== undefined && adx2 !== undefined) {
                        if ((adx0 - adx1) > 0 && (adx1 - adx2) >= 0) adxIncreasing = true;
                    }
                }

                let { score, ctx, forbidden, forbiddenReason } = BacktesterMath.calcScoreWithContext(all.slice(0, i + 1), trendAge, adxIncreasing, tf);

                if (forbidden) {
                    const timeStr = new Date(all[i].time).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    log(`[${timeStr}] 🛑 Отменен сигнал (${forbiddenReason}): ADX=${ctx.adx}, Spread=${ctx.diSpread}`);
                }

                const entry = all[i].close;
                const atr = BacktesterMath.calcATR(all.slice(0, i + 1));
                const atrPct = atr !== null ? Math.round(atr / entry * 10000) / 100 : null;

                const avgVol = all.slice(Math.max(0, i - 20), i).reduce((s, c) => s + c.volume, 0) / 20;
                const volRatio = avgVol > 0 ? Math.round(all[i].volume / avgVol * 100) / 100 : 1;

                let dir = 0;
                if (score >= BacktesterMath.LONG_TH) dir = 1;
                else if (score <= BacktesterMath.SHORT_TH) dir = -1;
                if (dir === 0) continue;

                const future = all.slice(i + 1, i + 1 + H);
                let exit = future[future.length - 1].close;
                let maxH = -Infinity, minL = Infinity;
                let hitStop = false;
                let hitTp = false;
                let stopLossPrice = null;
                let dynamicStopLevel = -SL;

                for (let c of future) {
                    maxH = Math.max(maxH, c.high);
                    minL = Math.min(minL, c.low);

                    const currentMae = dir === 1 ? (entry - c.low) / entry * 100 : (c.high - entry) / entry * 100;
                    const currentMfe = dir === 1 ? (c.high - entry) / entry * 100 : (entry - c.low) / entry * 100;

                    if (currentMae >= -dynamicStopLevel) {
                        hitStop = true;
                        stopLossPrice = dir === 1 ? entry * (1 + dynamicStopLevel / 100) : entry * (1 - dynamicStopLevel / 100);
                        exit = stopLossPrice;
                        break;
                    }

                    if (currentMfe >= TP) {
                        hitTp = true;
                        exit = dir === 1 ? entry * (1 + TP / 100) : entry * (1 - TP / 100);
                        break;
                    }

                    if (tf === '1d') {
                        if (currentMfe >= 7.5) dynamicStopLevel = Math.max(dynamicStopLevel, 5.0);
                        else if (currentMfe >= 5.0) dynamicStopLevel = Math.max(dynamicStopLevel, 2.5);
                        else if (currentMfe >= TRAIL) dynamicStopLevel = Math.max(dynamicStopLevel, 0);
                    } else {
                        if (currentMfe >= TRAIL) dynamicStopLevel = Math.max(dynamicStopLevel, 0);
                    }
                }

                const mfe = dir === 1 ? Math.round((maxH - entry) / entry * 10000) / 100 : Math.round((entry - minL) / entry * 10000) / 100;
                const mae = dir === 1 ? Math.round((entry - minL) / entry * 10000) / 100 : Math.round((maxH - entry) / entry * 10000) / 100;
                const ret = (exit - entry) / entry;
                const isFavorable = dir === 1 ? exit > entry : exit < entry;
                const isWin = hitTp || (hitStop && dynamicStopLevel >= 0) || (!hitStop && isFavorable);

                const hKyiv = getKyivHour(all[i].time);
                const session = (hKyiv >= 3 && hKyiv < 11) ? 'AS' : ((hKyiv >= 11 && hKyiv < 16) ? 'EU' : ((hKyiv >= 16 && hKyiv < 23) ? 'US' : 'Dead'));

                const LEVERAGE = 5;
                results.push({
                    time: all[i].time,
                    dir: dir === 1 ? 'LONG' : 'SHORT',
                    entry, exit,
                    ret: Math.round(ret * LEVERAGE * 100 * (dir === 1 ? 1 : -1) * 100) / 100,
                    isWin,
                    score: score,
                    ctx, atrPct, volRatio, mfe, mae, trendAge, session
                });

                const emoji = isWin ? '🟩' : '🟥';
                const sign = isWin ? '+' : '';
                const val = Math.round(ret * LEVERAGE * 100 * (dir === 1 ? 1 : -1) * 100) / 100;
                const dateStr = new Date(all[i].time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                log(`[${dateStr}] ${emoji} ${dir === 1 ? 'LONG ' : 'SHORT'} Entry: ${entry.toFixed(1)} -> Exit: ${exit.toFixed(1)} | ${sign}${val.toFixed(2)}% | MFE: ${mfe}%, MAE: ${mae}%`);
            }

            const winRate = results.length > 0 ? (results.filter(x => x.isWin).length / results.length * 100).toFixed(1) : 0;
            log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            log(`🏁 TEST FINISHED. Win Rate: ${winRate}% (${results.length} trades)`);

            self.postMessage({ type: 'done', results, winRate });
        } catch (e) {
            log(`❌ ERROR: ${e.message}`);
            self.postMessage({ type: 'error', error: e.message });
        }
    }
};
