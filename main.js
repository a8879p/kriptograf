import { NetworkManager } from './api.js';
import { appData, currentTF, setTF, showElliott, showVanga, toggleElliott, toggleVanga, candleChartInstance, setChartInstance } from './state.js';
import { fetchCryptoData } from './fetchMarket.js';
import { PaperTrader, ForecastTracker, AIAnalyzer, SqueezeScreener, openBacktestModal, openAIModal, saveAIModal, resetAIModal } from './trading.js';
import { CycleChart, CandleChart } from './charts.js';
import { BacktesterUI } from './backtester-ui.js';

// Bridge for lazy cross-module access (breaks circular dep: dataPipeline -> trading -> fetchMarket -> dataPipeline)
window.__tradingModule = { PaperTrader, ForecastTracker, AIAnalyzer };

// Global exports for inline HTML onclick= handlers
window.CycleChart = CycleChart;
window.PaperTrader = PaperTrader;
window.BacktesterUI = BacktesterUI;
window.AIAnalyzer = AIAnalyzer;
window.SqueezeScreener = SqueezeScreener;
window.openBacktestModal = openBacktestModal;
window.openAIModal = openAIModal;
window.saveAIModal = saveAIModal;
window.resetAIModal = resetAIModal;
window.fetchCryptoData = fetchCryptoData;





            window.closeChartTradeMenu = function () {
                const menu = document.getElementById('chartTradeMenu');
                if (menu) menu.style.display = 'none';
            };

            window.executeChartTrade = function (dir) {
                const price = window._pendingChartPrice;
                if (!price) return;

                // Вписываем цену в поле ввода
                // Запускаем сделку
                if (PaperTrader) {
                    PaperTrader.openPos(dir);
                }

                closeChartTradeMenu();
            };
        

// --- Extracted from HTML ---


    async function updateSmartMoney() {
        try {
            const data = await NetworkManager.fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
            if (!data) return;
            const price = parseFloat(data.price);

            const smPriceEl = document.getElementById('smPrice');
            if (smPriceEl) smPriceEl.innerText = '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });

            const widget = document.getElementById('smartMoneyWidget');
            const phaseEl = document.getElementById('smPhase');
            const actionEl = document.getElementById('smAction');
            const pointer = document.getElementById('smPointer');

            let phase = '';
            let action = '';
            let color = '';
            let percent = 0;

            if (price < 66600) {
                // Zone 1: Discount (0% to 33.3%)
                window.MACRO_BIAS = 'LONG_ONLY';
                phase = '🟢 ЗОНА СКИДКИ (LONG ONLY)';
                action = 'ВХОД ЛЕСЕНКОЙ: 65k (4%) → 60k (19%) → 50k (77%)';
                color = '#00FF88';
                let p = (price - 40000) / (66600 - 40000);
                if (p < 0) p = 0; if (p > 1) p = 1;
                percent = p * 33.3;
            } else if (price >= 66600 && price < 97000) {
                // Zone 2: Waiting (33.3% to 66.6%)
                window.MACRO_BIAS = 'SHORT_ONLY';
                phase = '🟡 ЭКВАТОР 666 (SHORT ONLY)';
                action = 'ТОЛЬКО ШОРТ ОТ ВЕРХНИХ ГРАНИЦ';
                color = '#FFD700';
                let p = (price - 66600) / (97000 - 66600);
                percent = 33.3 + (p * 33.3);
            } else {
                // Zone 3: Distribution (66.6% to 100%)
                window.MACRO_BIAS = 'EXIT';
                phase = '🔴 РАСПРЕДЕЛЕНИЕ (ВЫХОД)';
                action = 'ВКЛЮЧАЕМ ТРЕЙЛИНГ-СТОП!';
                color = '#FF006E';
                let p = (price - 97000) / (130000 - 97000);
                if (p > 1) p = 1;
                percent = 66.6 + (p * 33.3);
            }

            if (widget) widget.style.borderColor = color;
            if (phaseEl) {
                phaseEl.innerText = phase;
                phaseEl.style.color = color;
            }
            if (actionEl) actionEl.innerText = action;
            if (pointer) pointer.style.bottom = percent + '%';

        } catch (e) { console.error('SmartMoney Tracker error:', e); }
    }

    // Check every 10 seconds
    setInterval(updateSmartMoney, 10000);
    setTimeout(updateSmartMoney, 2000);

// ============================================================
// APPLICATION INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize sub-modules
    SqueezeScreener.init();
    PaperTrader.load();
    ForecastTracker.load();
    CycleChart.init();
    
    // СОБЫТИЯ
    // ============================================================
    document.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            setTF(e.target.dataset.tf);
            fetchCryptoData();
        });
    });
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) btnRefresh.addEventListener('click', fetchCryptoData);

    const btnToggleElliott = document.getElementById('btnToggleElliott');
    if (btnToggleElliott) {
        btnToggleElliott.addEventListener('click', function () {
            toggleElliott();
            this.style.background = showElliott ? 'rgba(0, 255, 200, 0.2)' : 'transparent';
            if (candleChartInstance) candleChartInstance.update(candleChartInstance.fullData);
        });
    }

    const btnToggleVanga = document.getElementById('btnToggleVanga');
    if (btnToggleVanga) {
        btnToggleVanga.addEventListener('click', function () {
            toggleVanga();
            this.style.background = showVanga ? 'rgba(255, 0, 110, 0.2)' : 'transparent';
            if (candleChartInstance) candleChartInstance.update(candleChartInstance.fullData);
        });
    }

    // 2. Restore AI state
    if (localStorage.getItem('ai_last_rawText')) {
        AIAnalyzer.rawText = localStorage.getItem('ai_last_rawText');
        import('./trading.js').then(mod => {
            if (mod.updateSidebarBullets) mod.updateSidebarBullets(AIAnalyzer.rawText);
        });
    }

    // 3. Initial data fetch (true = show errors on first load)
    fetchCryptoData(true);

    // 4. Auto-refresh timer
    setInterval(() => {
        // Fetch only if page is visible (optional optimization)
        fetchCryptoData();
    }, 5000); // AUTO_REFRESH_MS from state.js is 5000

    // 5. UI Animation / Blink Loop
    setInterval(() => {
        const blinkState = Math.floor(Date.now() / 500) % 2 === 0;

        const adxPointerValue = document.getElementById('adxPointerValue');
        const chipLong = document.getElementById('chipLong');
        const chipShort = document.getElementById('chipShort');

        if (adxPointerValue && appData.stochRSILines) {
            const sK = appData.stochRSILines.K;
            if (sK && sK.length > 0) {
                const lastK = sK[sK.length - 1];
                const isGreen = adxPointerValue.classList.contains('trend-up');
                const isRed = adxPointerValue.classList.contains('trend-down');

                const syncBlinkUp = isGreen && lastK <= 15;
                const syncBlinkDown = isRed && lastK >= 85;

                if (syncBlinkUp) {
                    const opacityVal = blinkState ? '1.0' : '0.2';
                    adxPointerValue.style.opacity = opacityVal;
                    if (chipLong) chipLong.style.opacity = opacityVal;
                    if (chipShort) chipShort.style.opacity = '0.75';
                } else if (syncBlinkDown) {
                    const opacityVal = blinkState ? '1.0' : '0.2';
                    adxPointerValue.style.opacity = opacityVal;
                    if (chipShort) chipShort.style.opacity = opacityVal;
                    if (chipLong) chipLong.style.opacity = '0.75';
                } else {
                    if (!adxPointerValue.classList.contains('trend-flat')) {
                        adxPointerValue.style.opacity = '1.0';
                    }
                    if (chipLong && chipShort && appData.prob) {
                        const isLong = appData.prob.long >= 50;
                        chipLong.style.opacity = isLong ? '1' : '0.75';
                        chipShort.style.opacity = isLong ? '0.75' : '1';
                    }
                }
            }
        }
    }, 500);

    // 6. Register Service Worker for offline caching
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered with scope:', reg.scope))
            .catch(err => console.warn('Service Worker registration failed:', err));
    }
});
