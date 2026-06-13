import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";
import {
  createPublicClient,
  http,
  formatUnits,
  parseAbi,
  encodeFunctionData,
  parseUnits,
} from "viem";
import { celoAlfajores } from "viem/chains";

// ─── Viem client ─────────────────────────────────────────────────────────────

const client = createPublicClient({
  chain: celoAlfajores,
  transport: http("https://alfajores-forno.celo-testnet.org", { timeout: 10000 }),
});

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
]);

// ─── Gemini client ───────────────────────────────────────────────────────────

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

// ─── Types ────────────────────────────────────────────────────────────────────

interface FrontendChatMessage {
  role: "user" | "aegis";
  text: string;
}

interface GeminiHistoryMessage {
  role: "user" | "model";
  parts: [{ text: string }];
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const checkWalletBalanceTool = {
  name: "check_wallet_balance",
  description: "Check the user's wallet balance on Celo for USDm and local stablecoins",
  parameters: {
    type: Type.OBJECT,
    properties: {
      userAddress: { type: Type.STRING, description: "The address of the user's wallet" },
    },
    required: ["userAddress"],
  },
};

const getMacroFxRateTool = {
  name: "get_macro_fx_rate",
  description: "Check a Web2 API for the current fiat exchange rate between USD and the target currency",
  parameters: {
    type: Type.OBJECT,
    properties: {
      targetFiat: { type: Type.STRING, description: "The target fiat currency (e.g. EUR, BRL)" },
    },
    required: ["targetFiat"],
  },
};

const getDexQuoteTool = {
  name: "get_dex_quote",
  description: "Get a simulated Celo DEX quote for swapping USDm to the target stablecoin",
  parameters: {
    type: Type.OBJECT,
    properties: {
      targetStablecoin: { type: Type.STRING, description: "The target stablecoin to buy (e.g. EURm)" },
    },
    required: ["targetStablecoin"],
  },
};

const executeJitPaymentTool = {
  name: "execute_jit_payment",
  description: "Prepare transaction payloads for a Just-In-Time swap and payment via a Smart Contract Wallet",
  parameters: {
    type: Type.OBJECT,
    properties: {
      merchantAddress: { type: Type.STRING, description: "The address of the merchant to receive the payment" },
      amountTargetToken: { type: Type.STRING, description: "The exact amount of the target token the merchant should receive" },
      maxAmountSourceToken: { type: Type.STRING, description: "The maximum amount of source token to spend for the swap" },
    },
    required: ["merchantAddress", "amountTargetToken", "maxAmountSourceToken"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAsterisks(text: string): string {
  return text
    .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
    .replace(/\*+/g, "")
    .trim();
}

function mapChatHistoryToGeminiFormat(
  chatHistory: FrontendChatMessage[]
): GeminiHistoryMessage[] {
  return chatHistory.map((msg) => ({
    role: msg.role === "aegis" ? "model" : "user",
    parts: [{ text: msg.text }],
  }));
}

// ─── Vercel Serverless Handler ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS headers so the deployed frontend can reach this function
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const {
      userPrompt,
      userAddress,
      chatHistory = [],
    } = req.body as {
      userPrompt: string;
      userAddress?: string;
      chatHistory: FrontendChatMessage[];
    };

    if (!userPrompt) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        text: "Server error: GEMINI_API_KEY environment variable is not set. Add it in your Vercel project settings under Settings → Environment Variables.",
        payloads: [],
      });
    }

    console.log(`[Aegis] Turn — history: ${chatHistory.length} msgs | prompt: ${userPrompt}`);

    const geminiHistory: GeminiHistoryMessage[] = mapChatHistoryToGeminiFormat(chatHistory);

    const chat = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: `You are Aegis, an AI payment agent on the Celo network.

STRICT RULES — follow these exactly, without exception:

1. NEVER invent, estimate, or assume any number. Every balance, rate, or quote you mention must come directly from a tool call result in this conversation. If you do not have a tool result for a value, say "I don't have that data yet" and call the appropriate tool.

2. NEVER respond with made-up exchange rates, balances, or transaction details. If a tool has not been called yet, call it before saying anything numeric.

3. Before authorizing any payment in a local currency, you MUST call BOTH get_macro_fx_rate AND get_dex_quote. Do not skip either. Do not state a rate before both tools return results.

4. After you receive tool results, report ONLY the exact values returned. Do not round, adjust, or embellish them.

5. If a user confirms a transaction (e.g., "yes, proceed"), check the chat history for the token amounts and merchant address, then immediately call execute_jit_payment with those values. After that tool returns, tell the user: "Transaction payload generated and ready for the bundler." Do not fabricate payload data.

6. Do not use markdown formatting of any kind. No asterisks, no bullet symbols, no headers, no bold, no italics. Write in plain sentences only.

7. If you are unsure about any piece of data, call the relevant tool. Never guess.

Your job: help users swap USDm to local stablecoins (like EURm or cREAL) just before a purchase, using only real data from tools.`,
        tools: [{ functionDeclarations: [checkWalletBalanceTool, getMacroFxRateTool, getDexQuoteTool, executeJitPaymentTool] }],
      },
      history: geminiHistory,
    });

    const promptToSend = userAddress
      ? `${userPrompt}\nMy address is ${userAddress}.`
      : userPrompt;

    let response = await chat.sendMessage({ message: promptToSend });

    const payloadsGenerated: any[] = [];

    // ── Agentic tool-call loop ──────────────────────────────────────────────
    while (response.functionCalls && response.functionCalls.length > 0) {
      const toolResponses: any[] = [];

      for (const call of response.functionCalls) {
        console.log(`[Aegis] Tool call: ${call.name}`);
        let result: any;

        switch (call.name) {
          case "check_wallet_balance": {
            const args = call.args as { userAddress: string };
            let addressStr = args?.userAddress || userAddress || "";
            if (!addressStr.startsWith("0x") || addressStr.length !== 42) {
              addressStr = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
            }
            const address = addressStr as `0x${string}`;
            const usdmAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const eurmAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";
            try {
              const [usdmBalance, usdmDecimals, eurmBalance, eurmDecimals] = await Promise.all([
                // @ts-ignore
                client.readContract({ address: usdmAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
                // @ts-ignore
                client.readContract({ address: usdmAddress, abi: erc20Abi, functionName: "decimals" }),
                // @ts-ignore
                client.readContract({ address: eurmAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
                // @ts-ignore
                client.readContract({ address: eurmAddress, abi: erc20Abi, functionName: "decimals" }),
              ]);
              const balance = `${formatUnits(usdmBalance, usdmDecimals)} USDm, ${formatUnits(eurmBalance, eurmDecimals)} EURm`;
              result = { balance };
            } catch (err: any) {
              result = { balance: "Fallback: 150 USDm, 5 EURm" };
            }
            break;
          }

          case "get_macro_fx_rate": {
            const target = ((call.args.targetFiat as string) || "EUR").toUpperCase();
            const rate = target === "EUR" ? 0.92 : 1.0;
            result = { rate, source: "CoinGecko (Mock)" };
            break;
          }

          case "get_dex_quote": {
            const target = (call.args.targetStablecoin as string) || "EURm";
            const dexRate = target.toLowerCase() === "eurm" ? 0.915 : 1.0;
            result = { dexRate, slippage: "0.1%", protocol: "Mock DEX" };
            break;
          }

          case "execute_jit_payment": {
            const args = call.args as any;
            const merchantAddress = args.merchantAddress || "0x1111222233334444555566667777888899990000";
            const amountTargetStr = args.amountTargetToken || "5";
            const maxSourceStr = args.maxAmountSourceToken || "5.5";
            const usdmAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const eurmAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";
            const dexRouterAddress = "0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121";
            try {
              const amountOut = parseUnits(amountTargetStr, 18);
              const amountInMax = parseUnits(maxSourceStr, 18);
              const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
              // @ts-ignore
              const approvePayload = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dexRouterAddress, amountInMax] });
              // @ts-ignore
              const swapPayload = encodeFunctionData({ abi: erc20Abi, functionName: "swapTokensForExactTokens", args: [amountOut, amountInMax, [usdmAddress, eurmAddress], merchantAddress as `0x${string}`, deadline] });
              result = { approvePayload, swapPayload, target: dexRouterAddress, status: "ready_for_bundler" };
              payloadsGenerated.push(result);
            } catch (err) {
              result = { error: "Failed to generate payload." };
            }
            break;
          }

          default:
            result = { error: "Unknown tool" };
        }

        toolResponses.push({ functionResponse: { name: call.name, response: result } });
      }

      response = await chat.sendMessage({ message: toolResponses });
    }

    let finalText = (response?.text || "")
      .replace(/cUSD/gi, "USDm")
      .replace(/cEUR/gi, "EURm");
    finalText = stripAsterisks(finalText);

    return res.status(200).json({ text: finalText, payloads: payloadsGenerated });

  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[Aegis] handler error:", message);
    return res.status(500).json({ text: `Server error: ${message}`, payloads: [] });
  }
}