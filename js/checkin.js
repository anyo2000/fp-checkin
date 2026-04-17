// checkin.js — FP 출석 페이지 (토큰 인증)

(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');

  // QR 파라미터 없으면 안내
  if (!code || !t) {
    showError('직접 접속 불가', '태블릿의 QR 코드를 카메라로 스캔해주세요.');
    return;
  }

  // 토큰 확인 → 모드 분기
  var token = localStorage.getItem('fp_checkin_token');
  var savedEmpId = localStorage.getItem('fp_checkin_empId');

  var savedEmpName = localStorage.getItem('fp_checkin_empName');

  if (token && savedEmpId) {
    // 등록된 기기 → 토큰 모드
    document.getElementById('formSection').style.display = 'none';
    document.getElementById('tokenSection').style.display = 'block';
    document.getElementById('tokenEmpName').textContent = savedEmpName || '';
    document.getElementById('tokenEmpId').textContent = '사번 ' + savedEmpId;
  } else {
    // 최초 접속 → 사번 입력 모드
    var empIdInput = document.getElementById('empId');
    empIdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCheckin();
    });
    empIdInput.focus();
  }
})();

/**
 * 디바이스 토큰 생성
 */
function generateToken() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 출근 처리
 */
async function doCheckin() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');
  var branch = params.get('branch') || 'default';

  var token = localStorage.getItem('fp_checkin_token');
  var empId = null;
  var isNewDevice = false;

  if (token) {
    // 토큰 모드 — localStorage에서 사번 가져옴
    empId = localStorage.getItem('fp_checkin_empId');
  } else {
    // 최초 등록 — 사번 + 이름 입력
    var empIdInput = document.getElementById('empId');
    var empNameInput = document.getElementById('empName');
    empId = empIdInput.value.trim();
    var empName = empNameInput.value.trim();

    if (!empId || empId.length < 3) {
      showFieldError('사번을 입력해주세요');
      return;
    }
    if (!empName) {
      showFieldError('이름을 입력해주세요');
      return;
    }

    token = generateToken();
    isNewDevice = true;
  }

  // TOTP 클라이언트 사전 검증
  var verification = await TOTP.verifyCode(
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

  var empName = isNewDevice ? document.getElementById('empName').value.trim() : (localStorage.getItem('fp_checkin_empName') || '');

  // GAS 미연결 — 로컬 테스트 모드
  if (!CONFIG.GAS_URL) {
    console.log('[테스트 모드] 출근 데이터:', { empId, empName, token: token.slice(0, 8) + '...', branch });
    if (isNewDevice) {
      localStorage.setItem('fp_checkin_token', token);
      localStorage.setItem('fp_checkin_empId', empId);
      localStorage.setItem('fp_checkin_empName', empName);
    }
    setTimeout(function () { showSuccess(empId, null, empName); }, 1000);
    return;
  }

  // GAS 전송
  try {
    var response = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'checkin',
        empId: empId,
        empName: empName,
        token: token,
        isNewDevice: isNewDevice,
        code: code,
        t: parseInt(t),
        branch: branch,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });

    var result = await response.json();

    if (result.success) {
      // 최초 등록 성공 → 토큰 저장
      if (isNewDevice) {
        localStorage.setItem('fp_checkin_token', token);
        localStorage.setItem('fp_checkin_empId', empId);
        localStorage.setItem('fp_checkin_empName', empName);
      }
      showSuccess(empId, result, empName);
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
  document.getElementById('tokenSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'block';
}

function showSuccess(empId, serverResult, empName) {
  document.getElementById('loadingSection').style.display = 'none';

  var now = new Date();
  var timeStr =
    String(now.getHours()).padStart(2, '0') +
    ':' +
    String(now.getMinutes()).padStart(2, '0');

  var type = serverResult?.type || '출근';

  document.getElementById('resultTime').textContent = timeStr;
  document.querySelector('#successSection .result-message').textContent =
    type + ' 완료';
  var detailText = (empName ? empName + ' | ' : '') + '사번 ' + empId;
  if (serverResult?.scanCount) detailText += ' | 오늘 ' + serverResult.scanCount + '번째';
  document.getElementById('resultDetail').textContent = detailText;

  var section = document.getElementById('successSection');
  section.style.display = 'block';
  section.classList.add('show');
}

function showError(title, detail) {
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('tokenSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'none';
  document.getElementById('errorTitle').textContent = title;
  document.querySelector('#errorSection .result-detail').textContent = detail;

  var section = document.getElementById('errorSection');
  section.style.display = 'block';
  section.classList.add('show');
}

function showFieldError(msg) {
  var errorMsg = document.getElementById('errorMsg');
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(function () {
    errorMsg.style.display = 'none';
  }, 3000);
}
