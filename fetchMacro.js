// Macro / futures data — extracted from 666BTC2graf.html (Stage 1 refactor)
import { TRADING_CONFIG } from './config.js';
import { NetworkManager } from './api.js';
import { appData, currentTF } from './state.js';

export async function fetchFuturesData() {
    const sym = TRADING_CONFIG.SYMBOL;
    try {
        const fundingData = await NetworkManager.fetchJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`);
        appData.fundingRate = fundingData ? parseFloat(fundingData.lastFundingRate) : null;

        const lsData = await NetworkManager.fetchJSON(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1d&limit=1`);
        appData.lsRatio = (lsData && lsData.length > 0) ? parseFloat(lsData[0].longShortRatio) : null;

        const depthData = await NetworkManager.fetchJSON(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=100`);
        let bidVol = 0, askVol = 0;
        if (depthData && depthData.bids) depthData.bids.forEach(b => bidVol += parseFloat(b[0]) * parseFloat(b[1]));
        if (depthData && depthData.asks) depthData.asks.forEach(a => askVol += parseFloat(a[0]) * parseFloat(a[1]));
        appData.orderBookImbalance = askVol > 0 ? bidVol / askVol : null;

        let oiInterval = currentTF === '1w' ? '1d' : currentTF;
        const oiData = await NetworkManager.fetchJSON(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${oiInterval}&limit=2`);
        if (oiData && oiData.length === 2) {
            const oldOI = parseFloat(oiData[0].sumOpenInterest);
            const newOI = parseFloat(oiData[1].sumOpenInterest);
            appData.oiChange = oldOI > 0 ? ((newOI - oldOI) / oldOI) * 100 : null;
        } else {
            appData.oiChange = null;
        }

        const fgData = await NetworkManager.fetchJSON('https://api.alternative.me/fng/?limit=1');
        appData.fearAndGreed = (fgData && fgData.data && fgData.data.length > 0) ? parseFloat(fgData.data[0].value) : null;

        const cgData = await NetworkManager.fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        appData.cg24hChange = (cgData && cgData.bitcoin) ? cgData.bitcoin.usd_24h_change : null;

        const feesData = await NetworkManager.fetchJSON('https://mempool.space/api/v1/fees/recommended');
        appData.mempoolFastFee = feesData ? feesData.fastestFee : null;

        const hrData = await NetworkManager.fetchJSON('https://mempool.space/api/v1/mining/hashrate/3d');
        if (hrData && hrData.hashrates && hrData.hashrates.length >= 2) {
            const rates = hrData.hashrates;
            const first = rates[0].avgHashrate;
            const last = rates[rates.length - 1].avgHashrate;
            appData.hashrateChange = first > 0 ? ((last - first) / first) * 100 : null;
        } else {
            appData.hashrateChange = null;
        }

        const y1Data = await NetworkManager.fetchJSON(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1w&limit=52`);
        let y1High = -Infinity, y1Low = Infinity;
        if (y1Data && y1Data.length > 0) {
            y1Data.forEach(k => {
                y1High = Math.max(y1High, parseFloat(k[2]));
                y1Low = Math.min(y1Low, parseFloat(k[3]));
            });
            appData.y1High = y1High;
            appData.y1Low = y1Low;
        }

        await fetchLiquidations();

    } catch (err) {
        console.error("[Data Sync] Error fetching macro data", err);
    }
}

export async function fetchLiquidations() {
    // NOTE: Binance /fapi/v1/allForceOrders is deprecated (returns 400).
    // Liquidation data requires authenticated access or an alternative provider.
    // Setting defaults to avoid silent network errors every refresh cycle.
    appData.liqLong = 0;
    appData.liqShort = 0;
}
