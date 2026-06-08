// checkin.js — FP 출석 페이지 (v3.7: 임팩트 효과 1차 — ripple, 햅틱, 체크 morph, 컨페티)

// ===== 임팩트 헬퍼 =====
function haptic(ms) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms || 25); } catch (e) {}
  }
}

function addRipple(e, btn) {
  var rect = btn.getBoundingClientRect();
  var size = Math.max(rect.width, rect.height);
  var x = (e.clientX || (rect.left + rect.width / 2)) - rect.left - size / 2;
  var y = (e.clientY || (rect.top + rect.height / 2)) - rect.top - size / 2;
  var span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = size + 'px';
  span.style.left = x + 'px';
  span.style.top = y + 'px';
  btn.appendChild(span);
  setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 600);
}

function bindEventBtnEffects() {
  var btns = document.querySelectorAll('.event-btn');
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    if (btn._fxBound) continue;
    btn._fxBound = true;
    btn.addEventListener('click', function (e) {
      if (this.classList.contains('disabled')) {
        haptic(15);
        return;
      }
      haptic(25);
      addRipple(e, this);
    });
  }
}

// 출근 직전 status 스냅샷 — 마일스톤 판정에 사용
var _statusBeforeCheckin = null;

function checkMilestone(before, eventType) {
  if (!before) return null;
  if (eventType !== '출근') return null;
  if (before.today && before.today.checkin) return null; // 이미 출근 상태였으면 마일스톤 없음
  var newMonth = (before.monthCheckinDays || 0) + 1;
  var newStreak = (before.streak || 0) + 1;

  if (newStreak === 30 || newMonth === 20) return 'huge';
  if (newStreak === 14 || newStreak === 7) return 'normal';
  if (newMonth === 15 || newMonth === 10 || newMonth === 5) return 'normal';
  if (newStreak === 3) return 'normal';
  if (newMonth === 1) return 'normal';
  return null;
}

function fireConfetti(intensity) {
  if (typeof confetti !== 'function') return;
  var colors = ['#FF6600', '#FF9933', '#001E4E', '#FFD700', '#FFFFFF'];
  if (intensity === 'huge') {
    confetti({ particleCount: 140, spread: 100, origin: { y: 0.55 }, colors: colors });
    setTimeout(function () {
      confetti({ particleCount: 90, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors: colors });
      confetti({ particleCount: 90, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors: colors });
    }, 280);
  } else {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: colors });
  }
}


(function () {
  if (window.__SKIP_AUTO_INIT) return;
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
    bindEventBtnEffects();
    checkTokenStatus(token, savedEmpName, savedEmpId, params.get('branch') || '');
  } else {
    var empIdInput = document.getElementById('empId');
    empIdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCheckin();
    });
    empIdInput.focus();
  }
})();

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

async function checkTokenStatus(token, empName, empId, branchCode) {
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

    _statusBeforeCheckin = status;

    if (status.weekly) renderWeekly(status.weekly);
    renderProgress(status);
    renderStreak(status);

    updateEventButton('출근', status);
    updateEventButton('귀소', status);
    updateEventButton('학습회', status);
    updateEventButton('퇴근', status);

    var ctxType = status.today && status.today.checkin ? '진행 중' : '출근 전';
    fetchTokenGreeting({
      empName: empName,
      empId: empId,
      branchName: status.branchName || '',
      type: ctxType,
      time: new Date().toTimeString().slice(0, 5),
    });
  } catch (e) {
    console.error('상태 확인 실패:', e);
  }
}

function getBusinessDaysInMonth(date) {
  var year = date.getFullYear();
  var month = date.getMonth();
  var lastDay = new Date(year, month + 1, 0).getDate();
  var count = 0;
  for (var d = 1; d <= lastDay; d++) {
    var wd = new Date(year, month, d).getDay();
    if (wd >= 1 && wd <= 5) count++;
  }
  return count;
}

function renderProgress(status) {
  var card = document.getElementById('progressCard');
  if (!card) return;
  var current = status.monthCheckinDays || 0;
  var total = getBusinessDaysInMonth(new Date());
  var pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  document.getElementById('progressCurrent').textContent = current;
  document.getElementById('progressTotal').textContent = total;
  card.style.display = 'block';

  // 다음 마일스톤 — streak 또는 월간 중 가까운 것 우선
  var streak = status.streak || 0;
  var streakTargets = [3, 7, 14, 30];
  var monthTargets = [5, 10, 15, 20];
  var nextStreak = null;
  for (var i = 0; i < streakTargets.length; i++) {
    if (streakTargets[i] > streak) { nextStreak = streakTargets[i]; break; }
  }
  var nextMonth = null;
  for (var j = 0; j < monthTargets.length; j++) {
    if (monthTargets[j] > current) { nextMonth = monthTargets[j]; break; }
  }

  var next = '';
  // streak 1일 이상일 때만 streak 마일스톤 우선 노출 (의미 있을 때만)
  if (streak >= 1 && nextStreak !== null) {
    next = '연속 ' + nextStreak + '일까지 ' + (nextStreak - streak) + '일';
  } else if (nextMonth !== null) {
    next = '이번달 ' + nextMonth + '일째까지 ' + (nextMonth - current) + '일';
  } else if (current < total) {
    next = '이번달 만근까지 ' + (total - current) + '일';
  } else {
    next = '이번달 만근 달성';
  }
  document.getElementById('progressNext').textContent = next;

  // 게이지 채우기 — 다음 프레임에 width 적용해서 transition 발동
  requestAnimationFrame(function () {
    document.getElementById('progressBarFill').style.width = pct + '%';
  });
}

function renderStreak(status) {
  var card = document.getElementById('streakCard');
  if (!card) return;
  var monthDays = status.monthCheckinDays || 0;
  var streak = status.streak || 0;
  var lastWeekPerfect = !!status.lastWeekPerfect;

  var headline = '';
  var sub = '';
  var icon = '';

  if (lastWeekPerfect) {
    headline = '지난주 5일 매일 출근';
    sub = '이번 주도 이어가요';
    icon = '🔥';
  } else if (streak >= 3) {
    headline = streak + '일 연속 출근 중';
    sub = '이번달 누적 ' + monthDays + '일';
    icon = '🔥';
  } else if (monthDays >= 5) {
    headline = '이번달 ' + monthDays + '일째 출근';
    sub = '꾸준한 모습 좋아요';
    icon = '✦';
  } else if (monthDays > 0) {
    headline = '이번달 ' + monthDays + '일 출근';
    sub = '오늘도 함께해요';
    icon = '·';
  } else {
    card.style.display = 'none';
    return;
  }

  document.getElementById('streakIcon').textContent = icon;
  document.getElementById('streakHeadline').textContent = headline;
  document.getElementById('streakSub').textContent = sub;
  card.style.display = 'flex';
}

function immediateFallback(empName, ctxOrType) {
  var name = (empName || '').trim();
  var prefix = name ? name + '님, ' : '';
  if (ctxOrType === '진행 중') return prefix + '오늘도 함께해요';
  if (ctxOrType === '출근 전') return prefix + '좋은 아침이에요';
  if (ctxOrType === '귀소') return prefix + '복귀 확인됐어요';
  if (ctxOrType === '학습회') return prefix + '학습회 등록됐어요';
  if (ctxOrType === '퇴근') return prefix + '오늘 잘 마무리됐어요';
  return prefix + '오늘도 시작해볼게요';
}

// 마침표 단위 줄바꿈 — AI 멘트 가독성
function splitSentences(text) {
  if (!text) return text;
  return text.replace(/([.!?])\s+/g, '$1\n').trim();
}

async function fetchTokenGreeting(data) {
  if (!CONFIG.GAS_URL) return;
  var el = document.getElementById('tokenAiGreeting');
  if (!el) return;
  el.classList.remove('typing');
  el.textContent = immediateFallback(data.empName, data.type);
  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'greeting', ...data }),
    });
    var result = await res.json();
    if (result.success && result.greeting) {
      typeText(el, splitSentences(result.greeting), 20);
    }
  } catch (e) {
    // fallback 유지
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
    greetingEl.classList.remove('typing');
    greetingEl.textContent = immediateFallback(empName, type);
  }

  var section = document.getElementById('successSection');
  section.style.display = 'block';
  section.classList.add('show');

  // 성공 진입 햅틱 + 마일스톤 컨페티
  haptic(45);
  var milestone = checkMilestone(_statusBeforeCheckin, type);
  if (milestone) {
    setTimeout(function () { fireConfetti(milestone); }, 250);
  }

  fetchGreeting({
    empName: empName,
    empId: empId,
    branchName: (serverResult && serverResult.branch) || '',
    status: (serverResult && serverResult.status) || '',
    type: type,
    time: timeStr,
  });
}

async function fetchGreeting(data) {
  if (!CONFIG.GAS_URL) return;
  var el = document.getElementById('resultGreeting');
  if (!el) return;
  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'greeting', ...data }),
    });
    var result = await res.json();
    if (result.success && result.greeting) {
      typeText(el, splitSentences(result.greeting), 20);
    }
  } catch (e) {
    // fallback 유지
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
