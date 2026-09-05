const VERSION = "6.2.0";

function report(kind, detail) {
  const line = kind + (detail ? ":" + detail : "");
  console.log(line);
  const body = document.getElementById("status");
  if (body) body.textContent = line;
}

function readConfig() {
  return fetch("/config.json", { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("config " + res.status);
    return res.json();
  });
}

function joinClientView(cfg) {
  return new Promise(function (resolve, reject) {
    const ZoomMtg = window.ZoomMtg;
    if (!ZoomMtg) {
      reject(new Error("ZoomMtg не загрузился"));
      return;
    }
    ZoomMtg.setZoomJSLib("https://source.zoom.us/" + VERSION + "/lib", "/av");
    ZoomMtg.preLoadWasm();
    ZoomMtg.prepareWebSDK();
    ZoomMtg.i18n.load("en-US");
    ZoomMtg.i18n.onLoad(function () {
      ZoomMtg.init({
        leaveUrl: window.location.origin + "/left",
        disableCORP: !window.crossOriginIsolated,
        patchJsMedia: true,
        leaveOnPageUnload: true,
        disablePreview: true,
        success: function () {
          ZoomMtg.inMeetingServiceListener("onMeetingStatus", function (data) {
            const status = String(
              (data && (data.meetingStatus || data.status)) || "",
            );
            const numeric = Number(status);
            if (/WAIT/i.test(status)) {
              report("ZOOM_BOT_WAITING_ROOM", status);
            }
            if (/ENDED|DISCONNECT/i.test(status) || numeric === 3) {
              report("ZOOM_BOT_ENDED", status);
              if (typeof window.pmBotEvent === "function") {
                window.pmBotEvent("ended");
              }
            }
          });
          ZoomMtg.inMeetingServiceListener("onMeetingEnd", function () {
            report("ZOOM_BOT_ENDED", "onMeetingEnd");
            if (typeof window.pmBotEvent === "function") {
              window.pmBotEvent("ended");
            }
          });
          ZoomMtg.join({
            signature: cfg.signature,
            meetingNumber: cfg.meetingNumber,
            userName: cfg.userName,
            passWord: cfg.passWord || "",
            success: function () {
              report("ZOOM_BOT_JOINED", "sdk");
              if (typeof window.pmBotEvent === "function") {
                window.pmBotEvent("joined");
              }
              try {
                ZoomMtg.mute({ mute: true });
              } catch {
                // запись идёт с входящих дорожек, в эфир бот не говорит
              }
              try {
                ZoomMtg.muteVideo({ mute: true });
              } catch {
                // камера боту не нужна
              }
              resolve("joined");
            },
            error: function (err) {
              reject(new Error(formatZoomErr(err)));
            },
          });
        },
        error: function (err) {
          reject(new Error("init: " + formatZoomErr(err)));
        },
      });
    });
  });
}

function formatZoomErr(err) {
  if (err == null) return "unknown";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

readConfig()
  .then(joinClientView)
  .catch(function (err) {
    report("ZOOM_BOT_SDK_FAILED", err && err.message ? err.message : String(err));
  });
