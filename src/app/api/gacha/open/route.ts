import { NextResponse } from "next/server";
import { adjustUserBalance, handleApiError, safeParseJson } from "@/lib/api-utils";
import {
  calculateItemPowerBonus,
  generateItemName,
  grantItemWithAutoEquip,
  PREMIUM_CAPSULE_COST_CORES,
  rollGachaRarity,
  rollRandomSlot,
  STANDARD_CAPSULE_COST_CREDITS,
} from "@/lib/game-logic";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTelegramUser } from "@/lib/telegram-auth";
import type { CapsuleType, GachaOpenResponse, UserRow } from "@/types/game";

interface GachaOpenBody {
  capsuleType?: unknown;
}

export async function POST(req: Request) {
  try {
    const tgUser = await verifyTelegramUser(req);
    const body = await safeParseJson<GachaOpenBody>(req);
    const capsuleType = body?.capsuleType;

    if (capsuleType !== "standard" && capsuleType !== "premium") {
      return NextResponse.json(
        { error: "Invalid capsuleType. Must be 'standard' or 'premium'." },
        { status: 400 }
      );
    }

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
    const typedCapsule: CapsuleType = capsuleType;
    const currency: "credits" | "cores" =
      typedCapsule === "standard" ? "credits" : "cores";
    const costAmount =
      typedCapsule === "standard"
        ? STANDARD_CAPSULE_COST_CREDITS
        : PREMIUM_CAPSULE_COST_CORES;

    if (user[currency] < costAmount) {
      return NextResponse.json(
        {
          error: `Insufficient ${currency}. Need ${costAmount}, have ${user[currency]}.`,
          required: costAmount,
          current: user[currency],
        },
        { status: 400 }
      );
    }

    // Atomically deduct cost using optimistic lock before rolling & granting item
    const updateFields =
      currency === "credits"
        ? { credits: user.credits - costAmount }
        : { cores: user.cores - costAmount };

    const { data: deductedUser, error: deductError } = await supabaseAdmin
      .from("users")
      .update(updateFields)
      .eq("telegram_id", tgUser.id)
      .eq(currency, user[currency])
      .select("*")
      .maybeSingle();

    if (deductError) {
      throw new Error(`Failed to deduct capsule cost: ${deductError.message}`);
    }
    if (!deductedUser) {
      return NextResponse.json(
        { error: "Balance changed concurrently. Please retry." },
        { status: 409 }
      );
    }

    const rarity = rollGachaRarity(typedCapsule);
    const slot = rollRandomSlot();
    const itemName = generateItemName(slot, rarity);
    const powerBonus = calculateItemPowerBonus(user.farm_level, rarity);

    let grantResult: Awaited<ReturnType<typeof grantItemWithAutoEquip>>;
    try {
      grantResult = await grantItemWithAutoEquip({
        userId: tgUser.id,
        slot,
        rarity,
        name: itemName,
        powerBonus,
      });
    } catch (grantError) {
      // Compensate user if item persistence failed after currency deduction
      try {
        await adjustUserBalance(tgUser.id, {
          creditsDelta: currency === "credits" ? costAmount : 0,
          coresDelta: currency === "cores" ? costAmount : 0,
        });
      } catch (refundError) {
        console.error("[gacha/open] Failed to refund after grant failure:", refundError);
      }
      throw grantError;
    }

    const finalUser: UserRow = {
      ...(deductedUser as UserRow),
      combat_power: grantResult.combatPower,
    };

    const payload: GachaOpenResponse = {
      item: grantResult.item,
      autoEquipped: grantResult.autoEquipped,
      replacedItem: grantResult.replacedItem,
      capsuleType: typedCapsule,
      cost: {
        currency,
        amount: costAmount,
      },
      user: finalUser,
      equippedInventory: grantResult.equippedInventory,
      inventory: grantResult.inventory,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
