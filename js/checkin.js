// checkin.js — FP 출석 페이지 (v2: 4개 이벤트 + 토큰 인증)

(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');

  // QR 파라미터 없으면 안내
  if (!code || !t) {
    showError('QR로 들어와주세요', '지점 태블릿의 QR을 폰 카메라로 스캔해주세요.');
    return;
  }

  // 토큰 확인 → 모드 분기
  var token = localStorage.getItem('fp_checkin_token');
  var savedEmpId = localStorage.getItem('fp_checkin_empId');
  var savedEmpName = localStorage.getItem('fp_checkin_empName');

  if (token && savedEmpId) {
    // 등록된 기기 → 토큰 모드 (4개 이벤트 버튼)
    document.getElementById('formSection').style.display = 'none';
    document.getElementById('tokenSection').style.display = 'block';
    document.getElementById('tokenEmpName').textContent = savedEmpName || '';
    document.getElementById('tokenEmpId').textContent = '사번 ' + savedEmpId;
    checkTokenStatus(token);
  } else {
    // 최초 접속 → 사번 입력 모드 (출근 등록 고정)
    var empIdInput = document.getElementById('empId');
    empIdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCheckin();
    });
    empIdInput.focus();
  }
})();

/**
 * 4개 이벤트 버튼 상태 업데이트
 */
async function checkTokenStatus(token) {
  if (!CONFIG.GAS_URL) return;
  try {
    var res = await fetch(CONFIG.GAS_URL + '?action=checkStatus&token=' + encodeURIComponent(token));
    var status = await res.json();

    if (status.invalidToken) {
      localStorage.removeItem('fp_checkin_token');
      localStorage.removeItem('fp_checkin_empId');
      localStorage.removeItem('fp_checkin_empName');
      location.reload();
      return;
    }

    var title = document.getElementById('tokenTitle');
    var statusMsg = document.getElementById('tokenStatusMsg');

    // 전체 인사
    if (status.today && status.today.checkin && status.today.return) {
      title.textContent = '오늘도 수고하셨어요';
    } else if (status.today && status.today.checkin) {
      title.textContent = '오늘도 화이팅';
    } else {
      title.textContent = '오늘도 좋은 하루';
    }

    // 각 버튼 상태
    updateEventButton('출근', status);
    updateEventButton('귀소', status);
    updateEventButton('학습회', status);
    updateEventButton('퇴근', status);
  } catch (e) {
    console.error('상태 확인 실패:', e);
  }
}

function updateEventButton(eventType, status) {
  var btn = document.querySelector('.event-btn[data-event="' + eventType + '"]');
  var stateEl = document.getElementById('state-' + eventType);
  if (!btn || !stateEl || !status.today) return;

  var keyMap = { '출근': 'checkin', '귀소': 'return', '학습회': 'learning', '퇴근': 'leave' };
  var key = keyMap[eventType];
  var done = status.today[key];

  // 학습회는 무제한 — 항상 활성
  if (eventType === '학습회') {
    btn.classList.remove('disabled');
    stateEl.innerHTML = done ? '오늘 등록됨' : '&nbsp;';
    return;
  }

  if (done) {
    btn.classList.add('disabled');
    stateEl.textContent = '등록 완료';
  } else if (eventType === '귀소' && status.hourKST < 14) {
    btn.classList.add('disabled');
    stateEl.textContent = '14시 이후';
  } else {
    btn.classList.remove('disabled');
    stateEl.innerHTML = '&nbsp;';
  }
}

/**
 * 디바이스 토큰 생성
 */
function generateToken() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 토큰 모드 — 4개 버튼 클릭 진입점
 */
async function doEventCheckin(eventType) {
  var btn = document.querySelector('.event-btn[data-event="' + eventType + '"]');
  if (btn && btn.classList.contains('disabled')) {
    // 비활성 버튼 클릭 시 안내
    var stateEl = document.getElementById('state-' + eventType);
    if (stateEl && stateEl.textContent === '등록 완료') {
      showFlash('오늘 ' + eventType + '은 이미 등록되었어요');
    } else if (eventType === '귀소') {
      showFlash('귀소는 오후 2시부터 등록할 수 있어요');
    }
    return;
  }
  var token = localStorage.getItem('fp_checkin_token');
  var empId = localStorage.getItem('fp_checkin_empId');
  await processCheckin(token, empId, false, eventType);
}

function showFlash(msg) {
  var statusMsg = document.getElementById('tokenStatusMsg');
  if (!statusMsg) return;
  statusMsg.style.display = 'block';
  statusMsg.style.color = '#854d0e';
  statusMsg.textContent = msg;
  clearTimeout(showFlash._t);
  showFlash._t = setTimeout(function () {
    statusMsg.style.color = '#475569';
  }, 2500);
}

/**
 * 신규 등록 — 사번/이름 입력 → 확인 → 출근 등록 (출근 고정)
 */
var _pendingToken = null;

async function doCheckin() {
  var token = localStorage.getItem('fp_checkin_token');
  if (token) {
    // 토큰 모드는 doEventCheckin으로 처리
    return;
  }

  // 신규 등록 — 사번 + 이름 입력 → 확인 화면
  var empIdInput = document.getElementById('empId');
  var empNameInput = document.getElementById('empName');
  var empId = empIdInput.value.trim();
  var empName = empNameInput.value.trim();

  if (!empId || empId.length < 3) {
    showFieldError('사번을 입력해주세요');
    return;
  }
  if (!empName) {
    showFieldError('이름을 입력해주세요');
    return;
  }

  _pendingToken = generateToken();
  document.getElementById('confirmEmpId').textContent = empId;
  document.getElementById('confirmEmpName').textContent = empName;
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'block';
}

function cancelConfirm() {
  document.getElementById('confirmSection').style.display = 'none';
  document.getElementById('formSection').style.display = 'block';
  _pendingToken = null;
}

async function doCheckinConfirmed() {
  var empId = document.getElementById('empId').value.trim();
  // 신규 등록은 '출근' 고정
  await processCheckin(_pendingToken, empId, true, '출근');
}

async function processCheckin(token, empId, isNewDevice, eventType) {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');
  var branch = params.get('branch') || 'default';

  // TOTP 클라이언트 사전 검증
  var verification = await TOTP.verifyCode(
    CONFIG.TOTP_SECRET,
    code,
    CONFIG.WINDOW_SEC,
    CONFIG.GRACE_SEC
  );

  if (!verification.valid) {
    showError('QR이 새로 바뀌었어요', '태블릿의 QR을 다시 스캔해주세요.');
    return;
  }

  showLoading();

  var empName = isNewDevice
    ? document.getElementById('empName').value.trim()
    : (localStorage.getItem('fp_checkin_empName') || '');

  // GAS 미연결 — 로컬 테스트 모드
  if (!CONFIG.GAS_URL) {
    console.log('[테스트 모드]', { empId, empName, token: token.slice(0, 8) + '...', branch, eventType });
    if (isNewDevice) {
      localStorage.setItem('fp_checkin_token', token);
      localStorage.setItem('fp_checkin_empId', empId);
      localStorage.setItem('fp_checkin_empName', empName);
    }
    setTimeout(function () { showSuccess(empId, { type: eventType || '출근' }, empName); }, 1000);
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
        eventType: eventType || '',
        code: code,
        t: parseInt(t),
        branch: branch,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });

    var result = await response.json();

    if (result.success) {
      if (isNewDevice) {
        localStorage.setItem('fp_checkin_token', token);
        localStorage.setItem('fp_checkin_empId', empId);
        localStorage.setItem('fp_checkin_empName', empName);
      }
      showSuccess(empId, result, empName);
    } else if (result.error && result.error.indexOf('등록되지 않은 기기') >= 0) {
      localStorage.removeItem('fp_checkin_token');
      localStorage.removeItem('fp_checkin_empId');
      localStorage.removeItem('fp_checkin_empName');
      location.reload();
      return;
    } else {
      showError(result.error || '등록 처리에 실패했어요', '잠시 후 다시 시도해주세요.');
    }
  } catch (err) {
    console.error('GAS 통신 에러:', err);
    showError('서버 연결 실패', '네트워크를 확인하고 다시 시도해주세요.');
  }
}

function showLoading() {
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('tokenSection').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'none';
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
  var headerText;
  if (type === '귀소') headerText = '귀소 확인 완료됐어요';
  else if (type === '학습회') headerText = '학습회 확인되었습니다';
  else if (type === '퇴근') headerText = '퇴근 확인 완료됐어요';
  else headerText = '출근 확인되었습니다';

  document.getElementById('resultTime').textContent = timeStr;
  document.querySelector('#successSection .result-message').textContent = headerText;
  var detailText = (empName ? empName + ' | ' : '') + '사번 ' + empId;
  if (serverResult?.scanCount) detailText += ' | 오늘 ' + serverResult.scanCount + '번째';
  document.getElementById('resultDetail').textContent = detailText;

  // 인사말 (LLM 멘트는 #5에서 채워질 자리, 지금은 기본 문구)
  var greetingEl = document.getElementById('resultGreeting');
  if (greetingEl) {
    if (type === '귀소') greetingEl.textContent = '오늘 활동 고생 많으셨습니다.';
    else if (type === '학습회') greetingEl.textContent = '학습 잘 다녀오세요.';
    else if (type === '퇴근') greetingEl.textContent = '오늘 하루 수고 많으셨습니다.';
    else greetingEl.textContent = '오늘 하루도 화이팅입니다.';
  }

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
