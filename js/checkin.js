// checkin.js — FP 출석 페이지

(function () {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const t = params.get('t');
  const branch = params.get('branch') || 'default';

  const empIdInput = document.getElementById('empId');
  const checkinBtn = document.getElementById('checkinBtn');
  const errorMsg = document.getElementById('errorMsg');

  // 로컬스토리지에서 마지막 사번 복원
  const savedEmpId = localStorage.getItem('fp_checkin_empId');
  if (savedEmpId) {
    empIdInput.value = savedEmpId;
  }

  // QR 파라미터 없으면 안내
  if (!code || !t) {
    showError('직접 접속 불가', '태블릿의 QR 코드를 카메라로 스캔해주세요.');
    return;
  }

  // Enter 키로 출근
  empIdInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      doCheckin();
    }
  });

  // 포커스
  empIdInput.focus();
})();

/**
 * 출근 처리
 */
async function doCheckin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const t = params.get('t');
  const branch = params.get('branch') || 'default';

  const empIdInput = document.getElementById('empId');
  const empId = empIdInput.value.trim();

  // 사번 검증
  if (!empId || empId.length < 3) {
    showFieldError('사번을 입력해주세요');
    return;
  }

  // 사번 저장
  localStorage.setItem('fp_checkin_empId', empId);

  // TOTP 클라이언트 사전 검증 (빠른 피드백용)
  const verification = await TOTP.verifyCode(
    CONFIG.TOTP_SECRET,
    code,
    CONFIG.WINDOW_SEC,
    CONFIG.GRACE_SEC
  );

  if (!verification.valid) {
    showError('QR이 만료되었습니다', '태블릿의 QR을 다시 스캔해주세요.');
    return;
  }

  // 로딩 표시
  showLoading();

  // GAS로 전송
  if (!CONFIG.GAS_URL) {
    // GAS 미연결 상태 — 로컬 테스트 모드
    console.log('[테스트 모드] 출근 데이터:', {
      empId,
      code,
      t,
      branch,
      timestamp: Math.floor(Date.now() / 1000),
      verified: verification.valid,
    });

    // 테스트용 성공 표시 (1초 딜레이)
    setTimeout(function () {
      showSuccess(empId);
    }, 1000);
    return;
  }

  // 실제 GAS 전송
  try {
    const response = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'checkin',
        empId: empId,
        code: code,
        t: parseInt(t),
        branch: branch,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });

    const result = await response.json();

    if (result.success) {
      showSuccess(empId, result);
    } else {
      showError(result.error || '출근 처리 실패', '다시 시도해주세요.');
    }
  } catch (err) {
    console.error('GAS 통신 에러:', err);
    showError('서버 연결 실패', '네트워크를 확인하고 다시 시도해주세요.');
  }
}

function showLoading() {
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'block';
}

function showSuccess(empId, serverResult) {
  document.getElementById('loadingSection').style.display = 'none';

  const now = new Date();
  const timeStr =
    String(now.getHours()).padStart(2, '0') +
    ':' +
    String(now.getMinutes()).padStart(2, '0');

  const type = serverResult?.type || '출근';

  document.getElementById('resultTime').textContent = timeStr;
  document.querySelector('#successSection .result-message').textContent =
    type + ' 완료';
  document.getElementById('resultDetail').textContent =
    '사번 ' + empId + (serverResult?.scanCount ? ' | 오늘 ' + serverResult.scanCount + '번째' : '');

  const section = document.getElementById('successSection');
  section.style.display = 'block';
  section.classList.add('show');
}

function showError(title, detail) {
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'none';
  document.getElementById('errorTitle').textContent = title;
  document.querySelector('#errorSection .result-detail').textContent = detail;

  const section = document.getElementById('errorSection');
  section.style.display = 'block';
  section.classList.add('show');
}

function showFieldError(msg) {
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(function () {
    errorMsg.style.display = 'none';
  }, 3000);
}
