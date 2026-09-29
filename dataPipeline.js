// Data processing + UI update — extracted from 666BTC2graf.html (Stage 1 refactor)
import { appData, currentTF, candleChartInstance, setChartInstance, showVanga, showElliott } from './state.js';
import { TRADING_CONFIG, getKyivHour } from './config.js';
import { TechnicalIndicators, SupportResistanceCalculator, GaussianCalculator, ElliottWaveEngine, AnalysisLogger } from './indicators.js';
import { fmtP, triggerAlert } from './ui-utils.js';
import { CandleChart } from './charts.js';
import { BacktesterMath } from './btMath.js';
// NOTE: PaperTrader and ForecastTracker are imported lazily to avoid
// circular dependency: dataPipeline -> trading -> fetchMarket -> dataPipeline
let _PaperTrader = null;
let _ForecastTracker = null;
let _AIAnalyzer = null;
function getLazyTrading() {
    if (!_PaperTrader) {
        // By the time processData runs, trading.js is fully loaded
        const mod = window.__tradingModule;
        if (mod) {
            _PaperTrader = mod.PaperTrader;
            _ForecastTracker = mod.ForecastTracker;
            _AIAnalyzer = mod.AIAnalyzer;
        }
    }
    return { PaperTrader: _PaperTrader, ForecastTracker: _ForecastTracker, AIAnalyzer: _AIAnalyzer };
}

export function processData() {
    const p = appData.prices;
    if (!p || p.length === 0 || !appData.candles || appData.candles.length === 0) {
        return; // Data not ready yet
    }
    appData.currentPrice = p[p.length - 1];
    const { PaperTrader, ForecastTracker } = getLazyTrading();
    if (PaperTrader) PaperTrader.updatePrice(appData.currentPrice);
    if (ForecastTracker) ForecastTracker.evaluate(appData.currentPrice, currentTF);
    appData.levels = SupportResistanceCalculator.calculateLevels(appData.candles);

    const allPrices = appData.allPrices || appData.prices || [];
    const allCandles = appData.allCandles || appData.candles || [];
    const candles = appData.candles || [];

    // Compute new indicators: EMA 200, VWAP, and CVD
    appData.ema200 = TechnicalIndicators.calculateEMAArray(allPrices, 200).slice(candles.length ? -candles.length : undefined);
    appData.vwap = TechnicalIndicators.calculateDailyVWAPArray(allCandles).slice(candles.length ? -candles.length : undefined);
    appData.cvd = TechnicalIndicators.calculateCVDArray(allCandles).slice(candles.length ? -candles.length : undefined);

    // --- Detection of Liquidity Sweeps ---
    try {
        const PIVOT_LR = 7;
        const data = appData.candles;
        if (data && data.length > PIVOT_LR * 2) {
            const lastCandleIndex = data.length - 1;
            const lastCandle = data[lastCandleIndex];
            const prevCandle = data.length > 2 ? data[lastCandleIndex - 1] : null;

            for (let i = PIVOT_LR; i < lastCandleIndex; i++) {
                let isHigh = true;
                let isLow = true;
                for (let j = 1; j <= PIVOT_LR; j++) {
                    if (data[i - j].high > data[i].high) isHigh = false;
                    if (data[i - j].low < data[i].low) isLow = false;
                    if (data[i + j] && data[i + j].high >= data[i].high) isHigh = false;
                    if (data[i + j] && data[i + j].low <= data[i].low) isLow = false;
                }

                if (isHigh) {
                    let sweptBefore = false;
                    for (let k = i + 1; k < lastCandleIndex; k++) {
                        if (data[k].high > data[i].high) {
                            sweptBefore = true;
                            break;
                        }
                    }
                    if (!sweptBefore && lastCandle.high > data[i].high) {
                        if (!prevCandle || prevCandle.high <= data[i].high) {
                            window.playBeep(880, 0.2, 'sine');
                            triggerAlert(`⚡ Sweep High Liquidity at $${Math.round(data[i].high)}!`, 'info');
                        }
                    }
                }

                if (isLow) {
                    let sweptBefore = false;
                    for (let k = i + 1; k < lastCandleIndex; k++) {
                        if (data[k].low < data[i].low) {
                            sweptBefore = true;
                            break;
                        }
                    }
                    if (!sweptBefore && lastCandle.low < data[i].low) {
                        if (!prevCandle || prevCandle.low >= data[i].low) {
                            window.playBeep(330, 0.25, 'triangle');
                            triggerAlert(`⚡ Sweep Low Liquidity at $${Math.round(data[i].low)}!`, 'info');
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error checking liquidity sweep", e);
    }

    const rsi = TechnicalIndicators.calculateRSI(p);
    const trend = TechnicalIndicators.calculateTrend(p);

    // Используем все доступные свечи (allCandles) для полного прогрева ADX (Wilder's smoothing)
    const allC = appData.allCandles || appData.candles || [];
    const adxObj = TechnicalIndicators.calculateADX(allC);
    const adx = adxObj ? adxObj.adx : null;

    let marketRegime = 'SIDEWAYS';
    if (adx !== null && adx >= TRADING_CONFIG.ADX_TREND_THRESHOLD) {
        const isUpDir = adxObj.plusDI >= adxObj.minusDI;
        marketRegime = isUpDir ? 'TRENDING UP' : 'TRENDING DOWN';
    }

    // Обновляем визуальный горизонтальный ADX бар
    const adxPointer = document.getElementById('adxPointer');
    const adxPointerValue = document.getElementById('adxPointerValue');

    if (adxPointer && adxPointerValue && adxObj) {
        const isUp = adxObj.plusDI >= adxObj.minusDI;
        // Значение от -100 до +100
        const directionalAdx = isUp ? adx : -adx;

        // Позиция: -100 = 0%, 0 = 50%, +100 = 100%
        const positionPct = (directionalAdx + 100) / 200 * 100;

        // Ограничиваем пределы, чтобы указатель не выходил за рамки (0-100%)
        const clampedPct = Math.max(0, Math.min(100, positionPct));
        adxPointer.style.bottom = `${clampedPct}%`;

        adxPointerValue.innerHTML = `ADX: ${Math.round(adx)}`;
        adxPointerValue.className = 'adx-pointer-value-v'; // сброс классов
        adxPointerValue.style.animation = 'none'; // сброс анимации

        if (adx < TRADING_CONFIG.ADX_TREND_THRESHOLD) {
            adxPointerValue.classList.add('trend-flat');
            // Чем ближе ADX к 0, тем быстрее мигание (от 0.2 сек до 2.0 сек)
            const duration = Math.max(0.2, (adx / 25) * 2.0);
            adxPointerValue.style.animation = `blink-flat ${duration}s infinite`;
        } else if (isUp) {
            adxPointerValue.classList.add('trend-up');
        } else {
            adxPointerValue.classList.add('trend-down');
        }
    }
    let score = 0.5;

    // --- StochRSI массивы (с полным прогревом 300 свечей) ---
    const allP = appData.allPrices || p;
    appData.stochRSILines = TechnicalIndicators.calculateStochRSIArray(allP);
    const _warmup = allP.length - p.length;
    appData.stochRSILines.displayKOff = _warmup - appData.stochRSILines.kOffset;
    appData.stochRSILines.displayDOff = _warmup - appData.stochRSILines.dOffset;

    const stochRSIArr = appData.stochRSILines;
    let lastK = null, lastD = null;
    if (stochRSIArr && stochRSIArr.K.length > 0) {
        lastK = stochRSIArr.K[stochRSIArr.K.length - 1];
        lastD = stochRSIArr.D.length > 0 ? stochRSIArr.D[stochRSIArr.D.length - 1] : null;
    }

    // --- MAIN ADX & StochRSI HYBRID LOGIC ---
    if (adxObj !== null && lastK !== null) {
        const isUptrend = adxObj.plusDI > adxObj.minusDI;
        const isDowntrend = adxObj.minusDI > adxObj.plusDI;

        if (adx < TRADING_CONFIG.ADX_TREND_THRESHOLD) {
            // СЦЕНАРИЙ 1: Флэт. Полностью доверяем StochRSI (Mean Reversion)
            if (lastK < 20) score += 0.25; // Перепроданность -> ЛОНГ
            else if (lastK > 80) score -= 0.25; // Перекупленность -> ШОРТ

            // Обычный RSI как подстраховка
            if (rsi !== null) {
                score += rsi < TRADING_CONFIG.RSI_OVERSOLD ? 0.10 : rsi > TRADING_CONFIG.RSI_OVERBOUGHT ? -0.10 : 0;
            }
        } else if (isUptrend) {
            // СЦЕНАРИЙ 2: Сильный Аптренд. 
            score += 0.20; // Базовый буст лонга за тренд
            if (lastK < 30) score += 0.15; // Откат вниз (перепроданность) -> Покупаем скидку (ЛОНГ)
            // Если lastK > 80 (залипание наверху) -> Игнорируем (или даем крошечный буст за силу тренда)
            if (lastK > 80) score += 0.05;
        } else if (isDowntrend) {
            // СЦЕНАРИЙ 3: Сильный Даунтренд.
            score -= 0.20; // Базовый буст шорта за тренд
            if (lastK > 70) score -= 0.15; // Отскок вверх (перекупленность) -> Продаем на отскоке (ШОРТ)
            // Если lastK < 20 (залипание на дне) -> Игнорируем (или даем крошечный буст за силу тренда)
            if (lastK < 20) score -= 0.05;
        }
    } else {
        // Фолбэк если нет ADX
        score += trend.includes('UP') ? 0.15 : trend.includes('DOWN') ? -0.15 : 0;
        if (rsi !== null) score += rsi < TRADING_CONFIG.RSI_OVERSOLD ? 0.15 : rsi > TRADING_CONFIG.RSI_OVERBOUGHT ? -0.15 : 0;
    }
    // --- Stochastic RSI (ТОЛЬКО кросс K/D, зоны уже учтены в ADX+StochRSI Hybrid выше) ---
    if (stochRSIArr && stochRSIArr.K.length > 0) {
        const prevK = stochRSIArr.K.length > 1 ? stochRSIArr.K[stochRSIArr.K.length - 2] : null;
        const prevD = stochRSIArr.D.length > 1 ? stochRSIArr.D[stochRSIArr.D.length - 2] : null;

        // BUG #6 fix: убран дублирующий счёт зон (±0.12/±0.05), оставлен только кросс
        // Бычий кросс: K пересекает D снизу вверх
        if (prevK !== null && prevD !== null && lastD !== null) {
            if (prevK <= prevD && lastK > lastD) score += 0.07; // K пробивает D вверх
            if (prevK >= prevD && lastK < lastD) score -= 0.07; // K пробивает D вниз
        }
    }

    // --- Price Rejection (Сквизы и тени) ---
    const lastC = appData.candles && appData.candles.length > 0 ? appData.candles[appData.candles.length - 1] : null;
    if (lastC) {
        const candleRange = lastC.high - lastC.low || 1;
        const bodyTop = Math.max(lastC.open, lastC.close);
        const bodyBottom = Math.min(lastC.open, lastC.close);
        const lowerWick = bodyBottom - lastC.low;
        const upperWick = lastC.high - bodyTop;

        // Если нижняя тень больше 50% от всей свечи (резкий сквиз вниз и откуп) -> Буст LONG
        if (lowerWick / candleRange > 0.5 && candleRange > (lastC.close * 0.002)) {
            score += 0.10;
        }
        // Если верхняя тень больше 50% (сквиз вверх и давление продавцов) -> Буст SHORT
        else if (upperWick / candleRange > 0.5 && candleRange > (lastC.close * 0.002)) {
            score -= 0.10;
        }
    }

    // --- Sentiment: Funding Rate & L/S Ratio (Контр-трендовый фильтр) ---
    let sentimentScore = 0;
    if (appData.lsRatio !== null && appData.fundingRate !== null) {
        // Если толпа жестко в лонгах и платит за это (опасность сбривания лонгов - SHORT)
        if (appData.lsRatio > 1.5 && appData.fundingRate > 0.01) {
            sentimentScore -= 0.20;
        }
        // Если толпа жестко в шортах (опасность шорт-сквиза - LONG)
        else if (appData.lsRatio < 0.8 && appData.fundingRate < 0) {
            sentimentScore += 0.20;
        } else {
            // Плавное влияние
            if (appData.lsRatio > 1.5) sentimentScore -= 0.10;
            else if (appData.lsRatio < 0.8) sentimentScore += 0.10;

            const clampedFR = Math.max(-0.0005, Math.min(0.0005, appData.fundingRate));
            sentimentScore -= (clampedFR / 0.0005) * 0.05;
        }
    }
    score += sentimentScore;

    // --- Fibonacci Levels Weighting (Regulator) ---
    const fibSlider = document.getElementById('fiboWeightSlider');
    if (fibSlider && appData.fibData && appData.fibData[currentTF] && appData.fibData[currentTF].levels && lastC) {
        const weightPct = parseInt(fibSlider.value, 10) / 100;
        if (weightPct > 0) {
            const currentPrice = lastC.close;
            const levels = appData.fibData[currentTF].levels;
            
            // Найти ближайший уровень Фибоначчи
            let closestDist = Infinity;
            let closestLevel = null;
            levels.forEach(l => {
                const dist = Math.abs(currentPrice - l.price);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestLevel = l;
                }
            });

            if (closestLevel) {
                // Если цена ближе чем 0.8% к уровню Фибоначчи
                const distancePct = closestDist / currentPrice;
                if (distancePct < 0.008) {
                    // Отскок от поддержки (цена чуть выше уровня)
                    if (currentPrice >= closestLevel.price) {
                        score += 0.30 * weightPct; // Буст к лонгу
                    } else {
                        // Отскок от сопротивления (цена чуть ниже уровня)
                        score -= 0.30 * weightPct; // Буст к шорту
                    }
                }
            }
        }
    }

    // --- Fear & Greed Index (Откупаем страх, продаем жадность) ---
    if (appData.fearAndGreed !== null && appData.fearAndGreed !== undefined) {
        if (appData.fearAndGreed < 25) { // Extreme Fear
            score += 0.15;
        } else if (appData.fearAndGreed > 75) { // Extreme Greed
            score -= 0.15;
        } else if (appData.fearAndGreed < 40) {
            score += 0.05;
        } else if (appData.fearAndGreed > 60) {
            score -= 0.05;
        }
    }

    // --- Order Book Imbalance (плавная шкала) ---
    if (appData.orderBookImbalance !== null && appData.orderBookImbalance !== undefined) {
        const obi = Math.max(0.5, Math.min(2.0, appData.orderBookImbalance));
        const obiScore = (obi - 1.0) / 1.0;
        score += Math.max(-0.10, Math.min(0.10, obiScore * 0.10));
    }

    // --- Open Interest (Открытый интерес) ---
    if (appData.oiChange !== null && appData.oiChange !== undefined) {
        if (Math.abs(appData.oiChange) > 0.5) {
            const oiImpact = Math.min((Math.abs(appData.oiChange) - 0.5) * 0.1, 0.15);
            if (appData.oiChange > 0) {
                score += trend.includes('UP') ? oiImpact : trend.includes('DOWN') ? -oiImpact : 0;
            } else {
                score = 0.5 + (score - 0.5) * 0.9;
            }
        }
    }

    // --- Volume Profile S/R (Вместо слепых Фибоначчи) ---
    if (appData.levels) {
        const { support, resistance, poc } = appData.levels;
        const rangeToRes = resistance - appData.currentPrice;
        const rangeToSup = appData.currentPrice - support;

        // Если мы очень близко к поддержке (менее 1% разницы)
        if (rangeToSup > 0 && (rangeToSup / appData.currentPrice) < 0.01) {
            score += 0.10; // Отскок от поддержки
        }
        // Если мы очень близко к сопротивлению
        else if (rangeToRes > 0 && (rangeToRes / appData.currentPrice) < 0.01) {
            score -= 0.10; // Отбой от сопротивления
        }

        // Влияние POC (Point of Control) - магнита для цены
        const distToPoc = (poc - appData.currentPrice) / appData.currentPrice;
        if (Math.abs(distToPoc) > 0.02) { // Если мы далеко от POC (более 2%)
            score += distToPoc > 0 ? 0.05 : -0.05; // Цена стремится вернуться к проторгованному объему
        }
    }

    // --- Macro Levels Influence (65k, 75k) ---
    const macroLevelsList = [65000, 75000];
    const MACRO_THRESHOLD = 1500; // $1500 зона влияния от уровня
    const MACRO_WEIGHT = 0.10;

    // Применяем только ближайший макро-уровень (без двойного буста)
    let nearestMacro = null, nearestDist = Infinity;
    macroLevelsList.forEach(level => {
        const dist = Math.abs(appData.currentPrice - level);
        if (dist <= MACRO_THRESHOLD && dist < nearestDist) {
            nearestMacro = level;
            nearestDist = dist;
        }
    });
    if (nearestMacro !== null) {
        score += (appData.currentPrice >= nearestMacro) ? MACRO_WEIGHT : -MACRO_WEIGHT;
    }

    // --- Mempool конгестия (высокая активность сети = бычьий сигнал) ---
    if (appData.mempoolFastFee !== null) {
        // Пороги: <5 sat/vB = тихо, 5-30 = норма, >30 = загружено (бычье)
        if (appData.mempoolFastFee > 30) score += 0.06;
        else if (appData.mempoolFastFee > 10) score += 0.03;
        else if (appData.mempoolFastFee < 3) score -= 0.03; // сеть пустая = медвежь
    }

    // --- Тренд хэшрейта (рост = долгосрочный бычьй сигнал) ---
    if (appData.hashrateChange !== null) {
        // Хэшрейт растет = майнеры уверены в прибыльности; падает = капитуляция
        if (appData.hashrateChange > 3) score += 0.05;
        else if (appData.hashrateChange < -5) score -= 0.07; // шарпое падение = бегство
    }

    // --- CoinGecko 24h изменение (независимый импульс от Binance) ---
    // BUG #9 fix: объединённая градуированная шкала (убран дублирующий блок)
    if (appData.cg24hChange !== null) {
        const ch = appData.cg24hChange;
        if (ch > 5) score += 0.07;        // Сильнейший импульс
        else if (ch > 3) score += 0.04;   // Сильный
        else if (ch > 1.5) score += 0.02; // Умеренный
        else if (ch < -5) score -= 0.07;
        else if (ch < -3) score -= 0.04;
        else if (ch < -1.5) score -= 0.02;
    }

    // ============================================================
    // UNIFIED SCORING LOGIC & AI AUTO-BOT 
    // ============================================================
    // BUG #2 fix: Рассчитываем botScore всегда, чтобы UI совпадал с ботом
    if (BacktesterMath) {
        try {
            const allC = appData.allCandles || appData.candles || [];
            if (allC && allC.length > 50) {
                // BUG #5 fix: лёгкий trendAge — один ADX + подсчёт последовательных свечей по направлению тренда
                let trendAge = 0;
                // Reuse adxObj computed earlier (line 106) instead of recalculating
                if (adxObj && adxObj.adx > TRADING_CONFIG.ADX_TREND_THRESHOLD) {
                    const trendDir = adxObj.plusDI > adxObj.minusDI ? 1 : -1;
                    for (let j = allC.length - 2; j >= Math.max(0, allC.length - 31); j--) {
                        const move = allC[j + 1].close - allC[j].close;
                        // Свеча идёт в направлении тренда или нейтральна
                        if ((move * trendDir) >= 0) trendAge++;
                        else break;
                    }
                }

                let adxIncreasing = false;
                const adx0 = adxObj?.adx;
                const adx1 = TechnicalIndicators.calculateADX(allC.slice(0, allC.length - 1))?.adx;
                const adx2 = TechnicalIndicators.calculateADX(allC.slice(0, allC.length - 2))?.adx;
                if (adx0 !== undefined && adx1 !== undefined && adx2 !== undefined) {
                    if ((adx0 - adx1) > 0 && (adx1 - adx2) >= 0) adxIncreasing = true;
                }

                // Передаем макро-очки из dataPipeline как базу для бота
                const baseScore = Math.max(0, Math.min(100, Math.round(score * 100)));
                const { score: botScore, ctx, forbidden, forbiddenReason } = BacktesterMath.calcScoreWithContext(allC, trendAge, adxIncreasing, currentTF, baseScore);

                // Синхронизируем UI с мнением бота
                score = botScore / 100;

                // --- SIGNAL GENERATION LOOP ---
                if (PaperTrader && PaperTrader.state.autoBotEnabled && !PaperTrader.state.pos) {

                const botMode = document.getElementById('ptBotMode')?.value || 'sniper';
                let longTh = BacktesterMath.LONG_TH;
                let shortTh = BacktesterMath.SHORT_TH;
                let isForbidden = forbidden;
                let finalScore = botScore;

                if (botMode === 'degen') {
                    longTh = 51;
                    shortTh = 49;
                    isForbidden = false;

                    // Форсируем сделки для Degen мода, если снайпер выдал нейтральные 50 баллов
                    if (finalScore === 50 && ctx.stochK !== null) {
                        finalScore = ctx.kAboveD ? 55 : 45;
                    }
                } else if (botMode === 'elliott') {
                    isForbidden = true; // Отключаем обычный поиск Phase 5
                    if (typeof ElliottWaveEngine !== 'undefined' && ElliottWaveEngine.lockedWaves && ElliottWaveEngine.lockedWaves[currentTF]) {
                        const locked = ElliottWaveEngine.lockedWaves[currentTF];
                        if (locked.points && locked.points.length >= 9) {
                            const waveC = locked.points[8]; // Точка C (реальная или спрогнозированная)
                            // BUG #8 fix: работаем и с реальными, и с проекционными волнами C
                            const currentPrice = allC[allC.length - 1].close;

                            // Регистрируем прогноз Эллиотта для статистики
                            const { ForecastTracker: FT_e } = getLazyTrading();
                            if (FT_e) {
                                FT_e.register('elliott', waveC.price, appData.currentPrice, currentTF);
                            }

                            if (waveC.isProjection) {
                                // Проекция: цена ещё не достигла C — ждём достижения целевого уровня
                                if (locked.isUptrend && currentPrice <= waveC.price * 1.002) {
                                    finalScore = 100;
                                    longTh = 100;
                                    isForbidden = false;
                                }
                                else if (!locked.isUptrend && currentPrice >= waveC.price * 0.998) {
                                    finalScore = 0;
                                    shortTh = 0;
                                    isForbidden = false;
                                }
                            } else {
                                // Реальная волна C уже сформирована — входим если цена рядом с ней (±0.5%)
                                const proximity = Math.abs(currentPrice - waveC.price) / waveC.price;
                                if (proximity < 0.005) {
                                    if (locked.isUptrend) {
                                        // C — дно коррекции в бычьем тренде → LONG
                                        finalScore = 100;
                                        longTh = 100;
                                        isForbidden = false;
                                    } else {
                                        // C — вершина отскока в медвежьем тренде → SHORT
                                        finalScore = 0;
                                        shortTh = 0;
                                        isForbidden = false;
                                    }
                                }
                            }
                        }
                    }
                }

                if (!isForbidden) {
                    if (finalScore >= longTh) {
                        PaperTrader.openPos('LONG', botMode);
                        if (PaperTrader.state.pos) {
                            PaperTrader.state.pos.score = finalScore;
                            PaperTrader.state.pos.ctx = ctx;
                        }
                        triggerAlert('🤖 AutoBot: ВХОД LONG (Score ' + finalScore + ')', 'success');
                        window.playBeep(880, 0.5, 'square');
                    } else if (finalScore <= shortTh) {
                        PaperTrader.openPos('SHORT', botMode);
                        if (PaperTrader.state.pos) {
                            PaperTrader.state.pos.score = finalScore;
                            PaperTrader.state.pos.ctx = ctx;
                        }
                        triggerAlert('🤖 AutoBot: ВХОД SHORT (Score ' + finalScore + ')', 'error');
                        window.playBeep(440, 0.5, 'square');
                    }
                }
                } // Конец if (autoBotEnabled)
            }
        } catch (e) {
            console.error("AutoBot Logic Error", e);
        }
    }

    // --- Учет Волатильности ---
    const volatility = TechnicalIndicators.calculateVolatility(p);
    const expectedVol = { '15m': 0.5, '1h': 1.2, '4h': 3.0, '1d': 8.0, '1w': 20.0 }[currentTF] || 2.0;
    const volRatio = volatility / expectedVol;

    if (volRatio > TRADING_CONFIG.VOL_SPIKE_RATIO) {
        const dampen = Math.max(0.4, 1 - (volRatio - 1.5) * 0.3);
        score = 0.5 + (score - 0.5) * dampen;
    } else if (volRatio < TRADING_CONFIG.VOL_LOW_RATIO) {
        score = 0.5 + (score - 0.5) * 0.8;
    }

    // Ограничиваем score перед конвертацией, чтобы не терять сигналы
    score = Math.max(0, Math.min(1, score));
    const long = Math.max(10, Math.min(90, Math.round(score * 100)));
    appData.prob = { long, short: 100 - long, rsi, trend, vol24h: null, adx, marketRegime };

    // --- Гаусс Авто-Расчет ---
    const horizons = {
        '15m': { label: '24 часа', periods: 96 },
        '1h': { label: '3 дня', periods: 72 },
        '4h': { label: '7 дней', periods: 42 },
        '1d': { label: '30 дней', periods: 30 },
        '1w': { label: '90 дней', periods: 12 }
    };
    const horizon = horizons[currentTF] || horizons['4h'];
    const probRes = GaussianCalculator.calculateTouchProbability(p, appData.levels.resistance, horizon.periods);
    const probSup = GaussianCalculator.calculateTouchProbability(p, appData.levels.support, horizon.periods);

    let longProf = 0, shortProf = 0;
    if (appData.y1High && appData.y1Low && appData.y1High > appData.y1Low) {
        longProf = ((appData.y1High - appData.currentPrice) / (appData.y1High - appData.y1Low)) * 100;
        shortProf = ((appData.currentPrice - appData.y1Low) / (appData.y1High - appData.y1Low)) * 100;
        longProf = Math.max(0, Math.min(100, longProf));
        shortProf = Math.max(0, Math.min(100, shortProf));
    }

    appData.gauss = {
        horizonLabel: horizon.label,
        resPrice: appData.levels.resistance,
        supPrice: appData.levels.support,
        probRes,
        probSup,
        volatility: volatility,
        longProf,
        shortProf
    };

    // ... StochRSI рассчитан в начале processData ...

    // --- Vanga Forecast Precomputation ---
    try {
        const data = appData.candles;
        // Use full history for wave detection so short TFs (15m/1h) can find patterns
        const fullData = appData.allCandles && appData.allCandles.length > 0 ? appData.allCandles : data;
        if (data && data.length > 0) {
            const waves = ElliottWaveEngine.detectWaves(fullData);
            // Remap pivot indices from fullData space to visible display window space
            if (waves && waves.points) {
                const displayOffset = fullData.length - data.length;
                waves.points = waves.points.map(p => ({
                    ...p,
                    index: p.index - displayOffset
                }));
            }
            appData.elliottWaves = waves;
            let isUptrend = true;
            if (waves) {
                isUptrend = waves.isUptrend;
            } else {
                if (data.length >= 20) {
                    isUptrend = data[data.length - 1].close > data[data.length - 20].close;
                }
            }

            let seqIdx = 5; // default to Wave 5
            if (waves) {
                const lastPivot = waves.points[waves.points.length - 1];
                const seq = ['0', '1', '2', '3', '4', '5', 'A', 'B', 'C'];
                const lastPivotIdx = waves.points.indexOf(lastPivot);
                if (lastPivotIdx >= 0) {
                    seqIdx = lastPivotIdx;
                }
            }

            let sumDiff = 0;
            const count = Math.min(20, data.length);
            for (let i = data.length - count; i < data.length; i++) {
                sumDiff += Math.abs(data[i].close - data[i].open);
            }
            const avgAmp = (sumDiff / count) || (data[data.length - 1].close * 0.0012);

            let lastClose = data[data.length - 1].close;
            const seq = ['0', '1', '2', '3', '4', '5', 'A', 'B', 'C'];

            let k = 0;
            if (waves) {
                const lastPivot = waves.points[waves.points.length - 1];
                k = (data.length - 1) - lastPivot.index;
            }

            const predicted = [];
            for (let idx = 0; idx < 12; idx++) {
                const stepCount = k + 1 + idx;
                const numTransitions = Math.floor(stepCount / 6);
                const activeWaveIdx = (seqIdx + numTransitions) % seq.length;
                const activeWaveLabel = seq[activeWaveIdx];

                let isBull = true;
                const upWaves = ['1', '3', '5', 'B'];
                const isWaveUp = upWaves.includes(activeWaveLabel);
                if (isUptrend) {
                    isBull = isWaveUp;
                } else {
                    isBull = !isWaveUp;
                }

                // Deterministic candle size scaling to prevent flickering
                const scale = 0.8 + ((idx * 7 + 13) % 5) * 0.1;
                const delta = avgAmp * scale;
                const open = lastClose;
                const close = isBull ? open + delta : open - delta;
                const high = Math.max(open, close) + delta * 0.25;
                const low = Math.min(open, close) - delta * 0.25;

                predicted.push({
                    open,
                    high,
                    low,
                    close,
                    isBull,
                    label: 'F' + (idx + 1)
                });
                lastClose = close;
            }
            appData.predictedCandles = predicted;

            // Регистрируем прогноз Ванги для статистики
            const { ForecastTracker: FT_v } = getLazyTrading();
            if (predicted.length > 0 && FT_v) {
                FT_v.register('vanga', predicted[predicted.length - 1].close, appData.currentPrice, currentTF);
            }
        }
    } catch (e) {
        console.error("Error computing Vanga Forecast", e);
    }

    AnalysisLogger.log('DATA_PROCESSED', { tf: currentTF, price: appData.currentPrice });
    updateUI();
}

// ============================================================
// ОБНОВЛЕНИЕ UI
// ============================================================
export function updateUI() {
    document.getElementById('btnRefresh').innerHTML = `🔄 ${new Date().toLocaleTimeString('ru-RU')}`;

    // --- Обновление торговой сессии (по Киевскому времени) ---
    const kyivHour = getKyivHour();
    const sessionEl = document.getElementById('sessionIndicator');
    if (sessionEl) {
        sessionEl.style.cursor = 'pointer';
        sessionEl.style.transition = '0.2s';
        sessionEl.onmouseenter = () => { sessionEl.style.boxShadow = '0 0 10px ' + sessionEl.style.borderColor; };
        sessionEl.onmouseleave = () => { sessionEl.style.boxShadow = 'none'; };

        if (!sessionEl.onclick) {
            sessionEl.onclick = function () {
                const box = document.getElementById('alertBox');
                const session = sessionEl.dataset.session;
                let title = "", text = "";
                if (session === 'asia') {
                    title = "Азиатская сессия (03:00 - 11:00)";
                    text = "Особенности:<br>• Низкая волатильность<br>• Фаза накопления (флэт)<br>• Реакция на фондовые рынки Азии<br>• Хорошее время для канальных стратегий";
                } else if (session === 'europe') {
                    title = "Европейская сессия (11:00 - 16:00)";
                    text = "Особенности:<br>• Высокая волатильность<br>• Формирование внутридневного тренда<br>• Пробой утренних диапазонов<br>• Активность институциональных игроков";
                } else if (session === 'overlap') {
                    title = "Лондон / Нью-Йорк (16:00 - 19:00)";
                    text = "Особенности:<br>• Пиковая волатильность и объемы<br>• Возможны сильные развороты тренда<br>• Реакция на макроданные США<br>• Лучшее время для трендовых стратегий";
                } else if (session === 'usa') {
                    title = "Американская сессия (19:00 - 00:00)";
                    text = "Особенности:<br>• Высокие объемы торгов<br>• Активность алгоритмов и маркетмейкеров<br>• Фиксация прибыли к концу сессии<br>• Сильные движения на новостях";
                } else {
                    title = "Тихоокеанская сессия (00:00 - 03:00)";
                    text = "Особенности:<br>• Очень низкая волатильность<br>• Расширение спредов<br>• Подготовка к азиатской сессии<br>• Риск ложных пробоев";
                }

                box.innerHTML = `<strong>${title}</strong><br><br>${text}`;
                box.className = 'alert info';
                box.style.display = 'block';

                if (window.sessionAlertTimeout) clearTimeout(window.sessionAlertTimeout);
                window.sessionAlertTimeout = setTimeout(() => {
                    box.style.display = 'none';
                }, 8000);
            };
        }

        if (kyivHour >= 3 && kyivHour < 11) {
            sessionEl.innerHTML = '03:00-11:00 🌏 АЗИЯ';
            sessionEl.dataset.session = 'asia';
            sessionEl.style.color = '#FFD700';
            sessionEl.style.borderColor = 'rgba(255, 215, 0, 0.3)';
        } else if (kyivHour >= 11 && kyivHour < 16) {
            sessionEl.innerHTML = '11:00-16:00 🇪🇺 ЕВРОПА';
            sessionEl.dataset.session = 'europe';
            sessionEl.style.color = '#00FFC8';
            sessionEl.style.borderColor = 'rgba(0, 255, 200, 0.3)';
        } else if (kyivHour >= 16 && kyivHour < 19) {
            sessionEl.innerHTML = '16:00-19:00 🇪🇺 ЛОНДОН / 🇺🇸 НЬЮ-ЙОРК';
            sessionEl.dataset.session = 'overlap';
            sessionEl.style.color = '#FF9900';
            sessionEl.style.borderColor = 'rgba(255, 153, 0, 0.3)';
        } else if (kyivHour >= 19 && kyivHour < 24) {
            sessionEl.innerHTML = '19:00-00:00 🇺🇸 США';
            sessionEl.dataset.session = 'usa';
            sessionEl.style.color = '#FF006E';
            sessionEl.style.borderColor = 'rgba(255, 0, 110, 0.3)';
        } else {
            sessionEl.innerHTML = '00:00-03:00 🌏 ТИХИЙ ОКЕАН';
            sessionEl.dataset.session = 'pacific';
            sessionEl.style.color = '#00BFFF';
            sessionEl.style.borderColor = 'rgba(0, 191, 255, 0.3)';
        }
    }

    // --- Центральный тикер: BTC $62 122 ▼ ---
    const _priceEl = document.getElementById('chartPriceVal');
    const _arrowEl = document.getElementById('chartTrendArrow');
    if (_priceEl && _arrowEl && appData.currentPrice) {
        _priceEl.textContent = '$' + fmtP(appData.currentPrice);
        const _tr = (appData.prob && appData.prob.trend) || '';
        if (_tr.includes('UP')) {
            _arrowEl.textContent = '▲';
            _arrowEl.style.color = '#00FF88';
            _priceEl.style.color = '#00FF88';
        } else if (_tr.includes('DOWN')) {
            _arrowEl.textContent = '▼';
            _arrowEl.style.color = '#FF006E';
            _priceEl.style.color = '#FF006E';
        } else {
            _arrowEl.textContent = '▶';
            _arrowEl.style.color = '#FFD700';
            _priceEl.style.color = '#FFD700';
        }
    }

    const rsi = appData.prob.rsi;
    const rsiIcon = rsi === null ? '' : rsi < TRADING_CONFIG.RSI_OVERSOLD ? ' 📉' : rsi > TRADING_CONFIG.RSI_OVERBOUGHT ? ' 📈' : ' ➡️';
    document.getElementById('indRSI').textContent = rsi !== null ? `${rsi}${rsiIcon}` : '---';
    document.getElementById('indTrend').textContent = appData.prob.trend;
    document.getElementById('indVol').textContent = appData.prob.vol24h ? appData.prob.vol24h.toFixed(2) + ' BTC' : '---';
    document.getElementById('indMom').textContent = (appData.orderBookImbalance !== null && appData.orderBookImbalance !== undefined) ? appData.orderBookImbalance.toFixed(2) + (appData.orderBookImbalance > 1 ? ' (Bids > Asks)' : ' (Asks > Bids)') : '---';

    document.getElementById('indLS').textContent = (appData.lsRatio !== null && appData.lsRatio !== undefined) ? appData.lsRatio.toFixed(2) + (appData.lsRatio > 1 ? ' 🔴' : ' 🟢') : '---';
    document.getElementById('indFunding').textContent = appData.fundingRate !== null ? (appData.fundingRate * 100).toFixed(4) + '%' : '---';

    const indADXEl = document.getElementById('indADX');
    if (appData.prob.adx !== null) {
        indADXEl.textContent = `${appData.prob.adx} (${appData.prob.marketRegime})`;
        if (appData.prob.marketRegime === 'TRENDING UP') {
            indADXEl.style.color = '#00FFC8';
        } else if (appData.prob.marketRegime === 'TRENDING DOWN') {
            indADXEl.style.color = '#FF5C5C';
        } else {
            indADXEl.style.color = '#aaa';
        }
    } else {
        indADXEl.textContent = '---';
        indADXEl.style.color = '#00FFC8';
    }

    if (appData.fearAndGreed !== null && appData.fearAndGreed !== undefined) {
        const fg = appData.fearAndGreed;
        const fgIcon = fg < 25 ? ' 🥶' : fg > 75 ? ' 🤑' : ' 😐';
        document.getElementById('indFG').textContent = `${fg}${fgIcon}`;
    } else {
        document.getElementById('indFG').textContent = '---';
    }

    const indOIEl = document.getElementById('indOI');
    if (indOIEl) {
        indOIEl.textContent = (appData.oiChange !== null && appData.oiChange !== undefined)
            ? (appData.oiChange > 0 ? '+' : '') + appData.oiChange.toFixed(2) + '%'
            : '---';
        indOIEl.style.color = (appData.oiChange !== null && appData.oiChange > 0) ? '#00FF88'
            : (appData.oiChange !== null && appData.oiChange < 0) ? '#FF006E'
                : '#888888';
    }

    const indMemFeeEl = document.getElementById('indMemFee');
    if (indMemFeeEl) {
        if (appData.mempoolFastFee !== null) {
            const fee = appData.mempoolFastFee;
            const feeLabel = fee > 30 ? ' 🔥' : fee > 10 ? ' ⚡' : ' 🏦';
            indMemFeeEl.textContent = fee + ' sat/vB' + feeLabel;
            indMemFeeEl.style.color = fee > 30 ? '#00FF88' : fee > 10 ? '#FFD700' : '#888';
        } else {
            indMemFeeEl.textContent = '---';
            indMemFeeEl.style.color = '';
        }
    }

    const indHashEl = document.getElementById('indHashrate');
    if (indHashEl) {
        if (appData.hashrateChange !== null) {
            const hc = appData.hashrateChange;
            indHashEl.textContent = (hc > 0 ? '+' : '') + hc.toFixed(1) + '%' + (hc > 3 ? ' 💪' : hc < -5 ? ' ⚠️' : ' →');
            indHashEl.style.color = hc > 0 ? '#00FF88' : '#FF006E';
        } else {
            indHashEl.textContent = '---';
            indHashEl.style.color = '';
        }
    }



    const indStochRSIEl = document.getElementById('indStochRSI');
    if (indStochRSIEl && appData.stochRSILines) {
        const { K: sK, D: sD } = appData.stochRSILines;
        if (sK.length > 0 && sD.length > 0) {
            const k = sK[sK.length - 1].toFixed(1);
            const d = sD[sD.length - 1].toFixed(1);
            indStochRSIEl.innerHTML = `<span style="color:#FFB300">K:${k}</span> <span style="color:#FF3EA5">D:${d}</span>`;
        } else {
            indStochRSIEl.textContent = '---';
        }
    }

    const plVal = document.getElementById('probLongVal');
    if (plVal) plVal.textContent = `${appData.prob.long}%`;
    const psVal = document.getElementById('probShortVal');
    if (psVal) psVal.textContent = `${appData.prob.short}%`;
    const fillLong = document.getElementById('probLongFill');
    const fillShort = document.getElementById('probShortFill');
    if (fillLong) fillLong.style.width = `${appData.prob.long}%`;
    if (fillShort) fillShort.style.width = `${appData.prob.short}%`;

    if (appData.prob) {
        const isLong = appData.prob.long >= 50;
        const chipLong = document.getElementById('chipLong');
        const chipShort = document.getElementById('chipShort');
        if (chipLong && chipShort) {
            if (isLong) {
                chipLong.style.background = 'rgba(0,255,136,0.12)';
                chipLong.style.borderColor = 'rgba(0,255,136,0.7)';
                chipLong.style.boxShadow = '0 0 8px rgba(0,255,136,0.3)';
                chipLong.style.opacity = '1';
                chipShort.style.background = 'transparent';
                chipShort.style.borderColor = 'rgba(255,0,110,0.2)';
                chipShort.style.boxShadow = 'none';
                chipShort.style.opacity = '0.75';
            } else {
                chipShort.style.background = 'rgba(255,0,110,0.12)';
                chipShort.style.borderColor = 'rgba(255,0,110,0.7)';
                chipShort.style.boxShadow = '0 0 8px rgba(255,0,110,0.3)';
                chipShort.style.opacity = '1';
                chipLong.style.background = 'transparent';
                chipLong.style.borderColor = 'rgba(0,255,136,0.2)';
                chipLong.style.boxShadow = 'none';
                chipLong.style.opacity = '0.75';
            }
        }
    }

    if (appData.gauss) {
        const longEl = document.getElementById('gaussLongProf');
        const shortEl = document.getElementById('gaussShortProf');
        if (longEl) longEl.textContent = appData.gauss.longProf !== undefined ? appData.gauss.longProf.toFixed(1) + '%' : '---%';
        if (shortEl) shortEl.textContent = appData.gauss.shortProf !== undefined ? appData.gauss.shortProf.toFixed(1) + '%' : '---%';
        const gaussVolEl = document.getElementById('gaussAutoVolatility');
        if (gaussVolEl) gaussVolEl.textContent = `Текущая волатильность: ${appData.gauss.volatility.toFixed(2)}%`;
    }

    // Обновляем состояние AI-Анализа (через lazy import)
    const { AIAnalyzer: LazyAIAnalyzer } = getLazyTrading();
    if (LazyAIAnalyzer) {
        LazyAIAnalyzer.updateState();
    }

    // --- Update Volume & Flow Widget ---
    if (appData.candles && appData.candles.length > 0) {
        const lastCandle = appData.candles[appData.candles.length - 1];
        const cvdVal = (appData.cvd && appData.cvd.length > 0) ? appData.cvd[appData.cvd.length - 1] : 0;

        const cvdEl = document.getElementById('vfCVD');
        const deltaEl = document.getElementById('vfDelta');
        const buySellEl = document.getElementById('vfBuySell');
        const liqLongEl = document.getElementById('vfLiqLong');
        const liqShortEl = document.getElementById('vfLiqShort');

        if (cvdEl) {
            cvdEl.textContent = (cvdVal >= 0 ? '+' : '') + cvdVal.toFixed(1) + ' BTC';
            cvdEl.style.color = cvdVal >= 0 ? '#00FF88' : '#FF006E';
        }

        if (deltaEl) {
            const deltaVal = lastCandle.delta || 0;
            deltaEl.textContent = (deltaVal >= 0 ? '+' : '') + deltaVal.toFixed(1) + ' BTC';
            deltaEl.style.color = deltaVal >= 0 ? '#00FF88' : '#FF006E';
        }

        if (buySellEl) {
            const buy = lastCandle.takerBuyVolume || 0;
            const sell = (lastCandle.volume - buy) || 0;
            buySellEl.innerHTML = `<span style="color:#00FF88">${buy.toFixed(1)}</span> / <span style="color:#FF006E">${sell.toFixed(1)}</span>`;
        }

        if (liqLongEl) {
            liqLongEl.textContent = '$' + (appData.liqLong || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
        if (liqShortEl) {
            liqShortEl.textContent = '$' + (appData.liqShort || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
    }

    renderCandleChart();
}

// ============================================================
// ГРАФИКИ
// ============================================================

function renderCandleChart() {
    const canvas = document.getElementById('candleChartCanvas');
    if (!candleChartInstance) {
        setChartInstance(new CandleChart(canvas));
    }
    candleChartInstance.update(appData.candles);
}

// При изменении размера перерисовываем свечи
window.addEventListener('resize', () => {
    if (candleChartInstance && appData.candles?.length) {
        candleChartInstance.update(appData.candles);
    }
});

