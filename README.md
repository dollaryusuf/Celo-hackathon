# 🛡️ Aegis: Autonomous Web3 Treasury for Celo

[![Celo Alfajores](https://img.shields.io/badge/Celo-Alfajores_Testnet-35D07F?style=for-the-badge&logo=celo)](https://celo.org/)
[![Gemini 1.5 Flash](https://img.shields.io/badge/AI-Gemini_1.5_Flash-4285F4?style=for-the-badge)](https://deepmind.google/technologies/gemini/)
[![Viem](https://img.shields.io/badge/Web3-Viem-1E1E20?style=for-the-badge)](https://viem.sh/)
[![React & Tailwind](https://img.shields.io/badge/Frontend-React_&_Tailwind-61DAFB?style=for-the-badge)](https://reactjs.org/)

**Aegis** is an autonomous AI agent built for the **Celo Onchain Agents Hackathon**. It acts as a mobile-first, smart treasury that protects users from inflation by handling complex multi-currency routing, live FX monitoring, and Just-In-Time (JIT) gasless payments.

> **Watch the Demo Video:** [Insert YouTube/Loom Link Here]
> 
> **Live Web App:** https://celo-hackathon-liart.vercel.app/

---

## 🌍 The Problem
In emerging markets, users hold stablecoins (like cUSD) to protect against local currency inflation. However, everyday commerce often requires local stablecoins (like cEUR or cREAL). 
For a normal user, manually checking Web2 FX rates, comparing them against Web3 DEX slippage, signing multiple `approve` and `swap` transactions, and paying gas fees is a massive UX hurdle.

## 💡 The Solution: Aegis
Aegis abstracts the entire Web3 backend into a simple, natural language chat interface designed perfectly for mobile wallets like **Opera MiniPay**.

Users simply tell Aegis what they want to buy. The agent autonomously:
1. **Reads onchain balances** using Viem.
2. **Checks macro-economic FX rates** to ensure purchasing power is protected.
3. **Quotes Celo DEXs** to find the most efficient routing.
4. **Generates Account Abstraction (ERC-4337) payloads** for a completely gasless, 1-click execution.

---

## ✨ Key Features

* **🧠 Autonomous Tool Chaining:** Powered by Google's `gemini-1.5-flash`, Aegis dynamically decides which blockchain tools to call based on user intent.
* **⚡ Just-In-Time (JIT) Swaps:** Aegis holds your core balance in cUSD and only swaps to local currencies at the exact microsecond of purchase.
* **⛽ Gasless Execution Architecture:** Instead of forcing the user to sign multiple transactions, Aegis encodes `approve` and `swapTokensForExactTokens` hex payloads, ready to be executed by a Smart Contract Wallet / Bundler.
* **📱 MiniPay-Ready UX:** A sleek, dark-mode, mobile-responsive UI built with React and Tailwind CSS, featuring glassmorphism elements and seamless state transitions.

---

## 🏗️ Technical Architecture

Aegis is a full-stack application bridging Web2 AI with Web3 execution.

1. **Frontend (Vite + React + Tailwind):** Manages the chat UI and user intent.
2. **Backend (Node.js + Express):** Handles the AI logic and blockchain reads securely.
3. **Agent Brain (Google GenAI SDK):** Uses Advanced Function Calling (`functionDeclarations`) to loop through custom TS tools.
4. **Onchain Engine (Viem):** Connects to the **Celo Alfajores Testnet** to read ERC-20 balances and encode smart contract payloads for Uniswap/Mento style routers.

### The Agent's Toolset
Aegis is equipped with the following custom-built functions:
* `check_wallet_balance`: Reads live `cUSD` and `cEUR` balances from Celo Alfajores.
* `get_macro_fx_rate`: Oracle for real-world fiat exchange rates.
* `get_dex_quote`: Simulates Celo AMM routing and slippage.
* `execute_jit_payment`: Generates encoded Hex Data for gasless relayer execution.

---

## 🚀 How to Run Locally

### Prerequisites
* Node.js (v18+)
* A Google Gemini API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/dollaryusuf/celo-hackathon
   cd celo-hackathon