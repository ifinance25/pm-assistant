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

  const OriginalPC = window.RTCPeerConnection;
  const hooked = new WeakSet();
  const mixer = { ctx: null, dest: null, recorder: null, sources: [] };

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
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    try {
      mixer.recorder = new MediaRecorder(mixer.dest.stream, { mimeType: mime });
    } catch {
      mixer.recorder = new MediaRecorder(mixer.dest.stream);
    }
    mixer.recorder.addEventListener("dataavailable", (event) => {
      void pushBlob(event.data);
    });
    mixer.recorder.start(1000);
    setInterval(() => {
      if (mixer.ctx && mixer.ctx.state === "suspended") {
        mixer.ctx.resume().catch(() => {});
      }
    }, 2000);
    return mixer;
  }

  function addTrack(track) {
    if (!track || track.kind !== "audio" || track.__pmHooked) {
      return;
    }
    track.__pmHooked = true;
    const mix = ensureMixer();
    if (!mix.ctx || !mix.dest) {
      return;
    }
    try {
      const stream = new MediaStream([track]);
      const src = mix.ctx.createMediaStreamSource(stream);
      src.connect(mix.dest);
      mixer.sources.push(src);
    } catch {
      // дорожка уже занята другим графом
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
          for (const receiver of pc.getReceivers()) {
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

  window.__pmStopCapture = function pmStopCapture() {
    return new Promise((resolve) => {
      const rec = mixer.recorder;
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      rec.addEventListener("stop", () => resolve(), { once: true });
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
  };
})();
