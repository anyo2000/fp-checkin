// display.js — 태블릿 QR 표시 화면

(function () {
  const qrContainer = document.getElementById('qrContainer');
  const timerBarFill = document.getElementById('timerBarFill');
  const timerText = document.getElementById('timerText');
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date');
  const branchNameEl = document.getElementById('branchName');

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || params.get('branch') || 'default';

  // 1) 시계 — 가장 먼저, 다른 어떤 비동기 호출에도 의존 X
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = h + ':' + m;
    if (dateEl) {
      const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
      dateEl.textContent = (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + weekdays[now.getDay()] + ')';
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // 2) 지점명 — fire-and-forget. 실패해도 placeholder 폴백
  branchNameEl.textContent = code === 'default' ? '테스트 지점' : code;
  if (CONFIG.GAS_URL && code !== 'default') {
    fetch(CONFIG.GAS_URL + '?action=branches')
      .then(function (r) { return r.json(); })
      .then(function (orgs) {
        var node = orgs.find(function (o) { return o.code === code; });
        if (node) branchNameEl.textContent = node.name;
      })
      .catch(function () { /* 폴백: code 표시 유지 */ });
  }

  // 3) QR — 별도 루프. 첫 호출 실패해도 다음 tick에 재시도
  let lastWindow = -1;
  let qrInstance = null;

  async function updateQR() {
    try {
      const result = await TOTP.getCurrentCode(CONFIG.TOTP_SECRET, CONFIG.WINDOW_SEC);
      const totpCode = result.code;
      const windowIdx = result.window;
      const timestamp = result.timestamp;
      const remaining = result.remaining;

      if (windowIdx !== lastWindow) {
        lastWindow = windowIdx;

        const checkinURL = CONFIG.BASE_URL +
          '/checkin.html?code=' + totpCode +
          '&t=' + timestamp +
          '&branch=' + encodeURIComponent(code);

        if (qrInstance) {
          qrInstance.clear();
          qrInstance.makeCode(checkinURL);
        } else if (typeof QRCode !== 'undefined') {
          qrInstance = new QRCode(qrContainer, {
            text: checkinURL,
            width: 280,
            height: 280,
            colorDark: '#001E4E',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
          });
        }
      }

      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      timerText.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

      var percent = (remaining / CONFIG.WINDOW_SEC) * 100;
      timerBarFill.style.width = percent + '%';

      if (remaining <= 30) {
        timerBarFill.style.background = '#EF4444';
      } else {
        timerBarFill.style.background = '#FF6600';
      }
    } catch (err) {
      console.error('QR 업데이트 실패:', err);
    }
  }

  updateQR();
  setInterval(updateQR, 1000);
})();

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}
