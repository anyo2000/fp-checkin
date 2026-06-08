// checkin-demo.js — 데모 모드. 시트에 안 남김. checkin.js 헬퍼 재사용 (haptic, addRipple, fireConfetti, checkMilestone, renderProgress, renderStreak, renderWeekly, typeText, immediateFallback).

var _demoStatus = null;     // 사번 불러왔을 때 GAS가 준 진짜 status
var _demoScenario = 'real'; // 시나리오 강제 키
var _demoEmpName = '';
var _demoBranchName = '';
var _demoCustomTime = '08:32'; // 불러오기 누를 때 잠금되는 시연 시각

function setScenario(btn) {
  document.querySelectorAll('.demo-scenario').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _demoScenario = btn.getAttribute('data-sc');

  // 시나리오 선택 즉시 화면 미리보기 — progress·streak·weekly·버튼 갱신
  // applyScenario가 today.checkin=false 강제하므로 출근 버튼 항상 활성
  if (!_demoStatus) return;
  var preview = applyScenario(_demoScenario, _demoStatus);
  if (typeof renderWeekly === 'function' && preview.weekly) renderWeekly(preview.weekly);
  if (typeof renderProgress === 'function') renderProgress(preview);
  if (typeof renderStreak === 'function') renderStreak(preview);
  if (typeof updateEventButton === 'function') {
    updateEventButton('출근', preview);
    updateEventButton('귀소', preview);
    updateEventButton('학습회', preview);
    updateEventButton('퇴근', preview);
  }
}

async function loadDemoEmp() {
  var empId = document.getElementById('demoEmpId').value.trim();
  if (!empId) { alert('사번을 입력하세요'); return; }
  var timeInput = document.getElementById('demoTime').value || '08:32';
  _demoCustomTime = timeInput.slice(0, 5);
  var btn = document.getElementById('demoLoadBtn');
  btn.disabled = true;
  btn.textContent = '불러오는 중...';

  try {
    var res = await fetch(CONFIG.GAS_URL + '?action=demoStatus&empId=' + encodeURIComponent(empId));
    var status = await res.json();
    if (!status.success) {
      alert('조회 실패: ' + (status.error || '알 수 없음'));
      return;
    }
    _demoStatus = status;
    _demoEmpName = status.empName || '(이름 없음)';
    _demoBranchName = status.branchName || '';

    // 정보 카드 표시
    var infoEl = document.getElementById('demoEmpInfo');
    infoEl.style.display = 'block';
    infoEl.innerHTML = '<strong>' + _demoEmpName + '</strong> · ' +
      (_demoBranchName ? _demoBranchName + ' · ' : '') +
      '이번달 ' + status.monthCheckinDays + '일 · ' +
      '연속 ' + status.streak + '일' +
      (status.lastWeekPerfect ? ' · 지난주 만근' : '');

    // 토큰 모드 화면 렌더
    document.getElementById('tokenEmpName').textContent = _demoEmpName;
    document.getElementById('tokenEmpId').textContent = '사번 ' + empId;

    // success 화면 숨기고 토큰 화면 표시
    var successEl = document.getElementById('successSection');
    successEl.style.display = 'none';
    successEl.classList.remove('show');
    document.getElementById('tokenSection').style.display = 'block';
    var spacer = document.getElementById('demoSpacer');
    if (spacer) spacer.style.display = 'block';

    // 헬퍼 호출 — checkin.js의 함수들 그대로 사용
    // 첫 로드는 'real' 시나리오로 미리보기 (today.checkin=false 강제 → 출근 버튼 활성)
    var initialPreview = applyScenario('real', status);
    if (typeof renderWeekly === 'function' && initialPreview.weekly) renderWeekly(initialPreview.weekly);
    if (typeof renderProgress === 'function') renderProgress(initialPreview);
    if (typeof renderStreak === 'function') renderStreak(initialPreview);
    if (typeof updateEventButton === 'function') {
      updateEventButton('출근', initialPreview);
      updateEventButton('귀소', initialPreview);
      updateEventButton('학습회', initialPreview);
      updateEventButton('퇴근', initialPreview);
    }
    if (typeof bindEventBtnEffects === 'function') bindEventBtnEffects();

    // AI 한마디 (진짜 호출, read-only) — 시연 시각 적용
    var ctxType = status.today && status.today.checkin ? '진행 중' : '출근 전';
    if (typeof fetchTokenGreeting === 'function') {
      fetchTokenGreeting({
        empName: _demoEmpName,
        empId: empId,
        branchName: _demoBranchName,
        type: ctxType,
        time: _demoCustomTime,
      });
    }
  } catch (e) {
    alert('서버 연결 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '불러오기';
  }
}

// 시나리오를 _statusBeforeCheckin에 강제 적용
function applyScenario(scenario, baseStatus) {
  var s = JSON.parse(JSON.stringify(baseStatus || {}));
  s.today = { checkin: false, return: false, learning: false, leave: false };

  if (scenario === 'real') {
    // 진짜 상태 그대로 (오늘 미출근으로만 강제)
  } else if (scenario === 'firstOfMonth') {
    s.monthCheckinDays = 0; s.streak = 0;
  } else if (scenario === 'month5') {
    s.monthCheckinDays = 4; s.streak = 0;
  } else if (scenario === 'month10') {
    s.monthCheckinDays = 9; s.streak = 0;
  } else if (scenario === 'month20huge') {
    s.monthCheckinDays = 19; s.streak = 0;
  } else if (scenario === 'streak3') {
    s.monthCheckinDays = 7; s.streak = 2;   // 출근 → streak 3
  } else if (scenario === 'streak7') {
    s.monthCheckinDays = 11; s.streak = 6;  // 출근 → streak 7
  } else if (scenario === 'streak30huge') {
    s.monthCheckinDays = 21; s.streak = 29; // 출근 → streak 30
  } else if (scenario === 'late') {
    // monthDays/streak는 진짜 상태 유지, 시각만 09:15로 강제 (buildFakeResult에서 처리)
  } else if (scenario === 'newbie') {
    s.monthCheckinDays = 0; s.streak = 0; s.lastWeekPerfect = false;
  }
  return s;
}

// 시나리오별 결과 화면 입력 생성 — 시연 시각 사용
function buildFakeResult(scenario, eventType) {
  var timeStr = _demoCustomTime || '08:32';
  var status = 'normal';

  if (scenario === 'late') {
    timeStr = '09:15';
    status = 'late';
  } else if (eventType === '출근') {
    var hour = parseInt(timeStr.split(':')[0], 10);
    if (hour < 9) status = 'normal';
    else if (hour < 10) status = 'late';
    else status = 'working';
  }

  return {
    success: true,
    type: eventType,
    time: timeStr,
    status: status,
    branch: _demoBranchName,
    scanCount: (_demoStatus && _demoStatus.monthCheckinDays || 0) + 1,
  };
}

async function demoEventCheckin(eventType) {
  if (!_demoStatus) {
    alert('먼저 사번을 불러오세요');
    return;
  }

  // 시나리오 강제 적용
  _statusBeforeCheckin = applyScenario(_demoScenario, _demoStatus);

  // showLoading
  document.getElementById('tokenSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'block';

  // fake 응답 약간의 지연 (UX 자연스럽게)
  setTimeout(function () {
    var fakeResult = buildFakeResult(_demoScenario, eventType);
    document.getElementById('loadingSection').style.display = 'none';
    if (typeof showSuccess === 'function') {
      showSuccess(document.getElementById('demoEmpId').value.trim(), fakeResult, _demoEmpName);
    }
  }, 600);
}

function resetDemo() {
  var successEl = document.getElementById('successSection');
  successEl.classList.remove('show');
  successEl.style.display = 'none';

  // 토큰 화면 다시 표시 + 효과 재실행 위해 status 다시 적용
  document.getElementById('tokenSection').style.display = 'block';
  if (_demoStatus) {
    if (typeof renderWeekly === 'function' && _demoStatus.weekly) renderWeekly(_demoStatus.weekly);
    if (typeof renderProgress === 'function') renderProgress(_demoStatus);
    if (typeof renderStreak === 'function') renderStreak(_demoStatus);
  }
}
