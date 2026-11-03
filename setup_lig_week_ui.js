/**
 * LIG Algorithm Hub — 주차 선택 + 주차 브랜치 자동 생성 로컬 설치 스크립트
 * 실행 위치: LIG-Algorithm-Hub 프로젝트 루트
 * node setup_lig_week_ui.js
 *
 * 네트워크 요청 없음. 프로젝트 파일을 수정하기 전 원본을 *.lig-backup-<timestamp>로 백업합니다.
 * 확장 프로그램 실행 시 GitHub API를 사용하는 코드를 설치하는 스크립트입니다.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.cwd();
const paths = {
  manifest: 'manifest.json',
  popupHTML: 'popup.html',
  popupJS: 'popup.js',
  github: 'scripts/Github.js',
  parsing: 'scripts/programmers/parsing.js',
  upload: 'scripts/programmers/uploadfunctions.js',
  programmers: 'scripts/programmers/programmers.js',
  config: 'scripts/lig-week.js',
};
const required = ['manifest', 'popupHTML', 'popupJS', 'github', 'parsing', 'upload', 'programmers'];
const originals = {};
for (const key of required) {
  const filename = path.join(root, paths[key]);
  if (!fs.existsSync(filename)) {
    console.error(`파일이 없습니다: ${paths[key]}`);
    console.error('LIG-Algorithm-Hub 루트 폴더에서 실행하세요.');
    process.exit(1);
  }
  originals[key] = fs.readFileSync(filename, 'utf8');
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function updated(text, key) {
  return text;
}

const configSource = `/* LIG-WEEK-CONFIG: 팝업과 프로그래머스 content script에서 공통 사용 */
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
`;

const popupMarkup = `
          <!-- LIG-WEEK-UI -->
          <div id="lig_week_ui" style="margin: 12px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; text-align: left;">
            <label for="lig_week_select" style="display: block; font-weight: 700; margin-bottom: 6px;">LIG 알고리즘 스터디 · 주차</label>
            <select id="lig_week_select" class="ui fluid dropdown" style="width:100%; padding: 7px; margin-bottom: 7px;"></select>
            <p id="lig_week_branch" style="font-size: 12px; margin: 6px 0; overflow-wrap: anywhere;"></p>
            <button type="button" id="lig_week_save" class="ui small primary button" style="width: 100%; margin: 4px 0;">주차 적용 · 브랜치 확인/생성</button>
            <p id="lig_week_status" role="status" aria-live="polite" style="font-size: 12px; margin-top: 8px; overflow-wrap: anywhere;"></p>
          </div>
`;

const popupLogic = `

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
`;

const newUploadFunction = `async function upload(token, hook, sourceText, readmeText, directory, filename, commitMessage, cb) {
  // LIG-WEEK-UPLOAD: 주차는 제출 당시 경로에 고정한다.
  const match = String(directory).match(/^(week(?:0[1-9]|[1-9][0-9]))\\/PGS(\\d+)$/);
  if (!match || filename !== LIG_MEMBER + '.cpp') {
    throw new Error('[LIG-HUB] 잘못된 저장 경로: ' + directory + '/' + filename);
  }
  const [_, week, problemId] = match;
  if (commitMessage !== week + ': PGS' + problemId + ' 풀이') {
    throw new Error('[LIG-HUB] 커밋 메시지와 업로드 주차가 일치하지 않습니다.');
  }
  if (hook !== LIG_REPO) throw new Error('[LIG-HUB] 허용되지 않은 저장소: ' + hook);
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new Error('[LIG-HUB] 소스 코드가 비어 있습니다.');
  }

  const { branch } = await ligEnsureWeekBranch(token, hook, week);
  const git = new GitHub(hook, token);
  const source = await git.createBlob(sourceText, directory + '/' + filename);
  // 팀 레포는 풀이 코드만 제출. 문제 지문을 포함하는 README는 업로드하지 않음.
  await git.commitTreeItems(branch, [source], commitMessage);
  await recordUploadInStats(hook, branch, [source]);
  console.log('[LIG-HUB] 업로드 성공:', branch, directory + '/' + filename);
  if (typeof cb === 'function') cb({ [hook]: branch }, directory);
}
`;

const newBeginUpload = `async function beginUpload(bojData, attempt) {
  // LIG-WEEK-BEGIN: 기본 브랜치/캐시가 아닌 제출 당시 주차 브랜치 기준으로 검사
  if (!bojData || typeof bojData.code !== 'string' || !bojData.code.trim()) {
    console.error('[LIG-HUB] 소스 코드 파싱 실패', bojData);
    markUploadFailedCSS(attempt);
    return;
  }

  const hook = await getHook();
  const token = await getToken();
  if (hook !== LIG_REPO) throw new Error('[LIG-HUB] 잘못된 저장소: ' + hook);
  if (!token) throw new Error('[LIG-HUB] GitHub 인증이 필요합니다.');

  const week = String(bojData.directory || '').split('/')[0];
  const branch = ligBranchForWeek(week);
  const expected = week + '/PGS' + String(bojData.problemId);
  if (bojData.directory !== expected ||
      bojData.fileName !== LIG_MEMBER + '.cpp' ||
      String(bojData.language_extension).replace(/^\\./, '').toLowerCase() !== 'cpp') {
    throw new Error('[LIG-HUB] C++ 파일명/문제 경로가 올바르지 않습니다.');
  }
  await ligEnsureWeekBranch(token, hook, week);

  const filepath = bojData.directory + '/' + bojData.fileName;
  const remoteFile = await githubRequest(
    'https://api.github.com/repos/' + hook + '/contents/' + filepath + '?ref=' + encodeURIComponent(branch),
    {
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github.v3+json',
      },
    },
    { notFoundAsNull: true }
  );

  if (remoteFile && remoteFile.sha === calculateBlobSHA(bojData.code)) {
    console.log('[LIG-HUB] 동일한 코드가 있어 업로드 생략:', filepath);
    markUploadedCSS({ [hook]: branch }, bojData.directory, attempt);
    return;
  }

  await uploadOneSolveProblemOnGit(
    bojData,
    (branches, directory) => markUploadedCSS(branches, directory, attempt)
  );
}
`;

try {
  const outputs = { ...originals, config: configSource };

  // manifest.json: programmers 사이트에서만 설정 함수 로드
  const manifest = JSON.parse(originals.manifest);
  const pgs = manifest.content_scripts.find((entry) =>
    entry.matches?.some((match) => match.includes('school.programmers.co.kr'))
  );
  ensure(pgs, 'manifest.json에서 프로그래머스 content_scripts를 찾지 못했습니다.');
  if (!pgs.js.includes(paths.config)) {
    const pos = pgs.js.indexOf('scripts/storage.js');
    ensure(pos !== -1, 'manifest.json에서 scripts/storage.js를 찾지 못했습니다.');
    pgs.js.splice(pos + 1, 0, paths.config);
  }
  outputs.manifest = JSON.stringify(manifest, null, 2) + '\n';

  // popup.html: 연결 후 표시되는 팝업에 주차 컨트롤 추가
  if (!originals.popupHTML.includes('id="lig_week_ui"')) {
    ensure(originals.popupHTML.includes('<div id="commit_mode" hidden>'), 'popup.html에서 commit_mode를 찾지 못했습니다.');
    outputs.popupHTML = originals.popupHTML.replace(
      '<div id="commit_mode" hidden>',
      '<div id="commit_mode" hidden>' + popupMarkup
    );
  }
  if (!outputs.popupHTML.includes('src="scripts/lig-week.js"')) {
    ensure(outputs.popupHTML.includes('src="popup.js"'), 'popup.html에서 popup.js 스크립트 태그를 찾지 못했습니다.');
    outputs.popupHTML = outputs.popupHTML.replace(
      /<script\b[^>]*\bsrc=["']popup\.js["'][^>]*><\/script>/,
      (tag) => '    <script src="scripts/lig-week.js"></script>\n    ' + tag
    );
    ensure(outputs.popupHTML.includes('src="scripts/lig-week.js"'), 'popup.html에 공통 설정 스크립트 추가 실패');
  }

  // popup.js: 주차 적용 버튼 핸들러 추가
  if (!originals.popupJS.includes('LIG-WEEK-UI:')) {
    outputs.popupJS = originals.popupJS.trimEnd() + '\n' + popupLogic;
  }

  // parsing.js: 제출 직전에 chrome.storage에서 주차를 읽고 경로 생성
  let parsing = originals.parsing;
  if (!parsing.includes('const week = await ligGetWeek();')) {
    const weekPattern = /const week\s*=\s*['"]week\d{2}['"]\s*;/;
    ensure(weekPattern.test(parsing), 'parsing.js에서 기존 `const week = \'week01\';`을 찾지 못했습니다. 수정 상태를 확인하세요.');
    parsing = parsing.replace(weekPattern, 'const week = await ligGetWeek();');
  }
  parsing = parsing.replace(/const memberName\s*=\s*['"]yunbin['"]\s*;/, 'const memberName = LIG_MEMBER;');
  const makeDataStart = parsing.indexOf('async function makeData(origin)');
  const afterMakeData = parsing.indexOf('function extractUploadedProblemIdsForProgrammers', makeDataStart);
  ensure(makeDataStart !== -1 && afterMakeData !== -1, 'parsing.js의 makeData 함수를 찾지 못했습니다.');
  const makeDataSection = parsing.slice(makeDataStart, afterMakeData);
  ensure(makeDataSection.includes('const directory = `${week}/PGS${problemId}`;'), 'parsing.js의 스터디 경로 변환 코드가 없습니다.');
  const returnMatch = makeDataSection.match(/return\s*\{([^}]+)\}\s*;/);
  ensure(returnMatch, 'parsing.js의 makeData return 문을 찾지 못했습니다.');
  if (!/\blanguage_extension\b/.test(returnMatch[1])) {
    const changed = returnMatch[0].replace(/}\s*;$/, ', language_extension };');
    parsing = parsing.replace(returnMatch[0], changed);
  }
  outputs.parsing = parsing;

  // uploadfunctions.js: 기본 브랜치 대신 제출 주차 브랜치, 코드만 업로드
  let upload = originals.upload;
  if (!upload.includes('LIG-WEEK-UPLOAD:')) {
    const start = upload.indexOf('async function upload(');
    const next = upload.indexOf('async function uploadAllSolvedProblemProgrammers()', start);
    ensure(start >= 0 && next > start, 'uploadfunctions.js의 upload 함수를 찾지 못했습니다.');
    upload = upload.slice(0, start) + newUploadFunction + '\n/**\n * 전체 업로드: 스터디 모드에서는 사용하지 않습니다.\n */\n' + upload.slice(next);
  }
  if (!upload.includes('LIG-WEEK-BULK-DISABLED')) {
    const marker = 'async function uploadAllSolvedProblemProgrammers() {';
    ensure(upload.includes(marker), 'uploadfunctions.js의 전체 업로드 함수를 찾지 못했습니다.');
    upload = upload.replace(marker, marker + `\n  // LIG-WEEK-BULK-DISABLED: 팀 저장소에 이전 풀이/문제 지문이 올라가지 않도록 차단\n  console.warn('[LIG-HUB] 스터디 모드에서 전체 업로드는 비활성화되어 있습니다.');\n  return;`);
  }
  outputs.upload = upload;

  // Github.js: 팀 저장소 main이나 다른 사람 브랜치에 잘못 올리는 것을 마지막 단계에서 차단.
  // 백준/SWEA/구름의 기존 업로더도 공유하는 GitHub 커밋 함수이므로 이 보호가 중요하다.
  let github = originals.github;
  if (!github.includes('LIG-WEEK-COMMIT-GUARD')) {
    const marker = 'async commitTreeItems(branch, treeItems, message) {';
    ensure(github.includes(marker), 'Github.js에서 commitTreeItems 함수를 찾지 못했습니다.');
    github = github.replace(marker, marker + `
    // LIG-WEEK-COMMIT-GUARD: 팀 저장소에는 선택한 개인 브랜치의 C++ 풀이 하나만 허용
    if (this.hook === 'codehooni/lig-ssen-algo-5th') {
      const m = /^yunbin\\/(week[0-9]{2})$/.exec(String(branch));
      const path = treeItems?.length === 1 ? String(treeItems[0]?.path || '') : '';
      const pm = /^(week[0-9]{2})\\/PGS([0-9]+)\\/yunbin\\.cpp$/.exec(path);
      if (!m || !pm || m[1] !== pm[1] || message !== pm[1] + ': PGS' + pm[2] + ' 풀이') {
        throw new Error('[LIG-HUB] 팀 저장소 보호: 개인 주차 브랜치의 PGS C++ 풀이 외 커밋은 차단합니다.');
      }
    }`);
  }
  outputs.github = github;

  // programmers.js: 기존 주차 고정 검사를 제출 당시 주차 기반으로 전환
  let programmers = originals.programmers;
  if (!programmers.includes('LIG-WEEK-BEGIN:')) {
    const start = programmers.indexOf('async function beginUpload(bojData, attempt)');
    const next = programmers.indexOf('async function versionUpdate()', start);
    ensure(start >= 0 && next > start, 'programmers.js의 beginUpload 함수를 찾지 못했습니다.');
    programmers = programmers.slice(0, start) + newBeginUpload + '\n' + programmers.slice(next);
  }
  outputs.programmers = programmers;

  // 모든 JS 파일을 저장 전에 구문 분석 (변경 후 오류면 파일 수정하지 않음)
  for (const key of ['config', 'popupJS', 'github', 'parsing', 'upload', 'programmers']) {
    new vm.Script(outputs[key], { filename: paths[key] });
  }
  JSON.parse(outputs.manifest);

  const backupSuffix = '.lig-backup-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const changedFiles = [];
  for (const [key, file] of Object.entries(paths)) {
    const dest = path.join(root, file);
    const old = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (old === outputs[key]) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (old !== null) fs.copyFileSync(dest, dest + backupSuffix);
    fs.writeFileSync(dest, outputs[key], 'utf8');
    changedFiles.push(file);
  }
  console.log('\nLIG 주차 UI + 브랜치 자동 생성 설치 완료!');
  console.log('변경 파일:\n' + changedFiles.map((file) => '  - ' + file).join('\n'));
  console.log('기존 파일 백업 확장자: ' + backupSuffix);
  console.log('다음: chrome://extensions에서 확장 프로그램 새로고침 후 팝업에서 주차 적용');
  console.log('※ main 브랜치에는 코드를 업로드하지 않습니다.');
} catch (error) {
  console.error('\n설치 중단: ' + error.message);
  console.error('수정 상태가 예상과 다른 파일이 있습니다. 직접 덮어쓰지 말고 오류를 확인하세요.');
  process.exit(1);
}
