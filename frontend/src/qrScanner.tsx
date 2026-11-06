import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useNavigate } from 'react-router-dom';

export default function QRScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let reader: BrowserMultiFormatReader | null = null;

    const start = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setError('Caméra non supportée par ce navigateur.');
          return;
        }

        reader = new BrowserMultiFormatReader();
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();

        if (!devices.length) {
          setError('Aucune caméra détectée.');
          return;
        }

        const result = await reader.decodeOnceFromVideoDevice(
          devices[0].deviceId,
          videoRef.current ?? undefined,
        );

        if (cancelled) return;
        setScanResult(result.getText());

        const scannedValue = result.getText().trim();
        if (scannedValue) {
          let token = scannedValue;
          try {
            const scannedUrl = new URL(scannedValue);
            const menuPath = scannedUrl.pathname.split('/').filter(Boolean);
            const menuIndex = menuPath.indexOf('menu');
            if (menuIndex >= 0 && menuPath[menuIndex + 1]) {
              token = menuPath[menuIndex + 1];
            }
            navigate(`/restaurant/menu/${token}${scannedUrl.search}`);
            return;
          } catch {
            // The QR may contain the raw table token instead of a URL.
          }
          navigate(`/restaurant/menu/${token}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Impossible de démarrer le scan QR.');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      // Cleanup: stop the video stream if it exists
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-600">QR Code</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Scanner la table</h1>
        <p className="mt-2 text-sm text-slate-500">Positionnez le QR code devant la caméra pour ouvrir le menu.</p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <video ref={videoRef} className="h-72 w-full object-cover" playsInline muted autoPlay />
        </div>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        {scanResult && <p className="mt-4 text-sm font-medium text-emerald-700">QR scanné : {scanResult}</p>}

      </div>
    </main>
  );
}
