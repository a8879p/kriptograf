export class NetworkManager {
    static RATE_LIMIT_DELAY = 100; // 100ms between requests to be safe
    
    // Centralized safe fetch with automatic JSON parsing and Error logging
    static async fetchJSON(url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                // Throttle requests using a simple await sleep
                await new Promise(r => setTimeout(r, this.RATE_LIMIT_DELAY));
                
                const response = await fetch(url);
                if (response.status === 429) {
                    console.warn(`[Network] 429 Rate Limit hit. Retrying in 2 seconds...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue; // Retry
                }
                
                if (!response.ok) {
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        console.error(`[Network] Fatal HTTP Error: ${response.status} ${response.statusText} for ${url}`);
                        return null; // Don't retry 4xx client errors
                    }
                    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
                }
                
                return await response.json();
            } catch (err) {
                console.error(`[Network] Request failed: ${url}`, err.message);
                if (i === retries - 1) {
                    console.error(`[Network] Max retries reached for ${url}`);
                    return null; // Return null instead of crashing the app
                }
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
            }
        }
        return null;
    }
}
