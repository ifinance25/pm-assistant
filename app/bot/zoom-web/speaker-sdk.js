// Zoom: таймлайн активного спикера из объекта клиента Zoom Video SDK, если он
// есть на странице. Подключается после bot/common/capture-audio.js, который
// выставляет window.__pmRecordSpeaker и сам опрашивает DOM.
(() => {
  function tryHookVideoSdkClient() {
    const record = window.__pmRecordSpeaker;
    if (typeof record !== "function") {
      return false;
    }
    const candidates = [window.client, window.zmClient, window.ZoomVideoSDKClient];
    for (const client of candidates) {
      if (client && typeof client.on === "function") {
        try {
          client.on("active-speaker", (payload) => {
            const list = Array.isArray(payload) ? payload : [payload];
            const first = list[0] || {};
            record(first.displayName || first.userName || first.name);
          });
          console.log("ZOOM_BOT_ACTIVE_SPEAKER_SOURCE:sdk");
          return true;
        } catch {
          // объект похож на клиент, но API отличается: не критично
        }
      }
    }
    return false;
  }

  if (!tryHookVideoSdkClient()) {
    // SDK-объект иногда появляется позже (после входа в звонок): пробуем ещё раз.
    setTimeout(tryHookVideoSdkClient, 5000);
  }
})();
