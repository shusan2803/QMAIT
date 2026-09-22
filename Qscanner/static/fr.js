(async function initCameraScanner() {
  // 1. Inject UI Styles directly via JS
  const style = document.createElement("style");
  //Frontend work can be adjustable to liking--
  style.textContent = `
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #f4f4f4; margin: 0; }
    #video-wrapper { position: relative; width: 100%; max-width: 480px; aspect-ratio: 4/3; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    #camera-feed { width: 100%; height: 100%; object-fit: cover; }
    #scanner-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 220px; height: 220px; border: 2px dashed rgba(255, 255, 255, 0.85); border-radius: 8px; pointer-events: none; }
    #status-card { margin-top: 16px; padding: 12px 18px; border-radius: 8px; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.08); font-size: 15px; font-weight: 500; text-align: center; }
    #engine-badge { font-size: 12px; color: #666; margin-top: 6px; }
  `;
  document.head.appendChild(style);

  // 2. Build DOM elements
  const container = document.createElement("div");
  container.id = "video-wrapper";

  const video = document.createElement("video");
  video.id = "camera-feed";
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");

  const overlay = document.createElement("div");
  overlay.id = "scanner-overlay";

  const statusCard = document.createElement("div");
  statusCard.id = "status-card";
  statusCard.textContent = "Initializing scanner...";

  const engineBadge = document.createElement("div");
  engineBadge.id = "engine-badge";

  container.append(video, overlay);
  document.body.append(container, statusCard, engineBadge);

  // Hidden offscreen canvas used by the jsQR fallback
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let isScanningLocked = false;
  let useNativeDetector = "BarcodeDetector" in window;
  let nativeDetector = null;

  // 3. Resolve scanning engine: Native BarcodeDetector vs jsQR CDN
  if (useNativeDetector) {
    try {
      nativeDetector = new BarcodeDetector({ formats: ["qr_code"] });
      engineBadge.textContent = "Engine: Native BarcodeDetector (Hardware Accelerated)";
    } catch {
      useNativeDetector = false;
    }
  }

  if (!useNativeDetector) {
    engineBadge.textContent = "Engine: Loading jsQR fallback...";
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      script.onload = () => {
        engineBadge.textContent = "Engine: jsQR (Canvas Software Fallback)";
        resolve();
      };
      script.onerror = () => {
        statusCard.textContent = "Failed to load QR scanner library.";
        reject(new Error("jsQR failed to load"));
      };
      document.head.appendChild(script);
    });
  }

  // 4. Send detected QR data to the Python CSV endpoint
  async function logToServer(decodedData) {
    statusCard.textContent = `Saving: ${decodedData}...`;
    try {
      const res = await fetch("/api/save-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr_data: decodedData, source: useNativeDetector ? "native_api" : "jsqr_fallback" })
      });
      const data = await res.json();
      if (res.ok) {
        statusCard.textContent = `Logged: ${decodedData}`;
      } else {
        statusCard.textContent = `Error: ${data.message}`;
      }
    } catch {
      statusCard.textContent = "Network error: Failed to reach server.";
    } finally {
      // 3-second cooldown to avoid logging duplicate reads in quick succession
      setTimeout(() => { isScanningLocked = false; }, 3000);
    }
  }

  // 5. Start camera stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    video.srcObject = stream;
    statusCard.textContent = "Point camera at a QR code...";
    requestAnimationFrame(scanLoop);
  } catch (err) {
    statusCard.textContent = `Camera Error: ${err.message}`;
  }

  // 6. Unified scanning loop
  async function scanLoop() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && !isScanningLocked) {
      if (useNativeDetector && nativeDetector) {
        // Fast path: Hardware accelerated
        try {
          const barcodes = await nativeDetector.detect(video);
          if (barcodes.length > 0) {
            isScanningLocked = true;
            logToServer(barcodes[0].rawValue);
          }
        } catch (e) {
          console.warn("Native detection error:", e);
        }
      } else if (window.jsQR) {
        // Fallback path: Capture frame to canvas and run jsQR
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert"
        });

        if (code && code.data) {
          isScanningLocked = true;
          logToServer(code.data);
        }
      }
    }
    requestAnimationFrame(scanLoop);
  }
})();