import { showElliott, currentTF } from './state.js';
import { TRADING_CONFIG } from './config.js';

// ============================================================
// ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ
// ============================================================
export class TechnicalIndicators {
    // RSI со сглаживанием Уайлдера (RMA)
    static calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        for (let i = period + 1; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            const gain = Math.max(0, diff);
            const loss = Math.max(0, -diff);
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return Math.round(100 - 100 / (1 + rs));
    }

    // Вспомогательный метод для получения массива значений RSI (для расчета StochRSI)
    static calculateRSIArray(prices, period = 14) {
        if (prices.length < period + 1) return [];
        let rsies = [];
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        rsies.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

        for (let i = period + 1; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            const gain = Math.max(0, diff);
            const loss = Math.max(0, -diff);
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            rsies.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
        }
        return rsies;
    }

    // Stochastic RSI
    static calculateStochRSI(prices, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
        const rsies = this.calculateRSIArray(prices, rsiPeriod);
        if (rsies.length < stochPeriod) return null;

        let stochRSI = [];
        for (let i = stochPeriod - 1; i < rsies.length; i++) {
            const window = rsies.slice(i - stochPeriod + 1, i + 1);
            const minRSI = Math.min(...window);
            const maxRSI = Math.max(...window);
            if (maxRSI === minRSI) {
                stochRSI.push(0);
            } else {
                stochRSI.push(((rsies[i] - minRSI) / (maxRSI - minRSI)) * 100);
            }
        }

        const sma = (data, period) => {
            if (data.length < period) return [];
            let result = [];
            for (let i = period - 1; i < data.length; i++) {
                const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
                result.push(sum / period);
            }
            return result;
        };

        const K = sma(stochRSI, kPeriod);
        if (K.length === 0) return null;
        const D = sma(K, dPeriod);
        if (D.length === 0) return null;

        return {
            k: Math.round(K[K.length - 1] * 100) / 100,
            d: Math.round(D[D.length - 1] * 100) / 100
        };
    }

    static calculateTrend(prices) {
        if (prices.length < 20) return 'UNKNOWN';
        const avg = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const pct = ((prices[prices.length - 1] - avg) / avg) * 100;
        return pct > 2 ? '🟢 UPTREND' : pct < -2 ? '🔴 DOWNTREND' : '🟡 SIDEWAYS';
    }

    static calculateADX(candles, period = 14) {
        if (candles.length < period * 2) return null;

        let tr = [0], plusDM = [0], minusDM = [0];

        for (let i = 1; i < candles.length; i++) {
            const c1 = candles[i - 1];
            const c2 = candles[i];

            const upMove = c2.high - c1.high;
            const downMove = c1.low - c2.low;

            plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
            minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);

            const currentTR = Math.max(
                c2.high - c2.low,
                Math.abs(c2.high - c1.close),
                Math.abs(c2.low - c1.close)
            );
            tr.push(currentTR);
        }

        const wilderSmooth = (data, p) => {
            let result = [];
            let sum = data.slice(1, p + 1).reduce((a, b) => a + b, 0);
            result.push(sum);
            for (let i = p + 1; i < data.length; i++) {
                sum = sum - (sum / p) + data[i];
                result.push(sum);
            }
            return result;
        };

        const trSmooth = wilderSmooth(tr, period);
        const plusDMSmooth = wilderSmooth(plusDM, period);
        const minusDMSmooth = wilderSmooth(minusDM, period);

        let dx = [];
        for (let i = 0; i < trSmooth.length; i++) {
            const diPlus = (plusDMSmooth[i] / trSmooth[i]) * 100;
            const diMinus = (minusDMSmooth[i] / trSmooth[i]) * 100;
            const diSum = diPlus + diMinus;
            if (diSum === 0) {
                dx.push(0);
            } else {
                dx.push(Math.abs(diPlus - diMinus) / diSum * 100);
            }
        }

        if (dx.length < period) return null;

        let adx = [];
        let adxSum = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
        adx.push(adxSum);
        for (let i = period; i < dx.length; i++) {
            adxSum = ((adxSum * (period - 1)) + dx[i]) / period;
            adx.push(adxSum);
        }

        // Взять последние значения +DI и -DI для определения направления тренда
        const lastTr = trSmooth[trSmooth.length - 1];
        const lastPlusDI = lastTr === 0 ? 0 : (plusDMSmooth[plusDMSmooth.length - 1] / lastTr) * 100;
        const lastMinusDI = lastTr === 0 ? 0 : (minusDMSmooth[minusDMSmooth.length - 1] / lastTr) * 100;

        return {
            adx: Math.round(adx[adx.length - 1] * 100) / 100,
            plusDI: Math.round(lastPlusDI * 100) / 100,
            minusDI: Math.round(lastMinusDI * 100) / 100
        };
    }

    static calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / (prices.length - 1);
        return Math.round(Math.sqrt(variance) / avg * 10000) / 100;
    }

    static calculateMACD(prices, short = 12, long = 26, signal = 9) {
        if (prices.length < long + signal) return null;
        const ema = (data, p) => {
            const k = 2 / (p + 1);
            return data.reduce((acc, v, i) => {
                acc.push(i === 0 ? v : v * k + acc[i - 1] * (1 - k));
                return acc;
            }, []);
        };
        const sEMA = ema(prices, short), lEMA = ema(prices, long);
        const macdLine = sEMA.map((v, i) => v - lEMA[i]).slice(long - 1);
        const sigLine = ema(macdLine, signal);
        const m = macdLine[macdLine.length - 1];
        const s = sigLine[sigLine.length - 1];
        return { macd: Math.round(m * 100) / 100, signal: Math.round(s * 100) / 100, hist: Math.round((m - s) * 100) / 100 };
    }

    // StochRSI — массивы K и D для всех свечей (для overlay)
    static calculateStochRSIArray(prices, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
        const rsies = this.calculateRSIArray(prices, rsiPeriod);
        if (rsies.length < stochPeriod) return { K: [], D: [], kOffset: 0, dOffset: 0 };

        let stochRSI = [];
        for (let i = stochPeriod - 1; i < rsies.length; i++) {
            const win = rsies.slice(i - stochPeriod + 1, i + 1);
            const lo = Math.min(...win), hi = Math.max(...win);
            stochRSI.push(hi === lo ? 0 : ((rsies[i] - lo) / (hi - lo)) * 100);
        }

        const sma = (data, p) => {
            if (data.length < p) return [];
            let r = [];
            for (let i = p - 1; i < data.length; i++)
                r.push(data.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
            return r;
        };

        const K = sma(stochRSI, kPeriod);
        const D = sma(K, dPeriod);
        // candle index where K[0] / D[0] aligns
        const kOffset = rsiPeriod + stochPeriod + kPeriod - 2;
        const dOffset = kOffset + dPeriod - 1;
        return { K, D, kOffset, dOffset };
    }

    static calculateEMAArray(prices, period = 200) {
        if (prices.length < period) return Array(prices.length).fill(null);
        const k = 2 / (period + 1);
        let result = Array(period - 1).fill(null);
        let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        result.push(emaVal);
        for (let i = period; i < prices.length; i++) {
            emaVal = prices[i] * k + emaVal * (1 - k);
            result.push(emaVal);
        }
        return result;
    }

    static calculateDailyVWAPArray(candles) {
        if (!candles || candles.length === 0) return [];
        let cumulativePV = 0;
        let cumulativeV = 0;
        let result = [];
        let lastDay = null;

        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const day = c.time ? new Date(c.time).getUTCDate() : null;

            if (lastDay !== null && day !== lastDay) {
                cumulativePV = 0;
                cumulativeV = 0;
            }
            lastDay = day;

            const typPrice = (c.high + c.low + c.close) / 3;
            cumulativePV += typPrice * c.volume;
            cumulativeV += c.volume;

            result.push(cumulativeV > 0 ? cumulativePV / cumulativeV : typPrice);
        }
        return result;
    }

    static calculateCVDArray(candles) {
        if (!candles || candles.length === 0) return [];
        let cvd = 0;
        let result = [];
        for (let i = 0; i < candles.length; i++) {
            cvd += candles[i].delta || 0;
            result.push(cvd);
        }
        return result;
    }
}

export class SupportResistanceCalculator {
    static calculateLevels(candles) {
        if (!candles || candles.length === 0) return { poc: 0, support: 0, resistance: 0 };
        const min = candles.reduce((acc, c) => Math.min(acc, c.low), Infinity);
        const max = candles.reduce((acc, c) => Math.max(acc, c.high), -Infinity);
        const range = max - min || 1;
        const binCount = 20;
        const binSize = range / binCount;

        let bins = Array(binCount).fill(0).map((_, i) => ({
            price: min + (i + 0.5) * binSize,
            volume: 0
        }));

        candles.forEach(c => {
            const typPrice = (c.high + c.low + c.close) / 3;
            const binIdx = Math.floor((typPrice - min) / binSize);
            if (binIdx >= 0 && binIdx < binCount) bins[binIdx].volume += c.volume;
            else if (binIdx === binCount) bins[binCount - 1].volume += c.volume;
        });

        const sorted = [...bins].sort((a, b) => b.volume - a.volume);
        const poc = sorted[0].price;
        const currentPrice = candles[candles.length - 1].close;

        const supports = bins
            .filter(b => b.price <= currentPrice && b.volume > sorted[0].volume * 0.20)
            .sort((a, b) => b.price - a.price);

        const resistances = bins
            .filter(b => b.price >= currentPrice && b.volume > sorted[0].volume * 0.20)
            .sort((a, b) => a.price - b.price);

        let supBinPrice = supports.length > 0 ? supports[0].price : currentPrice * 0.95;
        let resBinPrice = resistances.length > 0 ? resistances[0].price : currentPrice * 1.05;

        // Гарантируем спред > $700
        if (resBinPrice - supBinPrice < 700) {
            const nextSup = supports.find(b => resBinPrice - b.price >= 700);
            const nextRes = resistances.find(b => b.price - supBinPrice >= 700);

            if (nextSup && nextRes) {
                if (nextSup.volume > nextRes.volume) supBinPrice = nextSup.price;
                else resBinPrice = nextRes.price;
            } else if (nextSup) {
                supBinPrice = nextSup.price;
            } else if (nextRes) {
                resBinPrice = nextRes.price;
            } else {
                supBinPrice = Math.min(supBinPrice, currentPrice - 350);
                resBinPrice = Math.max(resBinPrice, currentPrice + 350);
            }
        }

        // Притягивание уровня к точному экстремуму свечи (чтобы уровень был точным, например $60756)
        const getExactLow = (approxPrice) => {
            const nearby = candles.filter(c => Math.abs(c.low - approxPrice) <= binSize * 1.5);
            return nearby.length > 0 ? nearby.reduce((acc, c) => Math.min(acc, c.low), Infinity) : approxPrice;
        };

        const getExactHigh = (approxPrice) => {
            const nearby = candles.filter(c => Math.abs(c.high - approxPrice) <= binSize * 1.5);
            return nearby.length > 0 ? nearby.reduce((acc, c) => Math.max(acc, c.high), -Infinity) : approxPrice;
        };

        return {
            poc: Math.round(poc),
            support: Math.round(getExactLow(supBinPrice)),
            resistance: Math.round(getExactHigh(resBinPrice))
        };
    }
}

export class GaussianCalculator {
    static normalCDF(x) {
        const t = 1 / (1 + 0.2316419 * Math.abs(x));
        const d = 0.3989423 * Math.exp(-x * x / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return x > 0 ? 1 - p : p;
    }

    static calculateTouchProbability(prices, targetPrice, periodsAhead) {
        if (prices.length < 2 || targetPrice <= 0) return 0;
        const currentPrice = prices[prices.length - 1];

        let returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return 0;

        const projectedStdDev = stdDev * Math.sqrt(periodsAhead);
        const logTarget = Math.log(targetPrice / currentPrice);

        // Z-score с учетом дрифта (среднего возврата)
        const driftAdjustedTarget = logTarget - meanReturn * periodsAhead;
        const zScore = Math.abs(driftAdjustedTarget) / projectedStdDev;

        // Вероятность касания барьера для броуновского движения
        const prob = 2 * (1 - this.normalCDF(zScore));
        return Math.min(Math.max(prob * 100, 0.01), 99.99);
    }
}

// ============================================================
// FIBONACCI ENGINE — Multi-Timeframe Validated Levels
// ============================================================
export class FibonacciEngine {
    // Ratios: standard + 0/1 anchors
    static RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    static COLORS = {
        0: '#888888',
        0.236: '#FF6B6B',
        0.382: '#FFA94D',
        0.5: '#FFD700',
        0.618: '#51CF66',
        0.786: '#339AF0',
        1: '#888888'
    };

    // Detect the absolute swing high and low in a candle array
    // Uses a "pivot" approach: a candle is a swing high if its `high`
    // is the maximum in a window of `lookback` candles on each side.
    static detectSwings(candles, lookback = 5) {
        if (!candles || candles.length < lookback * 2 + 1) {
            // fallback: absolute max/min of the entire dataset
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            const maxH = highs.reduce((a, b) => Math.max(a, b), -Infinity);
            const minL = lows.reduce((a, b) => Math.min(a, b), Infinity);
            return {
                swingHigh: maxH,
                swingLow: minL,
                swingHighIdx: highs.lastIndexOf(maxH),
                swingLowIdx: lows.lastIndexOf(minL)
            };
        }

        let swingHigh = -Infinity, swingHighIdx = 0;
        let swingLow = Infinity, swingLowIdx = 0;

        for (let i = lookback; i < candles.length - lookback; i++) {
            const window = candles.slice(i - lookback, i + lookback + 1);
            const localMaxH = window.reduce((acc, c) => Math.max(acc, c.high), -Infinity);
            const localMinL = window.reduce((acc, c) => Math.min(acc, c.low), Infinity);

            if (candles[i].high === localMaxH && candles[i].high >= swingHigh) {
                swingHigh = candles[i].high;
                swingHighIdx = i;
            }
            if (candles[i].low === localMinL && candles[i].low <= swingLow) {
                swingLow = candles[i].low;
                swingLowIdx = i;
            }
        }

        // Force the swings to encompass the absolute extremes of the currently viewed window.
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const absMax = highs.reduce((a, b) => Math.max(a, b), -Infinity);
        const absMin = lows.reduce((a, b) => Math.min(a, b), Infinity);

        if (absMax >= swingHigh) {
            swingHigh = absMax;
            swingHighIdx = highs.lastIndexOf(absMax);
        }
        if (absMin <= swingLow) {
            swingLow = absMin;
            swingLowIdx = lows.lastIndexOf(absMin);
        }

        return { swingHigh, swingLow, swingHighIdx, swingLowIdx };
    }

    // Build Fib price levels for a set of candles
    static computeLevels(candles, tf, lookback = 5) {
        const { swingHigh, swingLow, swingHighIdx, swingLowIdx } = this.detectSwings(candles, lookback);
        const range = swingHigh - swingLow;
        if (range <= 0) return null;

        // Determine trend direction from swing positions
        const isUptrend = swingLowIdx <= swingHighIdx; // low came first → uptrend
        const levels = {};
        this.RATIOS.forEach(r => {
            // Retracement from high in uptrend, from low in downtrend
            levels[r] = isUptrend
                ? swingHigh - range * r   // retracing down from high
                : swingLow + range * r;  // retracing up from low
        });

        return {
            tf, swingHigh, swingLow, swingHighIdx, swingLowIdx,
            isUptrend, range, levels
        };
    }

    // Fetch candles for a specific TF (used for MTF cache)
    static async fetchCandles(tf, limit = 90) {
        const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${limit}`
        );
        if (!res.ok) return null;
        const json = await res.json();
        return json.map(k => ({
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    }

    // Fetch all timeframes in parallel and return validated Fib data
    static async buildMultiTF() {
        const tfLookbacks = {
            '1w': 3, '1d': 5, '4h': 5, '1h': 7, '15m': 7
        };
        const tfs = Object.keys(tfLookbacks);
        const results = await Promise.allSettled(
            tfs.map(tf => this.fetchCandles(tf, 90))
        );

        const mtf = {};
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && r.value) {
                const tf = tfs[i];
                mtf[tf] = this.computeLevels(r.value, tf, tfLookbacks[tf]);
            }
        });
        return mtf;
    }

    // Find confluence zones: levels within `threshold` % of each other
    static findConfluence(mtfData, threshold = 0.008) {
        const allLevels = []; // { price, tf, ratio }
        Object.values(mtfData).forEach(d => {
            if (!d) return;
            FibonacciEngine.RATIOS.forEach(r => {
                if (r === 0 || r === 1) return; // skip anchors
                allLevels.push({ price: d.levels[r], tf: d.tf, ratio: r });
            });
        });

        const zones = []; // { price, members[], strength }
        const used = new Set();

        allLevels.forEach((a, i) => {
            if (used.has(i)) return;
            const group = [a];
            used.add(i);
            allLevels.forEach((b, j) => {
                if (used.has(j)) return;
                if (Math.abs(a.price - b.price) / a.price < threshold) {
                    group.push(b);
                    used.add(j);
                }
            });
            if (group.length >= 2) {
                const avgPrice = group.reduce((s, x) => s + x.price, 0) / group.length;
                zones.push({
                    price: avgPrice,
                    members: group,
                    strength: group.length // # of TFs agreeing
                });
            }
        });

        return zones.sort((a, b) => b.strength - a.strength);
    }
}

export class ElliottWaveEngine {
    static findPivots(candles, lookback = 4) {
        const pivots = [];
        for (let i = lookback; i < candles.length - lookback; i++) {
            let isHigh = true;
            let isLow = true;
            for (let j = 1; j <= lookback; j++) {
                if (candles[i - j].high > candles[i].high) isHigh = false;
                if (candles[i - j].low < candles[i].low) isLow = false;
                if (candles[i + j].high >= candles[i].high) isHigh = false;
                if (candles[i + j].low <= candles[i].low) isLow = false;
            }
            if (isHigh) {
                pivots.push({ index: i, type: 'high', price: candles[i].high });
            } else if (isLow) {
                pivots.push({ index: i, type: 'low', price: candles[i].low });
            }
        }
        return pivots;
    }

    static detectWaves(candles) {
        let newWave = null;

        // Сканируем от самых строгих (длинных) зигзагов к мелким
        for (let lookback = 8; lookback >= 3; lookback--) {
            const pivots = this.findPivots(candles, lookback);
            if (pivots.length < 6) continue;

            // Очищаем от идущих подряд одинаковых типов (схлопываем)
            const altPivots = [];
            let lastType = null;
            for (let i = 0; i < pivots.length; i++) {
                const p = pivots[i];
                if (p.type !== lastType) {
                    altPivots.push(p);
                    lastType = p.type;
                } else {
                    const lastP = altPivots[altPivots.length - 1];
                    if (p.type === 'high' && p.price > lastP.price) altPivots[altPivots.length - 1] = p;
                    else if (p.type === 'low' && p.price < lastP.price) altPivots[altPivots.length - 1] = p;
                }
            }

            // Ищем с конца самую свежую валидную структуру из 5 волн (6 точек)
            for (let i = altPivots.length - 6; i >= 0; i--) {
                const p0 = altPivots[i];
                const p1 = altPivots[i + 1];
                const p2 = altPivots[i + 2];
                const p3 = altPivots[i + 3];
                const p4 = altPivots[i + 4];
                const p5 = altPivots[i + 5];

                const isUptrend = p0.type === 'low';

                // ПРАВИЛО 1: Волна 2 не должна откатываться за начало Волны 1
                if (isUptrend && p2.price <= p0.price) continue;
                if (!isUptrend && p2.price >= p0.price) continue;

                // Проверка прогресса (Волна 3 должна пробить Волну 1)
                if (isUptrend && p3.price <= p1.price) continue;
                if (!isUptrend && p3.price >= p1.price) continue;

                // ПРАВИЛО 2: Волна 4 не должна заходить на территорию Волны 1
                if (isUptrend && p4.price <= p1.price) continue;
                if (!isUptrend && p4.price >= p1.price) continue;

                // ПРАВИЛО 3: Волна 3 не может быть самой короткой среди импульсных (1, 3, 5)
                const w1 = Math.abs(p1.price - p0.price);
                const w3 = Math.abs(p3.price - p2.price);
                const w5 = Math.abs(p5.price - p4.price);
                if (w3 < w1 && w3 < w5) continue;

                // Все строгие правила выполнены! Вычисляем коррекцию A-B-C
                // Ищем реальные пивоты после волны 5, привязываем A/B/C к свечам
                const impulseLength = Math.abs(p5.price - p0.price);
                const dir = isUptrend ? -1 : 1; // Куда направлена коррекция

                // Проекции как цели (fallback)
                const targetA = p5.price + (impulseLength * 0.382 * dir);
                const targetB = targetA - (impulseLength * 0.382 * 0.618 * dir);
                const targetC = p5.price + (impulseLength * 0.618 * dir);

                // Ищем реальные пивоты после p5 с мелким lookback (2)
                const postPivots = [];
                const searchLB = 2;
                for (let k = p5.index + searchLB; k < candles.length - searchLB; k++) {
                    let isPivHigh = true, isPivLow = true;
                    for (let m = 1; m <= searchLB; m++) {
                        if (candles[k - m].high > candles[k].high) isPivHigh = false;
                        if (candles[k + m].high >= candles[k].high) isPivHigh = false;
                        if (candles[k - m].low < candles[k].low) isPivLow = false;
                        if (candles[k + m].low <= candles[k].low) isPivLow = false;
                    }
                    if (isPivHigh) postPivots.push({ index: k, type: 'high', price: candles[k].high });
                    else if (isPivLow) postPivots.push({ index: k, type: 'low', price: candles[k].low });
                }

                // Тип волны A: после бычьего импульса — low (откат вниз), после медвежьего — high (отскок вверх)
                const typeA = isUptrend ? 'low' : 'high';
                const typeB = isUptrend ? 'high' : 'low';
                const typeC = isUptrend ? 'low' : 'high';

                // Привязка к реальным пивотам: ищем ближайший пивот нужного типа
                const findRealPivot = (afterIndex, pivotType, targetPrice) => {
                    const candidates = postPivots.filter(pp => pp.index > afterIndex && pp.type === pivotType);
                    if (candidates.length === 0) return null;
                    // Берём первый подходящий пивот (ближайший по времени)
                    return candidates[0];
                };

                const realA = findRealPivot(p5.index, typeA, targetA);
                const realB = realA ? findRealPivot(realA.index, typeB, targetB) : null;
                const realC = realB ? findRealPivot(realB.index, typeC, targetC) : null;

                const projectedA = realA
                    ? { index: realA.index, type: typeA, price: realA.price, isProjection: false }
                    : { index: p5.index + 10, type: typeA, price: targetA, isProjection: true };
                const projectedB = realB
                    ? { index: realB.index, type: typeB, price: realB.price, isProjection: false }
                    : { index: (realA ? realA.index : p5.index + 10) + 10, type: typeB, price: targetB, isProjection: true };
                const projectedC = realC
                    ? { index: realC.index, type: typeC, price: realC.price, isProjection: false }
                    : { index: (realB ? realB.index : (realA ? realA.index : p5.index + 10) + 10) + 10, type: typeC, price: targetC, isProjection: true };

                newWave = {
                    points: [p0, p1, p2, p3, p4, p5, projectedA, projectedB, projectedC],
                    isUptrend,
                    isStrict: true,
                    fibScore: 5,
                    type: 'FIB_IMPULSE'
                };
                newWave.projections = this.projectFuture(newWave, candles);
                break; // Нашли самый свежий валидный импульс
            }
            if (newWave) break;
        }

        // ==========================
        // STATEFUL WAVE TRACKING (LOCKING & INVALIDATION)
        // ==========================
        const tf = currentTF || '15m';
        if (!this.lockedWaves) this.lockedWaves = {};

        if (!this.lockedWaves[tf]) {
            if (newWave && newWave.isStrict) {
                this.lockedWaves[tf] = {
                    ...newWave,
                    points: newWave.points.map(p => {
                        if (p.isProjection) return p;
                        return { ...p, time: candles[p.index].time };
                    })
                };
            }
            return newWave;
        }

        const locked = this.lockedWaves[tf];
        const mappedPoints = [];
        for (let p of locked.points) {
            if (p.isProjection) {
                mappedPoints.push(p);
                continue;
            }
            const idx = candles.findIndex(c => c.time === p.time);
            if (idx !== -1) {
                mappedPoints.push({ index: idx, type: p.type, price: p.price, time: p.time, isProjection: false });
            }
        }

        if (mappedPoints.length < 9) {
            this.lockedWaves[tf] = null;
            return newWave;
        }

        const currentCandle = candles[candles.length - 1];
        let isBroken = false;

        if (locked.isUptrend) {
            if (currentCandle.low < mappedPoints[0].price) isBroken = true;
        } else {
            if (currentCandle.high > mappedPoints[0].price) isBroken = true;
        }

        if (newWave && newWave.isStrict && newWave.points[0].index > mappedPoints[8].index) {
            isBroken = true;
        }

        if (isBroken) {
            this.lockedWaves[tf] = null;
            if (newWave && newWave.isStrict) {
                this.lockedWaves[tf] = {
                    ...newWave,
                    points: newWave.points.map(p => {
                        if (p.isProjection) return p;
                        return { ...p, time: candles[p.index].time };
                    })
                };
            }
            return newWave;
        }

        const result = {
            points: mappedPoints,
            isUptrend: locked.isUptrend,
            isStrict: locked.isStrict,
            fibScore: locked.fibScore,
            type: 'LOCKED'
        };
        result.projections = this.projectFuture(result, candles);
        return result;
    }

    /**
     * Рассчитывает ценовые цели следующих волн на основе Фибоначчи.
     * Возвращает массив { label, price, isBullish } — точки-проекции вперёд.
     */
    static projectFuture(wave, candles) {
        if (!wave || !wave.points || wave.points.length < 6) return null;
        const pts = wave.points;
        const p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[3], p4 = pts[4], p5 = pts[5];
        const isUp = wave.isUptrend;

        const w1 = Math.abs(p1.price - p0.price);
        const w3 = Math.abs(p3.price - p2.price);
        const lastIdx = candles.length - 1;

        // --- Определяем, в какой волне мы находимся сейчас ---
        // Если последняя известная точка — p5 (или A/B проекции), строим прогноз коррекции A-B-C
        // Если последняя точка — p4 (волна 4 завершена), строим цели волны 5

        const currentPrice = candles[lastIdx].close;
        const projections = [];

        // Прогноз ВОЛНЫ 5 (если цена находится между p4 и p5 или ещё не дошла до p5)
        // Цель Волны 5 = p4 + w1 (равенство с волной 1) или p4 + w1 * 0.618
        const w5target_equal  = isUp ? p4.price + w1         : p4.price - w1;
        const w5target_short  = isUp ? p4.price + w1 * 0.618 : p4.price - w1 * 0.618;
        const w5target_ext    = isUp ? p4.price + w3 * 1.618 : p4.price - w3 * 1.618;

        // Прогноз коррекции A-B-C после волны 5
        const impulse = Math.abs(p5.price - p0.price);
        const corrA = isUp ? p5.price - impulse * 0.382 : p5.price + impulse * 0.382;
        const corrB = isUp ? corrA   + impulse * 0.382 * 0.618 : corrA - impulse * 0.382 * 0.618;
        const corrC = isUp ? p5.price - impulse * 0.618 : p5.price + impulse * 0.618;

        // Пакуем все цели в единый список
        // Указываем isFuture=true чтобы рендер знал что это прогноз
        projections.push(
            { label: '⑤=①',   price: w5target_equal,  color: '#FFD700', isFuture: true, description: `Волна 5 = Волна 1 ($${Math.round(w5target_equal).toLocaleString()})` },
            { label: '⑤×0.6', price: w5target_short,  color: '#FFA500', isFuture: true, description: `Волна 5 × 0.618 Волны 1 ($${Math.round(w5target_short).toLocaleString()})` },
            { label: '⑤×1.6', price: w5target_ext,    color: '#FFD700', isFuture: true, description: `Волна 5 × 1.618 Волны 3 ($${Math.round(w5target_ext).toLocaleString()})` },
            { label: 'A',      price: corrA,           color: '#FF5E7E', isFuture: true, description: `Коррекция A — цель 38.2% ($${Math.round(corrA).toLocaleString()})` },
            { label: 'B',      price: corrB,           color: '#BB88FF', isFuture: true, description: `Коррекция B — откат ($${Math.round(corrB).toLocaleString()})` },
            { label: 'C',      price: corrC,           color: '#FF5E7E', isFuture: true, description: `Коррекция C — цель 61.8% ($${Math.round(corrC).toLocaleString()})` }
        );

        return projections;
    }
}

export class AnalysisLogger {
    static log(action, data) {
        try {
            const logs = JSON.parse(localStorage.getItem('btc_log') || '[]');
            logs.unshift({ timestamp: new Date().toISOString(), action, data });
            localStorage.setItem('btc_log', JSON.stringify(logs.slice(0, 50)));
        } catch (e) { /* localStorage недоступен (Инкогнито) */ }
    }
    static get() {
        try { return localStorage.getItem('btc_log') || '[]'; }
        catch (e) { return '[]'; }
    }
}

// ============================================================
// СВЕЧНОЙ ГРАФИК (Canvas API, без зависимостей)
// ============================================================
// Audio alert helper
const globalContext = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {}));
globalContext.playBeep = function (frequency = 440, duration = 0.15, type = 'sine') {
    if (typeof window === 'undefined') return;
    try {
        // Создаем контекст только один раз!
        if (!window._audioCtx) {
            window._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = window._audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn("Web Audio API sound failed to play", e);
    }
};
// ============================================================
// ОБРАБОТЧИК РЫНОЧНЫХ ДАННЫХ (Инкапсуляция тяжелой математики)
// ============================================================
export class MarketDataProcessor {
    static process(candles, pivotLR = TRADING_CONFIG.PIVOT_LR) {
        const n = candles.length;
        const liquidityLevels = [];
        if (n < pivotLR * 2) return { liquidityLevels, elliottWaves: null };

        // 1. Подготовка суффиксных массивов для O(N) проверки "снятия" ликвидности
        // suffixMax[i] = максимальный high от i до конца массива
        // suffixMin[i] = минимальный low от i до конца массива
        const suffixMax = new Array(n + 1).fill(-Infinity);
        const suffixMin = new Array(n + 1).fill(Infinity);

        for (let i = n - 1; i >= 0; i--) {
            suffixMax[i] = Math.max(candles[i].high, suffixMax[i + 1]);
            suffixMin[i] = Math.min(candles[i].low, suffixMin[i + 1]);
        }

        // 2. Поиск пивотов и проверка "снятия" за O(1) внутри цикла
        for (let i = pivotLR; i < n - pivotLR; i++) {
            let isHigh = true, isLow = true;

            // Проверка локального экстремума
            for (let j = 1; j <= pivotLR; j++) {
                if (candles[i - j].high > candles[i].high) isHigh = false;
                if (candles[i - j].low < candles[i].low) isLow = false;
                if (candles[i + j].high >= candles[i].high) isHigh = false;
                if (candles[i + j].low <= candles[i].low) isLow = false;
            }

            if (isHigh) {
                // Берем суффикс после пивота (исключая зону формирования)
                const futureMax = suffixMax[i + pivotLR + 1];
                // Если в будущем хай не превысил наш пивот -> ликвидность не снята
                if (futureMax <= candles[i].high) {
                    liquidityLevels.push({ price: candles[i].high, index: i });
                }
            }

            if (isLow) {
                const futureMin = suffixMin[i + pivotLR + 1];
                if (futureMin >= candles[i].low) {
                    liquidityLevels.push({ price: candles[i].low, index: i });
                }
            }
        }

        return { liquidityLevels };
    }
}

