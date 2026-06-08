// checkin.js — FP 출석 페이지 (v3: 디자인 리뉴얼 + 타이핑 + 이번주 인디케이터)

(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');

  if (!code || !t) {
    showError('QR로 들어와주세요', '지점 태블릿의 QR을 폰 카메라로 스캔해주세요.');
    return;
  }

  var token = localStorage.getItem('fp_checkin_token');
  var savedEmpId = localStorage.getItem('fp_checkin_empId');
  var savedEmpName = localStorage.getItem('fp_checkin_empName');

  if (token && savedEmpId) {
    document.getElementById('formSection').style.display = 'none';
    document.getElementById('tokenSection').style.display = 'block';
    document.getElementById('tokenEmpName').textContent = savedEmpName || '';
    document.getElementById('tokenEmpId').textContent = '사번 ' + savedEmpId;
    renderWeeklyPlaceholder();
    checkTokenStatus(token, savedEmpName, params.get('branch') || '');
  } else {
    var empIdInput = document.getElementById('empId');
    empIdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCheckin();
    });
    empIdInput.focus();
  }
})();

function timeBasedGreeting(hour) {
  if (hour < 11) return '좋은 아침이에요';
  if (hour < 14) return '점심 잘 챙겨드세요';
  if (hour < 18) return '오후도 화이팅이에요';
  return '오늘 하루도 수고 많으셨어요';
}

function renderWeeklyPlaceholder() {
  var weekdays = ['월', '화', '수', '목', '금'];
  var todayIdx = (new Date().getDay() - 1 + 7) % 7;
  var html = '';
  for (var i = 0; i < 5; i++) {
    var cls = 'day-cell';
    if (i === todayIdx && i < 5) cls += ' today';
    html += '<div class="' + cls + '"><span class="day-check">·</span><span class="day-label">' + weekdays[i] + '</span></div>';
  }
  var el = document.getElementById('weeklyDays');
  if (el) el.innerHTML = html;
}

function renderWeekly(weekly) {
  if (!weekly) return;
  var weekdays = ['월', '화', '수', '목', '금'];
  var todayIdx = (new Date().getDay() - 1 + 7) % 7;
  var html = '';
  var done = 0;
  for (var i = 0; i < 5; i++) {
    var cls = 'day-cell';
    var checked = weekly[weekdays[i]] === true || weekly[weekdays[i]] === 'true';
    if (checked) { cls += ' done'; done++; }
    if (i === todayIdx && i < 5) cls += ' today';
    var icon = checked ? '✓' : (i === todayIdx ? '·' : '·');
    html += '<div class="' + cls + '"><span class="day-check">' + icon + '</span><span class="day-label">' + weekdays[i] + '</span></div>';
  }
  var el = document.getElementById('weeklyDays');
  if (el) el.innerHTML = html;
  var countEl = document.getElementById('weeklyCount');
  if (countEl) countEl.textContent = done + ' / 5';
}

async function checkTokenStatus(token, empName, branchCode) {
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

    var titleEl = document.getElementById('tokenTitle');
    if (titleEl) titleEl.textContent = timeBasedGreeting(status.hourKST != null ? status.hourKST : new Date().getHours());

    if (status.weekly) renderWeekly(status.weekly);

    updateEventButton('출근', status);
    updateEventButton('귀소', status);
    updateEventButton('학습회', status);
    updateEventButton('퇴근', status);

    // AI 인사말 fetch (출근 전이면 morning 톤, 출근 후면 다른 톤)
    var ctxType = status.today && status.today.checkin ? '진행 중' : '출근 전';
    fetchTokenGreeting({
      empName: empName,
      branchName: status.branchName || '',
      type: ctxType,
      time: new Date().toTimeString().slice(0, 5),
    });
  } catch (e) {
    console.error('상태 확인 실패:', e);
  }
}

async function fetchTokenGreeting(data) {
  if (!CONFIG.GAS_URL) return;
  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'greeting', ...data }),
    });
    var result = await res.json();
    var el = document.getElementById('tokenAiGreeting');
    if (!el) return;
    if (result.success && result.greeting) {
      typeText(el, result.greeting, 35);
    } else {
      el.textContent = '오늘도 좋은 하루 만들어가요';
    }
  } catch (e) {
    var el = document.getElementById('tokenAiGreeting');
    if (el) el.textContent = '오늘도 좋은 하루 만들어가요';
  }
}

function typeText(el, text, speed) {
  el.textContent = '';
  el.classList.add('typing');
  var i = 0;
  function tick() {
    if (i < text.length) {
      el.textContent += text.charAt(i);
      i++;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('typing');
    }
  }
  tick();
}

function updateEventButton(eventType, status) {
  var btn = document.querySelector('.event-btn[data-event="' + eventType + '"]');
  var stateEl = document.getElementById('state-' + eventType);
  if (!btn || !stateEl || !status.today) return;

  var keyMap = { '출근': 'checkin', '귀소': 'return', '학습회': 'learning', '퇴근': 'leave' };
  var key = keyMap[eventType];
  var done = status.today[key];

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

function generateToken() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function doEventCheckin(eventType) {
  var btn = document.querySelector('.event-btn[data-event="' + eventType + '"]');
  if (btn && btn.classList.contains('disabled')) {
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
  statusMsg.textContent = msg;
  clearTimeout(showFlash._t);
  showFlash._t = setTimeout(function () {
    statusMsg.style.display = 'none';
  }, 2500);
}

var _pendingToken = null;

async function doCheckin() {
  var token = localStorage.getItem('fp_checkin_token');
  if (token) return;

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
  await processCheckin(_pendingToken, empId, true, '출근');
}

function getCurrentLocation() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject({ code: 'NO_GEO', message: '이 기기는 GPS를 지원하지 않아요' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      function (err) {
        var code = 'GPS_FAIL';
        var msg = '위치를 가져오지 못했어요';
        if (err.code === 1) { code = 'DENIED'; msg = '위치 권한이 차단되어 있어요'; }
        else if (err.code === 2) { code = 'UNAVAILABLE'; msg = '위치 신호가 약해요'; }
        else if (err.code === 3) { code = 'TIMEOUT'; msg = '위치 확인이 너무 오래 걸려요'; }
        reject({ code: code, message: msg });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

async function processCheckin(token, empId, isNewDevice, eventType) {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var t = params.get('t');
  var branch = params.get('branch') || 'default';

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

  var geo = null;
  try {
    geo = await getCurrentLocation();
  } catch (err) {
    geo = null;
  }

  if (!CONFIG.GAS_URL) {
    console.log('[테스트 모드]', { empId, empName, token: token.slice(0, 8) + '...', branch, eventType, geo });
    if (isNewDevice) {
      localStorage.setItem('fp_checkin_token', token);
      localStorage.setItem('fp_checkin_empId', empId);
      localStorage.setItem('fp_checkin_empName', empName);
    }
    setTimeout(function () { showSuccess(empId, { type: eventType || '출근' }, empName); }, 1000);
    return;
  }

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
        lat: geo ? geo.lat : null,
        lng: geo ? geo.lng : null,
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
    } else if (result.code === 'OUT_OF_RANGE') {
      showError('지점에서 너무 떨어져 있어요', result.error || '지점 반경 내에서 다시 시도해주세요.');
    } else if (result.code === 'NO_LOCATION') {
      showError('위치 권한이 필요해요', 'Safari 설정 > 위치 > 허용으로 변경 후 다시 시도해주세요.');
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
    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var type = serverResult && serverResult.type ? serverResult.type : '출근';
  var headerText;
  if (type === '귀소') headerText = '귀소 확인되었어요';
  else if (type === '학습회') headerText = '학습회 확인되었어요';
  else if (type === '퇴근') headerText = '퇴근 확인되었어요';
  else headerText = '출근 확인되었어요';

  document.getElementById('resultTime').textContent = timeStr;
  document.querySelector('#successSection .result-message').textContent = headerText;
  var detailText = (empName ? empName + ' · ' : '') + '사번 ' + empId;
  if (serverResult && serverResult.scanCount) detailText += ' · 오늘 ' + serverResult.scanCount + '번째';
  document.getElementById('resultDetail').textContent = detailText;

  var greetingEl = document.getElementById('resultGreeting');
  if (greetingEl) {
    var fallback;
    if (type === '귀소') fallback = '오늘 활동 고생 많으셨어요.';
    else if (type === '학습회') fallback = '학습 잘 다녀오세요.';
    else if (type === '퇴근') fallback = '오늘 하루 수고 많으셨어요.';
    else fallback = '오늘 하루도 화이팅이에요.';
    greetingEl.textContent = fallback;
  }

  var section = document.getElementById('successSection');
  section.style.display = 'block';
  section.classList.add('show');

  fetchGreeting({
    empName: empName,
    branchName: (serverResult && serverResult.branch) || '',
    status: (serverResult && serverResult.status) || '',
    type: type,
    time: timeStr,
  });
}

async function fetchGreeting(data) {
  if (!CONFIG.GAS_URL) return;
  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'greeting', ...data }),
    });
    var result = await res.json();
    if (result.success && result.greeting) {
      var el = document.getElementById('resultGreeting');
      if (el) typeText(el, result.greeting, 35);
    }
  } catch (e) {
    // 실패 시 기본 인사말 유지
  }
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
