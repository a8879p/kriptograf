// UI helpers — extracted from 666BTC2graf.html (Stage 1 refactor)
export function fmtP(n) {
    // \u202F = NARROW NO-BREAK SPACE (~half digit width)
    return Math.round(n).toLocaleString('ru-RU').replace(/\u00A0|\s/g, '\u202F');
}

export function triggerAlert(msg, type = 'info') {
    const box = document.getElementById('alertBox');
    box.textContent = msg;
    box.className = `alert ${type}`;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.style.display = 'none'; }, 4000);
}

export function setLoading(on) {
    document.getElementById('chartLoading').classList.toggle('visible', on);
    document.getElementById('btnRefresh').disabled = on;
}