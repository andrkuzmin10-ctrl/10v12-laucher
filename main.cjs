const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createJavaManager, requiredMajor } = require('./java-runtime.cjs');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { localProfile } = require('./local-profile.cjs');
const { Auth } = require('msmc');
const { createVisualsInstaller } = require('./visuals-setup.cjs');
const lan = require('./lan-friends.cjs');
let friendsStore, discovery;
const friends = () => friendsStore ||= lan.createFriendsStore(path.join(app.getPath('userData'),'friends.json'));
async function lanResult(fn) { try { return await fn(); } catch(e) { return { error: e.code === 'LAN_INPUT' ? e.message : 'Не удалось выполнить действие с друзьями. Проверь доступ к папке данных.' }; } }
let win, minecraft, account = null, busy = false, signingIn = false;
let javaManager;
function getJavaManager() {
  if (!javaManager) javaManager = createJavaManager({ directory: path.join(app.getPath('userData'), 'runtime'), report: event => send('java-progress', event) });
  return javaManager;
}
const { createCatalog } = require('./version-catalog.cjs');
let catalog;
const getCatalog = () => catalog ||= createCatalog({ directory: path.join(app.getPath('userData'), 'catalog') });
const defaults = { version: '1.21.1', ram: 4, javaPath: '', fullscreen: false, accent: 'violet', visuals: false };
let settings = { ...defaults };
const root = () => path.join(app.getPath('userData'), 'minecraft');
const config = () => path.join(app.getPath('userData'), 'settings.json');
const maxRam = () => Math.max(2, Math.min(16, Math.floor(os.totalmem() / 1073741824) - 2));
function send(type, payload) { if (win && !win.isDestroyed()) win.webContents.send('launcher:event', { type, ...payload }); }
// Never expose authentication tokens, launch commands, or raw JVM output to renderer/log files.
function message(error) {
  const text = String(error?.message || error || 'Неизвестная ошибка');
  if (typeof error?.code === 'string' && /^(JAVA_|VISUALS_|FABRIC_)/.test(error.code)) return text;
  if (/ENOENT|java.*not found|unable to find.*java/i.test(text)) return 'Не найден компонент запуска. Повторите запуск: подходящая Java устанавливается автоматически. Если ошибка повторится, проверьте папку игры и настройки.';
  if (/VERSION_/.test(text)) return 'Не удалось получить или проверить официальную версию Minecraft. Обнови каталог, проверь интернет и повтори запуск.';
  if (/entitlement|not own|does not own|profile.*404/i.test(text)) return 'Не удалось подтвердить Minecraft: Java Edition на этом аккаунте.';
  return 'Операция не завершена. Проверьте интернет, аккаунт Microsoft и версию Java. Подробности: README → Решение проблем.';
}
async function installed() {
 try { const items=await fs.readdir(path.join(root(),'versions'),{withFileTypes:true});return items.filter(i=>i.isDirectory()).map(i=>i.name); }catch{return [];}
}
function publicAccount() { return account ? { name: account.profile.name, id: account.profile.id, mode: account.mode } : null; }
app.whenReady().then(async () => {
  try { const saved = JSON.parse(await fs.readFile(config(), 'utf8')); settings = { ...defaults, ...saved }; } catch {}
  const {validId}=require('./version-catalog.cjs');
  settings.version = validId(settings.version) ? settings.version : defaults.version;
  settings.visuals = !!settings.visuals;
  settings.ram = Math.min(maxRam(), Math.max(2, Number(settings.ram) || 4));
  win = new BrowserWindow({ width: 1320, height: 900, minWidth: 900, minHeight: 700, backgroundColor: '#0d0e14', title: '10v12', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile('app/index.html');
});
app.on('window-all-closed', () => app.quit());
ipcMain.handle('launcher:versions', (_, refresh) => getCatalog().list(refresh === true));
ipcMain.handle('launcher:state', async () => ({ settings, account: publicAccount(), installed: await installed(), maxRam: maxRam(), root: root(), busy }));
ipcMain.handle('launcher:save', async (_, value) => {
  if (busy) return { error: 'Дождитесь завершения запуска.' };
  const available = (await getCatalog().list()).versions;
  if (!value || !available.some(v=>v.id===value.version) || !Number.isInteger(value.ram) || value.ram < 2 || value.ram > maxRam() || typeof value.visuals !== 'boolean' || typeof value.javaPath !== 'string' || value.javaPath.length > 4096 || !['violet','mint','blue'].includes(value.accent)) return { error: 'Проверьте настройки.' };
  settings = { version: value.version, ram: value.ram, javaPath: value.javaPath, fullscreen: !!value.fullscreen, accent: value.accent, visuals: value.visuals };
  try { await fs.mkdir(app.getPath('userData'), { recursive: true }); await fs.writeFile(config(), JSON.stringify(settings, null, 2)); return { settings }; }
  catch { return { error: 'Не удалось сохранить настройки.' }; }
});
ipcMain.handle('launcher:browse-java', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Выберите javaw.exe / java', properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('launcher:folder', async () => { await fs.mkdir(root(), { recursive: true }); const error = await shell.openPath(root()); return error ? { error: 'Не удалось открыть папку.' } : {}; });
ipcMain.handle('launcher:login', async () => {
  if (signingIn || busy) return { error: 'Другая операция уже выполняется.' };
  signingIn = true;
  try {
    const xbox = await new Auth('select_account').launch('electron');
    const token = await xbox.getMinecraft();
    if (!token.profile?.name || !token.profile?.id) throw new Error('No profile / entitlement');
    account = { mode: 'microsoft', profile: token.profile, token };
    return { account: publicAccount() };
  } catch (e) { return { error: message(e) }; }
  finally { signingIn = false; }
});
ipcMain.handle('launcher:login-local', async (_, nickname) => {
  if (signingIn || busy) return { error: 'Дождитесь завершения операции.' };
  let profile;
  try { profile = localProfile(nickname); } catch (e) { return { error: e.message }; }
  account = { mode: 'local', profile };
  return { account: publicAccount() };
});
ipcMain.handle('launcher:logout', async () => { if (busy || signingIn) return { error: 'Дождитесь завершения операции.' }; account = null; return { ok: true }; });
ipcMain.handle('launcher:server-kit', async () => {
  try {
    const destination=path.join(app.getPath('userData'),'server-kit');await fs.mkdir(destination,{recursive:true});
    for(const name of ['start.cjs','START-SERVER-WINDOWS.cmd','README.md'])await fs.copyFile(path.join(__dirname,'server-kit',name),path.join(destination,name));
    await fs.copyFile(path.join(__dirname,'java-runtime.cjs'),path.join(destination,'java-runtime.cjs'));
    const error=await shell.openPath(destination);return error?{error:'Не удалось открыть папку server-kit.'}:{ok:true};
  }catch{return {error:'Не удалось подготовить server-kit. Он также есть в архиве проекта.'};}
});
ipcMain.handle('launcher:friends', () => lanResult(async()=>({friends:await friends().list(),interfaces:lan.interfaces()})));
ipcMain.handle('launcher:friend-add', (_,value) => lanResult(async()=>({friends:await friends().add(value)})));
ipcMain.handle('launcher:friend-remove', (_,id) => lanResult(async()=>({friends:await friends().remove(id)})));
ipcMain.handle('launcher:lan-discover', async () => {
  if(discovery) return discovery;
  discovery=lan.discover().catch(()=>({error:'Поиск LAN не завершён. Используй ручное подключение.'})).finally(()=>{discovery=null;});
  return discovery;
});
ipcMain.handle('launcher:lan-copy', (_,value) => lanResult(async()=>{require('electron').clipboard.writeText(lan.address(value));return {ok:true};}));
ipcMain.handle('launcher:play', async (_,request) => {
  if (busy || signingIn) return { error: 'Другая операция уже выполняется.' };
  if (!account) return { error: 'Выберите вход через Microsoft или локальный профиль по нику.' };
  let lanTarget;
  try { if(request !== undefined && request !== null) lanTarget=lan.target(request.connection || request.lan); }
  catch(e) { return {error:e.message}; }
  const launchVersion=lanTarget ? lanTarget.version : settings.version;
  busy = true;
  try {
    const versionInfo = await getCatalog().details(launchVersion);
    const required = versionInfo.javaMajor;
    send('status', { text: `Подготовка Java ${required}…` });
    const runtime = await getJavaManager().resolve(required, settings.javaPath);
    await fs.mkdir(root(), { recursive: true });
    let customVersion;
    if (settings.visuals && launchVersion === '1.21.1') {
      const installer = createVisualsInstaller({ gameRoot: root(), dataRoot: app.getPath('userData'), sourceDirectory: path.join(__dirname, 'visuals-mod'), report: event => send('visuals-progress', event) });
      customVersion = (await installer.ensure()).custom;
    }
    // Tokens stay in memory. Sign out and sign in again if the session expires.
    const client = new Client();
    client.on('progress', data => send('progress', { percent: data.total > 0 ? Math.min(100, Math.round(data.task / data.total * 100)) : 0, stage: String(data.type || 'files') }));
    client.on('download-status', data => send('progress', { percent: data.total > 0 ? Math.min(100, Math.round(data.current / data.total * 100)) : 0, stage: 'download' }));
    client.on('debug', () => {}); client.on('data', () => {});
    client.on('error', () => send('notice', { text: 'Ошибка компонента запуска. Проверьте Java и подключение.' }));
    send('status', { text: 'Подготовка файлов Minecraft…' });
    const proc = await client.launch({ authorization: account.mode === 'local' ? { ...(await Authenticator.getAuth(account.profile.name)), uuid: account.profile.id } : account.token.mclc(), root: root(), ...(lanTarget ? {quickPlay:lan.quickPlay(lanTarget)} : {}), version: { number: launchVersion, type: versionInfo.type, ...(customVersion ? { custom: customVersion } : {}) },
      memory: { max: `${settings.ram}G`, min: '1G' }, javaPath: runtime.executable, window: { width: 1280, height: 720, fullscreen: settings.fullscreen } });
    if (!proc || typeof proc.once !== 'function') throw new Error('No game process');
    minecraft = proc;
    send('running', { text: lanTarget ? 'Minecraft запущен с подключением к выбранному миру/серверу. Результат подключения смотри в игре.' : 'Minecraft запущен. Хорошей игры!' });
    proc.once('error', () => { busy = false; minecraft = null; send('finished', { text: 'Процесс игры завершился с ошибкой.' }); });
    proc.once('close', code => { busy = false; minecraft = null; send('finished', { text: code === 0 ? 'Игра закрыта. До следующего приключения!' : 'Игра завершилась с ошибкой. Проверьте совместимость Java.' }); });
    return { ok: true };
  } catch (e) { busy = false; return { error: message(e) }; }
});
