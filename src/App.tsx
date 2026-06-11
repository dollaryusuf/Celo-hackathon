/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { Send, Zap } from "lucide-react";

const USER_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

type Message = {
  role: "user" | "aegis";
  text: string;
};

// Abstract sleek shield / geometric 'A' logo
const AegisLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 2L4 7.5V14.5C4 21.5 9 28.5 16 31C23 28.5 28 21.5 28 14.5V7.5L16 2Z" fill="url(#paint0_linear)" />
    <path d="M16 8L10 18H22L16 8Z" fill="#E8F4EC" />
    <path d="M16 8L10 18H16V8Z" fill="#00D3A1" />
    <defs>
      <linearGradient id="paint0_linear" x1="4" y1="2" x2="28" y2="31" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00E676" />
        <stop offset="1" stopColor="#00E5FF" />
      </linearGradient>
    </defs>
  </svg>
);

const TypewriterText = ({ text, speed = 15 }: { text: string; speed?: number }) => {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    let index = 0;
    setDisplayedText("");
    const timer = setInterval(() => {
      if (index < text.length) {
        index++;
        setDisplayedText(text.slice(0, index));
      } else {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <>{displayedText}</>;
};

export default function App() {
  const [currentView, setCurrentView] = useState<"landing" | "connecting" | "chat">("landing");
  const [prompt, setPrompt] = useState("");
  const [chatLog, setChatLog] = useState<Message[]>([
    { role: "aegis", text: "Hello! I am Aegis, your shield against inflation. How can I protect your assets today?" }
  ]);
  const [loading, setLoading] = useState(false);
  const [pendingPayloads, setPendingPayloads] = useState<any[] | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentView === "connecting") {
      const timer = setTimeout(() => setCurrentView("chat"), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentView]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatLog, loading]);

  const sendMessage = async () => {
    if (!prompt.trim()) return;

    const userMessage = { role: "user" as const, text: prompt };
    setChatLog((prev) => [...prev, userMessage]);
    setPrompt("");
    setLoading(true);
    setPendingPayloads(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt: userMessage.text, userAddress: USER_ADDRESS }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response from Aegis");
      }

      const data = await response.json();
      
      setChatLog((prev) => [...prev, { role: "aegis", text: data.text }]);
      
      if (data.payloads && data.payloads.length > 0) {
        setPendingPayloads(data.payloads);
      }
    } catch (error) {
      console.error(error);
      setChatLog((prev) => [...prev, { role: "aegis", text: "Error: Could not reach the Aegis network." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  const executeTransaction = () => {
    alert("Account Abstraction Bundler taking over! Executing gasless payloads on Celo...");
    setPendingPayloads(null);
    setChatLog((prev) => [...prev, { role: "aegis", text: "Transaction successfully submitted to the Celo network via the Bundler! Your purchase is secured." }]);
  };

  return (
    <div className="min-h-screen w-full bg-[#1A1C20] flex items-center justify-center font-sans tracking-wide">
      {/* Mobile App Container */}
      <div className="w-full max-w-[450px] h-[100dvh] sm:h-[85vh] sm:rounded-[40px] bg-[#0A0B0E] relative shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col border border-white/5">
        
        {currentView === "landing" && (
          <div className="flex-1 flex flex-col items-center justify-between p-8 relative h-full overflow-y-auto pb-12">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/40 via-[#0A0B0E] to-[#0A0B0E] opacity-50 pointer-events-none"></div>
            
            <div className="flex flex-col items-center mt-12 relative z-10 w-full space-y-4 flex-shrink-0">
              <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_60px_rgba(16,185,129,0.3)] mb-4">
                <div className="scale-[1.5]">
                  <AegisLogo />
                </div>
              </div>
              <h1 className="text-5xl font-bold bg-gradient-to-br from-white via-white to-white/50 bg-clip-text text-transparent tracking-tight">Aegis.</h1>
              <p className="text-emerald-400 font-medium tracking-wide text-sm">Your Autonomous Web3 Treasury</p>
            </div>

            <div className="w-full space-y-3 relative z-10 mb-auto mt-12 flex-shrink-0">
              <div className="bg-[#181A20]/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                <div className="text-xl bg-white/5 w-10 h-10 rounded-full flex items-center justify-center">🛡️</div>
                <div>
                  <h3 className="text-white font-medium text-sm">Inflation Shield</h3>
                  <p className="text-white/40 text-xs mt-0.5">Auto-swap volatile local currency</p>
                </div>
              </div>
              <div className="bg-[#181A20]/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                <div className="text-xl bg-white/5 w-10 h-10 rounded-full flex items-center justify-center">⚡</div>
                <div>
                  <h3 className="text-white font-medium text-sm">Just-In-Time Routing</h3>
                  <p className="text-white/40 text-xs mt-0.5">Best DEX rates guaranteed</p>
                </div>
              </div>
              <div className="bg-[#181A20]/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                <div className="text-xl bg-white/5 w-10 h-10 rounded-full flex items-center justify-center">🔋</div>
                <div>
                  <h3 className="text-white font-medium text-sm">Gasless Execution</h3>
                  <p className="text-white/40 text-xs mt-0.5">Built for Opera MiniPay</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setCurrentView("connecting")}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-[15px] py-4 rounded-3xl shadow-[0_8px_32px_rgba(0,230,118,0.3)] hover:shadow-[0_8px_40px_rgba(0,230,118,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 relative overflow-hidden z-20 animate-pulse mt-8 flex-shrink-0 cursor-pointer"
            >
              <div className="absolute inset-0 bg-white/20 mix-blend-overlay pointer-events-none"></div>
              <span className="relative z-10 pointer-events-none">Connect MiniPay Wallet</span>
            </button>
          </div>
        )}

        {currentView === "connecting" && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative h-full space-y-8">
             <div className="relative">
               <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse"></div>
               <div className="w-20 h-20 bg-[#181A20] rounded-full border border-emerald-500/30 flex items-center justify-center relative z-10">
                 <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin"></div>
               </div>
             </div>
             <div className="text-center space-y-2">
               <h2 className="text-white text-lg font-bold tracking-wide">Connecting Wallet</h2>
               <p className="text-white/40 text-sm">Establishing secure link to MiniPay...</p>
             </div>
          </div>
        )}

        {currentView === "chat" && (
          <>
        {/* Header */}
        <header className="px-6 py-5 sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]">
              <AegisLogo />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent leading-none mb-1">Aegis</h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">MiniPay Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse drop-shadow-[0_0_5px_rgba(52,211,153,0.8)]"></div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Alfajores Live</span>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-5 space-y-6 scroll-smooth pb-32">
          {chatLog.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div 
                className={`p-4 rounded-[24px] max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap shadow-lg transition-all duration-300
                  ${msg.role === "user" 
                    ? "bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-medium rounded-br-none" 
                    : "bg-[#181A20]/80 backdrop-blur-md border border-white/5 text-zinc-300 rounded-tl-none font-normal shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
                }`}
              >
                {msg.role === "aegis" ? (
                  <TypewriterText text={msg.text} />
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#181A20]/80 backdrop-blur-md border border-white/5 text-white/50 p-4 rounded-[24px] rounded-tl-none flex items-center gap-2 shadow-lg">
                <div className="w-2 h-2 bg-cyan-400/80 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-cyan-400/80 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-cyan-400/80 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>

        {/* Bottom Area (Execute Button + Input) */}
        <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-[#0A0B0E] via-[#0A0B0E]/95 to-transparent pt-12 flex flex-col gap-4">
          
          {pendingPayloads && pendingPayloads.length > 0 && (
            <button 
              onClick={executeTransaction}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-[15px] py-4 rounded-3xl shadow-[0_8px_32px_rgba(0,230,118,0.3)] hover:shadow-[0_8px_40px_rgba(0,230,118,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse mix-blend-overlay"></div>
              <Zap className="w-5 h-5 fill-black/20" />
              Pay Gasless
            </button>
          )}

          <div className="relative flex items-center group">
            <input
              type="text"
              className="w-full bg-[#181A20] border border-white/10 rounded-full py-4 pl-5 pr-14 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 focus:bg-[#1C1F26] transition-all duration-300 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              placeholder="E.g., Swap for a 10 cEUR coffee"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button 
              onClick={sendMessage}
              disabled={!prompt.trim() || loading}
              className="absolute right-2 p-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-full disabled:opacity-50 disabled:hover:bg-emerald-500 transition-all duration-300 cursor-pointer disabled:cursor-not-allowed hover:scale-110 active:scale-95 shadow-lg shadow-emerald-500/20"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
          
          <div className="text-center w-full pb-1">
             <span className="text-[9px] text-white/20 uppercase tracking-[0.2em] font-medium">Secured by Gemini & Viem</span>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

