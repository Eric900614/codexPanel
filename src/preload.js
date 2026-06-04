const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexPanel", {
  getSnapshot: () => ipcRenderer.invoke("usage:getSnapshot"),
  refreshFull: () => ipcRenderer.invoke("usage:refreshFull"),
  getConfig: () => ipcRenderer.invoke("usage:getConfig"),
  openCodexHome: () => ipcRenderer.invoke("usage:openCodexHome"),
  onSyncProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("usage:syncProgress", listener);
    return () => ipcRenderer.removeListener("usage:syncProgress", listener);
  }
});
