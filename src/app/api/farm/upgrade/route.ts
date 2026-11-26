import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-utils";
import { getFarmUpgradeCost } from "@/lib/game-logic";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTelegramUser } from "@/lib/telegram-auth";
import type { FarmUpgradeResponse, UserRow } from "@/types/game";

export async function POST(req: Request) {
  try {
    const tgUser = await verifyTelegramUser(req);

    const { data: userData, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Failed to fetch user: ${fetchError.message}`);
    }

    if (!userData) {
      return NextResponse.json(
        { error: "User not initialized. Call /api/auth/sync first." },
        { status: 404 }
      );
    }

    const user = userData as UserRow;
    const upgradeCost = getFarmUpgradeCost(user.farm_level);

    if (user.credits < upgradeCost) {
      return NextResponse.json(
        {
          error: `Insufficient credits. Need ${upgradeCost}, have ${user.credits}.`,
          required: upgradeCost,
          current: user.credits,
        },
        { status: 400 }
      );
    }

    const { data: updatedData, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        credits: user.credits - upgradeCost,
        farm_level: user.farm_level + 1,
      })
      .eq("telegram_id", tgUser.id)
      .eq("credits", user.credits)
      .eq("farm_level", user.farm_level)
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw new Error(`Failed to upgrade farm: ${updateError.message}`);
    }

    if (!updatedData) {
      return NextResponse.json(
        { error: "Balance or farm level changed concurrently. Please retry." },
        { status: 409 }
      );
    }

    const updatedUser = updatedData as UserRow;
    const payload: FarmUpgradeResponse = {
      user: updatedUser,
      upgradeCost,
      nextUpgradeCost: getFarmUpgradeCost(updatedUser.farm_level),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
