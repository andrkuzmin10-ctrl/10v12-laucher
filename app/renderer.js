'use strict';
const $ = id => document.getElementById(id);
const demo = !window.launcher;
const demoConfig = { version: '1.21.1', ram: 4, javaPath: '', fullscreen: false, accent: 'violet', visuals: false };
let state = { settings: { ...demoConfig }, account: null, installed: [], maxRam: 16, busy: false }, loggingIn = false;
const api = window.launcher || {
  state: async () => { try { return { ...state, settings: { ...demoConfig, ...JSON.parse(localStorage.getItem('10v12-preview') || '{}') } }; } catch { return state; } },
  save: async settings => { localStorage.setItem('10v12-preview', JSON.stringify(settings)); return { settings }; },
  folder: async () => ({ error: 'Папка игры доступна в настольном приложении.' }),
  browseJava: async () => { toast('Выбор Java доступен в настольном приложении.'); return null; },
  login: async () => ({ error: 'Это предпросмотр. Для входа и игры запусти настольное приложение из архива.' }),
  loginLocal: async nickname => ({ account: { name: nickname.trim(), id: 'preview-local', mode: 'local' } }),
  logout: async () => ({ ok: true }), onEvent: () => {}
};
let catalogVersions = [], catalogWarning = '';
const typeNames={release:'Релиз',snapshot:'Снапшот',old_beta:'Бета',old_alpha:'Альфа / историческая'};
async function loadCatalog(refresh=false) {
 $('catalog-status').textContent='Загрузка официального каталога…';
 try {
 const result=demo ? {versions:[{id:'1.21.1',type:'release'},{id:'1.20.1',type:'release'},{id:'1.19.4',type:'release'}],warning:'Предпросмотр: полный каталог загружается в приложении.'} : await api.versions(refresh);
 catalogVersions=result.versions || [];catalogWarning=result.warning || '';
 for(const id of ['version-select','friend-version']) {
 const select=$(id), selected=select.value;select.replaceChildren();
 for(const item of catalogVersions){const o=document.createElement('option');o.value=item.id;o.textContent=item.id+' · '+(typeNames[item.type]||item.type);select.append(o);}
 if(catalogVersions.some(v=>v.id===selected))select.value=selected;
 }
 update();
 }catch{$('catalog-status').textContent='Не удалось загрузить каталог. Проверь интернет и нажми «Обновить каталог».';}
}
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000); }
function log(text) { const row = document.createElement('div'); row.className = 'log-row'; const time = document.createElement('span'); time.className = 'log-time'; time.textContent = new Date().toLocaleTimeString('ru-RU'); const msg = document.createElement('span'); msg.className = 'log-message'; msg.textContent = text; row.append(time, msg); $('log-list').append(row); if ($('log-list').childElementCount > 150) $('log-list').firstElementChild.remove(); $('log-list').scrollTop = $('log-list').scrollHeight; }
function navigate(page) { if (!['home','library','friends','settings','logs'].includes(page)) return; document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === page)); document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === page)); $('page-title').textContent = { home:'Главная', library:'Версии игры', settings:'Настройки', friends:'Друзья', logs:'Журнал' }[page]; }
function accent(value) { const colors = { violet:['#b4a0ff','#242038','#181125'], mint:['#91dfbe','#172f29','#0e211b'], blue:['#95c7ff','#1b293a','#111e2e'] }; const c = colors[value] || colors.violet; ['--accent','--accent-bg','--on-accent'].forEach((p,i) => document.documentElement.style.setProperty(p,c[i])); document.querySelectorAll('[data-accent]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent === value))); }
function renderVersions() {
  $('version-list').replaceChildren();
  const query=$('version-search').value.trim().toLowerCase(),type=$('version-type').value;
  const filtered=catalogVersions.filter(v=>(type==='all'||v.type===type)&&v.id.toLowerCase().includes(query));
  $('catalog-status').textContent=(catalogWarning ? catalogWarning+' ' : '')+'В каталоге: '+catalogVersions.length+'. Найдено: '+filtered.length+'. Показано: '+Math.min(80,filtered.length)+'. Для остальных уточни поиск.';
  filtered.slice(0,80).forEach(item => {
    const version=item.id,desc=(typeNames[item.type]||item.type)+(item.releaseTime?' · '+item.releaseTime.slice(0,10):'');
    const card = document.createElement('article'); card.className = 'version-card' + (state.settings.version === version ? ' selected' : '');
    const art = document.createElement('div'); art.className = 'version-art'; art.innerHTML = '<svg><use href="#cube"/></svg>';
    const content = document.createElement('div'); const title = document.createElement('h2'); title.textContent = 'Minecraft ' + version; const sub = document.createElement('p'); sub.textContent = desc; const tag = document.createElement('span'); tag.className = 'version-tag'; tag.textContent = state.installed.includes(version) ? 'Манифест установлен · файлы проверятся при запуске' : 'Скачивание при первом запуске'; content.append(title,sub,tag);
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = state.settings.version === version ? '✓ Выбрана' : 'Выбрать'; button.disabled = state.busy || state.settings.version === version; button.onclick = () => changeVersion(version); card.append(art, content, button); $('version-list').append(card);
  });
}
function update() {
  const s = state.settings;
  $('visuals-enabled').checked = !!s.visuals; $('visuals-enabled').disabled = s.version !== '1.21.1' || state.busy;
  $('visuals-description').textContent = s.version === '1.21.1' ? 'Лёгкий HUD: броня, тотемы, часы, клавиши, низкое HP, свободные слоты и перетаскивание блоков. Шесть тем; декор выключен по умолчанию. При первом запуске мод автоматически собирается из исходников: нужен интернет и около 4 ГБ места. Сборка и запуск в Minecraft здесь не проверялись.' : 'Внутриигровая панель доступна только для Minecraft 1.21.1. Выбери эту версию внизу окна.';
  $('version-flavor').textContent = s.visuals && s.version === '1.21.1' ? 'Fabric · Right Shift · Visuals' : 'Vanilla · Java Edition';
  $('summary-version').textContent = 'Minecraft ' + s.version; $('bar-version').textContent = s.version; $('version-select').value = s.version;
  $('summary-ram').textContent = s.ram + ' ГБ RAM'; $('summary-java').textContent = 'Java · по данным версии';
  $('ram').max = state.maxRam; $('ram').value = s.ram; $('ram-value').textContent = s.ram + ' ГБ'; $('ram-max').textContent = state.maxRam + ' ГБ'; $('java-path').value = s.javaPath; $('fullscreen').checked = s.fullscreen;
  $('account-name').textContent = state.account?.name || 'Твой аккаунт'; $('account-sub').textContent = state.account ? (state.account.mode === 'local' ? 'Локальный профиль · по нику' : 'Microsoft · подключён') : 'Microsoft или по нику';
  $('dialog-title').textContent = state.account ? 'Привет, ' + state.account.name + '.' : 'С возвращением.';
  $('dialog-copy').textContent = state.account ? (state.account.mode === 'local' ? 'Локальный профиль активен. Одиночная игра и серверы без проверки лицензии. Сервисы Microsoft и лицензионные серверы недоступны.' : 'Аккаунт Microsoft подключён. Выбери версию и отправляйся в свой мир.') : 'Войди через Microsoft или создай локальный профиль — без аккаунта и пароля.';
  $('profile-hint').textContent = state.account?.mode === 'local' ? 'Локальный профиль · одиночная игра и серверы без проверки лицензии.' : state.account ? 'Microsoft подключён. Всё готово к твоему следующему приключению.' : 'Твой способ входа: Microsoft или локальный профиль по нику.';
  $('login-choices').hidden = !!state.account; $('local-login-button').disabled = state.busy || loggingIn; $('local-name').disabled = state.busy || loggingIn;
  $('login-button').hidden = !!state.account; $('logout-button').hidden = !state.account; $('hint-login').textContent = state.account ? 'Аккаунт ↗' : 'Войти ↗';
  $('version-select').disabled = state.busy; $('play').disabled = state.busy || loggingIn; $('hero-play').disabled = state.busy || loggingIn;
  $('play-label').textContent = state.busy ? 'В процессе…' : 'Играть';
  accent(s.accent); renderVersions(); if(typeof renderFriends === 'function')renderFriends();
}
async function persist(settings, notify = false) { try { const result = await api.save(settings); if (result.error) { toast(result.error); update(); return false; } state.settings = result.settings; update(); if (notify) { toast('Настройки сохранены'); log('Настройки сохранены.'); } return true; } catch { toast('Не удалось сохранить настройки.'); return false; } }
async function changeVersion(version) { if (await persist({ ...state.settings, version })) log('Выбрана версия ' + version + '.'); }
function openAccount() { if (!$('login-dialog').open) $('login-dialog').showModal(); }
async function play(lanTarget = null) {
  if (state.busy) return;
  if (demo) { toast('Предпросмотр интерфейса. Запуск игры — в приложении 10v12 из архива.'); return; }
  if (!state.account) { openAccount(); return; }
  state.busy = true; lastJavaStage = ''; update(); $('progress-fill').classList.remove('indeterminate'); $('progress-track').hidden = false; $('progress-fill').style.width = '0%'; $('bar-status').textContent = 'Проверка Java и подготовка…'; log('Запуск Minecraft ' + state.settings.version + '.');
  try { const result = await api.play(lanTarget ? {lan:lanTarget} : undefined); if (result.error) { state.busy = false; $('progress-track').hidden = true; $('bar-status').textContent = 'Запуск не завершён'; toast(result.error); log(result.error); update(); } }
  catch { state.busy = false; $('progress-track').hidden = true; $('bar-status').textContent = 'Запуск не завершён'; toast('Не удалось связаться с приложением.'); update(); }
}
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => navigate(b.dataset.page));
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => navigate(b.dataset.go));
document.querySelector('.brand').onclick = e => { e.preventDefault(); navigate('home'); };
$('play').onclick = () => play(); $('hero-play').onclick = () => play(); $('account').onclick = openAccount; $('hint-login').onclick = openAccount;
$('close-dialog').onclick = () => $('login-dialog').close();
$('login-dialog').onclick = e => { if (e.target === $('login-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } };
$('login-button').onclick = async () => {
  if (loggingIn) return; loggingIn = true; $('login-button').disabled = true; $('login-label').textContent = 'Ожидание Microsoft…'; update();
  try { const result = await api.login(); if (result.error) { toast(result.error); log('Вход не завершён.'); } else { state.account = result.account; $('login-dialog').close(); toast('Привет, ' + result.account.name + '!'); log('Аккаунт Microsoft подключён.'); } }
  catch { toast('Не удалось завершить вход. Попробуй ещё раз.'); }
  finally { loggingIn = false; $('login-button').disabled = false; $('login-label').textContent = 'Войти через Microsoft'; update(); }
};
$('local-form').onsubmit = async e => {
  e.preventDefault();
  if (loggingIn || state.busy) return;
  const nickname = $('local-name').value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) { $('local-error').textContent = 'Ник: 3–16 символов — латиница, цифры и _.'; $('local-error').hidden = false; return; }
  $('local-error').hidden = true;
  loggingIn = true; $('login-button').disabled = true; update();
  try {
    const result = await api.loginLocal(nickname);
    if (result.error) { $('local-error').textContent = result.error; $('local-error').hidden = false; }
    else { state.account = result.account; $('login-dialog').close(); toast(demo ? 'Локальный профиль создан для предпросмотра. Игра запускается в приложении.' : 'Локальный профиль: ' + state.account.name); log('Выбран локальный профиль. Сервисы Microsoft недоступны.'); }
  } catch { toast('Не удалось создать локальный профиль.'); }
  finally { loggingIn = false; $('login-button').disabled = false; update(); }
};
$('local-name').oninput = () => { $('local-error').hidden = true; };
$('logout-button').onclick = async () => { const r = await api.logout(); if (r.error) return toast(r.error); state.account = null; update(); $('login-dialog').close(); toast('Выход выполнен.'); log('Аккаунт отключён.'); };
$('folder').onclick = async () => { try { const r = await api.folder(); if (r?.error) toast(r.error); } catch { toast('Папка недоступна.'); } };
$('browse-java').onclick = async () => { const file = await api.browseJava(); if (file) $('java-path').value = file; };
$('version-search').oninput = renderVersions;
$('version-type').onchange = renderVersions;
$('refresh-catalog').onclick = () => loadCatalog(true);
$('version-select').onchange = e => changeVersion(e.target.value);
$('ram').oninput = e => { $('ram-value').textContent = e.target.value + ' ГБ'; };
let selectedAccent = 'violet';
document.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { selectedAccent = b.dataset.accent; accent(selectedAccent); });
$('settings-form').onsubmit = e => { e.preventDefault(); const activeAccent = document.querySelector('[data-accent][aria-pressed=true]').dataset.accent; persist({ ...state.settings, ram: Number($('ram').value), javaPath: $('java-path').value.trim(), fullscreen: $('fullscreen').checked, accent: activeAccent, visuals: $('visuals-enabled').checked }, true); };
$('clear-log').onclick = () => { $('log-list').replaceChildren(); log('Журнал очищен.'); };
let lastJavaStage = '';
api.onEvent(async event => {
  if (event.type === 'java-progress' || event.type === 'visuals-progress') {
    $('progress-track').hidden = false;
    const determinate = Number.isFinite(event.percent);
    $('progress-fill').classList.toggle('indeterminate', !determinate);
    $('progress-fill').style.width = determinate ? Math.min(100, Math.max(0, event.percent)) + '%' : '32%';
    $('bar-status').textContent = event.text;
    $('play-label').textContent = event.type === 'visuals-progress' ? 'Подготовка…' : 'Java…';
    if (lastJavaStage !== event.stage) { log(event.text); lastJavaStage = event.stage; }
  }
  if (event.type === 'progress') { $('progress-fill').classList.remove('indeterminate'); $('play-label').textContent = 'Загрузка…'; $('progress-track').hidden = false; $('progress-fill').style.width = event.percent + '%'; $('bar-status').textContent = 'Подготовка · ' + event.stage + ' · ' + event.percent + '%'; }
  if (event.type === 'status') { $('bar-status').textContent = event.text; log(event.text); }
  if (event.type === 'notice') { toast(event.text); log(event.text); }
  if (event.type === 'running') { $('bar-status').textContent = event.text; $('play-label').textContent = 'В игре'; $('progress-track').hidden = true; log(event.text); }
  if (event.type === 'finished') { state.busy = false; $('progress-track').hidden = true; $('bar-status').textContent = event.text; log(event.text); try { const fresh = await api.state(); state.installed = fresh.installed; } catch {} update(); }
});
(async () => { try { state = { ...state, ...await api.state() }; selectedAccent = state.settings.accent; update(); await loadCatalog(); $('demo-banner').hidden = !demo; log(demo ? 'Режим предпросмотра. Игровой запуск недоступен в браузере.' : '10v12 готов. Выбери Microsoft или локальный профиль и версию игры.'); } catch { toast('Не удалось загрузить настройки. Перезапусти приложение.'); } })();
