import { NetworkManager } from './api.js';
import { appData, currentTF, AUTO_REFRESH_MS, candleChartInstance } from './state.js';
import { triggerAlert, fmtP } from './ui-utils.js';
import { fetchCryptoData } from './fetchMarket.js';
import { BacktesterUI } from './backtester-ui.js';

        export class SqueezeScreener {
            static async fetchTickers() {
                try {
                    const tickers = await NetworkManager.fetchJSON('https://api.binance.com/api/v3/ticker/24hr');
                    if (!tickers) return [];
                    return tickers
                        .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.lastPrice) > 0)
                        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                        .map(t => t.symbol);
                } catch (e) {
                    return [];
                }
            }

            static async fetchKlines(symbol, interval, limit) {
                const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                const data = await NetworkManager.fetchJSON(url);
                if (!data) throw new Error('fetch failed');
                return data;
            }

            static calcZScore(closes) {
                const changes = [];
                for (let i = 1; i < closes.length; i++) {
                    changes.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
                }
                const n = changes.length - 1;
                const hist = changes.slice(0, n);
                const last = changes[n];
                const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
                const std = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
                if (std < 0.0001) return { z: 0, change: last };
                return { z: (last - mean) / std, change: last };
            }

            static async runScan() {
                const statusEl = document.getElementById('squeezeStatus');
                const resultsEl = document.getElementById('squeezeResults');

                if (statusEl) statusEl.textContent = 'сканирование... ⏳';

                const tf = '5m';
                const lookback = 30;
                const threshold = 2.5;
                const minVol = 0; // 0 = Любой объем, как в полной версии
                const topN = 5; // Показываем 5 сильнейших сквизов в мини-версии

                const results = [];
                let scannedCount = 0; // Fix: Count all attempted coins that successfully fetch data
                const BATCH = 5;

                try {
                    let coins = await this.fetchTickers();
                    if (coins.length === 0) throw new Error("No tickers");
                    coins = coins.slice(0, 250); // Сканируем топ 250 монет для безопасности API

                    for (let i = 0; i < coins.length; i += BATCH) {
                        const batch = coins.slice(i, i + BATCH);
                        await Promise.all(batch.map(async sym => {
                            try {
                                const klines = await this.fetchKlines(sym, tf, lookback + 2);
                                if (klines.length < 10) return;

                                scannedCount++; // Count successful fetches

                                const closes = klines.map(k => parseFloat(k[4]));
                                const quoteVol = klines.slice(-1)[0][7];
                                const vol = parseFloat(quoteVol);

                                if (vol < minVol) return;

                                const { z, change } = this.calcZScore(closes);
                                const absZ = Math.abs(z);

                                if (absZ >= threshold) {
                                    results.push({
                                        sym: sym.replace('USDT', ''),
                                        z: parseFloat(z.toFixed(2)),
                                        change: parseFloat(change.toFixed(2)),
                                        dir: z > 0 ? 'up' : 'down'
                                    });
                                }
                            } catch (e) { /* ignore individual fetch errors */ }
                        }));
                    }

                    results.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
                    const top = results.slice(0, topN);

                    if (resultsEl) {
                        if (top.length === 0) {
                            resultsEl.innerHTML = '<div class="squeeze-empty">Нет сильных сквизов</div>';
                        } else {
                            let html = '';
                            top.forEach(r => {
                                const sign = r.z > 0 ? '+' : '';
                                const changeSign = r.change > 0 ? '+' : '';
                                const badgeClass = r.dir === 'up' ? 'up' : 'down';
                                const badgeText = r.dir === 'up' ? '▲ LONG' : '▼ SHORT';
                                html += `<div class="squeeze-row">
                                    <span class="squeeze-sym">${r.sym}</span>
                                    <span style="color: ${r.dir === 'up' ? '#00d4a0' : '#ff5c5c'}">${changeSign}${r.change}%</span>
                                    <span class="squeeze-z">${sign}${r.z}σ</span>
                                    <span class="squeeze-badge ${badgeClass}">${badgeText}</span>
                                </div>`;
                            });
                            resultsEl.innerHTML = html;
                        }
                    }

                    if (statusEl) {
                        const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                        statusEl.textContent = `скан: ${scannedCount} монет | ${now}`;
                    }
                } catch (e) {
                    if (statusEl) statusEl.textContent = 'ошибка сканирования';
                }
            }

            static init() {
                // Автозапуск отключен по вашему запросу. 
                // Теперь сканирование запускается только по кнопке "Скан".
                // setTimeout(() => this.runScan(), 2000);
            }
        }



        // ============================================================
        // AI ANALYZER MODULE (OpenAI Integration)
        // ============================================================
        export class AIAnalyzer {
            static setApiKey() {
                const key = prompt("Введите ваш API ключ (OpenAI, OpenRouter или Google Gemini):\nКлюч будет сохранен только локально в вашем браузере.", localStorage.getItem('openai_api_key') || '');
                if (key !== null) {
                    localStorage.setItem('openai_api_key', key.trim());
                    triggerAlert('API ключ сохранен!', 'info');
                }
            }

            static async translateToRussian(text) {
                try {
                    const res = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ q: text })
                    });
                    if (!res.ok) return text;
                    const data = await res.json();
                    return data[0].map(item => item[0]).join('');
                } catch (e) {
                    console.error("Translation error:", e);
                    return text; // fallback to English
                }
            }

            static async fetchAnalysis() {
                const titleEl = document.getElementById('aiAssessmentTitle');
                const bodyEl = document.getElementById('aiAssessmentBody');
                const modalTextEl = document.getElementById('aiModalText');

                const apiKey = localStorage.getItem('openai_api_key');
                if (!apiKey) {
                    if (modalTextEl) {
                        modalTextEl.innerHTML = `<div style="color: #FF5C5C; text-align: center; margin-top: 20px;">⚠️ Ошибка: API ключ не установлен!<br><br>Нажмите на кнопку «⚙️ API» вверху этого окна, чтобы указать ключ.</div>`;
                    } else {
                        triggerAlert('Сначала укажите API ключ OpenAI', 'error');
                    }
                    return;
                }

                if (!appData || !appData.prob || !appData.levels) {
                    if (titleEl) {
                        titleEl.textContent = '🤖 Baba Vanga AI: Ожидание данных... ⏳';
                        titleEl.style.color = '#888';
                    }
                    if (bodyEl) {
                        bodyEl.innerHTML = '<div style="color: #aaa;">• Рыночные данные еще загружаются...</div>';
                    }
                    if (modalTextEl) {
                        modalTextEl.innerHTML = '<div style="color: #aaa; text-align: center; margin-top: 20px;">Рыночные данные еще загружаются, пожалуйста подождите... ⏳</div>';
                    }
                    return;
                }

                if (titleEl) {
                    titleEl.textContent = '🤖 Baba Vanga AI: Думаю... ⏳';
                    titleEl.style.color = '#FFD700';
                }
                if (bodyEl) {
                    bodyEl.innerHTML = '<div style="color: #aaa;">• Отправка контекста в OpenAI...</div>';
                }
                if (modalTextEl) {
                    modalTextEl.innerHTML = '<div style="color: #FFD700; text-align: center; margin-top: 20px; font-size: 18px;">🤖 Нейросеть анализирует рынок...<br><br><span style="font-size:14px; color:#aaa;">Это может занять 10-20 секунд. Пожалуйста, подождите. ⏳</span></div>';
                }

                try {
                    const sysPrompt = `You are a professional crypto trader and analyst. Analyze the current BTCUSDT market data for timeframe ${currentTF}.
RESPOND STRICTLY IN ENGLISH. Provide a very deep and detailed analysis.
Response format:
VERDICT: [STRICTLY ONE OF THREE WORDS: BULLISH / BEARISH / NEUTRAL] [CONFIDENCE %]
TRADE: Entry: [Price], TP: [Price], SL: [Price]
- [Point 1: Main reason for this verdict]
- [Point 2: Detailed price and levels analysis]
- [Point 3: Indicators and order book]
- [Point 4: Liquidity, sentiment and risks]`;

                    let fibContext = "Fibonacci levels: no data";
                    if (appData.fibData && appData.fibData[currentTF] && appData.fibData[currentTF].levels) {
                        const fl = appData.fibData[currentTF].levels;
                        const fibD = appData.fibData[currentTF];
                        const trendStr = fibD.isUptrend ? 'Uptrend' : 'Downtrend';
                        fibContext = `Fibonacci Levels (${trendStr} - Swing High: $${Math.round(fibD.swingHigh)}, Swing Low: $${Math.round(fibD.swingLow)}):
  - 23.6%: $${Math.round(fl[0.236])}
  - 38.2%: $${Math.round(fl[0.382])}
  - 50.0%: $${Math.round(fl[0.5])}
  - 61.8%: $${Math.round(fl[0.618])}
  - 78.6%: $${Math.round(fl[0.786])}`;
                    }

                    let chartContext = "Price dynamics: no data";
                    if (appData.candles && appData.candles.length >= 10) {
                        const last10 = appData.candles.slice(-10).map(c => Math.round(c.close)).join(', ');
                        chartContext = `Last 10 candle closes (${currentTF}): ${last10}`;
                    }

                    const userData = `Current Price: $${appData.currentPrice}
Trend (ADX/Regime): ${appData.prob.marketRegime} (${appData.prob.adx})
RSI: ${appData.prob.rsi}
Fear & Greed Index: ${appData.fearAndGreed ?? '---'}
Funding Rate: ${appData.fundingRate ? (appData.fundingRate * 100).toFixed(4) : '---'}%
Bids vs Asks Imbalance: ${appData.orderBookImbalance ? appData.orderBookImbalance.toFixed(2) : '---'}
Nearest Resistance: $${appData.levels.resistance || '---'}
Nearest Support: $${appData.levels.support || '---'}

${fibContext}
${chartContext}`;

                    let url = 'https://api.openai.com/v1/chat/completions';
                    let headers = {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    };
                    let body = {
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: sysPrompt },
                            { role: 'user', content: userData }
                        ],
                        temperature: 0.7,
                        max_tokens: 2000
                    };
                    let providerName = 'OpenAI';

                    if (apiKey.startsWith('sk-or-v1-')) {
                        url = 'https://openrouter.ai/api/v1/chat/completions';
                        body.model = 'meta-llama/llama-3.1-8b-instruct:free'; // Бесплатная быстрая модель на OpenRouter
                        headers['HTTP-Referer'] = 'http://localhost';
                        headers['X-Title'] = 'Bitcoin Analyzer PRO';
                        providerName = 'OpenRouter';
                    } else if (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')) {
                        url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
                        headers = { 'Content-Type': 'application/json' };
                        body = {
                            system_instruction: { parts: { text: sysPrompt } },
                            contents: [{ parts: [{ text: userData }] }],
                            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
                        };
                        providerName = 'Gemini';
                    }

                    if (bodyEl) {
                        bodyEl.innerHTML = `<div style="color: #aaa;">• Отправка контекста в ${providerName}...</div>`;
                    }

                    const r = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(body)
                    });

                    if (!r.ok) {
                        const err = await r.json();
                        throw new Error((err.error && err.error.message) || err.message || 'API Error');
                    }

                    const data = await r.json();
                    let text = '';
                    if (providerName === 'Gemini') {
                        text = data.candidates[0].content.parts[0].text.trim();
                    } else {
                        text = data.choices[0].message.content.trim();
                    }

                    if (bodyEl) {
                        bodyEl.innerHTML = `<div style="color: #aaa;">• Перевод текста на русский...</div>`;
                    }
                    if (modalTextEl) {
                        modalTextEl.innerHTML = `<div style="color: #FFD700; text-align: center; margin-top: 20px; font-size: 18px;">🔄 Перевод текста на русский... ⏳</div>`;
                    }
                    const translatedText = await AIAnalyzer.translateToRussian(text);

                    AIAnalyzer.rawText = translatedText; // Сохраняем полный сырой текст для модального окна
                    AIAnalyzer.editedText = null;
                    localStorage.setItem('ai_last_rawText', translatedText);
                    localStorage.setItem('ai_last_run_time', Date.now());
                    updateSidebarBullets(translatedText);

                    if (modalTextEl) {
                        modalTextEl.innerText = translatedText;
                    }

                    this.lastTF = currentTF;

                } catch (e) {
                    if (titleEl) {
                        titleEl.textContent = '🤖 Baba Vanga AI: ОШИБКА';
                        titleEl.style.color = '#FF5C5C';
                    }
                    if (bodyEl) {
                        bodyEl.innerHTML = `<div style="color: #FF5C5C; line-height: 1.2;">• ${e.message}</div>`;
                    }
                    if (modalTextEl) {
                        modalTextEl.innerHTML = `<div style="color: #FF5C5C; text-align: center; margin-top: 20px;">❌ Ошибка: ${e.message}</div>`;
                    }
                }
            }

            static updateState() {
                // Больше не очищаем панель при смене таймфрейма, анализ остается (по просьбе пользователя)
                const titleEl = document.getElementById('aiAssessmentTitle');
                if (titleEl && this.lastTF) {
                    titleEl.textContent = `🤖 Baba Vanga AI (${this.lastTF})`;
                    titleEl.style.color = '#00FF88';
                }
            }
        }
        AIAnalyzer.lastTF = null;

        // ============================================================
        // ЗАПУСК + АВТООБНОВЛЕНИЕ
        // ============================================================
        // AUTO_REFRESH_MS и countdown объявлены в 666BTC2graf.html

        export function updateSidebarBullets (text) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            let verdict = "НЕЙТРАЛЬНО";
            let confidence = "";
            let tradeSetup = "";

            lines.forEach(line => {
                let cleanLine = line.replace(/[*#]/g, '').trim();
                if (cleanLine.length === 0) return;

                if (cleanLine.toUpperCase().includes('ВЕРДИКТ:') || cleanLine.toUpperCase().includes('VERDICT:')) {
                    const vMatch = cleanLine.match(/(?:ВЕРДИКТ|VERDICT):\s*([А-Яа-яA-Za-z]+)(?:.*?(\d+%))?/i);
                    if (vMatch) {
                        let rawV = vMatch[1].toUpperCase();
                        if (rawV.includes('БЫЧ') || rawV.includes('BULL')) verdict = 'БЫЧИЙ';
                        else if (rawV.includes('МЕДВ') || rawV.includes('BEAR') || rawV.includes('ШОРТ')) verdict = 'МЕДВЕЖИЙ';
                        else verdict = 'НЕЙТРАЛЬНО';

                        if (vMatch[2]) confidence = vMatch[2];
                    }
                } else if (cleanLine.toUpperCase().includes('СДЕЛКА:') || cleanLine.toUpperCase().includes('TRADE:') || cleanLine.toUpperCase().includes('ТОРГОВЛЯ:')) {
                    tradeSetup = cleanLine.replace(/(СДЕЛКА:|TRADE:|ТОРГОВЛЯ:)/i, '').trim();
                }
            });

            const bodyEl = document.getElementById('aiAssessmentBody');

            let color = '#FFD700'; // Yellow
            const vUpper = verdict.toUpperCase();
            if (vUpper.includes('БЫЧ') || vUpper.includes('BULL')) color = '#00FF88';
            if (vUpper.includes('МЕДВ') || vUpper.includes('ШОРТ') || vUpper.includes('BEAR')) color = '#FF5C5C';

            if (bodyEl) {
                bodyEl.innerHTML = `<div style="text-align:center; font-size: 20px; font-weight: 900; color: ${color}; margin: 15px 0 5px 0; text-shadow: 0 0 15px ${color}40; font-family: 'Courier New', monospace;">
                    ${verdict} ${confidence ? `<span style="font-size: 16px; opacity: 0.8;">${confidence}</span>` : ''}
                </div>
                ${tradeSetup ? `<div style="text-align:center; font-size: 11px; color: #bbb; margin-bottom: 15px; font-family: 'Courier New', monospace; line-height: 1.4; padding: 0 10px;">Сделка: ${tradeSetup}</div>` : ''}`;
            }
        };

        // AI Modal Handler
        export function openAIModal() {
            const modal = document.getElementById('aiModal');
            const body = document.getElementById('aiModalText');
            if (AIAnalyzer.rawText) {
                body.innerText = AIAnalyzer.editedText || AIAnalyzer.rawText;
            } else {
                body.innerText = "Нет данных. Нажмите «🔄 Запустить» в верхней части этого окна.";
            }
            modal.style.display = 'flex';
        };

        export function saveAIModal() {
            if (!AIAnalyzer.rawText) return;
            const body = document.getElementById('aiModalText');
            AIAnalyzer.editedText = body.innerText;
            updateSidebarBullets(AIAnalyzer.editedText);
            document.getElementById('aiModal').style.display = 'none';
        };

        export function resetAIModal() {
            if (!AIAnalyzer.rawText) return;
            const body = document.getElementById('aiModalText');
            body.innerText = AIAnalyzer.rawText;
            AIAnalyzer.editedText = null;
            updateSidebarBullets(AIAnalyzer.rawText);
        };

        // Инициализация AI при загрузке
        

    // Backtester — global script v2
        export class ForecastTracker {
            static state = {
                vanga: { hits: 0, misses: 0, active: null },
                elliott: { hits: 0, misses: 0, active: null }
            };

            static load() {
                try {
                    const saved = localStorage.getItem('vangaForecastStats');
                    if (saved) this.state = JSON.parse(saved);
                } catch(e) {}
                this.render();
            }

            static save() {
                try { localStorage.setItem('vangaForecastStats', JSON.stringify(this.state)); } catch(e) {}
                this.render();
            }

            static register(type, targetPrice, originPrice, tf) {
                if (!this.state[type].active) {
                    this.state[type].active = { targetPrice, originPrice, tf, timeCreated: Date.now() };
                    this.save();
                }
            }

            static evaluate(currentPrice, tf) {
                let changed = false;
                ['vanga', 'elliott'].forEach(type => {
                    const act = this.state[type].active;
                    if (act && act.tf === tf) {
                        const isUp = act.targetPrice > act.originPrice;
                        const targetHit = isUp ? currentPrice >= act.targetPrice : currentPrice <= act.targetPrice;
                        
                        let stopHit = false;
                        if (type === 'elliott') {
                            stopHit = isUp ? currentPrice < act.originPrice : currentPrice > act.originPrice;
                        } else {
                            stopHit = isUp ? currentPrice < act.originPrice * 0.99 : currentPrice > act.originPrice * 1.01;
                        }

                        if (targetHit) {
                            this.state[type].hits++;
                            this.state[type].active = null;
                            changed = true;
                        } else if (stopHit) {
                            this.state[type].misses++;
                            this.state[type].active = null;
                            changed = true;
                        }
                    }
                });
                if (changed) this.save();
            }

            static render() {
                const el = document.getElementById('forecastStatsUI');
                if (!el) return;
                const vTot = this.state.vanga.hits + this.state.vanga.misses;
                const eTot = this.state.elliott.hits + this.state.elliott.misses;
                const vWin = vTot > 0 ? Math.round(this.state.vanga.hits / vTot * 100) : 0;
                const eWin = eTot > 0 ? Math.round(this.state.elliott.hits / eTot * 100) : 0;
                
                let html = `<div style="font-size:10px; margin-bottom:8px; color:#aaa; text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">📊 Модели прогнозирования (Hit Rate)</div>`;
                html += `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
                            <span style="color:#a64d79;">🔮 Vanga AI:</span>
                            <span style="color:${vWin >= 50 ? '#00FF88' : '#FF006E'}">${vWin}% <span style="color:#666; font-size:10px;">(${this.state.vanga.hits}/${vTot})</span></span>
                         </div>`;
                html += `<div style="display:flex; justify-content:space-between; font-size:12px;">
                            <span style="color:#FFD700;">🌊 Elliott C-Wave:</span>
                            <span style="color:${eWin >= 50 ? '#00FF88' : '#FF006E'}">${eWin}% <span style="color:#666; font-size:10px;">(${this.state.elliott.hits}/${eTot})</span></span>
                         </div>`;
                el.innerHTML = html;
            }
        }

        export class PaperTrader {
            static state = {
                balance: 1000,
                pos: null,
                history: [],
                autoBotEnabled: false
            };

            static currentPrice = 0;

            static load() {
                try {
                    const saved = localStorage.getItem('btcAnalyzerPaperTrader');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        if (parsed.balance !== undefined && parsed.balance !== null) this.state.balance = parsed.balance;
                        if (parsed.pos !== undefined) this.state.pos = parsed.pos;
                        if (parsed.history) this.state.history = parsed.history;
                        if (parsed.autoBotEnabled !== undefined) this.state.autoBotEnabled = parsed.autoBotEnabled;
                        if (parsed.botMode !== undefined) {
                            this.state.botMode = parsed.botMode;
                            const modeSelect = document.getElementById('ptBotMode');
                            if (modeSelect) modeSelect.value = parsed.botMode;
                        }
                    }
                } catch (e) { }
                this.render();
            }

            static save() {
                localStorage.setItem('btcAnalyzerPaperTrader', JSON.stringify(this.state));
                this.render();
            }

            static toggleBot() {
                this.state.autoBotEnabled = !this.state.autoBotEnabled;
                this.save();
                triggerAlert('🤖 Auto-Bot ' + (this.state.autoBotEnabled ? 'ON' : 'OFF'), this.state.autoBotEnabled ? 'success' : 'info');
            }

            static saveMode() {
                this.state.botMode = document.getElementById('ptBotMode').value;
                this.save();
                triggerAlert('⚙️ Bot Mode Changed!', 'info');
            }

            static updatePrice(price) {
                this.currentPrice = price;

                if (!this.state.pos) return;

                const p = this.state.pos;
                const movePct = (price - p.entry) / p.entry * 100 * (p.dir === 'LONG' ? 1 : -1);
                const pnl = p.margin * (movePct / 100) * p.lev;

                const pnlEl = document.getElementById('ptPosPnL');
                if (pnlEl) {
                    pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + ' (' + (movePct * p.lev).toFixed(2) + '%)';
                    pnlEl.style.color = pnl >= 0 ? '#00FF88' : '#FF006E';
                }

                // AI AUTO-BOT POSITION MANAGEMENT (Phase 5 Logic)
                const currentMae = p.dir === 'LONG' ? (p.entry - price) / p.entry * 100 : (price - p.entry) / p.entry * 100;
                const currentMfe = p.dir === 'LONG' ? (price - p.entry) / p.entry * 100 : (p.entry - price) / p.entry * 100;
                
                if (!p.maxMfe || currentMfe > p.maxMfe) p.maxMfe = currentMfe;
                if (!p.maxMae || currentMae > p.maxMae) p.maxMae = currentMae;

                if (this.state.autoBotEnabled) {
                    let stratTP = 1.25, stratSL = 1.5, stratTrail = 0.75;
                    if (currentTF === '15m') { stratTP = 0.75; stratSL = 1.0; stratTrail = 0.35; }
                    else if (currentTF === '1h') { stratTP = 1.5; stratSL = 1.5; stratTrail = 0.75; }
                    else if (currentTF === '4h') { stratTP = 3.0; stratSL = 1.5; stratTrail = 0.75; }
                    else if (currentTF === '1d') { stratTP = 10.0; stratSL = 5.0; stratTrail = 2.5; }

                    const tpLimit = parseFloat(document.getElementById('ptTP')?.value) || stratTP;
                    const slLimit = parseFloat(document.getElementById('ptSL')?.value) || stratSL;
                    
                    // Dynamic Stop Level Tracking
                    if (p.dynamicStopLevel === undefined) p.dynamicStopLevel = -slLimit;

                    const prevStopLevel = p.dynamicStopLevel;
                    if (currentTF === '1d') {
                        if (currentMfe >= 7.5) p.dynamicStopLevel = Math.max(p.dynamicStopLevel, 5.0);
                        else if (currentMfe >= 5.0) p.dynamicStopLevel = Math.max(p.dynamicStopLevel, 2.5);
                        else if (currentMfe >= stratTrail) p.dynamicStopLevel = Math.max(p.dynamicStopLevel, 0);
                    } else {
                        if (currentMfe >= stratTrail) p.dynamicStopLevel = Math.max(p.dynamicStopLevel, 0);
                    }
                    // BUG #4 fix: save only when stop level actually ratcheted up
                    if (p.dynamicStopLevel !== prevStopLevel) this.save();
                    
                    // 1. Take Profit
                    if (currentMfe >= tpLimit) {
                        this.closePos(`🤖 Take Profit ${tpLimit}%`, price);
                        triggerAlert('🤖 AutoBot: Тейк Профит достигнут!', 'success');
                        return;
                    }
                    
                    // 2. Trailing Stop / Stop Loss (0.15% buffer to avoid micro-noise exits)
                    const trailBuffer = p.dynamicStopLevel > 0 ? 0.15 : 0;
                    if (currentMae >= -p.dynamicStopLevel + trailBuffer) {
                        const isWin = p.dynamicStopLevel >= 0;
                        const reason = isWin ? `🤖 Trailing Stop +${p.dynamicStopLevel}%` : `🤖 Stop Loss -${slLimit}%`;
                        this.closePos(reason, price);
                        triggerAlert(`🤖 AutoBot: Выход (${reason})`, isWin ? 'info' : 'error');
                        return;
                    }
                }
            }

            static openPos(dir, botMode = 'manual') {
                if (this.state.pos) return triggerAlert('Position already open!', 'error');
                if (!this.currentPrice) return triggerAlert('Waiting for price...', 'error');

                const elLev = document.getElementById('ptLeverage');
                const lev = elLev ? parseInt(elLev.value) || 5 : 5; // Default to 5x leverage for AutoBot
                const elMargin = document.getElementById('ptMarginPct');
                const marginPct = elMargin ? parseFloat(elMargin.value) || 100 : 100;

                const margin = this.state.balance * (marginPct / 100);
                if (margin <= 0) return triggerAlert('Balance is zero!', 'error');

                this.state.pos = {
                    dir, entry: this.currentPrice, margin: margin, lev: lev, time: Date.now(), botMode
                };
                this.save();
            }

            static closePos(reason = 'Manual', price = null) {
                if (!this.state.pos) return;
                const exit = price || this.currentPrice;
                const p = this.state.pos;
                const movePct = (exit - p.entry) / p.entry * 100 * (p.dir === 'LONG' ? 1 : -1);
                const pnl = p.margin * (movePct / 100) * p.lev;

                this.state.balance += pnl;
                
                // Инициализация статистики если ее нет
                if (!this.state.stats) {
                    this.state.stats = { sniper: { wins: 0, losses: 0, pnl: 0 }, elliott: { wins: 0, losses: 0, pnl: 0 }, degen: { wins: 0, losses: 0, pnl: 0 }, manual: { wins: 0, losses: 0, pnl: 0 } };
                }
                
                const mode = p.botMode || 'manual';
                if (!this.state.stats[mode]) this.state.stats[mode] = { wins: 0, losses: 0, pnl: 0 };
                
                if (pnl > 0) this.state.stats[mode].wins++;
                else this.state.stats[mode].losses++;
                this.state.stats[mode].pnl += pnl;

                this.state.history.push({
                    dir: p.dir, entry: p.entry, exit, pnl, movePct: movePct * p.lev, lev: p.lev, margin: p.margin, reason, date: new Date().toISOString(), botMode: mode,
                    score: p.score, ctx: p.ctx, maxMfe: p.maxMfe || 0, maxMae: p.maxMae || 0
                });
                this.state.pos = null;
                this.save();
            }

            static render() {
                const balEl = document.getElementById('ptBalance');
                if (balEl) balEl.textContent = '$' + this.state.balance.toFixed(2);

                const ctrl = document.getElementById('ptControls');
                const active = document.getElementById('ptActivePosition');
                const params = document.getElementById('ptParams');
                const riskParams = document.getElementById('ptRiskParams');

                if (this.state.pos) {
                    if (ctrl) ctrl.style.display = 'none';
                    if (params) params.style.display = 'none';
                    if (riskParams) riskParams.style.display = 'none';
                    if (active) active.style.display = 'block';
                    const badge = document.getElementById('ptPosBadge');
                    if (badge) {
                        badge.textContent = this.state.pos.dir;
                        badge.style.color = this.state.pos.dir === 'LONG' ? '#00FF88' : '#FF006E';
                        badge.style.background = this.state.pos.dir === 'LONG' ? 'rgba(0,255,136,0.12)' : 'rgba(255,0,110,0.12)';
                    }
                    const entryEl = document.getElementById('ptPosEntry');
                    if (entryEl) entryEl.textContent = this.state.pos.entry.toFixed(1);
                    const marginEl = document.getElementById('ptPosMargin');
                    if (marginEl) marginEl.textContent = this.state.pos.margin.toFixed(1);
                    const levEl = document.getElementById('ptPosLev');
                    if (levEl) levEl.textContent = this.state.pos.lev + 'x';
                } else {
                    if (ctrl) ctrl.style.display = 'block';
                    if (params) params.style.display = 'flex';
                    if (riskParams) riskParams.style.display = 'flex';
                    if (active) active.style.display = 'none';
                }

                // Auto-Bot UI update
                const botToggle = document.getElementById('ptAutoBotToggle');
                const botSlider = document.getElementById('ptAutoBotSlider');
                const botKnob = document.getElementById('ptAutoBotKnob');
                if (botToggle) {
                    botToggle.checked = this.state.autoBotEnabled;
                    if (this.state.autoBotEnabled) {
                        if (botSlider) botSlider.style.backgroundColor = '#00FF88';
                        if (botKnob) botKnob.style.transform = 'translateX(14px)';
                    } else {
                        if (botSlider) botSlider.style.backgroundColor = '#333';
                        if (botKnob) botKnob.style.transform = 'translateX(0)';
                    }
                }

                // Populate History list
                const histList = document.getElementById('ptHistoryList');
                if (histList) {
                    const h = this.state.history || [];
                    
                    // Render Trade Strategy Stats
                    const stats = this.state.stats || { sniper: { wins: 0, losses: 0, pnl: 0 }, elliott: { wins: 0, losses: 0, pnl: 0 } };
                    const snTot = stats.sniper.wins + stats.sniper.losses;
                    const elTot = stats.elliott.wins + stats.elliott.losses;
                    const snWin = snTot > 0 ? Math.round(stats.sniper.wins / snTot * 100) : 0;
                    const elWin = elTot > 0 ? Math.round(stats.elliott.wins / elTot * 100) : 0;
                    
                    let statsHtml = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                                        '<div style="font-size:10px; color:#aaa; text-transform:uppercase; font-weight:bold;">🔥 Trade Efficiency</div>' +
                                        '<div>' +
                                            '<button onclick="PaperTrader.exportCSV()" style="background:transparent; border:1px solid #444; color:#aaa; padding:2px 5px; margin-right:4px; font-size:10px; cursor:pointer; border-radius:3px;">CSV</button>' +
                                            '<button onclick="PaperTrader.exportJSON()" style="background:transparent; border:1px solid #444; color:#aaa; padding:2px 5px; margin-right:4px; font-size:10px; cursor:pointer; border-radius:3px;">JSON</button>' +
                                            '<button onclick="PaperTrader.copyForAI()" style="background:rgba(187,134,252,0.1); border:1px solid #BB86FC; color:#BB86FC; padding:2px 5px; font-size:10px; cursor:pointer; border-radius:3px;">AI Prompt</button>' +
                                        '</div>' +
                                     '</div>';
                    statsHtml += `<div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;">
                                    <span>🎯 Sniper (Indicators):</span>
                                    <span style="color:${snWin >= 50 ? '#00FF88' : '#FF006E'}">${snWin}% <span style="color:#666">(${stats.sniper.wins}/${snTot})</span> [${stats.sniper.pnl >= 0 ? '+' : ''}$${Math.round(stats.sniper.pnl)}]</span>
                                  </div>`;
                    statsHtml += `<div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;">
                                    <span>🌊 Elliott (Waves):</span>
                                    <span style="color:${elWin >= 50 ? '#00FF88' : '#FF006E'}">${elWin}% <span style="color:#666">(${stats.elliott.wins}/${elTot})</span> [${stats.elliott.pnl >= 0 ? '+' : ''}$${Math.round(stats.elliott.pnl)}]</span>
                                  </div>`;

                    if (h.length === 0) {
                        histList.innerHTML = statsHtml + '<div style="color:#666; text-align:center; padding:10px 0;">No trades yet</div>';
                    } else {
                        const lastTrades = h.slice().reverse().slice(0, 15);
                        histList.innerHTML = statsHtml + lastTrades.map(t => {
                            const dateStr = new Date(t.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                            const pnlColor = t.pnl >= 0 ? '#00FF88' : '#FF006E';
                            const sign = t.pnl >= 0 ? '+' : '';
                            const modeIcon = t.botMode === 'sniper' ? '🎯' : (t.botMode === 'elliott' ? '🌊' : '🤖');
                            return `<div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:3px; margin-bottom:3px; font-size:11px;">
                                <span>${dateStr} ${modeIcon} <strong style="color:${t.dir === 'LONG' ? '#00FF88' : '#FF006E'}">${t.dir}</strong> (${t.lev}x)</span>
                                <span style="color:${pnlColor}; font-weight:bold;">${sign}$${t.pnl.toFixed(2)} (${t.movePct >= 0 ? '+' : ''}${t.movePct.toFixed(1)}%)</span>
                            </div>`;
                        }).join('');
                    }
                }
            }

            static showStats() {
                const h = this.state.history;
                const wins = h.filter(x => x.pnl > 0).length;
                const total = h.length;
                const wr = total > 0 ? (wins / total * 100).toFixed(1) : 0;
                const profit = h.reduce((s, x) => s + x.pnl, 0);

                let msg = '📊 PAPER TRADING STATS (MARKET ENTRY)\n';
                msg += '==============================\n';
                msg += 'Current balance: $' + this.state.balance.toFixed(2) + '\n';
                msg += 'Total trades: ' + total + '\n';
                msg += 'Win Rate: ' + wr + '%\n';
                msg += 'Net Profit: $' + profit.toFixed(2) + '\n';
                triggerAlert(msg, 'info');
            }

            static toggleHistory() {
                const panel = document.getElementById('ptHistoryPanel');
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                }
            }

            static clearHistory() {
                if (confirm('Clear paper trading history?')) {
                    this.state.history = [];
                    this.state.balance = 1000;
                    this.state.stats = { sniper: { wins: 0, losses: 0, pnl: 0 }, elliott: { wins: 0, losses: 0, pnl: 0 }, degen: { wins: 0, losses: 0, pnl: 0 }, manual: { wins: 0, losses: 0, pnl: 0 } };
                    this.save();
                }
            }

            static copyForAI() {
                const h = this.state.history || [];
                if (h.length === 0) return triggerAlert('No live trades to analyze.', 'error');
                
                const total = h.length;
                const wins = h.filter(x => x.pnl > 0).length;
                const wr = (wins / total * 100).toFixed(1);
                
                // Get up to the last 50 trades (both wins and losses)
                const tradesToAnalyze = h.slice(-50);
                                
                const totalProfit = h.reduce((s, x) => s + x.pnl, 0);
                
                const tradeRows = tradesToAnalyze.map(x => {
                    const ctx = x.ctx || {};
                    const dateStr = new Date(x.date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    return dateStr + '|' + x.dir + '|Mode:' + x.botMode + '|Score:' + (x.score || '?') + '%|ADX:' + (ctx.adx||'?') + '(' + (ctx.adxDir||'?') + ')|DI-spread:' + (ctx.diSpread||'?') + '|+DI:' + (ctx.plusDI||'?') + '/-DI:' + (ctx.minusDI||'?') + '|K:' + (ctx.stochK||'?') + ' D:' + (ctx.stochD||'?') + '|K>D:' + (ctx.kAboveD||'?') + '|RSI:' + (ctx.rsi||'?') + '|' + (ctx.regime||'?') + '|' + (ctx.candlePattern||'?') + '|Session:' + (ctx.session||'?') + '|MFE:' + (x.maxMfe||0).toFixed(2) + '%|Entry:' + x.entry.toFixed(1) + '->Exit:' + x.exit.toFixed(1) + '|PnL:$' + x.pnl.toFixed(2);
                }).join('\n');

                const regStat = {};
                const zoneStat = { '<20': { t: 0, w: 0 }, '20-80': { t: 0, w: 0 }, '>80': { t: 0, w: 0 } };
                
                h.forEach(x => {
                    const r = x.ctx?.regime || 'UNKNOWN';
                    if (!regStat[r]) regStat[r] = { t: 0, w: 0 };
                    regStat[r].t++;
                    if (x.pnl > 0) regStat[r].w++;
                    
                    const k = x.ctx?.stochK;
                    if (k !== undefined && k !== null) {
                        const z = k < 20 ? '<20' : k > 80 ? '>80' : '20-80';
                        zoneStat[z].t++;
                        if (x.pnl > 0) zoneStat[z].w++;
                    }
                });

                const regStr = Object.entries(regStat).map(([k, v]) => k + ': ' + v.w + '/' + v.t + ' wins (' + (v.w / v.t * 100).toFixed(0) + '%)').join('\n');
                const zoneStr = Object.entries(zoneStat).map(([z, v]) => 'StochK ' + z + ': ' + v.w + '/' + v.t + ' wins (' + (v.t > 0 ? (v.w / v.t * 100).toFixed(0) : 0) + '%)').join('\n');

                let prompt = 'You are an expert in algorithmic Bitcoin trading. Analyze the LIVE AUTOBOT TRADING results below. Compare winning and losing trades to find patterns that cause losses or lead to wins.\n\n';
                prompt += '=== SYSTEM PARAMETERS ===\nSource: LIVE PAPER TRADING (AutoBot)\nLogic: Dynamic exit (Hard TP, SL, Trailing Breakeven)\n\n';
                prompt += '=== OVERALL STATISTICS ===\nTotal live trades: ' + total + '\nWins: ' + wins + ' (' + wr + '%)\nNet Profit: $' + totalProfit.toFixed(2) + '\n\n';
                prompt += '=== WIN RATE BY MARKET REGIME ===\n' + regStr + '\n\n';
                prompt += '=== WIN RATE BY STOCHRSI ZONE ===\n' + zoneStr + '\n\n';
                prompt += '=== DETAILED TRADE LOG (LIVE) ===\n' + tradeRows;

                navigator.clipboard.writeText(prompt).then(() => {
                    triggerAlert('🤖 AutoBot AI Prompt copied to clipboard!', 'success');
                }).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = prompt;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    triggerAlert('Prompt copied manually!', 'success');
                });
            }

            static exportJSON() {
                const h = this.state.history || [];
                if (h.length === 0) return triggerAlert('No live trades to export.', 'error');
                
                const blob = new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'autobot_live_trades_' + new Date().toISOString().slice(0, 10) + '.json';
                a.click();
            }

            static exportCSV() {
                const h = this.state.history || [];
                if (h.length === 0) return triggerAlert('No live trades to export.', 'error');

                const hdr = 'date,mode,dir,score,entry,exit,pnl_usd,ret%,mfe%,mae%,adx,adxDir,diSpread,plusDI,minusDI,stochK,stochD,kAboveD,rsi,regime,candlePattern,session';
                const lines = h.map(x => {
                    const ctx = x.ctx || {};
                    return [
                        new Date(x.date).toISOString(), x.botMode, x.dir, x.score, x.entry, x.exit, x.pnl.toFixed(2), x.movePct.toFixed(2),
                        (x.maxMfe||0).toFixed(2), (x.maxMae||0).toFixed(2),
                        ctx.adx, ctx.adxDir, ctx.diSpread, ctx.plusDI, ctx.minusDI,
                        ctx.stochK, ctx.stochD, ctx.kAboveD ? 1 : 0, ctx.rsi, ctx.regime,
                        ctx.candlePattern, ctx.session
                    ].join(',');
                });

                const blob = new Blob([[hdr, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'autobot_live_trades_' + new Date().toISOString().slice(0, 10) + '.csv';
                a.click();
            }
        }



        // BacktesterUI → backtester-ui.js (Web Worker)


        export function openBacktestModal() {
            const m = document.getElementById('btModal');
            const l = document.getElementById('btLog');
            if (m) m.style.display = 'flex';
            if (l && l.textContent.trim() === '') l.textContent = '⏳ Click ▶ Run to start...';
            if (BacktesterUI.lastResults) {
                ['btBtnCSV', 'btBtnJSON', 'btBtnAI'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'inline-block';
                });
            }
        }
    


