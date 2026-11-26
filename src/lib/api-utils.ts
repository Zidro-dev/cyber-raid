import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TelegramAuthError } from "@/lib/telegram-auth";
import type { UserRow } from "@/types/game";

export function handleApiError(error: unknown) {
  if (error instanceof TelegramAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  console.error("[API Error]", error);
  const message =
    error instanceof Error ? error.message : "An unexpected server error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function safeParseJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Optimistically adjusts user credits and/or cores with retry to prevent lost updates
 * under concurrent requests (e.g., simultaneous referrals, raids, or webhook fulfillments).
 */
export async function adjustUserBalance(
  telegramId: number,
  options: {
    creditsDelta?: number;
    coresDelta?: number;
    clampZero?: boolean;
  },
  maxRetries = 5
): Promise<UserRow> {
  const creditsDelta = options.creditsDelta ?? 0;
  const coresDelta = options.coresDelta ?? 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: current, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (fetchError || !current) {
      throw new Error(
        `User ${telegramId} not found while updating balance: ${fetchError?.message ?? "missing"}`
      );
    }

    const row = current as UserRow;
    const rawNextCredits = row.credits + creditsDelta;
    const rawNextCores = row.cores + coresDelta;

    const nextCredits = options.clampZero ? Math.max(0, rawNextCredits) : rawNextCredits;
    const nextCores = options.clampZero ? Math.max(0, rawNextCores) : rawNextCores;

    if (nextCredits < 0 || nextCores < 0) {
      throw new Error("Insufficient balance for balance adjustment.");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        credits: nextCredits,
        cores: nextCores,
      })
      .eq("telegram_id", telegramId)
      .eq("credits", row.credits)
      .eq("cores", row.cores)
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw new Error(`Failed updating balance for ${telegramId}: ${updateError.message}`);
    }

    if (updated) {
      return updated as UserRow;
    }
  }

  throw new Error(`Concurrent update conflict while adjusting balance for user ${telegramId}.`);
}
