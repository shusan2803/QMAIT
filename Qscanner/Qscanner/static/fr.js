(async function initBarcodeAndQRscanner() {
// 1. Inject UI Styles (wider viewfinder for 1D barcodes)
  const style = document.createElement("style");
  style.textContent = `
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #f4f4f4; margin: 0; }
    #video-wrapper { position: relative; width: 100%; max-width: 500px; aspect-ratio: 4/3; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    #camera-feed { width: 100%; height: 100%; object-fit: cover; }
    #scanner-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 280px; height: 180px; border: 2px dashed rgba(255, 255, 255, 0.85); border-radius: 8px; pointer-events: none; }
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

  let isScanningLocked = false;
  let useNativeDetector = "BarcodeDetector" in window;
  let nativeDetector = null;
  let zxingReader = null;

  // Formats for both QR Codes and standard retail/industrial 1D barcodes
  const barcodeFormats = [
    "qr_code",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "code_39",
    "itf"
  ];

  // 3. Resolve scanning engine: Native BarcodeDetector vs ZXing fallback
  if (useNativeDetector) {
    try {
      nativeDetector = new BarcodeDetector({ formats: barcodeFormats });
      engineBadge.textContent = "Engine: Native BarcodeDetector (Hardware Accelerated)";
    } catch {
      useNativeDetector = false;
    }
  }

  if (!useNativeDetector) {
    engineBadge.textContent = "Engine: Loading ZXing multi-format library...";
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@zxing/library@latest";
      script.onload = () => {
        zxingReader = new ZXing.BrowserMultiFormatReader();
        engineBadge.textContent = "Engine: ZXing (Multi-Format Software Fallback)";
        resolve();
      };
      script.onerror = () => {
        statusCard.textContent = "Failed to load scanner library.";
        reject(new Error("ZXing failed to load"));
      };
      document.head.appendChild(script);
    });
  }

  // Check for HTTPS/Secure context before attempting to access the camera
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusCard.textContent = "Camera blocked: Web browsers require an HTTPS (secure) connection to access the camera.";
    statusCard.style.color = "#d9534f";
    return;
  }

  // 4. Send detected code data to Flask
  async function logToServer(decodedData, formatType) {
    statusCard.textContent = `Saving [${formatType}]: ${decodedData}...`;
    try {
      const res = await fetch("/api/save-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code_data: decodedData,
          format: formatType,
          source: useNativeDetector ? "native_api" : "zxing_fallback"
        })
      });
      const data = await res.json();
      if (res.ok) {
        statusCard.textContent = `Saved [${formatType}]: ${decodedData}`;
      } else {
        statusCard.textContent = `Error: ${data.message}`;
      }
    } catch (err) {
      statusCard.textContent = "Network error: Failed to reach server.";
    } finally {
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
    statusCard.textContent = "Point camera at a Barcode or QR Code...";
    // ... continue scanning
    
    if (useNativeDetector) {
      requestAnimationFrame(scanNativeLoop);
    } else if (zxingReader) {
      // ZXing handles decoding directly from the HTML5 video element
      zxingReader.decodeFromVideoElement(video, (result, error) => {
        if (result && !isScanningLocked) {
          isScanningLocked = true;
          const formatName = ZXing.BarcodeFormat[result.getBarcodeFormat()] || "barcode";
          logToServer(result.getText(), formatName.toLowerCase());
        }
      });
    }
  } catch (err) {
    statusCard.textContent = `Camera Error: ${err.message}`;
  }

  // Loop for the native browser detector
  async function scanNativeLoop() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && !isScanningLocked) {
      try {
        const barcodes = await nativeDetector.detect(video);
        if (barcodes.length > 0) {
          isScanningLocked = true;
          logToServer(barcodes[0].rawValue, barcodes[0].format);
        }
      } catch (e) {
        console.warn("Detection error:", e);
      }
    }
    requestAnimationFrame(scanNativeLoop);
  }
})();
