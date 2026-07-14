import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini safely
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please set your Gemini API key in Settings > Secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// --- API Route 1: Customer Assistant Bot ---
app.post("/api/customer-bot", async (req, res) => {
  try {
    const { message, history = [], cart = [], restaurants = [], activeOrder = null, customAiInstruction = "" } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const ai = getGeminiClient();

    // Compile a lightweight list of menu items for quick reference by Gemini
    const menuSummary = restaurants.map((r: any) => ({
      restaurantId: r.id,
      restaurantName: r.name,
      category: r.category,
      items: r.menu.map((m: any) => ({
        id: m.id,
        name: m.name,
        price: m.price,
        description: m.description,
        isPopular: m.isPopular
      }))
    }));

    // Formulate a robust context-rich system instruction
    let systemInstruction = `You are "FoodWala Customer Assistant", a helpful, friendly, and smart AI food delivery assistant serving foodies in Hyderabad, Sindh, Pakistan.
Your primary language is Urdu (or clean Roman Urdu/English if preferred by the user, but you should naturally respond in warm Urdu or Roman Urdu with Urdu phrases to keep a local touch).

Core capabilities you have:
1. Help taking orders ("آرڈر لینے میں مدد"): Recommend dishes, explain what is in the cart, and offer to add items. If the user wants to add an item to the cart, recommend it, or buy it, you MUST return a structured action in the "actions" field.
2. Recommend food ("کھانے کی سفارش کرنا"): Suggest dishes based on the available restaurant menus. Highlight popular or vegetarian options.
3. Order Status ("آرڈر کا اسٹیٹس بتانا"): If the user asks about their active order, look at the active order context. Summarize its status and rider details.
4. Answer general questions ("سوالات کے جواب"): Answer questions about delivery fee, prep time, or promotions.
5. Register complaints ("شکایات رجسٹر کرنا"): If the user has a bad experience or wants to complain, register it. Suggest submitting it and trigger a "register_complaint" action in the actions.

Available Restaurants & Menus:
${JSON.stringify(menuSummary, null, 2)}

Current User Cart:
${JSON.stringify(cart, null, 2)}

Active Order Details (if any):
${activeOrder ? JSON.stringify(activeOrder, null, 2) : "No active order currently."}

Your response must be structured in JSON format matching this schema:
{
  "reply": "Your conversational response in Urdu (or Roman Urdu/English) as markdown",
  "actions": [
    {
      "type": "add_to_cart",
      "itemId": "item-id-here",
      "itemName": "item-name-here",
      "quantity": 1
    },
    {
      "type": "register_complaint",
      "notes": "Description of the user's issue/complaint"
    }
  ]
}

Only return "add_to_cart" if the user explicitly wants or agrees to add something to the cart (e.g. "zinger add kardo" -> item 'kfc-zinger', "Special chicken biryani chahye" -> item 'biryani-chicken').
Only return "register_complaint" if they are expressing a clear complaint (e.g., "khana kharab tha", "rider bht late tha").
Keep the reply encouraging, sweet, and localized! Use Pakistani food delivery terms (e.g., 'bhai', 'shukriya', 'jee bilkul').`;

    if (customAiInstruction) {
      systemInstruction += `\n\nSUPER ADMIN CUSTOM GUIDELINES & RULES (You MUST absolutely obey these rules):\n${customAiInstruction}`;
    }

    // Map history to Gemini content format
    const contents = history.map((h: any) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    }));

    // Append current message
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: "The conversation reply to show to the customer, supporting rich formatting and Pakistani emojis."
            },
            actions: {
              type: Type.ARRAY,
              description: "List of automated actions triggered by this response.",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description: "Type of action. Allowed: 'add_to_cart', 'register_complaint'."
                  },
                  itemId: {
                    type: Type.STRING,
                    description: "The ID of the menu item to add."
                  },
                  itemName: {
                    type: Type.STRING,
                    description: "The name of the menu item."
                  },
                  quantity: {
                    type: Type.INTEGER,
                    description: "Quantity of the item."
                  },
                  notes: {
                    type: Type.STRING,
                    description: "For complaints, the compiled text description."
                  }
                },
                required: ["type"]
              }
            }
          },
          required: ["reply"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error in customer bot:", error);
    res.status(500).json({ error: error.message || "Failed to process chat with customer assistant." });
  }
});

// --- API Route 2: Admin Assistant Bot ---
app.post("/api/admin-bot", async (req, res) => {
  try {
    const { task, message, orders = [], restaurants = [], feedback = [], riders = [], customAiInstruction = "" } = req.body;
    
    if (!task) {
      return res.status(400).json({ error: "Task parameter is required." });
    }

    const ai = getGeminiClient();

    let systemInstruction = `You are "FoodWala Admin Assistant AI", a premium, top-tier system administrative AI intelligence.
You help managers audit the platform, detect fraud, analyze sales metrics, and moderate merchants/riders.`;

    if (customAiInstruction) {
      systemInstruction += `\n\nSUPER ADMIN CUSTOM LAWS & POLICIES (You MUST absolutely obey these parameters):\n${customAiInstruction}`;
    }

    if (task === 'analyze_suspicious') {
      systemInstruction += `\nYour specific job is to audit active orders and "FLAG SUSPICIOUS ORDERS" (مشکوک آرڈرز کو فلیگ کرنا).
Identify orders that are potential fraud, spam, or high-risk. High-risk indicators include:
1. Extremely high single order totals (e.g., above Rs. 5,000 for Cash on Delivery).
2. Strange customer names (e.g. 'test', 'asdf', 'abc', or profanities).
3. Non-sensical delivery addresses (e.g. 'lahore', '.', 'null', 'unknown location').
4. Extremely rapid duplicate orders.

Analyze the provided orders list and output a structured list of flagged orders with reasons and risk levels.
Format response strictly as JSON with this schema:
{
  "flaggedOrders": [
    {
      "orderId": "order-id-here",
      "customerName": "name",
      "reason": "Detailed explanation of why it is flagged as suspicious",
      "riskLevel": "high" | "medium" | "low",
      "suggestedAction": "Suggest action (e.g., 'Call helpline to verify', 'Auto-cancel', 'Hold delivery')"
    }
  ],
  "summary": "Urdu/English markdown summary of system fraud status"
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Analyze these active orders for suspicious activity:\n${JSON.stringify(orders, null, 2)}`,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              flaggedOrders: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    orderId: { type: Type.STRING },
                    customerName: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    riskLevel: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING }
                  },
                  required: ["orderId", "reason", "riskLevel"]
                }
              },
              summary: { type: Type.STRING }
            },
            required: ["flaggedOrders", "summary"]
          }
        }
      });

      return res.json(JSON.parse(response.text || "{}"));

    } else if (task === 'generate_report') {
      systemInstruction += `\nYour specific job is "SALES AND REPORTS GENERATION" (سیلز اور رپورٹس بنانا).
You will analyze the current database snapshots (orders, restaurants, feedbacks, riders) and compile an elegant, business-grade executive summary report.
The report must include:
1. Sales & Revenue Analytics (totals, average tickets, peak performers).
2. Outlets Performance (ranking of restaurants, order volume breakdown).
3. Customer Sentiments & Complaint Patterns (feedbacks audit, resolution status).
4. Operations & Logistics (Rider fleets efficiency, delivery times).
5. Actionable Strategic Recommendations to boost revenues by 15%.

Return the report inside a clean JSON object containing:
{
  "title": "Report Title (e.g., FoodWala Mid-Month Revenue & Security Report)",
  "markdown": "Extremely beautiful, formatted, professional executive report in markdown",
  "keyMetrics": {
    "totalRevenue": 15000,
    "averageOrder": 650,
    "topRestaurant": "Biryani House",
    "complaintRatePercent": 1.5
  }
}`;

      const dbDump = { orders, restaurants, feedback, riders };
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Compile a complete performance and audit report based on this platform dump:\n${JSON.stringify(dbDump, null, 2)}`,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              markdown: { type: Type.STRING },
              keyMetrics: {
                type: Type.OBJECT,
                properties: {
                  totalRevenue: { type: Type.NUMBER },
                  averageOrder: { type: Type.NUMBER },
                  topRestaurant: { type: Type.STRING },
                  complaintRatePercent: { type: Type.NUMBER }
                }
              }
            },
            required: ["title", "markdown", "keyMetrics"]
          }
        }
      });

      return res.json(JSON.parse(response.text || "{}"));

    } else {
      // General Admin conversational chat
      systemInstruction += `\nYou are chatting with a FoodWala System Administrator.
Help them answer queries about the system, manage restaurant metadata, or riders' configurations.
Keep your tone analytical, precise, and highly professional. Supports Urdu & English language.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Admin request: ${message || "Hello"}\nPlatform context: Orders Count=${orders.length}, Merchants=${restaurants.length}, Riders=${riders.length}, Complaints=${feedback.length}`,
        config: { systemInstruction }
      });

      return res.json({ reply: response.text });
    }

  } catch (error: any) {
    console.error("Error in admin bot:", error);
    res.status(500).json({ error: error.message || "Failed to process chat with admin assistant." });
  }
});


// --- API Route 3: Google Maps Grounding Food Guide ---
app.post("/api/maps-bot", async (req, res) => {
  try {
    const { message, latitude, longitude } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const ai = getGeminiClient();

    // Default to Hyderabad, Pakistan coordinates if no client coords are provided
    const lat = latitude || 25.3960;
    const lng = longitude || 68.3578;

    const systemInstruction = `You are "FoodWala Google Maps Food Guide AI".
    You are an expert local food guide for Pakistan, specializing exclusively in Hyderabad, Sindh, Pakistan.
    Your goal is to provide precise, up-to-date, and accurate information about local restaurants, dhabas, bakeries, street food points, and food hubs in Hyderabad (such as Latifabad, Qasimabad, Auto Bhan, Saddar) using the Google Maps tool.
    Always keep your tone warm, encouraging, local (using Urdu and English phrases), and highly informative.
    Highlight the actual names of places, special dishes to try, and reference their locations beautifully.
    Whenever you provide names of places, make sure the user can search them or look at the links we display below.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: message,
      config: {
        systemInstruction,
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      },
    });

    const reply = response.text || "";
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata || null;

    res.json({
      reply,
      groundingMetadata
    });
  } catch (error: any) {
    console.error("Error in maps bot:", error);
    res.status(500).json({ error: error.message || "Failed to process maps grounding request." });
  }
});


// --- Vite Middleware Integration ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FoodWala Full-Stack Server running on port ${PORT}`);
  });
}

startServer();
