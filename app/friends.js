'use strict';
let savedFriends=[], lanWorlds=[], localInterfaces=[], scanning=false, friendSaving=false;
if(demo)Object.assign(api,{
  friends:async()=>{try{return {friends:JSON.parse(localStorage.getItem('10v12-preview-friends')||'[]'),interfaces:[]};}catch{return {error:'Не удалось прочитать список предпросмотра.'};}},
  addFriend:async value=>{const items=JSON.parse(localStorage.getItem('10v12-preview-friends')||'[]');if(items.length>=30)return {error:'В списке уже 30 друзей.'};if(items.some(i=>i.host===value.host&&i.port===value.port))return {error:'Такой адрес уже сохранён.'};items.push({...value,id:crypto.randomUUID()});localStorage.setItem('10v12-preview-friends',JSON.stringify(items));return {friends:items};},
  removeFriend:async id=>{const items=JSON.parse(localStorage.getItem('10v12-preview-friends')||'[]').filter(i=>i.id!==id);localStorage.setItem('10v12-preview-friends',JSON.stringify(items));return {friends:items};},
  discoverLan:async()=>({worlds:[],warning:'LAN-поиск работает только в настольном приложении. В браузере доступен предпросмотр списка друзей.'}),
  copyLan:async()=>({error:'Копирование адреса доступно в настольном приложении.'}),serverKit:async()=>({error:'Набор запуска лежит в папке server-kit скачанного архива. Открытие папки — в настольном приложении.'})
});
function friendError(id,message){$(id).textContent=message;$(id).hidden=!message;}
function validateFriendTarget(v){
  const host=v.host.trim(),mode=v.mode||'lan',parts=host.split('.');
  const ipv4=parts.length===4&&parts.every(s=>/^\d{1,3}$/.test(s)&&Number(s)<=255&&s===String(Number(s)));
  const [a,b]=parts.map(Number),usable=ipv4&&a>0&&a<224&&a!==127;
  if(mode==='lan'&&(!ipv4||!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254)))return 'Для LAN нужен локальный IPv4, например 192.168.1.15. Для VPN или сервера переключи тип.';
  if(mode==='vpn'&&!usable)return 'Введи VPN-IPv4 хозяина, например 26.12.34.56. Порт укажи отдельно.';
  const domain=host.length<=253&&host.includes('.')&&!/^[\d.]+$/.test(host)&&parts.every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s));
  if(mode==='server'&&!usable&&!domain)return 'Введи IPv4 или домен сервера без http:// и без порта. IPv6 пока не поддерживается.';
  if(!['lan','vpn','server'].includes(mode))return 'Выбери тип подключения.';
  if(!/^\d{1,5}$/.test(String(v.port))||Number(v.port)<1||Number(v.port)>65535)return 'Порт — целое число от 1 до 65535. Он указан в чате мира или панели хостинга.';
  if(!catalogVersions.some(item=>item.id===v.version))return 'Выбери версию игры друга/сервера.';
  return '';
}
const MODE_NAMES={lan:'LAN',vpn:'VPN-мир',server:'Сервер'};
function updateFriendMode(){
  const mode=$('friend-mode').value;
  $('friend-dialog-title').textContent=mode==='server'?'Добавить сервер':'Добавить друга';
  $('friend-save').firstChild.textContent='Сохранить подключение ';
  document.querySelector('label[for=friend-name]').textContent=mode==='server'?'Название сервера':'Имя друга';
  document.querySelector('label[for=friend-port]').textContent=mode==='server'?'Порт сервера':'Порт мира';
  $('friend-host-label').textContent=mode==='server'?'IPv4 или домен сервера':mode==='vpn'?'VPN-IPv4 хозяина':'Локальный IPv4';
  $('friend-host').placeholder=mode==='server'?'play.example.net':mode==='vpn'?'26.12.34.56':'192.168.1.15';
  $('friend-mode-help').textContent=mode==='server'?'Адрес от хостинга или доступный адрес вашего выделенного сервера.':mode==='vpn'?'Сначала подключитесь к одной VPN-сети. VPN не устанавливается лаунчером.':'В одной Wi-Fi/Ethernet-сети.';
  if(mode==='server'&&!$('friend-port').value)$('friend-port').value='25565';
  friendError('friend-error','');
}
function renderHostInterfaces(){
  const vpn=$('host-mode').value==='vpn',selected=$('host-ip').value;
  const candidates=localInterfaces.filter(i=>vpn||/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.host));
  $('host-ip').replaceChildren();
  if(!candidates.length){const option=document.createElement('option');option.value='';option.textContent=demo?'В настольном приложении':vpn?'VPN-адаптер не найден':'Нет локального IPv4';$('host-ip').append(option);}
  else candidates.forEach(i=>{const option=document.createElement('option');option.value=i.host;option.textContent=i.host+' · '+i.name;option.title=i.name;$('host-ip').append(option);});
  if(candidates.some(i=>i.host===selected))$('host-ip').value=selected;
  $('host-copy').disabled=!candidates.length;
  $('host-ip-label').textContent=vpn?'Твой VPN-IPv4':'Твой локальный IPv4';
  $('host-mode-note').textContent=vpn?'На обоих ПК установите VPN и войдите в одну сеть. Например, в Radmin VPN (Windows): один создаёт сеть, второй подключается по имени и паролю. Пароль передавайте только другу, не сохраняйте в лаунчере.':'Выберите общую Wi-Fi/Ethernet-сеть.';
  $('host-ip-hint').textContent=vpn?'Выбери именно VPN-адаптер: адрес должен совпадать с адресом в VPN-приложении. При отсутствии нажми обновление после установки VPN.':'При нескольких адресах выбери адаптер общей сети Wi-Fi / Ethernet.';
  friendError('host-error','');
}
function makeButton(label,cls,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls;b.onclick=action;return b;}
async function copyWorld(row){try{const r=await api.copyLan(row);if(r.error)return toast(r.error);toast('Адрес скопирован: '+row.host+':'+row.port);}catch{toast('Не удалось скопировать адрес.');}}
async function joinWorld(row){
  if(state.busy||loggingIn)return toast('Minecraft уже запускается или открыт. Скопируй адрес и подключись внутри игры.');
  if(demo)return toast('Это предпросмотр. Подключение к миру доступно в настольном приложении.');
  if(!state.account){openAccount();toast('Сначала войди, затем ещё раз нажми «Присоединиться».');return;}
  const issue=validateFriendTarget(row);if(issue)return toast(issue);
  if(state.settings.version!==row.version&&!await persist({...state.settings,version:row.version}))return;
  await play({host:row.host,port:Number(row.port),version:row.version,mode:row.mode||'lan'});
}
function friendCard(row,discovered){
  const card=document.createElement('article');card.className='friend-card';
  const avatar=document.createElement('span');avatar.className='friend-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=(row.name||'М')[0].toUpperCase();
  const info=document.createElement('div');info.className='friend-card-info';const name=document.createElement('h3');name.textContent=row.name;
  const addr=document.createElement('p');addr.textContent=row.host+':'+row.port;const ver=document.createElement('p');ver.className='friend-version';ver.textContent=discovered?'Версию уточни у хозяина · выбрана '+state.settings.version:'Minecraft '+row.version+' · '+(MODE_NAMES[row.mode||'lan']);info.append(name,addr,ver);
  const actions=document.createElement('div');actions.className='friend-actions';const getTarget=()=>({...row,version:discovered?state.settings.version:row.version,mode:row.mode||'lan'});
  const join=makeButton('Присоединиться','primary',()=>joinWorld(getTarget()));join.disabled=state.busy||loggingIn;join.title=state.busy?'Если игра уже открыта, скопируй адрес и используй прямое подключение.':'Запустить Minecraft с подключением к этому адресу';
  const copy=makeButton('Копировать','secondary',()=>copyWorld(getTarget()));actions.append(join,copy);
  if(discovered)actions.append(makeButton('Сохранить','secondary',()=>openFriendDialog(row)));
  else actions.append(makeButton('Удалить','secondary friend-delete',async()=>{if(!confirm('Удалить «'+row.name+'» из списка? Мир и файлы игры не будут удалены.'))return;try{const r=await api.removeFriend(row.id);if(r.error)return toast(r.error);savedFriends=r.friends;renderFriends();}catch{toast('Не удалось удалить запись.');}}));
  card.append(avatar,info,actions);return card;
}
function renderFriends(){
  $('friend-count').textContent=savedFriends.length;
  $('friends-empty').hidden=savedFriends.length>0;
  $('friends-list').replaceChildren(...savedFriends.map(row=>friendCard(row,false)));
  $('lan-worlds').replaceChildren(...lanWorlds.map(row=>friendCard(row,true)));
}
async function loadFriends(){
  try{const r=await api.friends();if(r.error){friendError('friends-storage-error',r.error);return;}friendError('friends-storage-error','');savedFriends=r.friends||[];localInterfaces=r.interfaces||[];
    renderHostInterfaces();renderFriends();
  }catch{friendError('friends-storage-error','Не удалось загрузить друзей. Перезапусти лаунчер.');}
}
function openFriendDialog(row,mode){
  $('friend-form').reset();friendError('friend-error','');$('friend-version').value=state.settings.version;
  if(row){$('friend-name').value=row.name;$('friend-host').value=row.host;$('friend-port').value=row.port;}
  $('friend-mode').value=mode||row?.mode||'lan';updateFriendMode();$('friend-dialog-title').textContent=$('friend-mode').value==='server'?'Добавить сервер':'Добавить друга';$('friend-dialog').showModal();$('friend-name').focus();
}
$('add-friend').onclick=()=>openFriendDialog();
$('close-friend-dialog').onclick=()=>$('friend-dialog').close();
$('friend-form').onsubmit=async event=>{
  event.preventDefault();if(friendSaving)return;
  const value={name:$('friend-name').value.trim(),host:$('friend-host').value.trim(),port:$('friend-port').value,version:$('friend-version').value,mode:$('friend-mode').value};
  const error=validateFriendTarget(value)||(!value.name?'Введи имя друга.':'');if(error){friendError('friend-error',error);return;}
  friendError('friend-error','');friendSaving=true;$('friend-save').disabled=true;
  try{const r=await api.addFriend({...value,port:Number(value.port)});if(r.error){friendError('friend-error',r.error);return;}savedFriends=r.friends;renderFriends();$('friend-dialog').close();toast('Друг сохранён. Если порт мира изменится, добавь новый адрес.');}
  catch{friendError('friend-error','Не удалось сохранить друга.');}finally{friendSaving=false;$('friend-save').disabled=false;}
};
$('lan-scan').onclick=async()=>{
  if(scanning)return;scanning=true;lanWorlds=[];renderFriends();$('lan-scan').disabled=true;$('lan-scan').querySelector('span').textContent='Поиск…';$('lan-status').textContent='Слушаем объявления открытых LAN-миров… около 5 секунд.';
  try{const r=await api.discoverLan();lanWorlds=r.worlds||[];renderFriends();$('lan-status').textContent=r.error||r.warning||(lanWorlds.length?'Найдено миров: '+lanWorlds.length+'. Версию игры уточни у хозяина; кнопка запуска использует выбранную версию.':'Открытых миров не обнаружено. Друг должен открыть мир для сети. Можно добавить его вручную по IP и порту.');}
  catch{$('lan-status').textContent='Поиск не завершён. Подключись вручную по IP и порту.';}
  finally{scanning=false;$('lan-scan').disabled=false;$('lan-scan').querySelector('span').textContent='Найти';}
};
$('show-host').onclick=()=>{$('host-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});$('host-port').focus({preventScroll:true});};
$('refresh-ips').onclick=loadFriends;
$('host-share-form').onsubmit=async event=>{event.preventDefault();const v={host:$('host-ip').value,port:$('host-port').value,version:state.settings.version,mode:$('host-mode').value};const error=validateFriendTarget(v);friendError('host-error',error);if(!error)await copyWorld({...v,port:Number(v.port)});};
loadFriends();

$('friend-mode').onchange=updateFriendMode;
$('host-mode').onchange=renderHostInterfaces;
$('show-vpn-host').onclick=()=>{$('host-mode').value='vpn';renderHostInterfaces();$('show-host').click();};
$('add-server').onclick=()=>openFriendDialog(null,'server');
$('dedicated-add').onclick=()=>openFriendDialog(null,'server');
$('show-dedicated').onclick=()=>$('dedicated-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
$('open-server-kit').onclick=async()=>{try{const r=await api.serverKit();toast(r.error||'Набор открыт. Запусти START-SERVER-WINDOWS.cmd; EULA принимается только при запуске.');}catch{toast('Набор server-kit также доступен в архиве проекта.');}};

$('friend-form').oninput=()=>friendError('friend-error','');
