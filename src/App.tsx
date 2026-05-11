import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QRCode from "react-qr-code";
import { GripVertical, Scaling } from "lucide-react";
import "./App.css";

function App() {
  const [passThrough, setPassThrough] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unlistenMode = listen<boolean>("overlay-mode-changed", (event) => {
      setPassThrough(event.payload);
    });

    const unlistenQr = listen<string>("whatsapp-qr", (event) => {
      setQrCode(event.payload);
      setIsReady(false);
      setErrorMsg(null);
    });

    const unlistenReady = listen("whatsapp-ready", () => {
      setIsReady(true);
      setQrCode(null);
      setErrorMsg(null);
    });

    const unlistenError = listen<string>("whatsapp-error", (event) => {
      setErrorMsg(event.payload);
    });

    return () => {
      unlistenMode.then((f) => f());
      unlistenQr.then((f) => f());
      unlistenReady.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  const toggleGhostMode = () => {
    invoke("set_ghost_mode", { enable: true });
  };

  return (
    <main className="h-screen w-screen flex items-center justify-center select-none overflow-hidden relative">
      <div className="bg-black/40 backdrop-blur-md border border-white/10 flex flex-col items-center justify-center transition-all duration-300 shadow-2xl relative w-screen h-screen rounded-none">
        
        {!passThrough && (
          <div 
            onMouseDown={() => getCurrentWindow().startDragging()}
            className="absolute top-4 left-4 cursor-grab active:cursor-grabbing p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <GripVertical size={20} className="text-white/50 hover:text-white pointer-events-none" />
          </div>
        )}

        <div className="flex flex-col items-center gap-4 w-full px-8">
          <h1 className="text-xl font-medium tracking-widest text-white/90 uppercase">
            Lucid
          </h1>
          
          {errorMsg ? (
            <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg mt-2 max-w-[250px] text-center">
              <p className="text-xs text-red-400 font-medium">{errorMsg}</p>
            </div>
          ) : isReady ? (
            <div className="flex flex-col items-center gap-2 mt-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full bg-emerald-400" />
                <p className="text-sm text-white/80 font-medium">WhatsApp Connected!</p>
              </div>
              <p className="text-xs text-white/40">Listening for messages...</p>
            </div>
          ) : qrCode ? (
            <div className="bg-white p-4 rounded-xl mt-2">
              <QRCode value={qrCode} size={256} />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/90 rounded-full animate-spin" />
              <p className="text-sm text-white/60">Waiting for WhatsApp...</p>
            </div>
          )}

          <button 
            onClick={toggleGhostMode}
            className={`mt-4 px-4 py-2 rounded-full border transition-all duration-300 flex items-center gap-2 ${passThrough ? "bg-yellow-500/10 border-yellow-500/20 cursor-default" : "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20 active:scale-95 cursor-pointer"}`}
          >
            <div className={`w-2 h-2 rounded-full ${passThrough ? "bg-yellow-400" : "bg-emerald-400"}`} />
            <span className="text-xs font-medium tracking-wider uppercase text-white/60">
              {passThrough ? "Ghost Mode Active (Alt+Shift+Z to Exit)" : "Click to Enter Ghost Mode"}
            </span>
          </button>
        </div>

        {!passThrough && (
          <div 
            onMouseDown={() => getCurrentWindow().startResizeDragging('SouthEast' as any)}
            className="absolute bottom-4 right-4 cursor-nwse-resize p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <Scaling size={20} className="text-white/50 hover:text-white pointer-events-none" />
          </div>
        )}

      </div>
    </main>
  );
}

export default App;
