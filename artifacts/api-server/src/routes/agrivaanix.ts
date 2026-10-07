import { Router, type IRouter, type Response } from "express";
import {
  CreateConversationBody,
  CreateConversationResponse,
  DeleteConversationParams,
  GetConversationParams,
  GetConversationResponse,
  GetDashboardSummaryResponse,
  GetFarmProfileResponse,
  ListConversationMessagesParams,
  ListConversationMessagesResponse,
  ListConversationsResponse,
  SaveFarmProfileBody,
  SaveFarmProfileResponse,
  SendAdvisoryMessageBody,
  SendAdvisoryMessageParams,
  SendAdvisoryMessageResponse,
} from "@workspace/api-zod";
import { getAuthContext, type AuthenticatedRequest } from "../middlewares/supabase-auth";
import { generateAdvisory } from "../lib/gemini-advisory";

const router: IRouter = Router();

type SupabaseClient = AuthenticatedRequest["supabase"];
type FarmProfileRow = {
  user_id: string;
  full_name: string;
  region: string;
  preferred_language: string;
  land_area: number | string;
  land_unit: string;
  irrigation_source: string;
  soil_type: string;
  soil_ph: number | string | null;
  primary_crops: string[];
  updated_at: string;
};
type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  domain: string;
  language: string;
  action_items: string[];
  safety_notes: string[];
  created_at: string;
};

function profileOutput(row: FarmProfileRow) {
  return GetFarmProfileResponse.parse({
    fullName: row.full_name,
    region: row.region,
    preferredLanguage: row.preferred_language,
    landArea: Number(row.land_area),
    landUnit: row.land_unit,
    irrigationSource: row.irrigation_source,
    soilType: row.soil_type,
    soilPh: row.soil_ph === null ? null : Number(row.soil_ph),
    primaryCrops: row.primary_crops ?? [],
    updatedAt: row.updated_at,
  });
}

function messageOutput(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    domain: row.domain,
    language: row.language,
    actionItems: row.action_items ?? [],
    safetyNotes: row.safety_notes ?? [],
    createdAt: row.created_at,
  };
}

async function loadProfile(client: SupabaseClient, userId: string): Promise<FarmProfileRow | null> {
  const { data, error } = await client
    .from("farm_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as FarmProfileRow;

  const { data: created, error: insertError } = await client
    .from("farm_profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (insertError) {
    const { data: raced, error: racedError } = await client
      .from("farm_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (racedError || !raced) throw insertError;
    return raced as FarmProfileRow;
  }
  return created as FarmProfileRow;
}

async function loadConversations(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("conversations")
    .select("id,user_id,title,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const conversations = (data ?? []) as ConversationRow[];
  if (!conversations.length) return [];

  const { data: messageRefs, error: messageError } = await client
    .from("messages")
    .select("conversation_id")
    .eq("user_id", userId)
    .in("conversation_id", conversations.map((conversation) => conversation.id));
  if (messageError) throw messageError;

  const counts = new Map<string, number>();
  for (const message of messageRefs ?? []) {
    counts.set(message.conversation_id, (counts.get(message.conversation_id) ?? 0) + 1);
  }
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    messageCount: counts.get(conversation.id) ?? 0,
  }));
}

function reportDatabaseError(
  req: AuthenticatedRequest,
  res: Response,
  error: unknown,
  action: string,
): void {
  req.log.error({ error, action, userId: req.authUser.id }, "Supabase request failed");
  res.status(502).json({ error: "Farm data is temporarily unavailable. Please try again." });
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  try {
    const [profile, conversations, adviceCountResult] = await Promise.all([
      loadProfile(supabase, authUser.id),
      loadConversations(supabase, authUser.id),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", authUser.id)
        .eq("role", "assistant"),
    ]);
    if (adviceCountResult.error) throw adviceCountResult.error;

    res.json(GetDashboardSummaryResponse.parse({
      activeFields: profile && (profile.primary_crops?.length || profile.land_area) ? 1 : 0,
      conversationCount: conversations.length,
      adviceCount: adviceCountResult.count ?? 0,
      recentConversations: conversations.slice(0, 5),
    }));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "load dashboard");
  }
});

router.get("/farm-profile", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  try {
    const profile = await loadProfile(supabase, authUser.id);
    if (!profile) {
      res.status(502).json({ error: "Farm profile could not be loaded." });
      return;
    }
    res.json(profileOutput(profile));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "load farm profile");
  }
});

router.put("/farm-profile", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const parsed = SaveFarmProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;
  try {
    const { data, error } = await supabase
      .from("farm_profiles")
      .upsert({
        user_id: authUser.id,
        full_name: input.fullName,
        region: input.region,
        preferred_language: input.preferredLanguage,
        land_area: input.landArea,
        land_unit: input.landUnit,
        irrigation_source: input.irrigationSource,
        soil_type: input.soilType,
        soil_ph: input.soilPh,
        primary_crops: input.primaryCrops,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw error;
    res.json(SaveFarmProfileResponse.parse(profileOutput(data as FarmProfileRow)));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "save farm profile");
  }
});

router.get("/conversations", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  try {
    const conversations = await loadConversations(supabase, authUser.id);
    res.json(ListConversationsResponse.parse(conversations));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "list conversations");
  }
});

router.post("/conversations", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: authUser.id, title: parsed.data.title.trim() })
      .select("id,title,created_at,updated_at")
      .single();
    if (error) throw error;

    res.status(201).json(CreateConversationResponse.parse({
      id: data.id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      messageCount: 0,
    }));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "create conversation");
  }
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id,title,created_at,updated_at")
      .eq("id", params.data.id)
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const { data: rows, error: messagesError } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: true });
    if (messagesError) throw messagesError;

    res.json(GetConversationResponse.parse({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messageCount: rows?.length ?? 0,
      messages: (rows ?? []).map((row: MessageRow) => messageOutput(row)),
    }));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "get conversation");
  }
});

router.delete("/conversations/:id", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const params = DeleteConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", params.data.id)
      .eq("user_id", authUser.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.sendStatus(204);
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "delete conversation");
  }
});

router.get("/conversations/:id/messages", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const params = ListConversationMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", params.data.id)
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json(ListConversationMessagesResponse.parse((data ?? []).map((row: MessageRow) => messageOutput(row))));
  } catch (error) {
    reportDatabaseError(req as AuthenticatedRequest, res, error, "list conversation messages");
  }
});

router.post("/conversations/:id/messages", async (req, res): Promise<void> => {
  const { supabase, authUser } = getAuthContext(req);
  const params = SendAdvisoryMessageParams.safeParse(req.params);
  const parsedBody = SendAdvisoryMessageBody.safeParse(req.body);
  if (!params.success || !parsedBody.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsedBody.error.message });
    return;
  }

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", params.data.id)
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const [profile, historyResult] = await Promise.all([
      loadProfile(supabase, authUser.id),
      supabase
        .from("messages")
        .select("role,content")
        .eq("conversation_id", conversation.id)
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (historyResult.error) throw historyResult.error;
    const history = (historyResult.data ?? []).reverse() as Array<{
      role: "user" | "assistant";
      content: string;
    }>;

    const advice = await generateAdvisory({
      question: parsedBody.data.content.trim(),
      profile: {
        fullName: profile?.full_name ?? "",
        region: profile?.region ?? "",
        preferredLanguage: profile?.preferred_language ?? "en",
        landArea: Number(profile?.land_area ?? 0),
        landUnit: profile?.land_unit ?? "acres",
        irrigationSource: profile?.irrigation_source ?? "",
        soilType: profile?.soil_type ?? "",
        soilPh: profile?.soil_ph == null ? null : Number(profile.soil_ph),
        primaryCrops: profile?.primary_crops ?? [],
      },
      history,
    });

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert([
        {
          conversation_id: conversation.id,
          user_id: authUser.id,
          role: "user",
          content: parsedBody.data.content.trim(),
        },
        {
          conversation_id: conversation.id,
          user_id: authUser.id,
          role: "assistant",
          content: advice.content,
          domain: advice.domain,
          language: advice.language,
          action_items: advice.actionItems,
          safety_notes: advice.safetyNotes,
        },
      ])
      .select("*");
    if (insertError) throw insertError;

    const userMessage = (inserted as MessageRow[]).find((row) => row.role === "user");
    const assistantMessage = (inserted as MessageRow[]).find((row) => row.role === "assistant");
    if (!userMessage || !assistantMessage) {
      throw new Error("Conversation messages were not returned after saving");
    }

    const { error: updateError } = await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversation.id)
      .eq("user_id", authUser.id);
    if (updateError) throw updateError;

    res.json(SendAdvisoryMessageResponse.parse({
      userMessage: messageOutput(userMessage),
      assistantMessage: messageOutput(assistantMessage),
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown advisory error";
    req.log.error({ error, userId: authUser.id }, "Failed to produce advisory");
    if (reason === "Gemini is not configured") {
      res.status(503).json({ error: "AI advice is not configured yet. Please try again later." });
      return;
    }
    if (reason.includes("429") || reason.toLowerCase().includes("rate limit")) {
      res.status(503).json({ error: "The advisory service is busy. Please wait a moment and try again." });
      return;
    }
    if (reason.includes("Supabase") || reason.includes("JWT")) {
      res.status(502).json({ error: "Farm data is temporarily unavailable. Please try again." });
      return;
    }
    res.status(502).json({ error: "Advice could not be generated right now. Please try again." });
  }
});

export default router;
