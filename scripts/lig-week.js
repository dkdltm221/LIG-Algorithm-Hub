/* LIG-WEEK-CONFIG: 팝업과 프로그래머스 content script에서 공통 사용 */
const LIG_REPO = 'codehooni/lig-ssen-algo-5th';
const LIG_MEMBER = 'yunbin';
const LIG_WEEK_KEY = 'LIG_week';
const LIG_BASE_BRANCH = 'main';

function ligValidateWeek(week) {
  if (typeof week !== 'string' || !/^week(?:0[1-9]|[1-9][0-9])$/.test(week)) {
    throw new Error('[LIG-HUB] 잘못된 주차: ' + String(week));
  }
  return week;
}

async function ligGetWeek() {
  const data = await chrome.storage.local.get(LIG_WEEK_KEY);
  return ligValidateWeek(data[LIG_WEEK_KEY] ?? 'week01');
}

function ligBranchForWeek(week) {
  return LIG_MEMBER + '/' + ligValidateWeek(week);
}

async function ligGitHubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('[LIG-HUB] GitHub ' + response.status + ': ' + (body?.message || '요청 실패'));
    error.status = response.status;
    throw error;
  }
  return body;
}

// 브랜치가 없으면 최신 main 커밋을 기준으로 생성. 이미 있으면 변경하지 않음.
async function ligEnsureWeekBranch(token, hook, week) {
  if (!token) throw new Error('[LIG-HUB] GitHub 인증이 필요합니다.');
  if (hook !== LIG_REPO) throw new Error('[LIG-HUB] 허용되지 않은 저장소: ' + hook);
  const branch = ligBranchForWeek(week);
  const refUrl = 'https://api.github.com/repos/' + hook + '/git/ref/heads/' + branch;

  try {
    await ligGitHubRequest(refUrl, token);
    return { branch, created: false };
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const base = await ligGitHubRequest(
    'https://api.github.com/repos/' + hook + '/git/ref/heads/' + LIG_BASE_BRANCH,
    token
  );
  const baseSHA = base?.object?.sha;
  if (!baseSHA) throw new Error('[LIG-HUB] main 브랜치의 최신 SHA를 읽지 못했습니다.');

  try {
    await ligGitHubRequest('https://api.github.com/repos/' + hook + '/git/refs', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: baseSHA }),
    });
    console.log('[LIG-HUB] 브랜치 생성:', branch);
    return { branch, created: true };
  } catch (error) {
    // 다른 탭 등이 동일한 브랜치를 먼저 만들었으면 정상으로 처리.
    if (error.status === 422) {
      await ligGitHubRequest(refUrl, token);
      return { branch, created: false };
    }
    throw error;
  }
}
