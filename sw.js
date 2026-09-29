const CACHE_NAME = 'criptograf-v3-cache';

// Какие локальные файлы кэшировать для мгновенной загрузки (App Shell)
const STATIC_ASSETS = [
    '/',
    '/666BTC2GRAF.html',
    '/styles.css',
    '/main.js',
    '/state.js',
    '/api.js',
    '/ui-utils.js',
    '/fetchMacro.js',
    '/fetchMarket.js',
    '/dataPipeline.js',
    '/trading.js',
    '/charts.js',
    '/btMath.js',
    '/indicators.js',
    '/config.js',
    '/backtester-ui.js',
    '/backtester.worker.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            })
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. Кэширование API Бинанса (только GET-запросы на klines и ticker)
    if (url.hostname === 'api.binance.com' || url.hostname === 'fapi.binance.com') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Кэшируем успешный ответ для оффлайна
                    if (response.ok) {
                        const clonedRes = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedRes));
                    }
                    return response;
                })
                .catch(async () => {
                    // Если нет интернета, отдаем из кэша
                    const cachedResponse = await caches.match(event.request);
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    throw new Error('Оффлайн и нет данных в кэше');
                })
        );
        return;
    }

    // 2. Стратегия Stale-While-Revalidate для статики
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                if (networkResponse.ok) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => null);

            // Сначала отдаем из кэша (мгновенно), а в фоне обновляем. 
            // Если в кэше нет — ждем сеть.
            return cachedResponse || fetchPromise;
        })
    );
});
