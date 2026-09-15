// Перехват звука в странице звонка: общий для ботов всех платформ.
// Скрипт входа платформы подключает его через bot/common/audio-sink.mjs
// (installAudioCapture) и принимает куски звука в window.pmPushAudio.
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

  // Префикс строк журнала. Скрипт входа пересылает в stdout строки console
  // с этим префиксом; платформа может задать свой через window.__pmBotLogPrefix
  // в init-скрипте до этого файла.
  const LOG_PREFIX =
    typeof window.__pmBotLogPrefix === "string" && window.__pmBotLogPrefix
      ? window.__pmBotLogPrefix
      : "PM_BOT_";

  function log(line) {
    console.log(line);
  }

  // Все повторяющиеся таймеры под учётом: на остановке записи их надо
  // погасить, иначе вотчдог и опрос имён спикеров крутятся до закрытия
  // браузера и пишут в журнал уже после конца встречи.
  const intervals = [];

  function trackInterval(id) {
    intervals.push(id);
    return id;
  }

  function stopIntervals() {
    while (intervals.length > 0) {
      clearInterval(intervals.pop());
    }
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
    pendingPush: Promise.resolve(),
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
      // Куски идут строго по очереди: dataavailable может прийти дважды
      // подряд (requestData + stop), а blobToBase64 асинхронный. Без цепочки
      // порядок записи в файл не гарантирован, и ожидание в __pmStopCapture
      // дожидалось бы только последнего куска.
      const blob = event.data;
      mixer.pendingPush = mixer.pendingPush.then(() => pushBlob(blob));
    });
    mixer.recorder.start(1000);
    mixer.recordingStartedAt = Date.now();
    startSilenceWatchdog();
    trackInterval(
      setInterval(() => {
        if (mixer.ctx && mixer.ctx.state === "suspended") {
          mixer.ctx.resume().catch(() => {});
        }
      }, 2000),
    );
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
    log(`${LOG_PREFIX}CAPTURE_SWITCH:${reason}`);
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

  // Фаза 3.2: RMS по общему миксу. Вотчдог взводится не при загрузке
  // страницы, а после входа в звонок (скрипт входа вызывает __pmCaptureJoined):
  // до входа бот честно сидит в тишине комнаты ожидания, и отсчёт 20 с
  // отключал бы захват вкладки на ровном месте. Переключаемся только если
  // запасной путь реально есть — живые RTC-дорожки в запасе.
  const RMS_SILENCE_THRESHOLD = 0.001;
  const RMS_SWITCH_AFTER_MS = 20000;
  const RMS_LOG_EVERY_MS = 30000;
  let silentSinceMs = null;
  let watchdogArmed = false;
  let lastRmsLogAt = 0;
  let lastRmsSilent = null;

  function liveRtcBacklog() {
    return pendingRtcTracks.filter((track) => track.readyState === "live").length;
  }

  function logRms(rms, silent) {
    const now = Date.now();
    // Пишем смену состояния тишина/звук сразу, иначе не чаще раза в 30 с:
    // раньше строка уходила каждые 2 с и забивала журнал воркера.
    if (silent !== lastRmsSilent || now - lastRmsLogAt >= RMS_LOG_EVERY_MS) {
      lastRmsSilent = silent;
      lastRmsLogAt = now;
      log(`${LOG_PREFIX}RMS:${rms.toFixed(5)}${silent ? " (тишина)" : ""}`);
    }
  }

  function startSilenceWatchdog() {
    if (!mixer.analyser) {
      return;
    }
    const buffer = new Uint8Array(mixer.analyser.fftSize);
    trackInterval(
      setInterval(() => {
        mixer.analyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const normalized = (buffer[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const silent = rms <= RMS_SILENCE_THRESHOLD;
        logRms(rms, silent);
        if (!silent) {
          silentSinceMs = null;
          return;
        }
        if (!watchdogArmed) {
          return;
        }
        if (silentSinceMs == null) {
          silentSinceMs = Date.now();
          return;
        }
        if (
          usingTabCapture &&
          Date.now() - silentSinceMs >= RMS_SWITCH_AFTER_MS &&
          liveRtcBacklog() > 0
        ) {
          fallBackToRtcHook(
            `тишина ${RMS_SWITCH_AFTER_MS}мс на захвате вкладки, в запасе дорожек: ${liveRtcBacklog()}`,
          );
          silentSinceMs = null;
        }
      }, 2000),
    );
  }

  // Скрипт входа зовёт это после успешного входа в звонок (в том числе после
  // комнаты ожидания): только с этого момента тишина означает проблему.
  window.__pmCaptureJoined = function pmCaptureJoined() {
    if (watchdogArmed) {
      return;
    }
    watchdogArmed = true;
    silentSinceMs = null;
    log(`${LOG_PREFIX}RMS_WATCHDOG:armed`);
  };

  async function startTabCapture() {
    const devices = navigator.mediaDevices;
    if (!devices || typeof devices.getDisplayMedia !== "function") {
      log(`${LOG_PREFIX}CAPTURE_PATH:rtc-hook (getDisplayMedia недоступен)`);
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
        log(`${LOG_PREFIX}CAPTURE_PATH:rtc-hook (у вкладки нет звуковой дорожки)`);
        return;
      }
      tabCaptureStream = stream;
      usingTabCapture = true;
      for (const track of audioTracks) {
        track.__pmHooked = true;
        connectSource(track);
      }
      log(`${LOG_PREFIX}CAPTURE_PATH:tab`);
    } catch (err) {
      log(`${LOG_PREFIX}CAPTURE_PATH:rtc-hook (${err && err.message ? err.message : err})`);
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
          // Фаза 4.0: сколько отдельных аудиодорожек шлёт клиент звонка:
          // от этого зависит, будет ли бонус "дорожка на человека" (фаза 4, бонус).
          for (const receiver of pc.getReceivers()) {
            if (receiver.track && receiver.track.kind === "audio" && !seenAudioReceivers.has(receiver)) {
              seenAudioReceivers.add(receiver);
              rtcTrackCount += 1;
              log(`${LOG_PREFIX}RTC_TRACKS:${rtcTrackCount}`);
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

  // Фаза 4.1/4.2: таймлайн активного спикера. Общая часть опрашивает DOM за
  // подсвеченной плиткой говорящего. Платформа с объектом клиента на странице
  // подписывается на его события своим init-скриптом и зовёт
  // window.__pmRecordSpeaker(имя). Селекторы DOM не проверены на живом звонке:
  // при расхождении смотреть фактический DOM и поправить ACTIVE_SPEAKER_SELECTORS.
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

  window.__pmRecordSpeaker = recordSpeaker;

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

  log(`${LOG_PREFIX}ACTIVE_SPEAKER_SOURCE:dom-poll`);
  trackInterval(setInterval(pollDomForActiveSpeaker, 1000));

  window.__pmGetSpeakerTimeline = function pmGetSpeakerTimeline() {
    return JSON.stringify(speakerTimeline);
  };

  // Фаза 3.1: пробуем захват вкладки сразу при установке скрипта — на
  // странице звонка скрипт входа задаёт --auto-select-tab-capture-source-by-title,
  // поэтому headless Chromium выбирает вкладку без диалога.
  void startTabCapture();

  // Фаза 3.3: requestData() принудительно сбрасывает буфер, затем stop()
  // даёт финальный dataavailable и событие stop. Ждём именно завершения
  // заливки всех кусков, а не фиксированную паузу.
  // Но ждём с ограничением: если событие stop не придёт (recorder уже в
  // сбойном состоянии), бот не должен висеть: скрипт входа ждёт этот промис
  // без своего таймаута.
  const STOP_TIMEOUT_MS = 5000;

  window.__pmStopCapture = function pmStopCapture() {
    return new Promise((resolve) => {
      stopIntervals();
      const rec = mixer.recorder;
      let settled = false;
      const finish = (reason) => {
        if (settled) {
          return;
        }
        settled = true;
        if (reason) {
          log(`${LOG_PREFIX}CAPTURE_STOP:${reason}`);
        }
        resolve();
      };
      if (!rec || rec.state === "inactive") {
        Promise.resolve(mixer.pendingPush).then(() => finish("recorder уже остановлен"));
        return;
      }
      const timer = setTimeout(() => finish(`таймаут ${STOP_TIMEOUT_MS}мс`), STOP_TIMEOUT_MS);
      rec.addEventListener(
        "stop",
        () => {
          Promise.resolve(mixer.pendingPush).then(() => {
            clearTimeout(timer);
            finish(null);
          });
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
        clearTimeout(timer);
        Promise.resolve(mixer.pendingPush).then(() => finish("stop() бросил исключение"));
      }
    });
  };
})();
