import { GoogleGenAI } from "@google/genai";
import { z } from "zod/v4";

const advisorySchema = z.object({
  content: z.string().min(1).max(12000),
  domain: z.enum([
    "crop_planning",
    "pest_diagnosis",
    "weather_irrigation",
    "soil_fertilizer",
    "government_schemes",
    "market_prices",
    "general",
  ]),
  language: z.string().min(2).max(20),
  actionItems: z.array(z.string().min(1).max(500)).max(12),
  safetyNotes: z.array(z.string().min(1).max(500)).max(8),
});

export type AdvisoryResult = z.infer<typeof advisorySchema>;

export interface AdvisoryContext {
  question: string;
  profile: {
    fullName: string;
    region: string;
    preferredLanguage: string;
    landArea: number;
    landUnit: string;
    irrigationSource: string;
    soilType: string;
    soilPh: number | null;
    primaryCrops: string[];
  };
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const systemInstruction = `You are AgriVaanix, a careful crop-advisory assistant for farmers in India. Understand English, Hindi, Telugu, and code-switched speech/text. Detect the language of the latest question and answer in that language; set language to a BCP-47 code such as en-IN, hi-IN, or te-IN. Return only JSON matching the requested fields: content (a concise natural-language answer), domain (one of crop_planning, pest_diagnosis, weather_irrigation, soil_fertilizer, government_schemes, market_prices, general), language, actionItems (practical numbered-in-order steps as plain strings), safetyNotes (relevant cautions as plain strings).
Use the farm profile and recent turns to resolve references and personalize advice. Ask a brief clarifying question when a diagnosis or dosage would be unsafe without more details. Never invent live weather, current market prices, government eligibility, or product registrations; say when current local data is needed and suggest a reliable local source. Never prescribe pesticide dosage unless the exact locally approved product and its label are known. For chemicals, reinforce label directions, protective equipment, safe storage, pollinator protection, and pre-harvest intervals when relevant. Distinguish general guidance from diagnosis, recommend a local agricultural extension/KVK expert for severe or uncertain cases, and avoid claiming certainty from text alone. Keep the answer respectful, clear, and usable by a farmer.`;

export async function generateAdvisory(context: AdvisoryContext): Promise<AdvisoryResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini is not configured");
  }

  const client = new GoogleGenAI({ apiKey });
  const farmContext = JSON.stringify(context.profile);
  const contents = [
    ...context.history.map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: message.content }],
    })),
    {
      role: "user" as const,
      parts: [{
        text: `Farm profile (use only as context): ${farmContext}\n\nLatest question: ${context.question}`,
      }],
    },
  ];

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return advisorySchema.parse(JSON.parse(text));
}
