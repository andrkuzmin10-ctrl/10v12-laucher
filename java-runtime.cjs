'use strict';
// Private Temurin runtime: HTTPS download, SHA-256 verification, staged extraction.
// Never changes PATH, JAVA_HOME, the registry, or the system's Java installations.
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const LIMIT = 600 * 1024 * 1024;
const DOWNLOAD_MS = 15 * 60 * 1000;
function requiredMajor(version) {
 const m=/^1\.(\d+)(?:\.(\d+))?(?:-|$)/.exec(version);
 if(!m)return 8;
 const minor=Number(m[1]),patch=Number(m[2]||0);
 return minor>20 || minor===20&&patch>=5 ? 21 : minor>=18 ? 17 : minor===17 ? 16 : 8;
}
function javaMajor(text) {
  const match = String(text).match(/version\s+"(?:1\.)?(\d+)/i) || String(text).match(/(?:openjdk|java)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}
function failure(code, message, cause) { const e = new Error(message, { cause }); e.code = code; return e; }
function targetFor(platform, arch) {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[platform];
  const architecture = { x64: 'x64', arm64: 'aarch64' }[arch];
  if (!os || !architecture) throw failure('JAVA_PLATFORM', 'Авто-Java поддерживает Windows, macOS и Linux (x64 / ARM64). На этой системе укажите совместимую Java вручную.');
  return { os, architecture };
}
function secureUrl(value) {
  let url; try { url = new URL(value); } catch { throw failure('JAVA_METADATA', 'Сервис Java вернул некорректную ссылку. Повторите позже.'); }
  // Package URLs must be from Temurin's official publishing locations.
  if (url.protocol !== 'https:' || url.username || url.password || !['github.com', 'api.adoptium.net', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(url.hostname)) throw failure('JAVA_METADATA', 'Сервис Java вернул неподдерживаемую ссылку. Загрузка остановлена.');
  if (url.hostname === 'github.com' && !/^\/adoptium\/temurin(?:8|16|17|21|25)-binaries\/releases\/download\//.test(url.pathname)) throw failure('JAVA_METADATA', 'Не удалось подтвердить источник Temurin. Загрузка остановлена.');
  return url.href;
}
async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function runProcess(command, args, options = {}) {
  return execFile(command, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024, timeout: options.timeout || 15000, ...(options.env ? { env: options.env } : {}) });
}
function createJavaManager({ directory, report = () => {}, platform = process.platform, arch = process.arch, fetchImpl = globalThis.fetch, run = runProcess, imageType = 'jre', useSystem = true }) {
  if (!path.isAbsolute(directory)) throw new Error('Java runtime directory must be absolute');
  const pending = new Map();
  const emit = (stage, text, percent = null) => report({ stage, text, percent });
  async function probe(executable) {
    const consolePath = executable.replace(/javaw\.exe$/i, 'java.exe');
    const output = await run(consolePath, ['-version'], { timeout: 15000 });
    const major = javaMajor((output.stderr || '') + '\n' + (output.stdout || ''));
    if (!major) throw failure('JAVA_VERIFY', 'Java не ответила на проверку версии.');
    return major;
  }
  async function findJava(folder, depth = 0) {
    if (depth > 5) return null;
    const binary = path.join(folder, 'bin', platform === 'win32' ? 'java.exe' : 'java');
    try { if ((await fs.stat(binary)).isFile()) return binary; } catch {}
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) if (entry.isDirectory()) { const result = await findJava(path.join(folder, entry.name), depth + 1); if (result) return result; }
    return null;
  }
  async function launchExecutable(consolePath) {
    if (platform !== 'win32' || !/java\.exe$/i.test(consolePath)) return consolePath;
    const windowless = consolePath.replace(/java\.exe$/i, 'javaw.exe');
    try { await fs.access(windowless); return windowless; } catch { return consolePath; }
  }
  async function metadata(major, target) {
    for (const type of (imageType === 'jdk' ? ['jdk'] : ['jre', 'jdk'])) {
      const query = new URLSearchParams({ architecture: target.architecture, image_type: type, os: target.os, vendor: 'eclipse' });
      const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?${query}`;
      let response;
      try { response = await fetchImpl(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } }); }
      catch (e) { throw failure('JAVA_NETWORK', 'Не удалось связаться с сервером Java. Проверьте интернет и доступ к api.adoptium.net, затем повторите запуск.', e); }
      if (response.status === 404) continue;
      if (!response.ok) throw failure('JAVA_NETWORK', `Сервер Java временно недоступен (HTTP ${response.status}). Повторите запуск позже.`);
      let values; try { values = await response.json(); } catch (e) { throw failure('JAVA_METADATA', 'Не удалось прочитать список сборок Java. Повторите позже.', e); }
      if (!Array.isArray(values)) throw failure('JAVA_METADATA', 'Сервис Java вернул неожиданный ответ. Повторите позже.');
      const asset = values.find(a => a.binary?.os === target.os && a.binary?.architecture === target.architecture && a.binary?.image_type === type && a.binary?.package);
      if (!asset) continue;
      const pkg = asset.binary.package;
      if (!/^[a-f0-9]{64}$/i.test(pkg.checksum) || !Number.isSafeInteger(pkg.size) || pkg.size <= 0 || pkg.size > LIMIT) throw failure('JAVA_METADATA', 'Некорректные параметры архива Java. Загрузка остановлена.');
      const link = secureUrl(pkg.link);
      const extension = platform === 'win32' ? '.zip' : '.tar.gz';
      if (!new URL(link).pathname.toLowerCase().endsWith(extension)) throw failure('JAVA_METADATA', 'Неожиданный формат архива Java. Загрузка остановлена.');
      return { link, checksum: pkg.checksum.toLowerCase(), size: pkg.size, extension, version: asset.version?.semver || String(major), imageType: type };
    }
    throw failure('JAVA_UNAVAILABLE', `Для этой системы Java ${major} сейчас недоступна. Укажите установленную совместимую Java вручную.`);
  }
  async function download(asset, filename, major) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_MS);
    let lastTime = 0, received = 0;
    try {
      const response = await fetchImpl(asset.link, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
      if (response.url && new URL(response.url).protocol !== 'https:') throw new Error('Insecure redirect');
      const size = Number(response.headers.get('content-length'));
      if (size > LIMIT) throw failure('JAVA_SIZE', 'Архив Java превышает допустимый размер. Загрузка остановлена.');
      const counter = new Transform({ transform(chunk, _, done) {
        received += chunk.length;
        if (received > LIMIT || received > asset.size) return done(failure('JAVA_SIZE', 'Размер архива Java не совпал с данными сервера. Повторите запуск.'));
        if (Date.now() - lastTime > 200) { lastTime = Date.now(); const percent = Math.min(100, Math.floor(received / asset.size * 100)); emit('download', `Java ${major} · загрузка ${percent}%`, percent); }
        done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(filename, { flags: 'wx' }), { signal: controller.signal });
      if (received !== asset.size) throw failure('JAVA_SIZE', 'Java скачалась не полностью. Нажмите «Играть» ещё раз для повторной загрузки.');
      emit('download', `Java ${major} · загружена`, 100);
    } catch (e) {
      controller.abort();
      if (e.code?.startsWith('JAVA_') || ['ENOSPC', 'EACCES', 'EPERM'].includes(e.code)) throw e;
      throw failure('JAVA_NETWORK', 'Не удалось скачать Java. Проверьте интернет и доступ к GitHub, затем нажмите «Играть» ещё раз. Незавершённая загрузка будет удалена.', e);
    } finally { clearTimeout(timeout); }
  }
  async function install(major, destination, target) {
    emit('lookup', `Подбираем Temurin Java ${major} для вашего компьютера…`);
    const asset = await metadata(major, target);
    await fs.mkdir(directory, { recursive: true });
    const temporary = await fs.mkdtemp(path.join(directory, `.install-${major}-`));
    const archive = path.join(temporary, 'runtime' + asset.extension);
    const extracted = path.join(temporary, 'unpacked');
    try {
      await download(asset, archive, major);
      emit('verify', `Java ${major} · проверка SHA-256…`);
      if (await hashFile(archive) !== asset.checksum) throw failure('JAVA_CHECKSUM', 'Контрольная сумма Java не совпала. Архив не установлен. Повторите загрузку; если ошибка повторится, проверьте подключение.');
      await fs.mkdir(extracted);
      emit('extract', `Java ${major} · распаковка, не закрывайте лаунчер…`);
      try {
        if (platform === 'win32') {
          const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
          await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:TENV12_ARCHIVE -DestinationPath $env:TENV12_EXTRACT -Force"], { timeout: 5 * 60000, env: { ...process.env, TENV12_ARCHIVE: archive, TENV12_EXTRACT: extracted } });
        } else {
          await run('/usr/bin/tar', ['-xzf', archive, '-C', extracted], { timeout: 5 * 60000 });
        }
      } catch (e) { throw failure('JAVA_EXTRACT', 'Не удалось распаковать Java. Проверьте свободное место, права доступа и наличие PowerShell (Windows) / tar (macOS, Linux).', e); }
      const executable = await findJava(extracted);
      if (!executable) throw failure('JAVA_VERIFY', 'В архиве не найден исполняемый файл Java. Установка остановлена.');
      try { if (await probe(executable) !== major) throw new Error('Wrong Java major'); }
      catch (e) { throw failure('JAVA_VERIFY', 'Скачанная Java не прошла проверку запуска. Проверьте совместимость ОС и ограничения антивируса.', e); }
      const relative = path.relative(extracted, executable);
      await fs.writeFile(path.join(extracted, '.10v12-runtime.json'), JSON.stringify({ major, version: asset.version, source: asset.link, sha256: asset.checksum, installedAt: new Date().toISOString() }, null, 2));
      // A broken cached runtime is replaced only after the new one has passed verification.
      const backup = destination + '.old-' + randomUUID();
      let backedUp = false;
      try { await fs.rename(destination, backup); backedUp = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      try { await fs.rename(extracted, destination); }
      catch (e) { if (backedUp) await fs.rename(backup, destination).catch(() => {}); throw e; }
      if (backedUp) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
      emit('ready', `Java ${major} установлена. Продолжаем запуск Minecraft.`, 100);
      return { executable: await launchExecutable(path.join(destination, relative)), major, managed: true };
    } finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
  }
  async function resolve(major, requestedPath = '') {
    if (![8,16,17,21,25].includes(major)) throw failure('JAVA_VERSION', `Для этой версии нужна Java ${major}. Автоустановка этой Java пока не поддерживается.`);
    const manual = typeof requestedPath === 'string' ? requestedPath.trim() : '';
    if (manual) {
      try { const detected = await probe(manual); if (detected === major) { emit('ready', `Используем выбранную Java ${major}.`, 100); return { executable: manual, major, managed: false }; }
        emit('fallback', `Выбрана Java ${detected}, нужна ${major}. Подбираем подходящую автоматически…`);
      } catch { emit('fallback', 'Указанная Java недоступна. Подбираем подходящую автоматически…'); }
    }
    // Manual paths work even on a platform not supported by automatic downloads.
    const target = targetFor(platform, arch);
    const destination = path.join(directory, `temurin-${imageType === 'jdk' ? 'jdk-' : ''}${major}-${target.os}-${target.architecture}`);
    const cached = await findJava(destination);
    if (cached) {
      try { if (await probe(cached) === major) { emit('ready', `Используем Java ${major} из папки 10v12.`, 100); return { executable: await launchExecutable(cached), major, managed: true }; } } catch {}
      emit('repair', `Переустанавливаем повреждённую Java ${major}…`);
    }
    try { if (useSystem && await probe('java') === major) { emit('ready', `Используем системную Java ${major}.`, 100); return { executable: 'java', major, managed: false }; } } catch {}
    // Only one install per major can run in this process.
    if (!pending.has(major)) pending.set(major, install(major, destination, target).catch(e => {
      if (e.code === 'ENOSPC') throw failure('JAVA_DISK', 'Недостаточно места для Java. Освободите место на системном диске и повторите запуск.', e);
      if (['EACCES', 'EPERM'].includes(e.code)) throw failure('JAVA_PERMISSIONS', 'Нет доступа к папке Java. Проверьте права и ограничения антивируса; запуск от администратора обычно не нужен.', e);
      if (e.code?.startsWith('JAVA_')) throw e;
      throw failure('JAVA_INSTALL', 'Не удалось установить Java в папку лаунчера. Проверьте свободное место, права доступа и интернет, затем повторите запуск.', e);
    }).finally(() => pending.delete(major)));
    return pending.get(major);
  }
  return { resolve, probe };
}
module.exports = { createJavaManager, requiredMajor, javaMajor, targetFor };
