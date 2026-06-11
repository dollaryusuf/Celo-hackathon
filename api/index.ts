import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
import { createPublicClient, http, formatUnits, parseStr, parseAbi, encodeFunctionData, parseUnits } from "viem";
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

// Tool Definitions
const checkWalletBalanceTool = {
  name: "check_wallet_balance",
  description: "Check the user's wallet balance on Celo for cUSD and local stablecoins",
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
  description: "Get a simulated Celo DEX quote for swapping cUSD to the target stablecoin",
  parameters: {
    type: Type.OBJECT,
    properties: {
      targetStablecoin: {
        type: Type.STRING,
        description: "The target stablecoin to buy (e.g. cEUR)",
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

// API POST endpoint for chat
app.post("/api/chat", async (req, res) => {
  try {
    const { userPrompt, userAddress } = req.body;

    if (!userPrompt) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    console.log(`\n--- New Chat Session ---`);
    console.log(`User Address: ${userAddress || "Not provided"}`);
    console.log(`User Prompt: ${userPrompt}`);

    const chat = ai.chats.create({
      model: "gemini-3.1-flash-lite",
      config: {
        systemInstruction:
          "You are Aegis, an AI agent on the Celo network that protects users from inflation. You hold cUSD and perform Just-In-Time (JIT) swaps to local stablecoins like cEUR or cREAL right before a purchase. Before authorizing a payment in a local currency, you MUST call both get_macro_fx_rate and get_dex_quote. Calculate exactly how much cUSD is needed for the requested local currency amount, and inform the user if the rate is favorable before proceeding. When the user agrees to the payment, use the execute_jit_payment tool to prepare the transaction payloads. After receiving the payloads, tell the user: 'Transaction payload generated and ready for the bundler.' Suggest optimal swaps based on the balance to afford purchases.",
        tools: [{ functionDeclarations: [checkWalletBalanceTool, getMacroFxRateTool, getDexQuoteTool, executeJitPaymentTool] }],
      },
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
        return res.status(500).json({ error: retryErr.message || String(retryErr) });
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
              // Default mock if nothing valid is provided
              addressStr = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
            }
            const address = addressStr as `0x${string}`;

            const cUsdAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const cEurAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";

            console.log(`[System] Fetching real balances from Alfajores for ${address}...`);
            
            let realResult = "";
            try {
              const [cUsdBalance, cUsdDecimals, cEurBalance, cEurDecimals] = await Promise.all([
                // @ts-ignore
                client.readContract({
                  address: cUsdAddress,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [address]
                }),
                // @ts-ignore
                client.readContract({
                  address: cUsdAddress,
                  abi: erc20Abi,
                  functionName: "decimals"
                }),
                // @ts-ignore
                client.readContract({
                  address: cEurAddress,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [address]
                }),
                // @ts-ignore
                client.readContract({
                  address: cEurAddress,
                  abi: erc20Abi,
                  functionName: "decimals"
                })
              ]);

              const formattedCUsd = formatUnits(cUsdBalance, cUsdDecimals);
              const formattedCEur = formatUnits(cEurBalance, cEurDecimals);
              
              realResult = `${formattedCUsd} cUSD, ${formattedCEur} cEUR`;
            } catch (error: any) {
              console.warn("[System] Error reading from blockchain. Falling back to mock data.", error.shortMessage || error.message);
              realResult = "Error reading blockchain balances. Fallback to: 150 cUSD, 5 cEUR";
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
            const target = (call.args.targetStablecoin as string) || "cEUR";
            console.log(`[System] Fetching DEX swap quote for cUSD to ${target}...`);
            const dexRate = target.toLowerCase() === "ceur" ? 0.915 : 1.0;
            console.log(`[System] Mock DEX returned: 1 cUSD = ${dexRate} ${target}`);
            result = { dexRate, slippage: "0.1%", protocol: "Mock DEX" };
            break;
          }

          case "execute_jit_payment": {
            const args = call.args as any;
            const merchantAddress = args.merchantAddress || "0x1111222233334444555566667777888899990000";
            const amountTargetStr = args.amountTargetToken || "5";
            const maxSourceStr = args.maxAmountSourceToken || "5.5";
            
            console.log(`[System] Generating JIT payment payloads for merchant: ${merchantAddress}`);
            
            const cUsdAddress = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
            const cEurAddress = "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F";
            const dexRouterAddress = "0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121"; // Mock Router

            try {
              const amountOut = parseUnits(amountTargetStr, 18);
              const amountInMax = parseUnits(maxSourceStr, 18);
              const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 mins

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
                args: [amountOut, amountInMax, [cUsdAddress, cEurAddress], merchantAddress as `0x${string}`, deadline],
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
        response = await chat.sendMessage({
          message: toolResponses,
        });
      } catch (err: any) {
        console.warn("[System] Gemini API Error during tool response on first attempt, retrying in 2 seconds...", err.message || String(err));
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          response = await chat.sendMessage({
            message: toolResponses,
          });
        } catch (retryErr: any) {
          console.error("[System] Gemini API Error during tool response retry:", retryErr);
          return res.status(500).json({ error: retryErr.message || String(retryErr) });
        }
      }
    }

    console.log(`[System] Final response sending back to client.`);

    return res.json({
      text: response.text,
      payloads: payloadsGenerated,
    });

  } catch (error: any) {
    console.error("[Server] Error in /api/chat:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

export default app;
