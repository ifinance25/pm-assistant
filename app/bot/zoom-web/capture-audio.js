(() => {
  if (window.__pmCaptureInstalled) {
    return;
  }
  window.__pmCaptureInstalled = true;
  window.__pmChunkCount = 0;

  let silentMic = null;

  function silentMicStream() {
    if (silentMic && silentMic.getAudioTracks().some((t) => t.readyState === "live")) {
      return silentMic.clone();
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return new MediaStream();
    }
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    silentMic = dest.stream;
    return silentMic.clone();
  }

  function installSilentMic() {
    const devices = navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== "function") {
      return;
    }
    const orig = devices.getUserMedia.bind(devices);
    devices.getUserMedia = function getUserMedia(constraints) {
      const wantAudio = !constraints || Boolean(constraints.audio);
      const wantVideo = Boolean(constraints && constraints.video);
      if (wantAudio && !wantVideo) {
        return Promise.resolve(silentMicStream());
      }
      if (wantAudio && wantVideo) {
        return orig.call(devices, { video: constraints.video }).then((cam) => {
          for (const track of silentMicStream().getAudioTracks()) {
            cam.addTrack(track);
          }
          return cam;
        });
      }
      return orig.call(devices, constraints);
    };
  }

  installSilentMic();

  function log(line) {
    // join.mjs форвардит в stdout любую строку console с префиксом ZOOM_BOT_
    console.log(line);
  }

  const OriginalPC = window.RTCPeerConnection;
  const hooked = new WeakSet();
  const seenAudioReceivers = new WeakSet();
  let rtcTrackCount = 0;
  const mixer = {
    ctx: null,
    dest: null,
    analyser: null,
    recorder: null,
    sources: [],
    lastPush: Promise.resolve(),
    recordingStartedAt: null,
  };

  // Фаза 3.1: захват вкладки — основной путь. RTC-хук остаётся запасным
  // и включается автоматически, если getDisplayMedia недоступен/отклонён,
  // либо если вкладка молчит (см. watchdog ниже, фаза 3.2).
  let usingTabCapture = false;
  let tabCaptureStream = null;
  const pendingRtcTracks = [];

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function pushBlob(blob) {
    if (!blob || !blob.size) {
      return;
    }
    window.__pmChunkCount += 1;
    try {
      const b64 = await blobToBase64(blob);
      if (typeof window.pmPushAudio === "function") {
        await window.pmPushAudio(b64);
      }
    } catch {
      // кадр звука потерян: лучше тишина, чем падение звонка
    }
  }

  function ensureMixer() {
    if (mixer.ctx) {
      return mixer;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return mixer;
    }
    mixer.ctx = new Ctx();
    mixer.dest = mixer.ctx.createMediaStreamDestination();
    // Аналайзер — проходной узел между источниками и dest: пишущемуся
    // MediaRecorder ничего не мешает, а сюда цепляется RMS-вотчдог (3.2).
    mixer.analyser = mixer.ctx.createAnalyser();
    mixer.analyser.fftSize = 2048;
    mixer.analyser.connect(mixer.dest);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    try {
      mixer.recorder = new MediaRecorder(mixer.dest.stream, { mimeType: mime });
    } catch {
      mixer.recorder = new MediaRecorder(mixer.dest.stream);
    }
    mixer.recorder.addEventListener("dataavailable", (event) => {
      mixer.lastPush = pushBlob(event.data);
    });
    mixer.recorder.start(1000);
    mixer.recordingStartedAt = Date.now();
    startSilenceWatchdog();
    setInterval(() => {
      if (mixer.ctx && mixer.ctx.state === "suspended") {
        mixer.ctx.resume().catch(() => {});
      }
    }, 2000);
    return mixer;
  }

  function connectSource(track) {
    const mix = ensureMixer();
    if (!mix.ctx || !mix.analyser) {
      return;
    }
    try {
      const stream = new MediaStream([track]);
      const src = mix.ctx.createMediaStreamSource(stream);
      src.connect(mix.analyser);
      mixer.sources.push(src);
    } catch {
      // дорожка уже занята другим графом
    }
  }

  function addTrack(track) {
    if (!track || track.kind !== "audio" || track.__pmHooked) {
      return;
    }
    track.__pmHooked = true;
    if (usingTabCapture) {
      // Захват вкладки уже несёт весь звук страницы, включая этот трек
      // (он декодируется в тот же <audio>/<video> внутри вкладки). Не
      // подмешиваем повторно — держим про запас на случай отката (3.2).
      pendingRtcTracks.push(track);
      return;
    }
    connectSource(track);
  }

  function fallBackToRtcHook(reason) {
    if (!usingTabCapture) {
      return;
    }
    usingTabCapture = false;
    log(`ZOOM_BOT_CAPTURE_SWITCH:${reason}`);
    if (tabCaptureStream) {
      for (const track of tabCaptureStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // трек уже мог быть остановлен вкладкой
        }
      }
      tabCaptureStream = null;
    }
    const backlog = pendingRtcTracks.splice(0, pendingRtcTracks.length);
    for (const track of backlog) {
      if (track.readyState === "live") {
        connectSource(track);
      }
    }
  }

  // Фаза 3.2: RMS каждые 2 с по общему миксу; 20 с подряд у нуля —
  // переключаемся с захвата вкладки на RTC-хук.
  const RMS_SILENCE_THRESHOLD = 0.001;
  const RMS_SWITCH_AFTER_MS = 20000;
  let silentSinceMs = null;

  function startSilenceWatchdog() {
    if (!mixer.analyser) {
      return;
    }
    const buffer = new Uint8Array(mixer.analyser.fftSize);
    setInterval(() => {
      mixer.analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const normalized = (buffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      log(`ZOOM_BOT_RMS:${rms.toFixed(5)}`);
      if (rms > RMS_SILENCE_THRESHOLD) {
        silentSinceMs = null;
        return;
      }
      if (silentSinceMs == null) {
        silentSinceMs = Date.now();
        return;
      }
      if (usingTabCapture && Date.now() - silentSinceMs >= RMS_SWITCH_AFTER_MS) {
        fallBackToRtcHook(`тишина ${RMS_SWITCH_AFTER_MS}мс на захвате вкладки`);
        silentSinceMs = null;
      }
    }, 2000);
  }

  async function startTabCapture() {
    const devices = navigator.mediaDevices;
    if (!devices || typeof devices.getDisplayMedia !== "function") {
      log("ZOOM_BOT_CAPTURE_PATH:rtc-hook (getDisplayMedia недоступен)");
      return;
    }
    try {
      const stream = await devices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: true,
      });
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        for (const track of stream.getTracks()) track.stop();
        log("ZOOM_BOT_CAPTURE_PATH:rtc-hook (у вкладки нет звуковой дорожки)");
        return;
      }
      tabCaptureStream = stream;
      usingTabCapture = true;
      for (const track of audioTracks) {
        track.__pmHooked = true;
        connectSource(track);
      }
      log("ZOOM_BOT_CAPTURE_PATH:tab");
    } catch (err) {
      log(`ZOOM_BOT_CAPTURE_PATH:rtc-hook (${err && err.message ? err.message : err})`);
    }
  }

  function hookPeer(pc) {
    if (!pc || hooked.has(pc)) {
      return pc;
    }
    hooked.add(pc);
    pc.addEventListener("track", (event) => {
      if (event.track) {
        addTrack(event.track);
      }
      for (const stream of event.streams || []) {
        for (const track of stream.getAudioTracks()) {
          addTrack(track);
        }
      }
    });
    const origSetRemote = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = function setRemoteDescription(desc) {
      return Promise.resolve(origSetRemote(desc)).then((result) => {
        try {
          // Фаза 4.0: сколько отдельных аудиодорожек шлёт Zoom Web SDK —
          // от этого зависит, будет ли бонус "дорожка на человека" (фаза 4, бонус).
          for (const receiver of pc.getReceivers()) {
            if (receiver.track && receiver.track.kind === "audio" && !seenAudioReceivers.has(receiver)) {
              seenAudioReceivers.add(receiver);
              rtcTrackCount += 1;
              log(`ZOOM_BOT_RTC_TRACKS:${rtcTrackCount}`);
            }
            if (receiver.track) {
              addTrack(receiver.track);
            }
          }
        } catch {
          // SDP ещё не применился
        }
        return result;
      });
    };
    return pc;
  }

  if (OriginalPC) {
    const HookedPC = new Proxy(OriginalPC, {
      construct(target, args) {
        return hookPeer(new target(...args));
      },
    });
    window.RTCPeerConnection = HookedPC;
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = HookedPC;
    }
  }

  function hookMediaElement(el) {
    if (!el || el.__pmMediaHooked) {
      return;
    }
    el.__pmMediaHooked = true;
    el.muted = true;
    el.defaultMuted = true;
    el.volume = 0;
    const start = () => {
      try {
        const capture = el.captureStream || el.mozCaptureStream;
        if (typeof capture === "function") {
          const stream = capture.call(el);
          for (const track of stream.getAudioTracks()) {
            addTrack(track);
          }
        }
      } catch {
        // элемент без звука
      }
    };
    el.addEventListener("playing", start);
    if (!el.paused) {
      start();
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          hookMediaElement(node);
        }
        if (node && node.querySelectorAll) {
          for (const el of node.querySelectorAll("audio, video")) {
            hookMediaElement(el);
          }
        }
      }
    }
  });
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });
  for (const el of document.querySelectorAll("audio, video")) {
    hookMediaElement(el);
  }

  // Фаза 4.1/4.2: таймлайн активного спикера. `client.on("active-speaker")`
  // (Zoom Video SDK) — если объект есть на странице; иначе опрос DOM за
  // подсвеченной плиткой говорящего. Селекторы DOM не проверены на живом
  // звонке (Zoom меняет разметку между версиями) — при расхождении смотреть
  // фактический DOM и поправить CANDIDATE_SELECTORS ниже.
  const speakerTimeline = [];
  let lastSpeakerName = null;

  function recordSpeaker(name) {
    const clean = String(name || "").trim();
    if (!clean || clean === lastSpeakerName || !mixer.recordingStartedAt) {
      return;
    }
    lastSpeakerName = clean;
    speakerTimeline.push({ atMs: Date.now() - mixer.recordingStartedAt, name: clean });
  }

  function tryHookVideoSdkClient() {
    const candidates = [window.client, window.zmClient, window.ZoomVideoSDKClient];
    for (const client of candidates) {
      if (client && typeof client.on === "function") {
        try {
          client.on("active-speaker", (payload) => {
            const list = Array.isArray(payload) ? payload : [payload];
            const first = list[0] || {};
            recordSpeaker(first.displayName || first.userName || first.name);
          });
          log("ZOOM_BOT_ACTIVE_SPEAKER_SOURCE:sdk");
          return true;
        } catch {
          // объект похож на клиент, но API отличается — не критично
        }
      }
    }
    return false;
  }

  const ACTIVE_SPEAKER_SELECTORS = [
    '[class*="active-speaker" i]',
    '[class*="speaker-active" i]',
    '[class*="talking" i]',
    '[aria-label*="is talking" i]',
  ];

  function guessSpeakerNameFromElement(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && /[a-zа-яё]/i.test(aria)) {
      return aria.replace(/is talking|говорит/gi, "").trim();
    }
    const nameEl =
      el.querySelector && el.querySelector('[class*="name" i]');
    if (nameEl && nameEl.textContent) {
      return nameEl.textContent.trim();
    }
    return el.textContent ? el.textContent.trim().slice(0, 60) : null;
  }

  function pollDomForActiveSpeaker() {
    for (const selector of ACTIVE_SPEAKER_SELECTORS) {
      let found;
      try {
        found = document.querySelector(selector);
      } catch {
        continue;
      }
      if (found) {
        recordSpeaker(guessSpeakerNameFromElement(found));
        return;
      }
    }
  }

  if (!tryHookVideoSdkClient()) {
    log("ZOOM_BOT_ACTIVE_SPEAKER_SOURCE:dom-poll");
    setInterval(pollDomForActiveSpeaker, 1000);
    // SDK-объект иногда появляется позже (после входа в звонок) — пробуем ещё раз.
    setTimeout(tryHookVideoSdkClient, 5000);
  }

  window.__pmGetSpeakerTimeline = function pmGetSpeakerTimeline() {
    return JSON.stringify(speakerTimeline);
  };

  // Фаза 3.1: пробуем захват вкладки сразу при установке скрипта — на
  // join.html заголовок совпадает с --auto-select-tab-capture-source-by-title,
  // поэтому headless Chromium выбирает вкладку без диалога.
  void startTabCapture();

  // Фаза 3.3: requestData() принудительно сбрасывает буфер, затем stop()
  // даёт финальный dataavailable и событие stop. Ждём именно завершения
  // pushBlob последнего куска, а не фиксированную паузу — она была лишь
  // временной подпоркой (см. join.mjs, ранее 1200мс).
  window.__pmStopCapture = function pmStopCapture() {
    return new Promise((resolve) => {
      const rec = mixer.recorder;
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      rec.addEventListener(
        "stop",
        () => {
          Promise.resolve(mixer.lastPush).then(() => resolve());
        },
        { once: true },
      );
      try {
        rec.requestData();
      } catch {
        // не все реализации поддерживают requestData в любой момент — не критично
      }
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
  };
})();
