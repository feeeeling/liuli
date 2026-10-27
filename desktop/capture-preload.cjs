const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("capture", {
  ready: () => ipcRenderer.invoke("liuli:capture-ready"),
  select: rect => ipcRenderer.invoke("liuli:capture-select", rect),
  cancel: () => ipcRenderer.invoke("liuli:capture-cancel"),
});
