'use strict';
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { createJavaManager } = require('./java-runtime.cjs');
const MC = '1.21.1', LOADER = '0.16.10', API = '0.102.1+1.21.1', GRADLE = '8.10.2';
const PROFILE = `fabric-loader-${LOADER}-${MC}`;
const MOD_FILE = '10v12-visuals-1.1.0.jar';
const API_FILE = `fabric-api-${API}.jar`;
function issue(code, text, cause) { const e = new Error(text, { cause }); e.code = code; return e; }
async function hash(filename, algorithm = 'sha256') { const h = createHash(algorithm); for await (const part of createReadStream(filename)) h.update(part); return h.digest('hex'); }
async function sourceHash(directory) {
  const h = createHash('sha256');
  async function walk(folder) { const entries = await fs.readdir(folder, { withFileTypes: true }); for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name,'en'))) {
    if (['build','.gradle','.git'].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) { h.update(path.relative(directory, file).split(path.sep).join('/')); h.update('\0'); h.update(await fs.readFile(file)); h.update('\0'); }
  } }
  await walk(directory); return h.digest('hex');
}
function run(command, args, { cwd, env = process.env, log = () => {}, timeout = 30 * 60 * 1000, verbatim = false } = {}) {
  return new Promise((resolve,reject) => {
    const proc = spawn(command,args,{ cwd, env, shell: false, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: ['ignore','pipe','pipe'] });
    let settled=false;
    const timer=setTimeout(()=>{proc.kill();if(!settled){settled=true;reject(issue('VISUALS_TIMEOUT','Подготовка заняла слишком много времени. Проверь интернет и повтори запуск.'));}},timeout);
    proc.stdout.on('data',log);proc.stderr.on('data',log);
    proc.once('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
    proc.once('close',code=>{clearTimeout(timer);if(!settled){settled=true;code===0?resolve():reject(issue('VISUALS_BUILD','Не удалось собрать мод. Подробности — visuals-build.log в папке данных 10v12. Проверь интернет, свободное место и повтори запуск.'));}});
  });
}
function createVisualsInstaller({ gameRoot, dataRoot, sourceDirectory, report = () => {}, fetchImpl = globalThis.fetch, runImpl = run, javaFactory = createJavaManager, platform = process.platform }) {
  const tools=path.join(dataRoot,'build-tools');
  const emit=(stage,text,percent=null)=>report({stage,text,percent});
  async function response(url) { let result;try{result=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});}catch(e){throw issue('VISUALS_NETWORK','Не удалось связаться с сервером Fabric / Gradle. Проверь интернет и повтори запуск.',e);}if(!result.ok)throw issue('VISUALS_NETWORK',`Сервер подготовки недоступен (HTTP ${result.status}). Повтори запуск позже.`);return result; }
  async function checkedDownload(url,destination,algorithm,expected,limit,label) {
    if(!new RegExp(`^[a-f0-9]{${algorithm==='sha1'?40:64}}$`,'i').test(expected))throw issue('VISUALS_CHECKSUM','Сервер вернул некорректную контрольную сумму. Загрузка остановлена.');
    try{if(await hash(destination,algorithm)===expected.toLowerCase())return;}catch{}
    await fs.mkdir(path.dirname(destination),{recursive:true});const temporary=destination+'.part';
    await fs.rm(temporary,{force:true});const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15*60000);
    try {
      const result=await fetchImpl(url,{signal:controller.signal,redirect:'follow'});if(!result.ok||!result.body)throw Error('download');
      if(result.url&&new URL(result.url).protocol!=='https:')throw Error('unsafe redirect');
      const total=Number(result.headers.get('content-length'));if(total>limit)throw issue('VISUALS_SIZE','Загружаемый файл слишком большой. Загрузка остановлена.');
      let received=0,last=0;const counter=new Transform({transform(chunk,_,done){received+=chunk.length;if(received>limit)return done(issue('VISUALS_SIZE','Превышен допустимый размер загрузки.'));if(Date.now()-last>250){last=Date.now();const p=total>0?Math.min(100,Math.floor(received/total*100)):null;emit('download-'+label,`${label} · загрузка${p===null?'…':' '+p+'%'}`,p);}done(null,chunk);}});
      await pipeline(Readable.fromWeb(result.body),counter,createWriteStream(temporary,{flags:'wx'}),{signal:controller.signal});
      if(await hash(temporary,algorithm)!==expected.toLowerCase())throw issue('VISUALS_CHECKSUM',`${label}: контрольная сумма не совпала. Файл не установлен; повтори загрузку.`);
      // Files here are only owned by 10v12; never remove other mods.
      await fs.rm(destination,{force:true});await fs.rename(temporary,destination);
    } catch(e) {if(e.code?.startsWith?.('VISUALS_'))throw e;throw issue('VISUALS_NETWORK',`Не удалось загрузить ${label}. Проверь интернет, свободное место и повтори запуск.`,e);}
    finally{controller.abort();clearTimeout(timer);await fs.rm(temporary,{force:true}).catch(()=>{});}
  }
  async function checksum(url,algorithm='sha256') {const value=(await (await response(url)).text()).trim().split(/\s+/)[0];if(!new RegExp(`^[a-f0-9]{${algorithm==='sha1'?40:64}}$`,'i').test(value))throw issue('VISUALS_CHECKSUM','Не удалось прочитать контрольную сумму. Загрузка остановлена.');return value;}
  async function ensureGradle() {
    const directory=path.join(tools,`gradle-${GRADLE}`);const binary=path.join(directory,'bin',platform==='win32'?'gradle.bat':'gradle');
    try{await fs.access(binary);return binary;}catch{}
    const url=`https://services.gradle.org/distributions/gradle-${GRADLE}-bin.zip`;
    const archive=path.join(tools,`gradle-${GRADLE}-bin.zip`);
    await checkedDownload(url,archive,'sha256',await checksum(url+'.sha256'),200*1024*1024,'Gradle');
    const temporary=await fs.mkdtemp(path.join(tools,'.gradle-extract-'));
    emit('gradle-extract','Распаковываем инструменты сборки…');
    try{
      if(platform==='win32')await runImpl(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:TENV12_ARCHIVE -DestinationPath $env:TENV12_EXTRACT -Force"],{env:{...process.env,TENV12_ARCHIVE:archive,TENV12_EXTRACT:temporary},timeout:300000});
      else await runImpl('/usr/bin/unzip',['-q',archive,'-d',temporary],{timeout:300000});
      await fs.access(path.join(temporary,`gradle-${GRADLE}`,'bin',platform==='win32'?'gradle.bat':'gradle'));
      await fs.rm(directory,{recursive:true,force:true});await fs.rename(path.join(temporary,`gradle-${GRADLE}`),directory);return binary;
    }finally{await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});}
  }
  async function ensureProfile() {
    const file=path.join(gameRoot,'versions',PROFILE,PROFILE+'.json');
    function valid(p){return p?.id===PROFILE&&p.inheritsFrom===MC&&p.mainClass==='net.fabricmc.loader.impl.launch.knot.KnotClient'&&Array.isArray(p.libraries)&&p.libraries.length>0;}
    try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(valid(value))return;}catch{}
    emit('fabric','Устанавливаем профиль Fabric 1.21.1…');
    const profile=await (await response(`https://meta.fabricmc.net/v2/versions/loader/${MC}/${LOADER}/profile/json`)).json();
    if(!valid(profile))throw issue('FABRIC_PROFILE','Fabric вернул неожиданный профиль. Подготовка остановлена.');
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(profile,null,2));await fs.rename(file+'.tmp',file);
  }
  async function retireLegacy() {
    // Only our known previous artifact; never touch worlds or third-party mods.
    const old=path.join(gameRoot,'mods','10v12-visuals-1.0.0.jar');
    try { await fs.access(old); } catch { return; }
    const backup=path.join(dataRoot,'mod-backups');await fs.mkdir(backup,{recursive:true});
    await fs.copyFile(old,path.join(backup,'10v12-visuals-1.0.0.jar'));await fs.rm(old);
  }
  async function ensure() {
    try {
      let existingMods = []; try { existingMods = await fs.readdir(path.join(gameRoot, 'mods')); } catch {}
      if (existingMods.some(name => /^fabric-api(?:-.*)?\.jar$/i.test(name) && name !== API_FILE)) throw issue('VISUALS_MOD_CONFLICT', 'В папке mods уже есть другой Fabric API. Перемести его за пределы mods (сохрани резервную копию) и повтори запуск, чтобы избежать дубликатов.');
      const fingerprint=await sourceHash(sourceDirectory);
      const manifestFile=path.join(dataRoot,'visuals-install.json');const mod=path.join(gameRoot,'mods',MOD_FILE);const api=path.join(gameRoot,'mods',API_FILE);
      try{const record=JSON.parse(await fs.readFile(manifestFile,'utf8'));if(record.source===fingerprint&&record.loader===LOADER&&record.api===API&&await hash(mod)===record.modHash&&await hash(api)===record.apiHash){await ensureProfile();await retireLegacy();emit('ready','10v12 Visuals готов. В игре нажми Right Shift.',100);return {custom:PROFILE};}}catch{}
      await fs.mkdir(tools,{recursive:true});
      const manager=javaFactory({directory:path.join(tools,'jdk'),imageType:'jdk',useSystem:false,report:e=>emit('jdk-'+e.stage,e.text,e.percent)});
      emit('jdk','Подготавливаем JDK 21 для первой сборки мода…');const runtime=await manager.resolve(21);
      const java=runtime.executable.replace(/javaw\.exe$/i,'java.exe');const javaHome=path.dirname(path.dirname(java));
      await fs.access(path.join(javaHome,'bin',platform==='win32'?'javac.exe':'javac'));
      const gradle=await ensureGradle();
      const work=path.join(dataRoot,'visuals-build',fingerprint.slice(0,16));
      await fs.mkdir(work,{recursive:true});await fs.cp(sourceDirectory,work,{recursive:true,filter:s=>!['build','.gradle','.git'].includes(path.basename(s))});
      const logFile=path.join(dataRoot,'visuals-build.log');await fs.writeFile(logFile,'10v12 Visuals build\n');
      let logSize=0,logChain=Promise.resolve();const log=chunk=>{if(logSize>4*1024*1024)return;logSize+=chunk.length;logChain=logChain.then(()=>fs.appendFile(logFile,chunk)).catch(()=>{});};
      const env={...process.env,JAVA_HOME:javaHome,GRADLE_USER_HOME:path.join(tools,'gradle-cache'),TENV12_GRADLE:gradle};
      emit('build','Собираем 10v12 Visuals. Первый запуск может занять 5–15 минут…');
      try{
        if(platform==='win32')await runImpl(path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'),['/d','/s','/c','""%TENV12_GRADLE%" --no-daemon --console=plain build"'],{cwd:work,env,log,verbatim:true});
        else await runImpl(gradle,['--no-daemon','--console=plain','build'],{cwd:work,env,log});
      }finally{await logChain;}
      const built=path.join(work,'build','libs',MOD_FILE);await fs.access(built);
      const apiUrl=`https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${API}/${API_FILE}`;
      await checkedDownload(apiUrl,api,'sha1',await checksum(apiUrl+'.sha1','sha1'),10*1024*1024,'Fabric API');
      await fs.mkdir(path.dirname(mod),{recursive:true});await fs.copyFile(built,mod+'.tmp');await fs.rename(mod+'.tmp',mod);
      await ensureProfile();await retireLegacy();
      await fs.writeFile(manifestFile,JSON.stringify({source:fingerprint,loader:LOADER,api:API,modHash:await hash(mod),apiHash:await hash(api)},null,2));
      emit('ready','10v12 Visuals установлен. В игре нажми Right Shift.',100);return {custom:PROFILE};
    }catch(e){if(e.code?.startsWith?.('JAVA_')||e.code?.startsWith?.('VISUALS_')||e.code?.startsWith?.('FABRIC_'))throw e;throw issue('VISUALS_SETUP','Не удалось подготовить 10v12 Visuals. Проверь интернет и свободное место. Подробности — visuals-build.log в папке данных приложения.',e);}
  }
  return {ensure};
}
module.exports={createVisualsInstaller,sourceHash,PROFILE};
