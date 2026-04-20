// display.js — 태블릿 QR 표시 화면

(async function () {
  const qrContainer = document.getElementById('qrContainer');
  const timerBarFill = document.getElementById('timerBarFill');
  const timerText = document.getElementById('timerText');
  const clockEl = document.getElementById('clock');
  const branchNameEl = document.getElementById('branchName');

  // URL 파라미터에서 코드 추출 (code 또는 branch)
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || params.get('branch') || 'default';

  // 조직명 가져오기
  if (CONFIG.GAS_URL && code !== 'default') {
    try {
      var res = await fetch(CONFIG.GAS_URL + '?action=branches');
      var orgs = await res.json();
      var node = orgs.find(function (o) { return o.code === code; });
      branchNameEl.textContent = node ? node.name : code;
    } catch (e) {
      branchNameEl.textContent = code;
    }
  } else {
    branchNameEl.textContent = code === 'default' ? '테스트 지점' : code;
  }

  let lastWindow = -1;
  let qrInstance = null;

  async function updateQR() {
    const { code: totpCode, window, timestamp, remaining } = await TOTP.getCurrentCode(
      CONFIG.TOTP_SECRET,
      CONFIG.WINDOW_SEC
    );

    if (window !== lastWindow) {
      lastWindow = window;

      const checkinURL =
        CONFIG.BASE_URL +
        '/checkin.html?code=' +
        totpCode +
        '&t=' +
        timestamp +
        '&branch=' +
        encodeURIComponent(code);

      if (qrInstance) {
        qrInstance.clear();
        qrInstance.makeCode(checkinURL);
      } else {
        qrInstance = new QRCode(qrContainer, {
          text: checkinURL,
          width: 280,
          height: 280,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
      }
    }

    // 타이머 — MM:SS 형식
    var mins = Math.floor(remaining / 60);
    var secs = remaining % 60;
    timerText.textContent = mins + ':' + String(secs).padStart(2, '0');

    var percent = (remaining / CONFIG.WINDOW_SEC) * 100;
    timerBarFill.style.width = percent + '%';

    if (remaining <= 30) {
      timerBarFill.style.background = '#ef4444';
    } else if (remaining <= 60) {
      timerBarFill.style.background = '#f59e0b';
    } else {
      timerBarFill.style.background = '#3b82f6';
    }
  }

  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = h + ':' + m + ':' + s;
  }

  updateQR();
  updateClock();
  setInterval(() => {
    updateQR();
    updateClock();
  }, 1000);
})();

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}
