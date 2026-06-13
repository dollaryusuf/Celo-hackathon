import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
import { createPublicClient, http, formatUnits, parseAbi, encodeFunctionData, parseUnits } from "viem";
import { celoAlfajores } from "viem/chains";

dotenv.config();

// Configure Viem client for Celo Alfajores testnet
const client = createPublicClient({
  chain: celoAlfajores,
  transport: http("https://alfajores-forno.celo-testnet.org", {
    timeout: 3000,
  }),
});

// ERC-20 ABI for balance checking and DEX interactions
const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)"
]);

if (!process.env.GEMINI_API_KEY) {
  console.error("CRITICAL: GEMINI_API_KEY is missing from .env file!");
}

// Initialize the @google/genai client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ─── Types ────────────────────────────────────────────────────────────────────

// Shape sent from the frontend chatLog
interface FrontendChatMessage {
  role: "user" | "aegis";
  text: string;
}

// Shape the Google GenAI SDK expects in the history array
interface GeminiHistoryMessage {
  role: "user" | "model";
  parts: [{ text: string }];
}

// Tool Definitions
const checkWalletBalanceTool = {
  name: "check_wallet_balance",
  description: "Check the user's wallet balance on Celo for USDm and local stablecoins",
  parameters: {
    type: Type.OBJECT,
    properties: {
      userAddress: {
        type: Type.STRING,
        description: "The address of the user's wallet",
      },
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
      targetFiat: {
        type: Type.STRING,
        description: "The target fiat currency (e.g. EUR, BRL)",
      },
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
      targetStablecoin: {
        type: Type.STRING,
        description: "The target stablecoin to buy (e.g. EURm)",
      },
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
      merchantAddress: {
        type: Type.STRING,
        description: "The address of the merchant to receive the payment",
      },
      amountTargetToken: {
        type: Type.STRING,
        description: "The exact amount of the target token (e.g. 5) the merchant should receive",
      },
      maxAmountSourceToken: {
        type: Type.STRING,
        description: "The maximum amount of the source token (e.g. 5.5) to spend for the swap",
      },
    },
    required: ["merchantAddress", "amountTargetToken", "maxAmountSourceToken"],
  },
};

const app = express();

app.use(express.json());

// Strips markdown asterisks (bold/italic) and cleans up excess whitespace
function stripAsterisks(text: string): string {
  return text
    .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1") // remove *text*, **text**, ***text***
    .replace(/\*+/g, "")                     // remove any stray asterisks
    .trim();
}

/**
 * Maps the frontend's chatLog array (role: "user" | "aegis") into the format
 * the Google GenAI SDK requires for the history property:
 *   role: "user" | "model"
 *   parts: [{ text: string }]
 *
 * "aegis" → "model" so Gemini recognises prior assistant turns correctly.
 */
function mapChatHistoryToGeminiFormat(
  chatHistory: FrontendChatMessage[]
): GeminiHistoryMessage[] {
  return chatHistory.map((msg) => ({
    role: msg.role === "aegis" ? "model" : "user",
    parts: [{ text: msg.text }],
  }));
}

// API POST endpoint for chat
app.post("/api/chat", async (req, res) => {
  try {
    const {
      userPrompt,
      userAddress,
      chatHistory = [], // frontend chatLog snapshot before the new user message
    } = req.body as {
      userPrompt: string;
      userAddress?: string;
      chatHistory: FrontendChatMessage[];
    };

    if (!userPrompt) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    console.log(`\n--- New Chat Turn ---`);
    console.log(`User Address: ${userAddress || "Not provided"}`);
    console.log(`History turns received: ${chatHistory.length}`);
    console.log(`User Prompt: ${userPrompt}`);

    // Map frontend chatHistory into the shape Gemini expects
    const geminiHistory: GeminiHistoryMessage[] = mapChatHistoryToGeminiFormat(chatHistory);

    const chat = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: `You are Aegis, an AI payment agent on the Celo network.

STRICT RULES — you must follow these exactly, without exception:

1. NEVER invent, estimate, or assume any number. Every balance, rate, or quote you mention must come directly from a tool call result in this conversation. If you do not have a tool result for a value, say "I don't have that data yet" and call the appropriate tool.

2. NEVER respond with made-up exchange rates, balances, or transaction details. If a tool has not been called yet, call it before saying anything numeric.

3. Before authorizing any payment in a local currency, you MUST call BOTH get_macro_fx_rate AND get_dex_quote. Do not skip either. Do not state a rate before both tools return results.

4. After you receive tool results, report ONLY the exact values returned. Do not round, adjust, or embellish them.

5. If a user confirms a transaction (e.g., "yes, proceed"), check the chat history for the token amounts and merchant address, then immediately call execute_jit_payment with those values. After that tool returns, tell the user: "Transaction payload generated and ready for the bundler." Do not fabricate payload data.

6. Do not use markdown formatting of any kind in your responses. No asterisks, no bullet symbols, no headers, no bold, no italics. Write in plain sentences only.

7. If you are unsure about any piece of data, call the relevant tool. Never guess.

Your job: help users swap USDm to local stablecoins (like EURm or cREAL) just before a purchase, using only real data from tools.`,
        tools: [{ functionDeclarations: [checkWalletBalanceTool, getMacroFxRateTool, getDexQuoteTool, executeJitPaymentTool] }],
      },
      // Pass the mapped history so the model has full conversation context
      history: geminiHistory,
    });

    // Contextual prompt if userAddress is known to the backend but not explicitly stated
    const promptToSend = userAddress ? `${userPrompt}\nMy address is ${userAddress}.` : userPrompt;

    let response;
    try {
      response = await chat.sendMessage({ message: promptToSend });
    } catch (err: any) {
      console.warn("[System] Gemini API Error on first attempt, retrying in 2 seconds...", err.message || String(err));
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        response = await chat.sendMessage({ message: promptToSend });
      } catch (retryErr: any) {
        console.error("[System] Gemini API Error on retry:", retryErr);
        throw retryErr;
      }
    }

    let payloadsGenerated: any[] = [];

    // Execution loop to handle function calls
    while (response.functionCalls && response.functionCalls.length > 0) {
      console.log(`\n[System] Model requested ${response.functionCalls.length} tool call(s)`);

      const toolResponses = [];

      for (const call of response.functionCalls) {
        console.log(`[System] Executing tool: ${call.name}`);
        let result: any;

        switch (call.name) {
          case "check_wallet_balance": {
            const args = call.args as { userAddress: string };
            let addressStr = args?.userAddress || userAddress;

            if (!addressStr || !addressStr.startsWith("0x") || addressStr.length !== 42) {
              addressStr = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
            }
            const address = addressStr as `0x${string}`;

            const usdmAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const eurmAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";

            console.log(`[System] Fetching real balances from Alfajores for ${address}...`);

            let realResult = "";
            try {
              const [usdmBalance, usdmDecimals, eurmBalance, eurmDecimals] = await Promise.all([
                // @ts-ignore
                client.readContract({ address: usdmAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
                // @ts-ignore
                client.readContract({ address: usdmAddress, abi: erc20Abi, functionName: "decimals" }),
                // @ts-ignore
                client.readContract({ address: eurmAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
                // @ts-ignore
                client.readContract({ address: eurmAddress, abi: erc20Abi, functionName: "decimals" })
              ]);

              const formattedUsdm = formatUnits(usdmBalance, usdmDecimals);
              const formattedEurm = formatUnits(eurmBalance, eurmDecimals);

              realResult = `${formattedUsdm} USDm, ${formattedEurm} EURm`;
            } catch (error: any) {
              console.warn("[System] Error reading from blockchain. Falling back to mock data.", error.shortMessage || error.message);
              realResult = "Error reading blockchain balances. Fallback: 150 USDm, 5 EURm";
            }

            console.log(`[System] Blockchain query returned: ${realResult}`);
            result = { balance: realResult };
            break;
          }

          case "get_macro_fx_rate": {
            const target = (call.args.targetFiat as string) || "EUR";
            console.log(`[System] Fetching macro FX rate for USD to ${target}...`);
            const rate = target.toUpperCase() === "EUR" ? 0.92 : 1.0;
            console.log(`[System] Mock FX API returned: 1 USD = ${rate} ${target}`);
            result = { rate, source: "CoinGecko (Mock)" };
            break;
          }

          case "get_dex_quote": {
            const target = (call.args.targetStablecoin as string) || "EURm";
            console.log(`[System] Fetching DEX swap quote for USDm to ${target}...`);
            const dexRate = target.toLowerCase() === "eurm" ? 0.915 : 1.0;
            console.log(`[System] Mock DEX returned: 1 USDm = ${dexRate} ${target}`);
            result = { dexRate, slippage: "0.1%", protocol: "Mock DEX" };
            break;
          }

          case "execute_jit_payment": {
            const args = call.args as any;
            const merchantAddress = args.merchantAddress || "0x1111222233334444555566667777888899990000";
            const amountTargetStr = args.amountTargetToken || "5";
            const maxSourceStr = args.maxAmountSourceToken || "5.5";

            console.log(`[System] Generating JIT payment payloads for merchant: ${merchantAddress}`);

            const usdmAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const eurmAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";
            const dexRouterAddress = "0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121";

            try {
              const amountOut = parseUnits(amountTargetStr, 18);
              const amountInMax = parseUnits(maxSourceStr, 18);
              const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

              // @ts-ignore
              const approveData = encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [dexRouterAddress, amountInMax],
              });

              // @ts-ignore
              const swapData = encodeFunctionData({
                abi: erc20Abi,
                functionName: "swapTokensForExactTokens",
                args: [amountOut, amountInMax, [usdmAddress, eurmAddress], merchantAddress as `0x${string}`, deadline],
              });

              console.log(`[System] Generated payloads successfully`);

              result = {
                approvePayload: approveData,
                swapPayload: swapData,
                target: dexRouterAddress,
                status: "ready_for_bundler"
              };

              payloadsGenerated.push(result);
            } catch (err) {
              console.error("[System] Payload generation error:", err);
              result = { error: "Failed to generate payload. Ensure valid address and amount formatting." };
            }
            break;
          }

          default:
            console.log(`[System] Unknown capability called: ${call.name}`);
            result = { error: "Unknown capability" };
            break;
        }

        toolResponses.push({
          functionResponse: {
            name: call.name,
            response: result,
          },
        });
      }

      // Pass the tool responses back to the model
      try {
        response = await chat.sendMessage({ message: toolResponses });
      } catch (err: any) {
        console.warn("[System] Gemini API Error during tool response on first attempt, retrying in 2 seconds...", err.message || String(err));
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          response = await chat.sendMessage({ message: toolResponses });
        } catch (retryErr: any) {
          console.error("[System] Gemini API Error during tool response retry:", retryErr);
          throw retryErr;
        }
      }
    }

    console.log(`[System] Final response sending back to client.`);

    let finalText = response?.text || "";
    if (finalText) {
      // Normalize token names, then strip asterisks and markdown artifacts
      finalText = finalText
        .replace(/cUSD/gi, "USDm")
        .replace(/cEUR/gi, "EURm");
      finalText = stripAsterisks(finalText);
    }

    return res.json({
      text: finalText,
      payloads: payloadsGenerated,
    });

  } catch (error: any) {
    console.error("[Server] Error in /api/chat:", error);
    return res.status(500).json({
      text: "An error occurred processing your request. Please try again.",
      payloads: [],
    });
  }
});

export default app;