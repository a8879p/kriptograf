import { appData } from './state.js';
import { triggerAlert } from './ui-utils.js';
// Backtest UI — runs simulation in Web Worker (backtester.worker.js)
export class BacktesterUI {
    static HORIZON = 5;
    static MIN_MOVE = 0.005;
    static LONG_TH = 55;
    static SHORT_TH = 45;
    static WARMUP = 250;
    static lastResults = null;
    static _worker = null;

    static _getWorker() {
        if (!this._worker) {
            this._worker = new Worker('backtester.worker.js', { type: 'module' });
        }
        return this._worker;
    }

    static _fmt(ts) {
        return new Date(ts).toLocaleString('en-GB', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    static _mapResults(tf, results) {
        return results.map(r => ({
            date: this._fmt(r.time),
            timestamp: r.time,
            tf,
            dir: r.dir,
            score: r.score,
            entry: Math.round(r.entry),
            exit: Math.round(r.exit),
            ret: r.ret,
            isWin: r.isWin,
            mfe: r.mfe,
            mae: r.mae,
            atrPct: r.atrPct,
            volRatio: r.volRatio,
            session: r.session,
            trendAge: r.trendAge,
            adx: r.ctx?.adx ?? null,
            adxDir: r.ctx?.adxDir ?? null,
            plusDI: r.ctx?.plusDI ?? null,
            minusDI: r.ctx?.minusDI ?? null,
            diSpread: r.ctx?.diSpread ?? null,
            stochK: r.ctx?.stochK ?? null,
            stochD: r.ctx?.stochD ?? null,
            kAboveD: r.ctx?.kAboveD ?? null,
            rsi: r.ctx?.rsi ?? null,
            regime: r.ctx?.regime ?? null,
            candlePattern: r.ctx?.candlePattern ?? null,
            lowerWick: r.ctx?.lowerWickRatio ?? 0,
            upperWick: r.ctx?.upperWickRatio ?? 0,
            prevWin: null
        }));
    }

    static run(tf, limit, offsetMonths = 0) {
        const logEl = document.getElementById('btLog');
        const runBtn = document.getElementById('runBtBtn');
        const log = msg => {
            logEl.textContent += msg + '\n';
            logEl.scrollTop = logEl.scrollHeight;
        };

        logEl.textContent = '';
        if (runBtn) runBtn.disabled = true;
        ['btBtnCSV', 'btBtnJSON', 'btBtnAI'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const worker = this._getWorker();

        return new Promise((resolve, reject) => {
            const onMessage = (e) => {
                const { type, msg, results, error } = e.data;
                if (type === 'log') {
                    log(msg);
                } else if (type === 'done') {
                    worker.removeEventListener('message', onMessage);
                    const mapped = this._mapResults(tf, results);
                    this.lastResults = { tf, limit, results: mapped };
                    try {
                        localStorage.setItem('bt_last_results', JSON.stringify(this.lastResults));
                    } catch (_) { /* ignore */ }
                    ['btBtnCSV', 'btBtnJSON', 'btBtnAI'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.display = 'inline-block';
                    });
                    if (runBtn) runBtn.disabled = false;
                    resolve(this.lastResults);
                } else if (type === 'error') {
                    worker.removeEventListener('message', onMessage);
                    log(`❌ Error: ${error}`);
                    if (runBtn) runBtn.disabled = false;
                    reject(new Error(error));
                }
            };
            worker.addEventListener('message', onMessage);
            worker.postMessage({
                cmd: 'run',
                tf,
                limit: parseInt(limit, 10),
                offsetMonths: parseInt(offsetMonths, 10) || 0
            });
        });
    }

    static exportCSV() {
        if (!this.lastResults) return triggerAlert('Run backtest first.', 'error');
        const rows = this.lastResults.results;
        const hdr = 'date,tf,dir,score,entry,exit,ret%,win,mfe%,mae%,atr%,volRatio,session,trendAge,adx,adxDir,diSpread,plusDI,minusDI,stochK,stochD,kAboveD,rsi,regime,candlePattern,lowerWick%,upperWick%,prevWin';
        const lines = rows.map(r =>
            [r.date, r.tf, r.dir, r.score, r.entry, r.exit, r.ret, r.isWin ? 1 : 0,
            r.mfe, r.mae, r.atrPct, r.volRatio, r.session, r.trendAge,
            r.adx, r.adxDir, r.diSpread, r.plusDI, r.minusDI,
            r.stochK, r.stochD, r.kAboveD ? 1 : 0, r.rsi, r.regime,
            r.candlePattern, r.lowerWick, r.upperWick,
            r.prevWin === null ? '' : r.prevWin ? 1 : 0].join(',')
        );
        const blob = new Blob([[hdr, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backtest_${this.lastResults.tf}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    static exportJSON() {
        if (!this.lastResults) return triggerAlert('Run backtest first.', 'error');
        const blob = new Blob([JSON.stringify(this.lastResults, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backtest_${this.lastResults.tf}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    }

    static copyForAI() {
        if (!this.lastResults) return triggerAlert('Run backtest first.', 'error');
        const r = this.lastResults;
        const total = r.results.length;
        const wins = r.results.filter(x => x.isWin).length;
        const signedRet = x => x.ret;
        const losses = r.results
            .filter(x => !x.isWin)
            .map(x => ({ ...x, signed: x.ret }))
            .sort((a, b) => a.signed - b.signed);
        const wr = (wins / total * 100).toFixed(1);
        const adj = r.results.map(x => x.ret);
        const totalRetPct = adj.reduce((a, b) => a + b, 0);
        const avgRetPct = adj.length > 0 ? totalRetPct / adj.length : 0;
        const worst20 = losses.slice(0, 20);
        const lossRows = worst20.map(x =>
            `${x.date}|${x.dir}|Score:${x.score}%|ADX:${x.adx}(${x.adxDir})|DI-spread:${x.diSpread}|+DI:${x.plusDI}/-DI:${x.minusDI}|K:${x.stochK} D:${x.stochD}|K>D:${x.kAboveD}|RSI:${x.rsi}|${x.regime}|${x.candlePattern}|ATR:${x.atrPct}%|Vol:${x.volRatio}x|Session:${x.session}|TrendAge:${x.trendAge}|MFE:${x.mfe}%|MAE:${x.mae}%|Entry:${x.entry}->Exit:${x.exit}|PnL:${x.signed.toFixed(2)}%`
        ).join('\n');
        const regStat = {};
        r.results.forEach(x => {
            if (!regStat[x.regime]) regStat[x.regime] = { t: 0, w: 0 };
            regStat[x.regime].t++;
            if (x.isWin) regStat[x.regime].w++;
        });
        const regStr = Object.entries(regStat).map(([k, v]) =>
            `${k}: ${v.w}/${v.t} wins (${(v.w / v.t * 100).toFixed(0)}%)`).join('\n');
        const zoneStat = { '<20': { t: 0, w: 0 }, '20-80': { t: 0, w: 0 }, '>80': { t: 0, w: 0 } };
        r.results.forEach(x => {
            const z = x.stochK < 20 ? '<20' : x.stochK > 80 ? '>80' : '20-80';
            zoneStat[z].t++;
            if (x.isWin) zoneStat[z].w++;
        });
        const zoneStr = Object.entries(zoneStat).map(([z, v]) =>
            `StochK ${z}: ${v.w}/${v.t} wins (${v.t > 0 ? (v.w / v.t * 100).toFixed(0) : 0}%)`).join('\n');
        const sessStat = {};
        r.results.forEach(x => {
            if (!sessStat[x.session]) sessStat[x.session] = { t: 0, w: 0 };
            sessStat[x.session].t++;
            if (x.isWin) sessStat[x.session].w++;
        });
        const sessStr = Object.entries(sessStat).map(([s, v]) =>
            `${s}: ${v.w}/${v.t} wins (${(v.w / v.t * 100).toFixed(0)}%)`).join('\n');
        const avgMFE = losses.length ? (losses.reduce((s, x) => s + x.mfe, 0) / losses.length).toFixed(2) : '0';
        const avgMAE = losses.length ? (losses.reduce((s, x) => s + x.mae, 0) / losses.length).toFixed(2) : '0';
        const prompt =
            `You are an expert in algorithmic Bitcoin trading systems. Analyze the backtest results below and find patterns that cause losses.

=== SYSTEM PARAMETERS ===
Timeframe: ${r.tf}
Candles tested: ${r.limit}
Indicators: ADX (trend/flat), StochRSI K/D, RSI, candle wick analysis
Logic: LONG if score>=55%, SHORT if score<=45%, neutral 45-55%
Verification horizon: ${this.HORIZON} candles forward, min move: ${this.MIN_MOVE * 100}%

=== OVERALL STATISTICS ===
Total signals: ${total}
Wins: ${wins} (${wr}%)
Losses: ${losses.length}
Cumulative PnL: ${totalRetPct > 0 ? '+' : ''}${totalRetPct.toFixed(2)}%
Average PnL/Trade: ${avgRetPct > 0 ? '+' : ''}${avgRetPct.toFixed(2)}%

=== WIN RATE BY MARKET REGIME ===
${regStr}

=== WIN RATE BY STOCHRSI ZONE ===
${zoneStr}

=== WIN RATE BY TRADING SESSION ===
${sessStr}

=== TOP-20 WORST LOSING TRADES ===
${lossRows}`;

        navigator.clipboard.writeText(prompt).then(() => {
            const btn = document.getElementById('btBtnAI');
            if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = '🤖 Copy for AI', 2000); }
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = prompt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            triggerAlert('Prompt copied to clipboard!', 'info');
        });
    }
}
