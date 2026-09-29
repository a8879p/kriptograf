// Primary market data loader — extracted from 666BTC2graf.html (Stage 1 refactor)
import { TRADING_CONFIG } from './config.js';
import { NetworkManager } from './api.js';
import { appData, currentTF, lastSecondaryFetch, setLastSecondaryFetch, countdown, updateCountdown, AUTO_REFRESH_MS, candleChartInstance } from './state.js';
import { FibonacciEngine } from './indicators.js';
import { fetchFuturesData } from './fetchMacro.js';
import { processData } from './dataPipeline.js';
import { setLoading, triggerAlert } from './ui-utils.js';

let _localLastFetchTF = null;

export async function fetchCryptoData(isManual = false) {
    const manual = isManual === true || isManual instanceof Event;
    if (manual) setLoading(true);

    const now = Date.now();
    // Обновляем тяжелые данные (MTF Фибоначчи, Фандинг, Стакан) только при ручном обновлении или раз в 60 секунд
    const shouldFetchSecondary = manual || (now - lastSecondaryFetch > 60 * 1000);

    updateCountdown(AUTO_REFRESH_MS / 1000); // Сброс таймера при каждом обновлении
    let interval = '4h';
    if (currentTF === '15m') interval = '15m';
    else if (currentTF === '1h') interval = '1h';
    else if (currentTF === '4h') interval = '4h';
    else if (currentTF === '1d') interval = '1d';
    else if (currentTF === '1w') interval = '1w';

    const DISPLAY_LIMIT = 90;  // возвращено на 90 по просьбе пользователя
    const WARMUP_LIMIT = 1000; // увеличено до 1000 для идеального прогрева RMA(RSI) как на биржах

    // Инкрементальное обновление: если мы не меняли таймфрейм и у нас уже есть история,
    // достаточно запросить последние 10 свечей (с запасом), чтобы не качать 1000 свечей каждые 5 сек.
    const isIncremental = !manual && _localLastFetchTF === interval && appData.allCandles && appData.allCandles.length > 0;
    const fetchLimit = isIncremental ? 10 : WARMUP_LIMIT;

    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${TRADING_CONFIG.SYMBOL}&interval=${interval}&limit=${fetchLimit}`;
        const json = await NetworkManager.fetchJSON(url);
        if (!json) throw new Error('Failed to fetch klines');

        const mappedCandles = json.map(k => {
            const date = new Date(k[0]);
            const label = ['1d', '1w'].includes(currentTF)
                ? date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
                : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

            const volume = parseFloat(k[5]);
            const takerBuyVolume = parseFloat(k[9]) || (volume * 0.5);
            const takerSellVolume = volume - takerBuyVolume;
            const delta = takerBuyVolume - takerSellVolume;

            return {
                time: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume,
                takerBuyVolume,
                delta,
                label
            };
        });

        if (isIncremental) {
            // Сливаем новые свечи с существующим массивом (O(n) через Map)
            const existingByTime = new Map(appData.allCandles.map((c, i) => [c.time, i]));
            mappedCandles.forEach(mc => {
                const idx = existingByTime.get(mc.time);
                if (idx !== undefined) {
                    appData.allCandles[idx] = mc; // Обновляем текущую формирующуюся свечу
                } else {
                    appData.allCandles.push(mc); // Добавляем новую
                }
            });
            // Не даем массиву бесконечно расти
            if (appData.allCandles.length > WARMUP_LIMIT) {
                appData.allCandles = appData.allCandles.slice(-WARMUP_LIMIT);
            }
        } else {
            appData.allCandles = mappedCandles;
        }

        _localLastFetchTF = interval;
        appData.allPrices = appData.allCandles.map(c => c.close);

        appData.candles = appData.allCandles.slice(-DISPLAY_LIMIT);
        appData.prices = appData.candles.map(c => c.close);
        appData.dates = appData.candles.map(c => c.label);

        if (shouldFetchSecondary) {
            await fetchFuturesData();
            setLastSecondaryFetch(now);
        }

        // Fibonacci MTF: compute current TF from loaded candles immediately,
        // then fetch all TFs in background without blocking the render.
        appData.fibData = appData.fibData || {};
        const tfLookbacks = { '1w': 3, '1d': 5, '4h': 5, '1h': 7, '15m': 7 };
        appData.fibData[currentTF] = FibonacciEngine.computeLevels(
            appData.candles, currentTF, tfLookbacks[currentTF] || 5
        );
        processData();
        // Non-blocking MTF build — updates chart after all TFs resolve
        if (shouldFetchSecondary) {
            FibonacciEngine.buildMultiTF().then(mtf => {
            appData.fibData = { ...appData.fibData, ...mtf };
                appData.fibConfluence = FibonacciEngine.findConfluence(mtf);
                if (candleChartInstance && appData.candles.length) {
                    candleChartInstance.update(appData.candles);
                }
            }).catch(e => console.warn('MTF Fib build failed:', e));
        }
    } catch (err) {
        if (manual) {
            triggerAlert(`❌ Ошибка загрузки: ${err.message}`, 'error');
        } else {
            console.error("DEBUG_STACK:", err.stack);
        }
    } finally {
        setLoading(false);
    }
}
