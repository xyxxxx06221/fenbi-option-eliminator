const enabled = document.querySelector("#enabled");

chrome.storage.sync.get({ enabled: true }, (settings) => {
  enabled.checked = settings.enabled;
});

enabled.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabled.checked });
});
