const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cuepoint', {
  request: (method, params) => ipcRenderer.invoke('cuepoint:request', method, params),
  choose: (directory) => ipcRenderer.invoke('cuepoint:choose', directory),
  window: (action) => ipcRenderer.invoke('cuepoint:window', action),
  revealFile: (filePath) => ipcRenderer.invoke('cuepoint:revealFile', filePath),
})
