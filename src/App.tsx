import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QRCode from "react-qr-code";
import { GripVertical, Scaling, MessageSquare, ArrowLeft, Send, X, Check, CheckCheck } from "lucide-react";
import "./App.css";

interface Chat {
  id: string;
  name: string;
  unreadCount: number;
  picUrl?: string;
}

interface Message {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  chatId?: string;
  type?: string;
  mediaData?: string;
  ack?: number;
}

function App() {
  const [passThrough, setPassThrough] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const activeChatRef = useRef<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [showGhostInput, setShowGhostInput] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (passThrough && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        setShowGhostInput(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [passThrough]);

  useEffect(() => {
    const unlistenMode = listen<boolean>("overlay-mode-changed", (event) => {
      setPassThrough(event.payload);
      setShowGhostInput(false);
    });

    const unlistenQr = listen<string>("whatsapp-qr", (event) => {
      setQrCode(event.payload);
      setIsReady(false);
      setErrorMsg(null);
    });

    const unlistenReady = listen<string>("whatsapp-ready", () => {
      setIsReady(true);
      setQrCode(null);
      setErrorMsg(null);
      invoke("send_to_sidecar", { payload: JSON.stringify({ action: "get_chats" }) });
    });

    const unlistenError = listen<string>("whatsapp-error", (event) => {
      setErrorMsg(event.payload);
    });

    const unlistenDisconnected = listen<string>("whatsapp-disconnected", () => {
      setIsReady(false);
      setQrCode(null);
      setErrorMsg(null);
      setChats([]);
      setActiveChat(null);
      setMessages([]);
      invoke("set_ghost_mode", { enable: false });
    });

    const unlistenChats = listen<Chat[]>("whatsapp-chats", (event) => {
      setChats(event.payload);
    });

    const unlistenMessages = listen<any>("whatsapp-messages", (event) => {
      if (activeChatRef.current && event.payload.chatId === activeChatRef.current.id) {
        setMessages(event.payload.data);
      }
    });

    const unlistenMessageSent = listen<Message>("whatsapp-message-sent", (event) => {
      setMessages((prev) => {
        if (prev.some(m => m.id === event.payload.id)) return prev;
        return [...prev, event.payload];
      });
      setShowGhostInput(false);
    });

    const unlistenIncomingMessage = listen<Message>("whatsapp-incoming-message", (event) => {
      const msg = event.payload;
      
      if (activeChatRef.current && msg.chatId === activeChatRef.current.id) {
        setMessages((prev) => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
      
      invoke("send_to_sidecar", { payload: JSON.stringify({ action: "get_chats" }) });
    });

    const unlistenMessageAck = listen<{ id: string, ack: number }>("whatsapp-message-ack", (event) => {
      const { id, ack } = event.payload;
      setMessages((prev) => prev.map(m => m.id === id ? { ...m, ack } : m));
    });

    return () => {
      unlistenMode.then((f) => f());
      unlistenQr.then((f) => f());
      unlistenReady.then((f) => f());
      unlistenError.then((f) => f());
      unlistenDisconnected.then((f) => f());
      unlistenChats.then((f) => f());
      unlistenMessages.then((f) => f());
      unlistenMessageSent.then((f) => f());
      unlistenIncomingMessage.then((f) => f());
      unlistenMessageAck.then((f) => f());
    };
  }, []);

  const toggleGhostMode = () => {
    invoke("set_ghost_mode", { enable: true });
  };

  const openChat = (chat: Chat) => {
    setActiveChat(chat);
    setMessages([]);
    invoke("send_to_sidecar", { payload: JSON.stringify({ action: "get_messages", chatId: chat.id }) });
  };

  const closeChat = () => {
    setActiveChat(null);
    setMessages([]);
    invoke("send_to_sidecar", { payload: JSON.stringify({ action: "get_chats" }) });
  };

  const sendMessage = () => {
    if (!inputText.trim() || !activeChat) return;
    invoke("send_to_sidecar", { 
      payload: JSON.stringify({ action: "send_message", chatId: activeChat.id, text: inputText.trim() }) 
    });
    setInputText("");
    setShowGhostInput(false);
  };

  return (
    <main className="h-screen w-screen flex items-center justify-center select-none overflow-hidden relative">
      <div className="bg-black/40 backdrop-blur-md border border-white/10 flex flex-col items-center justify-center transition-all duration-300 shadow-2xl relative w-screen h-screen rounded-none">
        
        {!passThrough && (
          <div 
            onMouseDown={() => getCurrentWindow().startDragging()}
            className="absolute top-4 left-4 cursor-grab active:cursor-grabbing p-1 rounded-md hover:bg-white/10 transition-colors z-50"
          >
            <GripVertical size={20} className="text-white/50 hover:text-white pointer-events-none" />
          </div>
        )}

        {!passThrough && (
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
            {isReady && (
              <button 
                onClick={toggleGhostMode}
                className="p-1 rounded-md hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                title="Enter Ghost Mode"
              >
                <MessageSquare size={20} />
              </button>
            )}
            <button 
              onClick={() => invoke("exit_app")}
              className="p-1 rounded-md hover:bg-red-500/20 transition-colors text-white/50 hover:text-red-400"
              title="Close App"
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className={`flex flex-col w-full h-full ${isReady ? 'p-4 pt-12 pb-12' : 'items-center justify-center px-8'}`}>
          {!isReady && (
            <h1 className="text-xl font-medium tracking-widest text-white/90 uppercase mb-4 mt-8">
              Lucid
            </h1>
          )}
          
          {errorMsg ? (
            <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg mt-2 max-w-[250px] text-center">
              <p className="text-xs text-red-400 font-medium">{errorMsg}</p>
            </div>
          ) : isReady ? (
            <div className="flex-1 w-full flex flex-col overflow-hidden text-white">
              {!activeChat ? (
                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 space-y-1 pr-2">
                  {chats.length === 0 ? (
                    <div className="text-white/40 text-xs text-center mt-10">Loading chats...</div>
                  ) : (
                    chats.map((chat) => (
                      <div 
                        key={chat.id}
                        onClick={() => openChat(chat)}
                        className="p-3 rounded-lg hover:bg-white/5 cursor-pointer transition flex items-center gap-3 border border-transparent hover:border-white/5"
                      >
                        {chat.picUrl ? (
                          <img src={chat.picUrl} alt="" className="w-10 h-10 rounded-full object-cover bg-white/5" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-sm font-semibold">
                            {chat.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="truncate text-sm font-medium text-white/90 block">{chat.name}</span>
                        </div>
                        {chat.unreadCount > 0 && (
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="flex flex-col h-full relative">
                  {!passThrough && (
                    <div className="flex items-center gap-3 pb-3 border-b border-white/10 mb-3">
                      <button onClick={closeChat} className="text-white/50 hover:text-white transition">
                        <ArrowLeft size={18} />
                      </button>
                      {activeChat.picUrl ? (
                        <img src={activeChat.picUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-xs font-semibold">
                          {activeChat.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-semibold text-sm truncate text-white/90">{activeChat.name}</span>
                    </div>
                  )}
                  
                  <div className={`flex-1 overflow-y-auto flex flex-col gap-2 scrollbar-thin scrollbar-thumb-white/10 pr-2 ${passThrough ? 'pb-2' : ''}`}>
                    {messages.map((msg, i) => (
                      <div key={msg.id || i} className={`max-w-[85%] px-3 py-2 text-sm rounded-xl border flex flex-col gap-1 ${msg.fromMe ? 'bg-emerald-500/10 border-emerald-500/20 text-white/90 self-end rounded-tr-sm' : 'bg-white/5 border-white/10 text-white/80 self-start rounded-tl-sm'}`}>
                        {msg.mediaData && (
                          <img src={msg.mediaData} alt="media" className="max-w-full rounded-lg object-contain pointer-events-auto" style={{ maxHeight: '200px' }} />
                        )}
                        {msg.body && <span>{msg.body}</span>}
                        {msg.type === 'sticker' && !msg.mediaData && <span className="italic text-white/40">[Sticker]</span>}
                        {msg.type === 'image' && !msg.mediaData && <span className="italic text-white/40">[Image]</span>}
                        
                        {msg.fromMe && (
                          <div className="self-end mt-0.5 flex items-center">
                            {(msg.ack === undefined || msg.ack === 0) && <span className="text-[10px] text-white/30 italic">Sending...</span>}
                            {msg.ack === 1 && <Check size={12} className="text-white/50" />}
                            {msg.ack === 2 && <CheckCheck size={12} className="text-white/50" />}
                            {(msg.ack !== undefined && msg.ack >= 3) && <CheckCheck size={12} className="text-blue-400" />}
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {(!passThrough || showGhostInput) && (
                    <div className="mt-3 flex gap-2 relative z-50 pointer-events-auto">
                      <input 
                        ref={inputRef}
                        type="text" 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') sendMessage();
                          if (e.key === 'Escape' && passThrough) setShowGhostInput(false);
                        }}
                        onBlur={() => passThrough && setShowGhostInput(false)}
                        placeholder="Type a message..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white/90 focus:outline-none focus:border-white/30 transition placeholder-white/30 backdrop-blur-lg"
                      />
                      <button 
                        onClick={sendMessage}
                        disabled={!inputText.trim()}
                        className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 w-10 h-10 rounded-lg flex items-center justify-center hover:bg-emerald-500/20 disabled:opacity-50 transition"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  )}
                </div>
              )}
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

          {!isReady && (
            <button 
              onClick={toggleGhostMode}
              className={`mt-4 px-4 py-2 rounded-full border transition-all duration-300 flex items-center gap-2 ${passThrough ? "bg-yellow-500/10 border-yellow-500/20 cursor-default" : "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20 active:scale-95 cursor-pointer"}`}
            >
              <div className={`w-2 h-2 rounded-full ${passThrough ? "bg-yellow-400" : "bg-emerald-400"}`} />
              <span className="text-xs font-medium tracking-wider uppercase text-white/60">
                {passThrough ? "Ghost Mode Active (Alt+Shift+Z to Exit)" : "Click to Enter Ghost Mode"}
              </span>
            </button>
          )}
        </div>

        {!passThrough && (
          <div 
            onMouseDown={() => getCurrentWindow().startResizeDragging('SouthEast' as any)}
            className="absolute bottom-4 right-4 cursor-nwse-resize p-1 rounded-md hover:bg-white/10 transition-colors z-50"
          >
            <Scaling size={20} className="text-white/50 hover:text-white pointer-events-none" />
          </div>
        )}

      </div>
    </main>
  );
}

export default App;
