const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPanel", {
  getSnapshot: () => ipcRenderer.invoke("usage:getSnapshot"),
  refreshFull: () => ipcRenderer.invoke("usage:refreshFull"),
  getConfig: () => ipcRenderer.invoke("usage:getConfig"),
  openCodexHome: () => ipcRenderer.invoke("usage:openCodexHome"),
  onSnapshot: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("usage:snapshot", listener);
    return () => ipcRenderer.removeListener("usage:snapshot", listener);
  },
  onSyncProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("usage:syncProgress", listener);
    return () => ipcRenderer.removeListener("usage:syncProgress", listener);
  }
});
