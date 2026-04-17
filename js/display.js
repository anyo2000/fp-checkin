// display.js — 태블릿 QR 표시 화면

(async function () {
  const canvas = document.getElementById('qrCanvas');
  const timerBarFill = document.getElementById('timerBarFill');
  const timerText = document.getElementById('timerText');
  const clockEl = document.getElementById('clock');
  const branchNameEl = document.getElementById('branchName');

  // URL 파라미터에서 지점 코드 추출
  const params = new URLSearchParams(window.location.search);
  const branch = params.get('branch') || 'default';
  branchNameEl.textContent = branch === 'default' ? '테스트 지점' : branch;

  let lastWindow = -1;

  /**
   * QR 코드 갱신
   */
  async function updateQR() {
    const { code, window, timestamp, remaining } = await TOTP.getCurrentCode(
      CONFIG.TOTP_SECRET,
      CONFIG.WINDOW_SEC
    );

    // 같은 윈도우면 QR 갱신 불필요 (타이머만 업데이트)
    if (window !== lastWindow) {
      lastWindow = window;

      // QR에 담을 URL 생성
      const checkinURL =
        CONFIG.BASE_URL +
        '/checkin.html?code=' +
        code +
        '&t=' +
        timestamp +
        '&branch=' +
        encodeURIComponent(branch);

      // QR 코드 렌더링
      QRCode.toCanvas(canvas, checkinURL, {
        width: 280,
        margin: 0,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    }

    // 타이머 업데이트
    timerText.textContent = remaining;
    const percent = (remaining / CONFIG.WINDOW_SEC) * 100;
    timerBarFill.style.width = percent + '%';

    // 색상 변경 (5초 이하면 주황, 3초 이하면 빨강)
    if (remaining <= 3) {
      timerBarFill.style.background = '#ef4444';
    } else if (remaining <= 5) {
      timerBarFill.style.background = '#f59e0b';
    } else {
      timerBarFill.style.background = '#3b82f6';
    }
  }

  /**
   * 시계 업데이트
   */
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = h + ':' + m + ':' + s;
  }

  // 1초마다 업데이트
  updateQR();
  updateClock();
  setInterval(() => {
    updateQR();
    updateClock();
  }, 1000);
})();

/**
 * 전체화면 토글
 */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}
