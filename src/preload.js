const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPanel", {
  getSnapshot: () => ipcRenderer.invoke("usage:getSnapshot"),
  getConfig: () => ipcRenderer.invoke("usage:getConfig"),
  openCodexHome: () => ipcRenderer.invoke("usage:openCodexHome")
});
