// Application state — extracted from 666BTC2graf.html (Stage 1 refactor)
export let currentTF = '4h';
export let appData = { prices: [], candles: [], dates: [], levels: null, prob: null, currentPrice: 0 };
export let candleChartInstance = null;
export let lastSecondaryFetch = 0;
export let AUTO_REFRESH_MS = 5 * 1000;
export let countdown = AUTO_REFRESH_MS / 1000;
export let showElliott = true;
export let showVanga = true;

export function setChartInstance(instance) {
    candleChartInstance = instance;
}

export function setTF(tf) {
    currentTF = tf;
}

export function setLastSecondaryFetch(time) {
    lastSecondaryFetch = time;
}

export function updateCountdown(val) {
    countdown = val;
}

export function toggleElliott() {
    showElliott = !showElliott;
    return showElliott;
}

export function toggleVanga() {
    showVanga = !showVanga;
    return showVanga;
}