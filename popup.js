/* global oAuth2, I18N */
/* eslint no-undef: "error" */

I18N.init();

let action = false;

$('#authenticate').on('click', () => {
  if (action) {
    oAuth2.begin();
  }
});

/* Get URL for welcome page */
$('#welcome_URL').attr('href', `chrome-extension://${chrome.runtime.id}/welcome.html`);
$('#hook_URL').attr('href', `chrome-extension://${chrome.runtime.id}/welcome.html`);

chrome.storage.local.get('BaekjoonHub_token', (data) => {
  const token = data.BaekjoonHub_token;
  if (token === null || token === undefined) {
    action = true;
    $('#auth_mode').show();
  } else {
    // To validate user, load user object from GitHub.
    const AUTHENTICATION_URL = 'https://api.github.com/user';

    const xhr = new XMLHttpRequest();
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          /* Show MAIN FEATURES */
          chrome.storage.local.get('mode_type', (data2) => {
            if (data2 && data2.mode_type === 'commit') {
              $('#commit_mode').show();
              /* Get problem stats and repo link */
              chrome.storage.local.get(['stats', 'BaekjoonHub_hook'], (data3) => {
                const BaekjoonHubHook = data3.BaekjoonHub_hook;
                if (BaekjoonHubHook) {
                  const repoLink = `<a target="blank" style="color: cadetblue !important;" href="https://github.com/${BaekjoonHubHook}">${BaekjoonHubHook}</a>`;
                  const updateRepoUrl = () => {
                    $('#repo_url').html(`${I18N.t('popup.yourRepo')} ${repoLink}`);
                  };
                  updateRepoUrl();
                  I18N.onChange(updateRepoUrl);
                }
              });
            } else {
              $('#hook_mode').show();
            }
          });
        } else if (xhr.status === 401) {
          // bad oAuth
          // reset token and redirect to authorization process again!
          chrome.storage.local.set({ BaekjoonHub_token: null }, () => {
            console.log('BAD oAuth!!! Redirecting back to oAuth process');
            action = true;
            $('#auth_mode').show();
          });
        }
      }
    });
    xhr.open('GET', AUTHENTICATION_URL, true);
    xhr.setRequestHeader('Authorization', `token ${token}`);
    xhr.send();
  }
});

/*
  초기에 활성화 데이터가 존재하는지 확인, 없으면 새로 생성, 있으면 있는 데이터에 맞게 버튼 조정
 */
chrome.storage.local.get('bjhEnable', (data4) => {
  if (data4.bjhEnable === undefined) {
    $('#onffbox').prop('checked', true);
    chrome.storage.local.set({ 'bjhEnable': $('#onffbox').is(':checked') }, () => { });
  }
  else {
    $('#onffbox').prop('checked', data4.bjhEnable);
    chrome.storage.local.set({ 'bjhEnable': $('#onffbox').is(':checked') }, () => { });
  }
})
/*
  활성화 버튼 클릭 시 storage에 활성 여부 데이터를 저장.
 */
$('#onffbox').on('click', () => {
  chrome.storage.local.set({ 'bjhEnable': $('#onffbox').is(':checked') }, () => { });
});


/* LIG-WEEK-UI: 주차 선택 시 브랜치를 확인/생성한 후 설정을 저장 */
(async function initializeLIGWeekUI() {
  const select = document.getElementById('lig_week_select');
  const button = document.getElementById('lig_week_save');
  const status = document.getElementById('lig_week_status');
  const branchPreview = document.getElementById('lig_week_branch');
  if (!select || !button || !status || !branchPreview) return;

  for (let n = 1; n <= 52; n++) {
    const week = 'week' + String(n).padStart(2, '0');
    const option = document.createElement('option');
    option.value = week;
    option.textContent = week;
    select.appendChild(option);
  }

  try {
    const data = await chrome.storage.local.get([
      LIG_WEEK_KEY, 'BaekjoonHub_hook', 'BaekjoonHub_token'
    ]);
    select.value = ligValidateWeek(data[LIG_WEEK_KEY] ?? 'week01');
    const render = () => {
      branchPreview.textContent = '저장 대상: ' + LIG_REPO + ' / ' + ligBranchForWeek(select.value);
    };
    render();
    select.addEventListener('change', () => {
      render();
      status.textContent = '아직 적용되지 않았습니다. 아래 버튼을 눌러주세요.';
    });

    if (data.BaekjoonHub_hook !== LIG_REPO) {
      button.disabled = true;
      status.textContent = '먼저 ' + LIG_REPO + ' 저장소에 연결하세요.';
      return;
    }
    if (!data.BaekjoonHub_token) {
      button.disabled = true;
      status.textContent = 'GitHub 인증이 필요합니다.';
      return;
    }

    button.addEventListener('click', async () => {
      button.disabled = true;
      const week = select.value;
      status.textContent = ligBranchForWeek(week) + ' 확인 중...';
      try {
        const token = (await chrome.storage.local.get('BaekjoonHub_token')).BaekjoonHub_token;
        const result = await ligEnsureWeekBranch(token, LIG_REPO, week);
        await chrome.storage.local.set({ [LIG_WEEK_KEY]: week });
        status.textContent = result.created
          ? '완료: ' + result.branch + ' 브랜치를 생성하고 주차를 적용했습니다.'
          : '완료: ' + result.branch + ' 브랜치가 이미 있어 해당 주차를 적용했습니다.';
      } catch (error) {
        status.textContent = '실패: ' + error.message + ' (주차는 변경되지 않음)';
        console.error('[LIG-HUB] 주차 적용 실패', error);
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    button.disabled = true;
    status.textContent = '설정을 읽지 못했습니다: ' + error.message;
    console.error('[LIG-HUB] 주차 UI 초기화 실패', error);
  }
})();
