import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & {
  authUser: User;
  supabase: SupabaseClient;
};

export function createSupabaseClient(accessToken?: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase configuration is missing");
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
  });
}

export async function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const token = match[1];
    const supabase = createSupabaseClient(token);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }

    Object.assign(req, { authUser: data.user, supabase });
    next();
  } catch (error) {
    req.log?.error({ error }, "Supabase authentication failed");
    res.status(503).json({ error: "Sign-in is temporarily unavailable." });
  }
}

export function getAuthContext(req: Request): AuthenticatedRequest {
  return req as AuthenticatedRequest;
}
