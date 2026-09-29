// ============================================================
// ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ (Избавляемся от магических чисел)
// ============================================================
export const TRADING_CONFIG = {
    // Базовые настройки
    SYMBOL: 'BTCUSDT',

    // Ликвидность
    PIVOT_LR: 7,               // Свечей слева/справа для пула ликвидности
    
    // Индикаторы
    RSI_PERIOD: 14,
    RSI_OVERBOUGHT: 70,
    RSI_OVERSOLD: 30,
    ADX_TREND_THRESHOLD: 25,   // Минимальный ADX для подтверждения тренда
    DI_SPREAD_MIN: 20,         // Минимальное расхождение DI+ / DI-
    
    // Объемы
    VOL_SPIKE_RATIO: 1.5,      // Множитель для аномального всплеска
    VOL_LOW_RATIO: 0.4,        // Множитель для падения объемов
    
    // Звуковые Уведомления (Гц, Сек)
    SOUND_FREQ_LONG: 880,
    SOUND_FREQ_SHORT: 330,
    SOUND_DURATION: 0.2,
    SOUND_VOLUME: 0.08
};

// Утилита: надёжное определение часа по Киевскому времени
// Используется в btMath, dataPipeline, backtester.worker для session-фильтров
export function getKyivHour(timestamp) {
    const d = timestamp ? new Date(timestamp) : new Date();
    return parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Kiev',
        hour: 'numeric',
        hour12: false
    }).format(d)) % 24;
}
