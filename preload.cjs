const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  versions: refresh => ipcRenderer.invoke('launcher:versions', refresh),
  state: () => ipcRenderer.invoke('launcher:state'),
  save: value => ipcRenderer.invoke('launcher:save', value),
  login: () => ipcRenderer.invoke('launcher:login'),
  loginLocal: nickname => ipcRenderer.invoke('launcher:login-local', nickname),
  logout: () => ipcRenderer.invoke('launcher:logout'),
  play: value => ipcRenderer.invoke('launcher:play', value),
  serverKit: () => ipcRenderer.invoke('launcher:server-kit'),
  friends: () => ipcRenderer.invoke('launcher:friends'),
  addFriend: value => ipcRenderer.invoke('launcher:friend-add',value),
  removeFriend: id => ipcRenderer.invoke('launcher:friend-remove',id),
  discoverLan: () => ipcRenderer.invoke('launcher:lan-discover'),
  copyLan: value => ipcRenderer.invoke('launcher:lan-copy',value),
  folder: () => ipcRenderer.invoke('launcher:folder'),
  browseJava: () => ipcRenderer.invoke('launcher:browse-java'),
  onEvent: callback => { const fn = (_, event) => callback(event); ipcRenderer.on('launcher:event', fn); return () => ipcRenderer.removeListener('launcher:event', fn); }
});
