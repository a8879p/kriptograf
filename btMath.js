import { TechnicalIndicators } from './indicators.js';
import { TRADING_CONFIG, getKyivHour } from './config.js';

export class BacktesterMath {
    static HORIZON = 5;
    static MIN_MOVE = 0.005;
    static LONG_TH = 55;
    static SHORT_TH = 45;

    static calcATR(candles, period = 14) {
        if (candles.length < period + 1) return null;
        const trs = candles.slice(-period).map((c, i, arr) => {
            const prev = i > 0 ? arr[i - 1].close : c.open;
            return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
        });
        return trs.reduce((a, b) => a + b, 0) / period;
    }

    static calcScoreWithContext(candles, trendAge = 0, adxIncreasing = false, tf = '15m', baseScore = 50) {
        const prices = candles.map(c => c.close);
        let score = baseScore; 
        let forbidden = false;
        let forbiddenReason = null;
        const ctx = {
            adx: null, adxDir: 'FLAT', plusDI: null, minusDI: null,
            diSpread: null, stochK: null, stochD: null, kAboveD: null,
            rsi: null, lowerWickRatio: 0, upperWickRatio: 0,
            regime: 'SIDEWAYS', candlePattern: 'NEUTRAL'
        };
        try {
            const adxObj = TechnicalIndicators.calculateADX(candles);
            const adx = adxObj ? adxObj.adx : null;
            const stoch = TechnicalIndicators.calculateStochRSI(prices);
            const lastK = stoch ? stoch.k : null;
            const lastD = stoch ? stoch.d : null;
            const rsi = TechnicalIndicators.calculateRSI(prices);

            const prevStoch = TechnicalIndicators.calculateStochRSI(prices.slice(0, -1));
            const prevK = prevStoch ? prevStoch.k : null;
            const prevD = prevStoch ? prevStoch.d : null;
            const prevKAboveD = prevK !== null && prevD !== null ? prevK > prevD : null;

            const prevPrice = prices.length >= 2 ? prices[prices.length - 2] : null;
            const currPrice = prices[prices.length - 1];
            const prevRSI = TechnicalIndicators.calculateRSI(prices.slice(0, -1));
            const rsiDivBearish = (prevPrice && currPrice > prevPrice) && (rsi !== null && prevRSI !== null && rsi < prevRSI);
            const rsiDivBullish = (prevPrice && currPrice < prevPrice) && (rsi !== null && prevRSI !== null && rsi > prevRSI);

            ctx.adx = adx !== null ? Math.round(adx * 10) / 10 : null;
            ctx.stochK = lastK !== null ? Math.round(lastK * 10) / 10 : null;
            ctx.stochD = lastD !== null ? Math.round(lastD * 10) / 10 : null;
            ctx.kAboveD = lastK !== null && lastD !== null ? lastK > lastD : null;
            ctx.rsi = rsi !== null ? Math.round(rsi * 10) / 10 : null;

            if (adxObj) {
                ctx.plusDI = Math.round(adxObj.plusDI * 10) / 10;
                ctx.minusDI = Math.round(adxObj.minusDI * 10) / 10;
                ctx.diSpread = Math.round(Math.abs(adxObj.plusDI - adxObj.minusDI) * 10) / 10;
                const isUp = adxObj.plusDI >= adxObj.minusDI;
                ctx.adxDir = adx < TRADING_CONFIG.ADX_TREND_THRESHOLD ? 'FLAT' : (isUp ? 'UP' : 'DOWN');
                
                const diSpreadThreshold = typeof window !== 'undefined' && window.DI_SPREAD_THRESHOLD ? window.DI_SPREAD_THRESHOLD : 10;
                ctx.regime = (adx < TRADING_CONFIG.ADX_TREND_THRESHOLD || ctx.diSpread < diSpreadThreshold) ? 'SIDEWAYS' : (isUp ? 'TREND_UP' : 'TREND_DOWN');
            }

            const lc = candles[candles.length - 1];
            const cr = lc.high - lc.low || 1;
            const lw = Math.min(lc.open, lc.close) - lc.low;
            const uw = lc.high - Math.max(lc.open, lc.close);
            ctx.lowerWickRatio = Math.round(lw / cr * 100);
            ctx.upperWickRatio = Math.round(uw / cr * 100);

            const isHammer = lw / cr > 0.5;
            const isShootingStar = uw / cr > 0.5;
            const isBullishBody = lc.close > lc.open;

            if (isHammer) ctx.candlePattern = 'HAMMER';
            else if (isShootingStar) ctx.candlePattern = 'SHOOTING_STAR';
            else if (isBullishBody) ctx.candlePattern = 'BULLISH';
            else ctx.candlePattern = 'BEARISH';

            const isBullishCandle = isHammer || isBullishBody;
            const isBearishCandle = isShootingStar || !isBullishBody;

            const corridorLookback = Math.min(candles.length, 50);
            const recentC = candles.slice(-corridorLookback);
            let cMax = -Infinity, cMin = Infinity;
            for (let c of recentC) {
                if (c.high > cMax) cMax = c.high;
                if (c.low < cMin) cMin = c.low;
            }
            ctx.corridorMax = Math.round(cMax);
            ctx.corridorMin = Math.round(cMin);
            const cRange = cMax - cMin || 1;
            ctx.corridorPos = (lc.close - cMin) / cRange; 

            if (adxObj && lastK !== null) {
                if (ctx.regime === 'SIDEWAYS') {
                    if (lastK < 20 && ctx.kAboveD && isBullishCandle) {
                        score += 10; 
                    } else if (lastK > 80 && !ctx.kAboveD && isBearishCandle) {
                        score -= 10; 
                    }
                }
                else if (ctx.regime === 'TREND_UP') {
                    score += 5; 
                    if (lastK < 30 && ctx.kAboveD) {
                        score += 10;
                        if (isHammer) score += 5; 
                    }
                    else if (lastK > 85 && ctx.kAboveD) {
                        score += 10;
                    }
                    else if (lastK > 85 && !ctx.kAboveD && rsiDivBearish) {
                        score -= 20; 
                    }
                    else if (lastK >= 30 && lastK <= 85) {
                        score = 50; 
                    }
                    if (lastK < 30 && !ctx.kAboveD) score = 50;
                }
                else if (ctx.regime === 'TREND_DOWN') {
                    score -= 5; 
                    if (lastK > 70 && !ctx.kAboveD) {
                        score -= 10;
                        if (isShootingStar) score -= 5; 
                    }
                    else if (lastK < 20 && !ctx.kAboveD) {
                        score -= 10; 
                    }
                    else if (lastK < 15 && ctx.kAboveD && rsiDivBullish) {
                        score += 10; 
                    } 
                    else if (lastK < 30 && ctx.kAboveD) {
                        score += 5; 
                    }
                    if (lastK > 70 && ctx.kAboveD) score = 50;
                }

                if (tf === '1d' || tf === '4h') {
                    const minDiSpread = tf === '1d' ? 8 : 5;
                    if (score !== 50 && ctx.diSpread !== null && ctx.diSpread < minDiSpread) {
                        score = 50;
                        forbidden = true;
                        forbiddenReason = 'DI_SQUEEZE_CHOP_MACRO';
                    }
                }

                if (lastK >= 30 && lastK <= 70) {
                    if (score > 50 && score < 65) score = 50; 
                    if (score < 50 && score > 35) score = 50; 
                }
            }

            if (score >= 55 && isBearishCandle) score = 50;
            if (score <= 45 && isBullishCandle) score = 50;

            let LONG_FORBIDDEN = false;
            let SHORT_FORBIDDEN = false;
            let FORBIDDEN_ALL = false;

            const minTrendAdx = tf === '4h' ? 20 : 25;
            const minTrendSpread = tf === '4h' ? 12 : 15;
            if (ctx.adx > minTrendAdx && ctx.diSpread > minTrendSpread) {
                if (ctx.minusDI > ctx.plusDI) LONG_FORBIDDEN = true;
                if (ctx.plusDI > ctx.minusDI) SHORT_FORBIDDEN = true;
            }

            if (ctx.adx < TRADING_CONFIG.ADX_TREND_THRESHOLD && ctx.diSpread > 20) FORBIDDEN_ALL = true;

            // ADX Overheat Veto (Trend Exhaustion) - Raised to 55 to allow more strong trends
            if (ctx.adx > 55) FORBIDDEN_ALL = true;

            if (ctx.regime === 'TREND_DOWN' && lastK !== null && lastK < 35 && ctx.kAboveD) SHORT_FORBIDDEN = true;
            if (ctx.regime === 'TREND_UP' && lastK !== null && lastK > 85 && !ctx.kAboveD) LONG_FORBIDDEN = true;

            // Smart FOMO Veto (relax for fresh strong trends)
            if (lastK !== null) {
                // Squeeze / Fakeout absolute limits
                if (lastK >= 98) LONG_FORBIDDEN = true;
                if (lastK <= 2) SHORT_FORBIDDEN = true;
                
                if (lastK > 95 && trendAge >= 5) LONG_FORBIDDEN = true;
                if (lastK < 5 && trendAge >= 5) SHORT_FORBIDDEN = true;
            }

            // Anti-Squeeze Veto in SIDEWAYS
            if (ctx.regime === 'SIDEWAYS' && lastK !== null) {
                if (lastK > 75 && ctx.plusDI > 20) SHORT_FORBIDDEN = true; // Bullish breakout risk
                if (lastK < 25 && ctx.minusDI > 20) LONG_FORBIDDEN = true; // Bearish breakdown risk
            }

            if (ctx.diSpread < 5) FORBIDDEN_ALL = true;

            // Bitcoin Up-trends last for weeks (80 candles), Down-trends exhaust faster (25 candles)
            const maxTrendAge = tf === '1d' ? 15 : (tf === '4h' ? (ctx.regime === 'TREND_UP' ? 80 : 25) : 20);
            if (trendAge >= maxTrendAge) FORBIDDEN_ALL = true;

            const hKyiv = getKyivHour(lc.time);
            
            // Block Dead Session for 4H to prevent low-liquidity chop losses (10% win rate)
            const isDeadSession = (hKyiv >= 23 || hKyiv < 3);
            if (tf === '4h' && isDeadSession) FORBIDDEN_ALL = true;

            if (FORBIDDEN_ALL) {
                if (score >= 55 || score <= 45) {
                    score = 50;
                    forbidden = true;
                    forbiddenReason = 'NOISE_OR_EXHAUSTED';
                }
            } else if (LONG_FORBIDDEN && score >= 55) {
                score = 50; 
                forbidden = true;
                forbiddenReason = 'STRONG_DOWNTREND_OR_LATE';
            } else if (SHORT_FORBIDDEN && score <= 45) {
                score = 50; 
                forbidden = true;
                forbiddenReason = 'STRONG_UPTREND_OR_LATE';
            }
            
            if (!forbidden && (score >= 55 || score <= 45)) {
                const atr = this.calcATR(candles);
                const atrPct = atr !== null ? Math.round(atr / lc.close * 10000) / 100 : null;
                const avgVol = candles.slice(Math.max(0, candles.length - 20)).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length);
                const volRatio = avgVol > 0 ? Math.round(lc.volume / avgVol * 100) / 100 : 1;
                
                if (volRatio < 0.60) {
                    score = 50;
                    forbidden = true;
                    forbiddenReason = 'LOW_VOLUME';
                } else if (atrPct !== null && atrPct < 0.15) {
                    score = 50;
                    forbidden = true;
                    forbiddenReason = 'LOW_VOLATILITY';
                } else if (ctx.regime === 'TREND_DOWN' && ctx.adx > 40 && score >= 55) {
                    score = 50;
                    forbidden = true;
                    forbiddenReason = 'FALLING_KNIFE';
                } else if (ctx.regime === 'SIDEWAYS') {
                    if (score >= 55 && ctx.corridorPos > 0.45) {
                        score = 50;
                        forbidden = true;
                        forbiddenReason = 'BUYING_TOP_OF_CORRIDOR';
                    } else if (score <= 45 && ctx.corridorPos < 0.55) {
                        score = 50;
                        forbidden = true;
                        forbiddenReason = 'SHORTING_BOTTOM_OF_CORRIDOR';
                    }
                }
            }

            if (trendAge < 2 || trendAge > 15) {
                if (score >= 50) {
                    if (score > 60) score = 60;
                } else {
                    if (score < 40) score = 40;
                }
            }

            if (hKyiv === 22) {
                if (score >= 55 || score <= 45) {
                    score = 50;
                    forbidden = true;
                    forbiddenReason = 'US_CLOSE_FLUSH';
                }
            }

            
            const isAsia = (hKyiv >= 3 && hKyiv < 11);
            // BUG #7 fix: Asia veto не имеет смысла на дневном/недельном ТФ
            if (isAsia && tf !== '1d' && tf !== '1w') {
                if (score >= 55 && score <= 65) score -= 5;
                if (score <= 45 && score >= 35) score += 5; 
            }
            
            const lcTime = new Date(lc.time).getTime();
            const isCurrentCycle = lcTime >= new Date('2023-01-01').getTime();
            
            // BUG #3 fix: Macro-666 как демпфер (−30% conviction), а не жёсткий запрет.
            // Позволяет боту торговать при очень сильных сигналах вместо блокировки 50% сделок.
            if (isCurrentCycle && !forbidden) {
                if (lc.close < 66600 && score <= 45) {
                    // Зона скидки: ослабляем шорт-сигнал, но не убиваем полностью
                    score = Math.round(50 + (score - 50) * 0.3); // 30% от силы сигнала
                    if (score > 45) { // Если после демпфера сигнал слишком слабый — отменяем
                        score = 50;
                        forbidden = true;
                        forbiddenReason = 'MACRO_666_DISCOUNT_DAMPED';
                    }
                } else if (lc.close >= 66600 && lc.close < 97000 && score >= 55) {
                    // Экватор: ослабляем лонг-сигнал
                    score = Math.round(50 + (score - 50) * 0.3);
                    if (score < 55) {
                        score = 50;
                        forbidden = true;
                        forbiddenReason = 'MACRO_666_EQUATOR_DAMPED';
                    }
                }
                // Выше 97k — нет ограничений на лонги (зона распределения)
            }

        } catch (e) { console.error('[btMath] calcScoreWithContext error:', e); }

        return { 
            score: Math.max(0, Math.min(100, score)), 
            ctx,
            forbidden,
            forbiddenReason
        };
    }
}
