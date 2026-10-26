'use strict';
// Standalone vanilla Java server. No port forwarding, remote provisioning or license bypass.
const fs=require('node:fs/promises');const {createReadStream,createWriteStream}=require('node:fs');
const path=require('node:path'),os=require('node:os');const {createHash}=require('node:crypto');
const {Readable,Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');
const {spawn}=require('node:child_process');
function javaModule(){try{return require('./java-runtime.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;return require('../java-runtime.cjs');}}
const VERSIONS=['1.21.1','1.20.1','1.19.4'];
const dataDirectory=()=>path.join(process.platform==='win32'?(process.env.LOCALAPPDATA||os.homedir()):path.join(os.homedir(),'.local','share'),'10v12-dedicated');
function safeUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['piston-meta.mojang.com','piston-data.mojang.com','launchermeta.mojang.com','launcher.mojang.com'].includes(u.hostname))throw Error('Неподтверждённый источник Minecraft. Загрузка остановлена.');return u.href;}
async function digest(file){const h=createHash('sha1');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function atomic(file,text){await fs.writeFile(file+'.tmp',text,'utf8');await fs.rename(file+'.tmp',file);}
function validConfig(c){if(!c||!VERSIONS.includes(c.version)||!Number.isInteger(c.ram)||c.ram<2||c.ram>16||!Number.isInteger(c.port)||c.port<1||c.port>65535)throw Error('Проверь server-config.json: version 1.21.1/1.20.1/1.19.4, ram 2–16, port 1–65535.');return c;}
function properties(port){return `# 10v12 Vanilla dedicated server\nserver-port=${port}\nserver-ip=\nonline-mode=true\nwhite-list=true\nenforce-whitelist=true\nenable-rcon=false\nenable-query=false\nmax-players=8\nmotd=10v12 - Our world\nview-distance=8\nsimulation-distance=6\nlevel-name=world\n` ;}
async function setup({directory,ask,fetchImpl=globalThis.fetch,log=console.log}={}){
  if(!directory||!path.isAbsolute(directory)||typeof ask!=='function')throw Error('Нужны абсолютный каталог и явное подтверждение EULA.');
  await fs.mkdir(directory,{recursive:true});
  const configFile=path.join(directory,'server-config.json');let cfg;
  try{cfg=validConfig(JSON.parse(await fs.readFile(configFile,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;cfg={version:'1.21.1',ram:2,port:25565};await atomic(configFile,JSON.stringify(cfg,null,2));}
  const game=path.join(directory,'game');await fs.mkdir(game,{recursive:true});
  const eula=path.join(game,'eula.txt');let accepted=false;
  try{accepted=/^\s*eula\s*=\s*true\s*$/m.test(await fs.readFile(eula,'utf8'));}catch{}
  if(!accepted){
    log('Minecraft EULA: https://www.minecraft.net/eula\nPrivacy: https://www.microsoft.com/privacy/privacystatement');
    const reply=await ask('Прочитай условия. Принимаешь EULA Minecraft для запуска сервера? Введи ДА (иначе отмена): ');
    if(!['да','yes'].includes(String(reply).trim().toLowerCase()))throw Error('EULA не принята. Сервер и Java не скачивались и не запускались.');
    await atomic(eula,'# Accepted explicitly by server operator\neula=true\n');
  }
  const install=path.join(directory,'server-install.json'),jar=path.join(game,'server.jar');let record;
  try{record=JSON.parse(await fs.readFile(install,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Повреждён server-install.json. Сохрани резервную копию и проверь файл.');}
  if(record&&record.version!==cfg.version)throw Error('Версия существующего сервера отличается. Не обновляем и не понижаем мир автоматически. Создай отдельный каталог после резервной копии.');
  let cached=false;
  if(record&&/^[a-f0-9]{40}$/i.test(record.sha1))try{cached=await digest(jar)===record.sha1&&(await fs.stat(jar)).size===record.size;}catch{}
  if(!cached){
    async function request(url){const response=await fetchImpl(safeUrl(url),{signal:AbortSignal.timeout(600000),redirect:'error'});if(!response.ok)throw Error('Ошибка загрузки Minecraft: HTTP '+response.status);if(response.url)safeUrl(response.url);return response;}
    async function json(url){const response=await request(url);const text=await response.text();if(text.length>8*1024*1024)throw Error('Слишком большой ответ Minecraft.');return JSON.parse(text);}
    log('Проверяем официальный Minecraft server '+cfg.version+'…');
    const manifest=await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const version=manifest.versions?.find(v=>v.id===cfg.version);if(!version)throw Error('Версия Minecraft не найдена.');
    const meta=await json(version.url),server=meta.downloads?.server;
    if(!server||!/^[a-f0-9]{40}$/i.test(server.sha1)||!Number.isInteger(server.size)||server.size<1||server.size>300*1024*1024)throw Error('Не удалось подтвердить серверный JAR.');
    const response=await request(server.url),temp=jar+'.download';const h=createHash('sha1');let size=0;
    try{
      const guard=new Transform({transform(chunk,_,done){size+=chunk.length;if(size>server.size)return done(Error('Размер сервера отличается от официального.'));h.update(chunk);done(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),guard,createWriteStream(temp,{flags:'w'}));
      if(size!==server.size||h.digest('hex')!==server.sha1.toLowerCase())throw Error('Контрольная сумма сервера не совпала. Ничего не запускаем.');
      await fs.rename(temp,jar);record={version:cfg.version,sha1:server.sha1.toLowerCase(),size};await atomic(install,JSON.stringify(record,null,2));
    }finally{await fs.rm(temp,{force:true});}
  }
  const props=path.join(game,'server.properties');try{await fs.access(props);}catch{await fs.writeFile(props,properties(cfg.port),{flag:'wx'});}
  const existing=await fs.readFile(props,'utf8');
  // Do not silently weaken authentication or overwrite the operator's existing settings/world.
  if(!/^online-mode=true\s*$/m.test(existing)||!/^white-list=true\s*$/m.test(existing))throw Error('В server.properties должны быть online-mode=true и white-list=true. Проверка аккаунтов и список допуска обязательны в этом наборе.');
  return {cfg,game,jar};
}
async function runServer(directory){
  const {createInterface}=require('node:readline/promises');const rl=createInterface({input:process.stdin,output:process.stdout});
  console.log('10v12 — отдельный Vanilla-сервер\nДанные: '+directory+'\nЭто не хостинг 24/7: компьютер должен работать. VPN/маршрутизация настраиваются отдельно.');
  let result;try{result=await setup({directory,ask:question=>rl.question(question)});}finally{rl.close();}
  const {cfg,game,jar}=result;const {createJavaManager,requiredMajor}=javaModule();
  const runtime=await createJavaManager({directory:path.join(directory,'runtime'),report:e=>console.log(e.text)}).resolve(requiredMajor(cfg.version));
  const java=runtime.executable.replace(/javaw\.exe$/i,'java.exe');
  console.log('В консоли сервера: whitelist add ТвойНик, затем whitelist add НикДруга.\nДля остановки введи stop и дождись сохранения. Порт смотри в game/server.properties.\nПубличный доступ/порты/платный VPS НЕ настраиваются автоматически.');
  const child=spawn(java,['-Xms1G',`-Xmx${cfg.ram}G`,'-jar',jar,'nogui'],{cwd:game,stdio:'inherit',shell:false});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Сервер завершился с кодом '+code+'. Проверь game/logs/latest.log.')));});
}
async function main(){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Для набора сервера нужен Node.js 22 или новее.');
  const directory=dataDirectory();await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,'server-run.lock');let lock;
  try{lock=await fs.open(file,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Набор сервера уже открыт. Если он точно закрыт после сбоя, удали только server-run.lock в '+directory+' и повтори запуск. Мир не удаляй.');throw e;}
  try{await lock.writeFile(String(process.pid));await runServer(directory);}finally{await lock.close();await fs.rm(file,{force:true});}
}
module.exports={setup,properties,validConfig,safeUrl,dataDirectory};
if(require.main===module)main().catch(e=>{console.error('\n'+e.message);process.exitCode=1;});
