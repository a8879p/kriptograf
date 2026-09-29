import { appData, currentTF, showElliott, showVanga } from './state.js';
import { NetworkManager } from './api.js';
import { FibonacciEngine, MarketDataProcessor } from './indicators.js';
import { fmtP } from './ui-utils.js';

export const CycleChart = (() => {
    const PAD = { top: 40, right: 80, bottom: 52, left: 60 };
    let candles = [], ctx = null, canvas = null, cw = 0, ch = 0, mx = null, my = null;

    const ema = (data, period) => {
        const k = 2 / (period + 1), r = new Array(data.length).fill(null);
        let s = 0, c = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] === null) continue;
            if (c < period) { s += data[i]; c++; if (c === period) r[i] = s / period; }
            else r[i] = data[i] * k + r[i - 1] * (1 - k);
        }
        return r;
    };

    const fp = p => p >= 1000 ? '$' + (p / 1000).toFixed(1) + 'k' : '$' + p.toFixed(0);
    const fd = ts => new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' });

    function draw() {
        if (!candles.length) return;
        cw = canvas.width; ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#080c1e'; ctx.fillRect(0, 0, cw, ch);

        const L = PAD.left + 8, R = cw - PAD.right, T = PAD.top, B = ch - PAD.bottom;
        const CW = R - L, CH = B - T;
        const prices = candles.flatMap(c => [c.high, c.low]);
        const maxP = Math.max(...prices) * 1.015;
        const minP = 0; // Шкала от 0
        const PR = maxP - minP;
        const px = p => T + CH * (1 - (p - minP) / PR);
        const barW = CW / candles.length;
        const xOf = i => L + i * barW + barW / 2;
        const cndW = Math.max(1, barW * 0.65);

        // ── Правая ось цены — фоновая панель ──
        ctx.fillStyle = 'rgba(8,12,30,0.92)';
        ctx.fillRect(R, T, cw - R, CH);

        // ── Правая ось цены — горизонтальные уровни + подписи ──
        const priceSteps = 8;
        for (let i = 0; i <= priceSteps; i++) {
            const p = minP + PR * (i / priceSteps), y = px(p);
            // Grid line
            ctx.strokeStyle = 'rgba(0,255,200,0.07)'; ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
            // Tick mark
            ctx.strokeStyle = 'rgba(0,255,200,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(R, y); ctx.lineTo(R + 4, y); ctx.stroke();
            // Price label — hover highlight
            const isHov = mx !== null && Math.abs(my - y) < 14;
            if (isHov) {
                ctx.fillStyle = '#FFF'; ctx.font = 'bold 13px "Courier New"';
                ctx.shadowColor = '#00FFC8'; ctx.shadowBlur = 10;
            } else {
                ctx.fillStyle = 'rgba(0,255,200,0.55)'; ctx.font = '13px "Courier New"';
                ctx.shadowBlur = 0;
            }
            ctx.textAlign = 'left';
            ctx.fillText(fp(p), R + 8, y + 4);
            ctx.shadowBlur = 0;
        }

        // ── Нижняя ось времени — фоновая панель ──
        ctx.fillStyle = 'rgba(8,12,30,0.92)';
        ctx.fillRect(L, B, CW, ch - B);

        // ── Нижняя ось времени — вертикальные метки (Только Основные Пики и Падения) ──
        const LOOKBACK = 45; // Увеличенный период (3 месяца), чтобы отсечь мелкий шум
        let pivots = [];
        for (let i = LOOKBACK; i < candles.length - LOOKBACK; i++) {
            let isHi = true, isLo = true;
            for (let j = i - LOOKBACK; j <= i + LOOKBACK; j++) {
                if (j === i) continue;
                if (candles[j].high > candles[i].high) isHi = false;
                if (candles[j].low < candles[i].low) isLo = false;
            }
            if (isHi || isLo) pivots.push(i);
        }
        pivots.push(candles.length - 1); // Всегда показываем текущий день

        let lastLabelX = -100;
        for (let i of pivots) {
            const x = xOf(i);
            // Защита от наложения текста (если слишком близко к предыдущему)
            if (i !== candles.length - 1 && x - lastLabelX < 45) continue;
            lastLabelX = x;

            // Grid line
            ctx.strokeStyle = 'rgba(0,255,200,0.05)'; ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
            // Tick mark
            ctx.strokeStyle = 'rgba(0,255,200,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, B); ctx.lineTo(x, B + 4); ctx.stroke();
            // Date label — hover highlight
            const isHov = mx !== null && Math.abs(mx - x) < barW * 2;
            if (isHov) {
                ctx.fillStyle = '#FFF'; ctx.font = 'bold 12px "Courier New"';
                ctx.shadowColor = '#00FFC8'; ctx.shadowBlur = 10;
            } else {
                ctx.fillStyle = 'rgba(0,255,200,0.6)'; ctx.font = '12px "Courier New"';
                ctx.shadowBlur = 0;
            }
            const d = new Date(candles[i].time);
            ctx.textAlign = 'center';
            ctx.fillText(d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), x, B + 16);
            ctx.shadowBlur = 0;
        }

        // EMA 200
        const e200 = ema(candles.map(c => c.close), 200);
        ctx.beginPath(); ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 1.8; ctx.setLineDash([]);
        let s = false;
        for (let i = 0; i < candles.length; i++) {
            if (!e200[i]) continue;
            const x = xOf(i), y = px(e200[i]);
            if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // EMA 50
        const e50 = ema(candles.map(c => c.close), 50);
        ctx.beginPath(); ctx.strokeStyle = '#00D9FF'; ctx.lineWidth = 1.2; s = false;
        for (let i = 0; i < candles.length; i++) {
            if (!e50[i]) continue;
            const x = xOf(i), y = px(e50[i]);
            if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Zone fills (цвет шкалы на графике) и Левая шкала
        ctx.setLineDash([]);
        const y666 = Math.max(T, Math.min(B, px(66600)));
        const y97 = Math.max(T, Math.min(B, px(97000)));
        const y24 = Math.max(T, Math.min(B, px(24300))); // Нижняя граница зоны скидки
        const lastX = xOf(candles.length - 1);
        const fillW = lastX - L; // От шкалы до сегодняшнего дня

        // Левая шкала - Отрисовка цветных столбиков
        // Красная зона (97k+)
        if (y97 > T) {
            let gScale = ctx.createLinearGradient(0, T, 0, y97);
            gScale.addColorStop(0, '#FF006E'); gScale.addColorStop(1, '#FF4081');
            ctx.fillStyle = gScale;
            ctx.fillRect(10, T, 12, y97 - T);
        }
        // Желтая зона (66.6k - 97k)
        if (y97 < B && y666 > T) {
            let gScale = ctx.createLinearGradient(0, y97, 0, y666);
            gScale.addColorStop(0, '#FFD700'); gScale.addColorStop(1, '#FFA500');
            ctx.fillStyle = gScale;
            ctx.fillRect(10, y97, 12, y666 - y97);
        }
        // Зеленая зона (24.3k - 66.6k)
        if (y666 < B && y24 > T) {
            let gScale = ctx.createLinearGradient(0, y666, 0, y24);
            gScale.addColorStop(0, '#00FFC8'); gScale.addColorStop(1, '#00FF88');
            ctx.fillStyle = gScale;
            ctx.fillRect(10, y666, 12, y24 - y666);
        }

        // Подложка шкалы ниже 24.3k (пустая шкала до 0)
        if (y24 < B) {
            ctx.strokeStyle = 'rgba(0,255,200,0.1)';
            ctx.strokeRect(10, y24, 12, B - y24);
        }

        // Подписи на левой шкале
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px "Courier New"';
        ctx.textAlign = 'left';
        ctx.fillText('ATH', 28, T + 8);
        ctx.fillText('$97k', 28, y97 + 4);
        ctx.fillText('$66k', 28, y666 + 4);
        ctx.fillText('$24.3k', 28, y24 + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('$0', 28, B);

        // Кнопка-подсказка над шкалой
        ctx.fillStyle = (mx !== null && mx < PAD.left && my < T) ? '#00FFC8' : '#aaa';
        ctx.font = 'bold 10px "Courier New"';
        ctx.textAlign = 'left';
        ctx.fillText('[?] ИНФО', 8, T - 15);

        // Указатель текущей цены (стрелочка)
        const currentPrice = candles[candles.length - 1].close;
        const curY = Math.max(T, Math.min(B, px(currentPrice)));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(25, curY); // Острие стрелки указывает влево на шкалу
        ctx.lineTo(33, curY - 5);
        ctx.lineTo(33, curY + 5);
        ctx.fill();

        // --- Проекция заливки на сам график ---

        // 24.3k to 66.6k (Green)
        if (y666 < B && y24 > T) {
            let grad = ctx.createLinearGradient(0, y666, 0, y24);
            grad.addColorStop(0, 'rgba(0,255,136,0.15)');
            grad.addColorStop(1, 'rgba(0,255,136,0.05)');
            ctx.fillStyle = grad;
            ctx.fillRect(L, y666, fillW, y24 - y666);
        }
        // 66600 to 97000 (Yellow/Orange)
        if (y97 < B && y666 > T) {
            let grad = ctx.createLinearGradient(0, y97, 0, y666);
            grad.addColorStop(0, 'rgba(255,215,0,0.15)');
            grad.addColorStop(1, 'rgba(255,165,0,0.15)');
            ctx.fillStyle = grad;
            ctx.fillRect(L, y97, fillW, y666 - y97);
        }
        // 97000 to max (Red/Pink)
        if (y97 > T) {
            let grad = ctx.createLinearGradient(0, T, 0, y97);
            grad.addColorStop(0, 'rgba(255,0,110,0.2)');
            grad.addColorStop(1, 'rgba(255,64,129,0.1)');
            ctx.fillStyle = grad;
            ctx.fillRect(L, T, fillW, y97 - T);
        }

        // 666 Line
        if (y666 > T && y666 < B) {
            ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,0,110,0.8)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(L, y666); ctx.lineTo(R, y666); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,0,110,0.9)'; ctx.font = 'bold 10px "Courier New"'; ctx.textAlign = 'right';
            ctx.fillText('$66,600 ━ 666 LINE', R - 4, y666 - 4);
        }
        // 97k Line
        if (y97 > T && y97 < B) {
            ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,215,0,0.8)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(L, y97); ctx.lineTo(R, y97); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,215,0,0.9)'; ctx.font = 'bold 10px "Courier New"'; ctx.textAlign = 'right';
            ctx.fillText('$97,000 ━ РАСПРЕДЕЛЕНИЕ', R - 4, y97 - 4);
        }

        // Candles
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i], x = xOf(i);
            const col = c.close >= c.open ? '#00FF88' : '#FF006E';
            ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x, px(c.high)); ctx.lineTo(x, px(c.low)); ctx.stroke();
            const bT = Math.min(px(c.open), px(c.close)), bH = Math.max(1, Math.abs(px(c.open) - px(c.close)));
            ctx.fillStyle = col; ctx.fillRect(x - cndW / 2, bT, cndW, bH);
        }

        // ATH dot
        let ai = 0, av = 0;
        for (let i = 0; i < candles.length; i++) if (candles[i].high > av) { av = candles[i].high; ai = i; }
        const ax = xOf(ai), ay = px(candles[ai].high);
        ctx.fillStyle = '#00FF88'; ctx.beginPath(); ctx.arc(ax, ay - 6, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,255,136,0.95)'; ctx.font = 'bold 10px "Courier New"'; ctx.textAlign = 'center';
        ctx.fillText('ATH ' + fp(av), ax, ay - 16);

        // Bottom axis
        ctx.strokeStyle = 'rgba(0,255,200,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(R, B); ctx.stroke();

        // ══════════════════════════════════════════════
        // FIBONACCI RETRACEMENT — автоматический расчёт
        // Swing High / Low по всему циклу 2023–сейчас
        // ══════════════════════════════════════════════
        (function drawFib() {
            // ── Цвета и описания уровней ──
            const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
            const FIB_COLORS = {
                0: '#888888',
                0.236: '#FF6B6B',
                0.382: '#FFA94D',
                0.5: '#FFD700',
                0.618: '#51CF66',
                0.786: '#339AF0',
                1: '#888888',
                1.272: '#CC77FF',
                1.618: '#FF44AA'
            };
            const FIB_DESC = {
                0.236: 'Слабость',
                0.382: 'Зеркальный уровень',
                0.5: 'Экватор',
                0.618: 'Золотой карман',
                0.786: 'Глубокая коррекция',
                1.272: 'Расширение 127',
                1.618: 'Золотое расширение'
            };

            // ── Поиск Swing High / Low ──
            // Используем pivot-окно 10 свечей — оптимально для дневного цикла
            const LOOKBACK = 10;
            let shVal = -Infinity, shIdx = 0;
            let slVal = Infinity, slIdx = 0;

            // Pivot-поиск
            for (let i = LOOKBACK; i < candles.length - LOOKBACK; i++) {
                let isHi = true, isLo = true;
                for (let j = i - LOOKBACK; j <= i + LOOKBACK; j++) {
                    if (j === i) continue;
                    if (candles[j].high >= candles[i].high) isHi = false;
                    if (candles[j].low <= candles[i].low) isLo = false;
                }
                if (isHi && candles[i].high >= shVal) { shVal = candles[i].high; shIdx = i; }
                if (isLo && candles[i].low <= slVal) { slVal = candles[i].low; slIdx = i; }
            }

            // Гарантируем абсолютные экстремумы цикла
            for (let i = 0; i < candles.length; i++) {
                if (candles[i].high >= shVal) { shVal = candles[i].high; shIdx = i; }
                if (candles[i].low <= slVal) { slVal = candles[i].low; slIdx = i; }
            }

            const range = shVal - slVal;
            if (range <= 0) return;

            // Направление тренда: Low раньше High → аптренд (ретрейс вниз от High)
            const isUp = slIdx <= shIdx;

            // ── Строим уровни ──
            // Ретрейсы (r ≤ 1) — внутри диапазона свинга.
            // Расширения (r > 1: 1.272 / 1.618) — ПРОДОЛЖЕНИЕ движения за экстремумом,
            // т.е. в аптренде ВЫШЕ Swing High, в даунтренде НИЖЕ Swing Low.
            // Старая формула (sh - range*r) уводила расширения ниже Swing Low — это ошибка.
            const levels = {};
            FIB_RATIOS.forEach(r => {
                if (r <= 1) {
                    levels[r] = isUp ? shVal - range * r : slVal + range * r;
                } else {
                    levels[r] = isUp ? shVal + range * (r - 1) : slVal - range * (r - 1);
                }
            });

            // ── Рисуем линии и подписи ──
            FIB_RATIOS.forEach(r => {
                const price = levels[r];
                const y = px(price);
                if (y < T - 2 || y > B + 2) return;

                const color = FIB_COLORS[r];
                const isAnchor = (r === 0 || r === 1);
                const isGolden = (r === 0.618);
                const isExt = (r === 1.272 || r === 1.618);

                // Линия
                ctx.setLineDash(isAnchor ? [] : (isExt ? [3, 5] : [6, 4]));
                ctx.strokeStyle = isAnchor ? color + '44' : (isGolden ? color : color + (isExt ? '77' : '99'));
                ctx.lineWidth = isGolden ? 1.8 : (isAnchor ? 1 : (isExt ? 0.8 : 1.1));
                ctx.beginPath();
                ctx.moveTo(L, y);
                ctx.lineTo(R, y);
                ctx.stroke();
                ctx.setLineDash([]);

                if (isAnchor) return; // якоря — без подписей

                // Левая подпись — текстовое описание
                const desc = FIB_DESC[r] || '';
                ctx.fillStyle = color;
                ctx.font = isGolden ? 'bold 9px "Courier New"' : '9px "Courier New"';
                ctx.textAlign = 'left';
                ctx.fillText(desc, L + 4, y - 4);

                // Правая внутренняя подпись — процент
                ctx.textAlign = 'right';
                ctx.fillStyle = color;
                ctx.font = '9px "Courier New"';
                ctx.fillText((r * 100).toFixed(1) + '%', R - 4, y - 4);

                // Правая ось — цена (с hover-подсветкой)
                const isHov = mx !== null && Math.abs(my - y) < 14;
                ctx.textAlign = 'left';
                if (isHov) {
                    ctx.fillStyle = '#FFF';
                    ctx.font = 'bold 11px "Courier New"';
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 10;
                    // Бейдж на оси
                    ctx.fillStyle = color + '33';
                    ctx.fillRect(R, y - 10, cw - R - 2, 20);
                    ctx.fillStyle = '#FFF';
                } else {
                    ctx.fillStyle = color + 'CC';
                    ctx.font = '10px "Courier New"';
                    ctx.shadowBlur = 0;
                }
                ctx.fillText(fp(price), R + 8, y + 4);
                ctx.shadowBlur = 0;
            });

            // ── Маркеры якорей SH / SL ──
            const sHy = px(shVal);
            const sLy = px(slVal);
            ctx.font = 'bold 10px "Courier New"';
            ctx.setLineDash([]);

            if (sHy >= T && sHy <= B) {
                // Треугольник вниз
                ctx.fillStyle = '#FF6B6B';
                ctx.beginPath();
                ctx.moveTo(xOf(shIdx) - 6, sHy - 14);
                ctx.lineTo(xOf(shIdx) + 6, sHy - 14);
                ctx.lineTo(xOf(shIdx), sHy - 6);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#FF6B6B';
                ctx.textAlign = 'center';
                ctx.fillText('SH', xOf(shIdx), sHy - 17);
            }

            if (sLy >= T && sLy <= B) {
                // Треугольник вверх
                ctx.fillStyle = '#51CF66';
                ctx.beginPath();
                ctx.moveTo(xOf(slIdx) - 6, sLy + 14);
                ctx.lineTo(xOf(slIdx) + 6, sLy + 14);
                ctx.lineTo(xOf(slIdx), sLy + 6);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#51CF66';
                ctx.textAlign = 'center';
                ctx.fillText('SL', xOf(slIdx), sLy + 24);
            }
        })();

        // ── Последняя цена — бейдж на правой оси ──
        const lastClose = candles[candles.length - 1].close;
        const lastY = px(lastClose);
        // Горизонтальная пунктирная линия
        ctx.strokeStyle = 'rgba(0,255,136,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(L, lastY); ctx.lineTo(R, lastY); ctx.stroke();
        ctx.setLineDash([]);
        // Бейдж фон
        ctx.fillStyle = 'rgba(0,255,136,0.18)';
        ctx.fillRect(R, lastY - 11, cw - R - 2, 22);
        // Текст последней цены
        ctx.fillStyle = '#00FF88'; ctx.font = 'bold 13px "Courier New"'; ctx.textAlign = 'left';
        ctx.shadowColor = '#00FF88'; ctx.shadowBlur = 6;
        ctx.fillText(fp(lastClose), R + 8, lastY + 4);
        ctx.shadowBlur = 0;

        // ── Crosshair + живые подписи на осях ──
        if (mx !== null && my !== null && mx > L && mx < R && my > T && my < B) {
            const idx = Math.min(candles.length - 1, Math.max(0, Math.floor((mx - L) / barW)));
            const c = candles[idx], cx2 = xOf(idx);

            // Вертикальная/горизонтальная линии
            document.getElementById('cycleCrosshairV').style.cssText = 'display:block;position:absolute;top:0;bottom:0;width:1px;border-left:1px dashed rgba(255,255,255,0.35);pointer-events:none;z-index:10;left:' + cx2 + 'px';
            document.getElementById('cycleCrosshairH').style.cssText = 'display:block;position:absolute;left:0;right:0;height:1px;border-top:1px dashed rgba(255,255,255,0.35);pointer-events:none;z-index:10;top:' + my + 'px';

            // ── Живая цена на правой оси ──
            const hoverPrice = minP + PR * (1 - (my - T) / CH);
            // Стираем фон правой оси в месте курсора
            ctx.fillStyle = '#0a0d1e';
            ctx.fillRect(R, my - 12, cw - R, 24);
            // Подложка-бейдж
            ctx.fillStyle = 'rgba(0,255,200,0.15)';
            ctx.fillRect(R, my - 11, cw - R - 2, 22);
            // Текст цены
            ctx.textAlign = 'left';
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 13px "Courier New"';
            ctx.shadowColor = '#00FFC8'; ctx.shadowBlur = 8;
            ctx.fillText(fp(hoverPrice), R + 8, my + 4);
            ctx.shadowBlur = 0;

            // ── Живая дата на нижней оси ──
            const d = new Date(c.time);
            const dateLabel = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
            const labelW = ctx.measureText(dateLabel).width + 16;
            // Стираем фон нижней оси в месте курсора
            ctx.fillStyle = '#0a0d1e';
            ctx.fillRect(cx2 - labelW / 2 - 4, B, labelW + 8, ch - B);
            // Подложка-бейдж
            ctx.fillStyle = 'rgba(0,255,200,0.15)';
            ctx.fillRect(cx2 - labelW / 2 - 2, B + 2, labelW + 4, 18);
            // Текст даты
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 12px "Courier New"';
            ctx.shadowColor = '#00FFC8'; ctx.shadowBlur = 8;
            ctx.fillText(dateLabel, cx2, B + 14);
            ctx.shadowBlur = 0;

            // ── Tooltip скрыт по просьбе пользователя ──
            const tip = document.getElementById('cycleTooltip');
            if (tip) tip.style.display = 'none';
        } else {
            document.getElementById('cycleCrosshairV').style.display = 'none';
            document.getElementById('cycleCrosshairH').style.display = 'none';
            document.getElementById('cycleTooltip').style.display = 'none';
        }
    }

    function resize() {
        if (!canvas) return;
        const wr = canvas.parentElement;
        canvas.width = wr.clientWidth; canvas.height = wr.clientHeight;
        draw();
    }

    async function fetchCandles() {
        document.getElementById('cycleLoading').style.display = 'flex';
        document.getElementById('cycleStatus').textContent = 'Загрузка...';
        try {
            let all = [], startTime = new Date('2023-01-01').getTime();
            const endMs = Date.now();
            while (startTime < endMs) {
                const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=' + startTime + '&limit=1000';
                const data = await NetworkManager.fetchJSON(url);
                if (!data || data.length === 0) break;
                for (const k of data) all.push({ time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) });
                startTime = data[data.length - 1][0] + 86400000;
                if (data.length < 1000) break;
            }
            if (all.length && all[all.length - 1].time > Date.now() - 3600000) all.pop();
            candles = all;
            const ath = Math.max(...candles.map(c => c.high));
            const athDate = new Date(candles.find(c => c.high === ath).time).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
            const last = candles[candles.length - 1], first = candles[0];
            const tc = ((last.close - first.open) / first.open * 100).toFixed(1);
            document.getElementById('cycleStats').innerHTML =
                '<span style="color:#aaa;">Свечей: <strong style="color:#00FFC8;">' + candles.length + '</strong></span>' +
                '<span style="color:#aaa;">Период: <strong style="color:#00FFC8;">01.01.2023 \u2192 сегодня</strong></span>' +
                '<span style="color:#aaa;">ATH цикла: <strong style="color:#00FF88;">$' + ath.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</strong> (' + athDate + ')</span>' +
                '<span style="color:#aaa;">Рост: <strong style="color:#00FF88;">+' + tc + '%</strong></span>' +
                '<span style="color:#aaa;">Цена сейчас: <strong style="color:#00D9FF;">$' + last.close.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</strong></span>';
            document.getElementById('cycleStatus').textContent = candles.length + ' дней загружено';
            document.getElementById('cycleLoading').style.display = 'none';
            resize();
        } catch (e) {
            document.getElementById('cycleLoading').innerHTML = '&#10060; Ошибка загрузки. Проверьте интернет.';
            document.getElementById('cycleStatus').textContent = 'Ошибка';
        }
    }

    function init() {
        canvas = document.getElementById('cycleChartCanvas');
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
        canvas.addEventListener('mousemove', e => {
            const r = canvas.getBoundingClientRect();
            mx = (e.clientX - r.left) * (canvas.width / r.width);
            my = (e.clientY - r.top) * (canvas.height / r.height);

            // Курсор-палец для левой шкалы
            if (mx < PAD.left) canvas.style.cursor = 'pointer';
            else canvas.style.cursor = 'crosshair';

            draw();
        });
        canvas.addEventListener('mouseleave', () => { mx = null; my = null; draw(); });

        canvas.addEventListener('click', e => {
            const r = canvas.getBoundingClientRect();
            const clickX = (e.clientX - r.left) * (canvas.width / r.width);
            if (clickX < PAD.left) {
                const modal = document.getElementById('strategyReportModal');
                if (modal) modal.style.display = 'flex';
            }
        });

        fetchCandles();
    }

    return { reload: fetchCandles, init };
})();


export class CandleChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.data = [];
        this.fullData = [];
        this.tooltip = document.getElementById('candleTooltip');

        this.scrollOffset = 0;
        this.visibleCandles = 1000;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;

        this._onMouseMove = this._handleMouseMove.bind(this);
        this._onMouseLeave = this._handleMouseLeave.bind(this);
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onClick = this._handleClick.bind(this);

        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mouseleave', this._onMouseLeave);
        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('mouseup', this._onMouseUp);
        canvas.addEventListener('click', this._onClick);
    }

    update(candles) {
        if (!candles || candles.length === 0) return;
        this.fullData = candles;

        if (this.scrollOffset < 0) this.scrollOffset = 0;
        if (this.scrollOffset > candles.length - this.visibleCandles) {
            this.scrollOffset = Math.max(0, candles.length - this.visibleCandles);
        }

        const startIndex = Math.max(0, candles.length - this.visibleCandles - this.scrollOffset);
        this.data = candles.slice(startIndex, startIndex + this.visibleCandles);

        const { liquidityLevels } = MarketDataProcessor.process(candles);
        const elliottWaves = showElliott ? appData.elliottWaves : null;

        this.liquidityLevels = liquidityLevels.map(l => ({ ...l, index: l.index - startIndex }));
        if (elliottWaves) {
            this.activeWaves = {
                ...elliottWaves,
                points: elliottWaves.points.map(p => ({ ...p, index: p.index - startIndex }))
            };
        } else {
            this.activeWaves = null;
        }

        this._render();
    }

    destroy() {
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('click', this._onClick);
    }

    _handleClick(e) {
        if (!this._chartParams || !this.data.length) return;
        // Не открывать торговое меню, если это был drag (перетаскивание графика)
        const rect0 = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect0.left, cy = e.clientY - rect0.top;
        if (this.dragStartX !== undefined && Math.hypot(cx - this.dragStartX, cy - (this.dragStartY ?? cy)) > 5) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const { PAD, chartH, minP, maxP } = this._chartParams;

        if (my >= PAD.top && my <= PAD.top + chartH) {
            const price = minP + (maxP - minP) * (PAD.top + chartH - my) / chartH;

            // Сохраняем цену глобально
            window._pendingChartPrice = price;

            // Показываем меню
            const menu = document.getElementById('chartTradeMenu');
            const priceLabel = document.getElementById('chartTradePriceValue');
            if (menu && priceLabel) {
                priceLabel.textContent = '$' + price.toFixed(1);

                // Позиционируем меню рядом с курсором относительно окна
                menu.style.display = 'block';

                // Adjust if it goes off screen
                let leftPos = e.clientX + 15;
                let topPos = e.clientY - 20;

                if (leftPos + 180 > window.innerWidth) leftPos = e.clientX - 190;

                menu.style.left = leftPos + 'px';
                menu.style.top = topPos + 'px';
            }
        } else {
            // Клик мимо графика (например на оси) закрывает меню
            if (window.closeChartTradeMenu) window.closeChartTradeMenu();
        }
    }

    _render() {
        const { canvas, ctx, data } = this;
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth, H = canvas.offsetHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        if (!data.length) return;

        const PAD = { top: 30, right: 80, bottom: 40, left: 10 };
        const chartW = W - PAD.left - PAD.right;
        const chartH = H - PAD.top - PAD.bottom;

        const allLows = data.map(c => c.low);
        const allHighs = data.map(c => c.high);
        if (showVanga && typeof appData !== 'undefined' && appData.predictedCandles) {
            appData.predictedCandles.forEach(c => {
                allLows.push(c.low);
                allHighs.push(c.high);
            });
        }
        let minP = Math.min(...allLows);
        let maxP = Math.max(...allHighs);

        const rawRange = maxP - minP || 1;
        // Добавляем пространство снизу (20%), чтобы было видно ближайшие линии Фибоначчи и индикаторы
        minP -= rawRange * 0.20;
        maxP += rawRange * 0.05;

        const range = maxP - minP || 1;
        const priceToY = p => PAD.top + chartH - ((p - minP) / range) * chartH;

        // Ось Y (справа): Только Максимум и Минимум
        const actualMaxPrice = Math.max(...allHighs);
        const actualMinPrice = Math.min(...allLows);
        const actualMaxY = priceToY(actualMaxPrice);
        const actualMinY = priceToY(actualMinPrice);

        // Текст макс/мин на шкале Y (с Native Hover)
        ctx.textAlign = 'left';

        // Max Price Hover
        const isHoveredMax = this.mouseY !== undefined && Math.abs(this.mouseY - actualMaxY) < 15;
        if (isHoveredMax) {
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 13px Courier New';
            ctx.shadowColor = '#00FFC8';
            ctx.shadowBlur = 10;
        } else {
            ctx.fillStyle = 'rgba(0,255,200,0.5)';
            ctx.font = '13px Courier New';
            ctx.shadowBlur = 0;
        }
        ctx.fillText(fmtP(actualMaxPrice), W - PAD.right + 8, actualMaxY + 4);

        // Min Price Hover
        const isHoveredMin = this.mouseY !== undefined && Math.abs(this.mouseY - actualMinY) < 15;
        if (isHoveredMin) {
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 13px Courier New';
            ctx.shadowColor = '#00FFC8';
            ctx.shadowBlur = 10;
        } else {
            ctx.fillStyle = 'rgba(0,255,200,0.5)';
            ctx.font = '13px Courier New';
            ctx.shadowBlur = 0;
        }
        ctx.fillText(fmtP(actualMinPrice), W - PAD.right + 8, actualMinY + 4);
        ctx.shadowBlur = 0; // reset
        // ── Fibonacci Levels (validated, per-TF swing anchors) ──
        const fibData = appData.fibData && appData.fibData[currentTF];
        if (fibData) {
            ctx.font = '10px Courier New';
            ctx.lineWidth = 1;

            const fibDescriptions = {
                0.236: 'Слабость',
                0.382: 'Зеркальный уровень',
                0.5: 'Экватор',
                0.618: 'Золотой карман',
                0.786: 'Глубокая коррекция'
            };

            FibonacciEngine.RATIOS.forEach(r => {
                if (r === 0 || r === 1) return; // skip anchors to reduce clutter
                const price = fibData.levels[r];
                const y = priceToY(price);
                if (y < PAD.top || y > PAD.top + chartH) return;

                // Check if this level is in a confluence zone
                const conf = (appData.fibConfluence || []).find(
                    z => Math.abs(z.price - price) / price < 0.005
                );
                const color = FibonacciEngine.COLORS[r];
                const isConfl = conf && conf.strength >= 2;

                ctx.strokeStyle = isConfl ? color : color + '88';
                ctx.lineWidth = isConfl ? 1.5 : 0.8;
                ctx.setLineDash(isConfl ? [8, 3] : [4, 4]);
                ctx.beginPath();
                ctx.moveTo(PAD.left, y);
                ctx.lineTo(W - PAD.right, y);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label: left side (Beginner friendly description)
                ctx.fillStyle = color;
                ctx.textAlign = 'left';
                ctx.fillText(` ${fibDescriptions[r] || ''}`, PAD.left + 4, y - 5);

                // Label: right side (Technical details - только проценты на графике)
                ctx.textAlign = 'right';
                const label = `${(r * 100).toFixed(1)}%`;
                ctx.fillText(label, W - PAD.right - 4, y - 5);

                // Цена Фибоначчи на шкале (с Native Hover)
                ctx.textAlign = 'left';
                const isHoveredY = this.mouseY !== undefined && Math.abs(this.mouseY - y) < 15;
                if (isHoveredY) {
                    ctx.fillStyle = '#FFF';
                    ctx.font = 'bold 13px Courier New';
                    ctx.shadowColor = '#00FFC8';
                    ctx.shadowBlur = 10;
                } else {
                    ctx.fillStyle = 'rgba(0,255,200,0.5)';
                    ctx.font = '13px Courier New';
                    ctx.shadowBlur = 0;
                }
                ctx.fillText(fmtP(price), W - PAD.right + 8, y + 4);
                ctx.shadowBlur = 0; // reset
            });


            // Swing anchor markers (small triangles)
            ctx.font = 'bold 10px Courier New';
            const sHy = priceToY(fibData.swingHigh);
            const sLy = priceToY(fibData.swingLow);
            if (sHy >= PAD.top && sHy <= PAD.top + chartH) {
                ctx.fillStyle = '#FF6B6B';
                ctx.fillText('▼ SH', PAD.left + 4, sHy - 4);
            }
            if (sLy >= PAD.top && sLy <= PAD.top + chartH) {
                ctx.fillStyle = '#51CF66';
                ctx.fillText('▲ SL', PAD.left + 4, sLy + 12);
            }
        }


        // Макро-уровни (65000, 75000) удалены по просьбе пользователя

        // Свечи и общие метрики
        const gap = 1;
        const totalSlots = data.length + (showVanga ? 12 : 0);
        const candleW = Math.max(2, Math.floor(chartW / totalSlots) - gap);
        const slotW = chartW / totalSlots;

        // --- Уровни ликвидности (Liquidation Pools) ---
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0; // Убрали shadowBlur, он убивает FPS

        if (this.liquidityLevels) {
            this.liquidityLevels.forEach(lvl => {
                const y = priceToY(lvl.price);
                const startX = PAD.left + slotW * lvl.index + slotW / 2;
                const endX = PAD.left + slotW * (data.length - 1) + slotW / 2;

                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
                ctx.stroke();
            });
        }
        // --- Конец логики уровней ликвидности ---

        data.forEach((c, i) => {
            const x = PAD.left + (chartW / totalSlots) * i + (chartW / totalSlots - candleW) / 2;
            const isBull = c.close >= c.open;
            const color = isBull ? '#00FF88' : '#FF006E';

            // Тень (фитиль)
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + candleW / 2, priceToY(c.high));
            ctx.lineTo(x + candleW / 2, priceToY(c.low));
            ctx.stroke();

            // Тело
            const bodyTop = priceToY(Math.max(c.open, c.close));
            const bodyBot = priceToY(Math.min(c.open, c.close));
            const bodyH = Math.max(1, bodyBot - bodyTop);
            ctx.fillStyle = isBull ? 'rgba(0,255,136,0.85)' : 'rgba(255,0,110,0.85)';
            ctx.fillRect(x, bodyTop, candleW, bodyH);
            // Обводка
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
        });

        // --- Vanga Forecast Candles ---
        if (showVanga && appData.predictedCandles) {
            appData.predictedCandles.forEach((cCandle, idx) => {
                const i = data.length + idx;
                const x = PAD.left + slotW * i + (slotW - candleW) / 2;
                const yOpen = priceToY(cCandle.open);
                const yClose = priceToY(cCandle.close);
                ctx.strokeStyle = cCandle.isBull ? '#00FF88' : '#FF006E';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, Math.min(yOpen, yClose), candleW, Math.max(1, Math.abs(yOpen - yClose)));
            });
        }

        // --- Elliott Waves ---
        if (showElliott && this.activeWaves) {
            const waves = this.activeWaves;
            if (waves && waves.points && waves.points.length >= 6) {
                // Clamp points that are before the visible window to index=0
                const historicalPts = waves.points
                    .filter(p => !p.isProjection)
                    .map(p => ({ ...p, index: Math.max(0, p.index) }));
                const isUp = waves.isUptrend;
                const waveColors = ['#00FF88', '#FF5E7E', '#00FF88', '#FF5E7E', '#FFD700'];
                const waveNames  = ['Волна 1', 'Волна 2', 'Волна 3', 'Волна 4', 'Волна 5'];
                const abcColorsArr = ['#FF5E7E', '#BB88FF', '#FF5E7E'];
                const abcNamesArr  = ['A', 'B', 'C'];

                // ── 1a. Colored filled zones + labeled lines for impulse segments ──
                for (let i = 0; i < Math.min(historicalPts.length - 1, 5); i++) {
                    const pStart = historicalPts[i];
                    const pEnd   = historicalPts[i + 1];
                    if (!pStart || !pEnd) continue;
                    const xS = PAD.left + slotW * pStart.index + slotW / 2;
                    const xE = PAD.left + slotW * pEnd.index   + slotW / 2;
                    const yS = priceToY(pStart.price);
                    const yE = priceToY(pEnd.price);
                    const col = waveColors[i] || '#888';

                    ctx.save();
                    ctx.globalAlpha = (i === 2) ? 0.12 : 0.06;
                    ctx.fillStyle = col;
                    ctx.fillRect(xS, Math.min(yS,yE), xE-xS, Math.abs(yS-yE));
                    ctx.restore();

                    ctx.save();
                    ctx.strokeStyle = col; ctx.lineWidth = 2;
                    ctx.shadowBlur = 6; ctx.shadowColor = col;
                    ctx.beginPath(); ctx.moveTo(xS,yS); ctx.lineTo(xE,yE); ctx.stroke();
                    ctx.shadowBlur = 0;

                    const midX = (xS+xE)/2, midY = (yS+yE)/2;
                    ctx.font = 'bold 9px Inter, Arial'; ctx.textAlign = 'center';
                    ctx.globalAlpha = 0.85;
                    const tw = ctx.measureText(waveNames[i]).width + 8;
                    ctx.fillStyle = 'rgba(10,14,39,0.85)';
                    ctx.fillRect(midX-tw/2, midY-8, tw, 13);
                    ctx.fillStyle = col;
                    ctx.fillText(waveNames[i], midX, midY+2);
                    ctx.restore();
                }

                // ── 1b. A-B-C correction segments (dashed) ──
                for (let i = 5; i < historicalPts.length - 1; i++) {
                    const pStart = historicalPts[i], pEnd = historicalPts[i+1];
                    if (!pStart || !pEnd) continue;
                    const xS = PAD.left + slotW * pStart.index + slotW / 2;
                    const xE = PAD.left + slotW * pEnd.index   + slotW / 2;
                    const col = abcColorsArr[i-5] || '#888';
                    ctx.save();
                    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
                    ctx.setLineDash([4,3]); ctx.shadowBlur = 4; ctx.shadowColor = col;
                    ctx.beginPath(); ctx.moveTo(xS, priceToY(pStart.price)); ctx.lineTo(xE, priceToY(pEnd.price)); ctx.stroke();
                    ctx.setLineDash([]); ctx.shadowBlur = 0;
                    ctx.restore();
                }

                // ── 2. Pivot badges with price annotations ──
                const badgeLabels = ['0','1','2','3','4','5'];
                historicalPts.forEach((p, idx) => {
                    const x = PAD.left + slotW * p.index + slotW / 2;
                    const y = priceToY(p.price);
                    const isImp = idx < 6;
                    const col = isImp ? '#FFD700' : (abcColorsArr[idx-6] || '#BB88FF');
                    const label = isImp ? (badgeLabels[idx]||'') : (abcNamesArr[idx-6]||'');

                    ctx.save();
                    ctx.beginPath(); ctx.arc(x, y, 10, 0, 2*Math.PI);
                    ctx.fillStyle = 'rgba(10,14,39,0.92)'; ctx.fill();
                    ctx.lineWidth = 2; ctx.strokeStyle = col;
                    ctx.shadowBlur = 8; ctx.shadowColor = col; ctx.stroke(); ctx.shadowBlur = 0;
                    ctx.fillStyle = '#FFF'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
                    ctx.fillText(label, x, y+4);

                    const pLabel = '$' + Math.round(p.price).toLocaleString();
                    const above = (idx%2===0) === isUp;
                    ctx.font = '9px Courier New'; ctx.fillStyle = col; ctx.globalAlpha = 0.8;
                    ctx.fillText(pLabel, x, above ? y-16 : y+24);
                    ctx.restore();
                });

                // ── 3. FORWARD PROJECTIONS ──
                if (waves.projections && waves.projections.length > 0) {
                    const lastPt   = historicalPts[historicalPts.length - 1];
                    const anchorX  = PAD.left + slotW * (lastPt ? lastPt.index : data.length-1) + slotW/2;
                    const anchorP  = lastPt ? lastPt.price : data[data.length-1].close;
                    const projEndX = PAD.left + chartW - 2;

                    const w5Projs  = waves.projections.filter(p => p.label.startsWith('⑤'));
                    const abcProjs = waves.projections.filter(p => ['A','B','C'].includes(p.label));

                    // Wave-5 target zone fill (golden)
                    if (w5Projs.length >= 2) {
                        const prices = w5Projs.map(p => p.price);
                        const zT = priceToY(Math.max(...prices)), zB = priceToY(Math.min(...prices));
                        if (zT < PAD.top+chartH && zB > PAD.top) {
                            ctx.save();
                            const g = ctx.createLinearGradient(anchorX, 0, projEndX, 0);
                            g.addColorStop(0,'rgba(255,215,0,0)'); g.addColorStop(1,'rgba(255,215,0,0.13)');
                            ctx.fillStyle = g;
                            ctx.fillRect(anchorX, Math.max(PAD.top,zT), projEndX-anchorX, Math.min(zB,PAD.top+chartH)-Math.max(PAD.top,zT));
                            ctx.restore();
                        }
                    }

                    // ABC correction zone fill (red)
                    if (abcProjs.length >= 2) {
                        const prices = abcProjs.map(p => p.price);
                        const zT = priceToY(Math.max(...prices)), zB = priceToY(Math.min(...prices));
                        if (zT < PAD.top+chartH && zB > PAD.top) {
                            ctx.save();
                            const g = ctx.createLinearGradient(anchorX, 0, projEndX, 0);
                            g.addColorStop(0,'rgba(255,94,126,0)'); g.addColorStop(1,'rgba(255,94,126,0.11)');
                            ctx.fillStyle = g;
                            ctx.fillRect(anchorX, Math.max(PAD.top,zT), projEndX-anchorX, Math.min(zB,PAD.top+chartH)-Math.max(PAD.top,zT));
                            ctx.restore();
                        }
                    }

                    // Individual lines + pill labels + arrows
                    const dOff = (Date.now() / 80) % 20;
                    waves.projections.forEach((proj, i) => {
                        const y = priceToY(proj.price);
                        if (y < PAD.top+5 || y > PAD.top+chartH-5) return;
                        ctx.save();
                        ctx.strokeStyle = proj.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.65;
                        ctx.setLineDash([6,5]); ctx.lineDashOffset = -(dOff + i*5);
                        ctx.shadowBlur = 5; ctx.shadowColor = proj.color;
                        ctx.beginPath(); ctx.moveTo(anchorX, y); ctx.lineTo(projEndX-108, y); ctx.stroke();
                        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.shadowBlur = 0; ctx.globalAlpha = 1;

                        // Pill
                        const txt = `${proj.label}  $${Math.round(proj.price).toLocaleString()}`;
                        ctx.font = 'bold 10px Inter, Arial';
                        const tw2 = ctx.measureText(txt).width + 12;
                        const px2 = projEndX - tw2 - 2, py2 = y - 8;
                        ctx.globalAlpha = 0.93;
                        ctx.fillStyle = 'rgba(8,12,30,0.92)';
                        if (ctx.roundRect) ctx.roundRect(px2, py2, tw2, 16, 4);
                        else ctx.rect(px2, py2, tw2, 16);
                        ctx.fill(); ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(px2, py2, tw2, 16, 4);
                        else ctx.rect(px2, py2, tw2, 16);
                        ctx.strokeStyle = proj.color; ctx.lineWidth = 1; ctx.stroke();
                        ctx.fillStyle = proj.color; ctx.textAlign = 'left';
                        ctx.fillText(txt, px2+6, py2+11);

                        // Triangle arrow
                        const dir = proj.price > anchorP ? -1 : 1;
                        ctx.fillStyle = proj.color; ctx.globalAlpha = 0.9;
                        ctx.beginPath();
                        ctx.moveTo(anchorX+8, y);
                        ctx.lineTo(anchorX+3, y+dir*5);
                        ctx.lineTo(anchorX+13, y+dir*5);
                        ctx.closePath(); ctx.fill();
                        ctx.globalAlpha = 1;
                        ctx.restore();
                    });

                    // Header
                    ctx.save();
                    ctx.font = 'bold 9px Inter, Arial'; ctx.textAlign = 'center';
                    ctx.fillStyle = 'rgba(255,255,255,0.35)';
                    ctx.fillText('── ПРОГНОЗ ЭЛЛИОТА ──', anchorX+(projEndX-anchorX)/2, PAD.top+14);
                    ctx.restore();

                    if (!this._projAnimFrame) {
                        this._projAnimFrame = requestAnimationFrame(() => {
                            this._projAnimFrame = null;
                            if (showElliott && this.activeWaves && this.activeWaves.projections) this._render();
                        });
                    }
                }
            }
        }


        // Ось X — метки времени (с Native Hover)
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(data.length / 8));
        data.forEach((c, i) => {
            if (i % step === 0) {
                const x = PAD.left + (chartW / totalSlots) * i + candleW / 2;
                const isHoveredX = this.mouseX !== undefined && Math.abs(this.mouseX - x) < 20;
                if (isHoveredX) {
                    ctx.fillStyle = '#FFF';
                    ctx.font = 'bold 12px Courier New';
                    ctx.shadowColor = '#00FFC8';
                    ctx.shadowBlur = 10;
                } else {
                    ctx.fillStyle = 'rgba(0,255,200,0.5)';
                    ctx.font = '12px Courier New';
                    ctx.shadowBlur = 0;
                }
                ctx.fillText(c.label, x, H - 10);
                ctx.shadowBlur = 0; // reset
            }
        });

        // Уровни поддержки и сопротивления (RES/SUP) скрыты с графика по просьбе пользователя




        const lastClose = data[data.length - 1].close;
        const lastY = priceToY(lastClose);
        ctx.strokeStyle = 'rgba(0,255,136,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD.left, lastY); ctx.lineTo(W - PAD.right, lastY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,255,136,0.05)';
        ctx.fillRect(W - PAD.right, lastY - 12, PAD.right, 24);
        ctx.fillStyle = '#00FF88';
        ctx.font = 'bold 13px Courier New';
        ctx.textAlign = 'left';
        ctx.fillText('$' + fmtP(lastClose), W - PAD.right + 6, lastY + 5);


        // --- ДИНАМИЧЕСКИЕ "НЕВИДИМЫЕ" ЧИСЛА (Точная цена и время под курсором) ---
        if (this.mouseY !== undefined && this.mouseX !== undefined && this.mouseX >= PAD.left && this.mouseX <= PAD.left + chartW && this.mouseY >= PAD.top && this.mouseY <= PAD.top + chartH) {

            // 1. Точная цена (Ось Y)
            const hoverPrice = minP + (maxP - minP) * (PAD.top + chartH - this.mouseY) / chartH;

            // Рисуем стирающий фон, сливающийся с графиком (чтобы перекрыть статику, если она там есть)
            ctx.fillStyle = '#0a0e27';
            ctx.fillRect(W - PAD.right, this.mouseY - 10, PAD.right, 20);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 13px Courier New';
            ctx.shadowColor = '#00FFC8';
            ctx.shadowBlur = 10;
            ctx.fillText(fmtP(hoverPrice), W - PAD.right + 8, this.mouseY + 4);
            ctx.shadowBlur = 0;

            // 2. Точное время (Ось X)
            const slotW = chartW / totalSlots;
            const idx = Math.floor((this.mouseX - PAD.left) / slotW);
            if (idx >= 0 && idx < data.length) {
                const hoverTime = data[idx].label;

                // Стирающий фон для оси X
                ctx.fillStyle = '#0a0e27';
                ctx.fillRect(this.mouseX - 30, H - 20, 60, 20);

                ctx.textAlign = 'center';
                ctx.fillStyle = '#FFF';
                ctx.font = 'bold 12px Courier New';
                ctx.shadowColor = '#00FFC8';
                ctx.shadowBlur = 10;
                ctx.fillText(hoverTime, this.mouseX, H - 10);
                ctx.shadowBlur = 0;
            }
        }

        // ── StochRSI Overlay — K и D поверх всего графика, полная ширина и высота ──
        if (appData.stochRSILines && appData.stochRSILines.K && appData.stochRSILines.K.length > 0) {
            const { K: sK, D: sD, displayKOff = 0, displayDOff = 0 } = appData.stochRSILines;
            // slotW уже объявлена выше в методе _render()
            // StochRSI 0=низ графика, 100=верх графика
            const srsiToY = v => PAD.top + chartH - (Math.max(0, Math.min(100, v)) / 100) * chartH;

            // --- ЭКСПЕРИМЕНТАЛЬНЫЙ КОД (СТРЕЛОЧКИ ДЛЯ K И D С МИГАНИЕМ) ---
            const blinkState = Math.floor(Date.now() / 500) % 2 === 0;

            const drawArrows = (dataSeries, offset, isDLine) => {
                for (let i = 0; i < totalSlots; i++) {
                    const idx = offset + i;
                    // Отображаем историю только для 4 последних свечей
                    if (idx < 0 || idx >= dataSeries.length || idx < dataSeries.length - 4) continue;

                    const val = dataSeries[idx];
                    const x = PAD.left + slotW * i + slotW / 2;
                    const c = data[i]; // Текущая свеча для магнитного прилипания

                    let color, dir;
                    if (val >= 80) {
                        color = isDLine ? '#A80048' : '#FF006E';
                        dir = 'down';
                    } else if (val <= 20) {
                        color = isDLine ? '#00A859' : '#00FF88';
                        dir = 'up';
                    } else {
                        color = isDLine ? '#B39600' : '#FFD700';
                        dir = 'diamond';
                    }

                    const isLastOne = (idx === dataSeries.length - 1);

                    // Ранее здесь скрывались нейтральные ромбы (20-80).
                    // Теперь мы отображаем их всегда, чтобы линия Стохастика не пропадала визуально.

                    const isBlinkingPhase = isDLine ? blinkState : !blinkState;
                    ctx.globalAlpha = (isLastOne && isBlinkingPhase) ? 0.2 : (isDLine ? 0.6 : 1.0);

                    // Градация размеров
                    let size = 2.0;
                    if (isLastOne) {
                        if (val >= 85 || val <= 15) {
                            size = isDLine ? 4.0 : 6.0; // Самый большой треугольник
                        } else if (val >= 75 || val <= 25) {
                            size = isDLine ? 2.5 : 3.5; // Средний
                        } else {
                            size = isDLine ? 1.2 : 1.8; // Маленький
                        }
                    }

                    // Магнитное притягивание Y-координаты к графику
                    let y;
                    if (dir === 'down') {
                        // Overbought: прилипаем к High свечи (значения 80..100 отдаляются от 5px до 25px)
                        y = priceToY(c.high) - 5 - size - (val - 80) * 1.0;
                    } else if (dir === 'up') {
                        // Oversold: прилипаем к Low свечи (значения 20..0 отдаляются от 5px до 25px)
                        y = priceToY(c.low) + 5 + size + (20 - val) * 1.0;
                    } else {
                        // Neutral: прилипаем к Close свечи с небольшим разбросом
                        y = priceToY(c.close) - (val - 50) * 0.4;
                    }

                    ctx.beginPath();
                    ctx.fillStyle = color;

                    if (dir === 'up') {
                        ctx.moveTo(x, y - size);
                        ctx.lineTo(x + size * 1.5, y + size);
                        ctx.lineTo(x - size * 1.5, y + size);
                    } else if (dir === 'down') {
                        ctx.moveTo(x, y + size);
                        ctx.lineTo(x + size * 1.5, y - size);
                        ctx.lineTo(x - size * 1.5, y - size);
                    } else { // diamond
                        ctx.moveTo(x, y - size * 1.2);
                        ctx.lineTo(x + size * 1.2, y);
                        ctx.lineTo(x, y + size * 1.2);
                        ctx.lineTo(x - size * 1.2, y);
                    }
                    ctx.closePath();
                    ctx.fill();
                }
            };

            // Сначала рисуем медленную D (как тень), чтобы K была поверх неё
            drawArrows(sD, displayDOff, true);
            // Затем быструю K
            drawArrows(sK, displayKOff, false);

            ctx.globalAlpha = 1.0;
        }

        // Сохраняем параметры для tooltip/crosshair
        this._chartParams = { PAD, chartW, chartH, totalSlots, candleW, priceToY, minP, maxP };
    }

    _handleMouseMove(e) {
        if (!this._chartParams || !this.data.length) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isDragging) {
            const dx = mx - this.dragStartX;
            const shiftCandles = Math.round((dx / this._chartParams.chartW) * this.visibleCandles);

            this.scrollOffset = this.dragStartOffset + shiftCandles;

            if (this.scrollOffset < 0) this.scrollOffset = 0;
            if (this.scrollOffset > this.fullData.length - this.visibleCandles) {
                this.scrollOffset = Math.max(0, this.fullData.length - this.visibleCandles);
            }

            this.update(this.fullData);
            return;
        }

        const crosshairH = document.getElementById('crosshairH');
        const crosshairV = document.getElementById('crosshairV');

        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
            const { PAD, chartW, chartH, totalSlots, minP, maxP } = this._chartParams;

            this.mouseX = mx;
            this.mouseY = my;

            if (this._reqFrame) cancelAnimationFrame(this._reqFrame);
            this._reqFrame = requestAnimationFrame(() => this._render());

            if (crosshairH) {
                crosshairH.style.display = 'block';
                crosshairH.style.top = my + 'px';
            }
            if (crosshairV) {
                crosshairV.style.display = 'block';
                crosshairV.style.left = mx + 'px';
            }

            // --- Тултип для StochRSI ---
            if (mx >= PAD.left && mx <= PAD.left + chartW) {
                const slotW = chartW / totalSlots;
                const idx = Math.floor((mx - PAD.left) / slotW);
                if (idx >= 0 && idx < this.data.length) {
                    if (typeof appData !== 'undefined' && appData.stochRSILines && appData.stochRSILines.K) {
                        let stochTooltip = document.getElementById('stochTooltip');
                        if (!stochTooltip) {
                            stochTooltip = document.createElement('div');
                            stochTooltip.id = 'stochTooltip';
                            stochTooltip.style.position = 'absolute';
                            stochTooltip.style.padding = '6px 10px';
                            stochTooltip.style.background = 'rgba(10, 14, 39, 0.95)';
                            stochTooltip.style.border = '1px solid #00FFC8';
                            stochTooltip.style.color = '#FFF';
                            stochTooltip.style.fontSize = '12px';
                            stochTooltip.style.borderRadius = '6px';
                            stochTooltip.style.pointerEvents = 'none';
                            stochTooltip.style.zIndex = '20';
                            stochTooltip.style.fontFamily = "'Courier New', monospace";
                            stochTooltip.style.boxShadow = '0 0 10px rgba(0,255,200,0.2)';
                            document.querySelector('.chart-canvas-container').appendChild(stochTooltip);
                        }

                        const { K, D, displayKOff, displayDOff } = appData.stochRSILines;
                        const kVal = K[displayKOff + idx];
                        const dVal = D[displayDOff + idx];

                        if (kVal !== undefined && dVal !== undefined) {
                            const srsiToY = v => PAD.top + chartH - (Math.max(0, Math.min(100, v)) / 100) * chartH;
                            const kY = srsiToY(kVal);
                            const dY = srsiToY(dVal);

                            if (Math.abs(my - kY) < 30 || Math.abs(my - dY) < 30) {
                                stochTooltip.innerHTML = `<div style="margin-bottom:4px; font-size:10px; color:#aaa; text-transform:uppercase;">Stochastic RSI</div><span style="color:#FFB300; font-weight:bold;">K: ${kVal.toFixed(1)}%</span><br><span style="color:#FF3EA5; font-weight:bold;">D: ${dVal.toFixed(1)}%</span>`;
                                stochTooltip.style.display = 'block';
                                stochTooltip.style.left = (mx + 15) + 'px';
                                stochTooltip.style.top = (my - 30) + 'px';
                            } else {
                                stochTooltip.style.display = 'none';
                            }
                        } else {
                            if (stochTooltip) stochTooltip.style.display = 'none';
                        }
                    }
                } else {
                    const stochTt = document.getElementById('stochTooltip');
                    if (stochTt) stochTt.style.display = 'none';
                }
            } else {
                const stochTt = document.getElementById('stochTooltip');
                if (stochTt) stochTt.style.display = 'none';
            }
        } else {
            this._hideCrosshair();
        }
    }

    _handleMouseLeave() {
        this.mouseX = undefined;
        this.mouseY = undefined;
        this.isDragging = false;
        if (this._reqFrame) cancelAnimationFrame(this._reqFrame);
        this._reqFrame = requestAnimationFrame(() => this._render());
        this._hideCrosshair();
    }

    _handleMouseDown(e) {
        if (!this._chartParams || !this.data.length) return;
        const rect = this.canvas.getBoundingClientRect();
        this.dragStartX = e.clientX - rect.left;
        this.dragStartY = e.clientY - rect.top;
        this._dragMoved = false;
        this.dragStartOffset = this.scrollOffset;
        this.isDragging = true;
        this.canvas.style.cursor = 'grabbing';
    }

    _handleMouseUp(e) {
        this.isDragging = false;
        this.canvas.style.cursor = 'crosshair';
    }

    _hideCrosshair() {
        const ch = document.getElementById('crosshairH');
        const cv = document.getElementById('crosshairV');
        const cp = document.getElementById('crosshairPrice');
        const ct = document.getElementById('crosshairTime');
        const stochTt = document.getElementById('stochTooltip');
        if (ch) ch.style.display = 'none';
        if (cv) cv.style.display = 'none';
        if (cp) cp.style.display = 'none';
        if (ct) ct.style.display = 'none';
        if (stochTt) stochTt.style.display = 'none';
    }
}
