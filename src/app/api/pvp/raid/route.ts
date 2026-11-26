import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { adjustUserBalance, handleApiError, safeParseJson } from "@/lib/api-utils";
import {
  calculateEnergySync,
  computeBattleMultiplier,
  isUserShielded,
} from "@/lib/game-logic";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTelegramUser } from "@/lib/telegram-auth";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import type { PvpRaidResponse, RaidRow, UserRow } from "@/types/game";

interface RaidRequestBody {
  revengeRaidId?: unknown;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const tgUser = await verifyTelegramUser(req);
    const body = await safeParseJson<RaidRequestBody>(req);
    const revengeRaidId =
      typeof body?.revengeRaidId === "string" && UUID_REGEX.test(body.revengeRaidId)
        ? body.revengeRaidId
        : null;

    const now = new Date();
    const nowIso = now.toISOString();

    const { data: attackerData, error: attackerFetchError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (attackerFetchError) {
      throw new Error(`Failed to fetch attacker: ${attackerFetchError.message}`);
    }
    if (!attackerData) {
      return NextResponse.json(
        { error: "User not initialized. Call /api/auth/sync first." },
        { status: 404 }
      );
    }

    const attacker = attackerData as UserRow;
    const energySync = calculateEnergySync(attacker, now);

    if (energySync.energy < 1) {
      return NextResponse.json(
        {
          error: "Not enough energy. Energy regenerates +1 every 30 minutes.",
          energy: energySync.energy,
          max_energy: attacker.max_energy,
        },
        { status: 400 }
      );
    }

    let defender: UserRow | null = null;
    let isRevenge = false;

    if (revengeRaidId) {
      const { data: originalRaid, error: raidLookupError } = await supabaseAdmin
        .from("raids")
        .select("*")
        .eq("id", revengeRaidId)
        .eq("defender_id", tgUser.id)
        .eq("attacker_won", true)
        .maybeSingle();

      if (raidLookupError) {
        throw new Error(`Failed to look up revenge raid: ${raidLookupError.message}`);
      }
      if (!originalRaid) {
        return NextResponse.json(
          { error: "Revenge target raid record not found." },
          { status: 404 }
        );
      }

      const { data: revengeTarget, error: targetFetchError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("telegram_id", (originalRaid as RaidRow).attacker_id)
        .maybeSingle();

      if (targetFetchError) {
        throw new Error(`Failed to look up revenge target: ${targetFetchError.message}`);
      }
      if (!revengeTarget) {
        return NextResponse.json({ error: "Revenge target no longer exists." }, { status: 404 });
      }
      if ((revengeTarget as UserRow).telegram_id === tgUser.id) {
        return NextResponse.json({ error: "Cannot raid yourself." }, { status: 400 });
      }
      if (isUserShielded(revengeTarget as UserRow, now)) {
        return NextResponse.json(
          { error: "Target currently has an active Energy Shield." },
          { status: 409 }
        );
      }

      defender = revengeTarget as UserRow;
      isRevenge = true;
    } else {
      const minPower = Math.floor(attacker.combat_power * 0.7);
      const maxPower = Math.ceil(attacker.combat_power * 1.3);

      const { data: matchedRivals, error: matchError } = await supabaseAdmin
        .from("users")
        .select("*")
        .neq("telegram_id", tgUser.id)
        .or(`shield_until.is.null,shield_until.lt.${nowIso}`)
        .gte("combat_power", minPower)
        .lte("combat_power", maxPower)
        .limit(50);

      if (matchError) {
        throw new Error(`Failed to search matched rivals: ${matchError.message}`);
      }

      let candidates = (matchedRivals ?? []) as UserRow[];

      if (candidates.length === 0) {
        const { data: fallbackRivals, error: fallbackError } = await supabaseAdmin
          .from("users")
          .select("*")
          .neq("telegram_id", tgUser.id)
          .or(`shield_until.is.null,shield_until.lt.${nowIso}`)
          .limit(50);

        if (fallbackError) {
          throw new Error(`Failed to search fallback rivals: ${fallbackError.message}`);
        }
        candidates = (fallbackRivals ?? []) as UserRow[];
      }

      if (candidates.length === 0) {
        return NextResponse.json(
          { error: "No unshielded targets available in this sector right now." },
          { status: 404 }
        );
      }

      defender = candidates[crypto.randomInt(0, candidates.length)];
    }

    // Consume 1 energy atomically before resolving battle
    const nextEnergy = energySync.energy - 1;
    const nextLastEnergyAt =
      energySync.energy >= attacker.max_energy ? nowIso : energySync.nextLastEnergyAt;

    let energyUpdateQuery = supabaseAdmin
      .from("users")
      .update({
        energy: nextEnergy,
        last_energy_at: nextLastEnergyAt,
      })
      .eq("telegram_id", attacker.telegram_id)
      .eq("energy", attacker.energy);

    energyUpdateQuery =
      attacker.last_energy_at === null
        ? energyUpdateQuery.is("last_energy_at", null)
        : energyUpdateQuery.eq("last_energy_at", attacker.last_energy_at);

    const { data: energyUpdatedAttacker, error: energyUpdateError } = await energyUpdateQuery
      .select("*")
      .maybeSingle();

    if (energyUpdateError) {
      throw new Error(`Failed to deduct raid energy: ${energyUpdateError.message}`);
    }
    if (!energyUpdatedAttacker) {
      return NextResponse.json(
        { error: "Energy state changed concurrently. Please retry." },
        { status: 409 }
      );
    }

    const attackerMult = computeBattleMultiplier();
    const defenderMult = computeBattleMultiplier();
    const attackerRawScore = attacker.combat_power * attackerMult;
    const defenderRawScore = defender.combat_power * defenderMult;
    const attackerRoll = Math.round(attackerRawScore);
    const defenderRoll = Math.round(defenderRawScore);
    const attackerWon = attackerRawScore >= defenderRawScore;

    let stolenCredits = 0;
    let finalAttacker = energyUpdatedAttacker as UserRow;

    if (attackerWon) {
      stolenCredits = Math.max(50, Math.floor(defender.credits * 0.15));

      const [updatedAttacker] = await Promise.all([
        adjustUserBalance(attacker.telegram_id, {
          creditsDelta: stolenCredits,
        }),
        adjustUserBalance(defender.telegram_id, {
          creditsDelta: -stolenCredits,
          clampZero: true,
        }),
      ]);

      finalAttacker = updatedAttacker;
    }

    const raidRecord: RaidRow = {
      id: crypto.randomUUID(),
      attacker_id: attacker.telegram_id,
      defender_id: defender.telegram_id,
      attacker_won: attackerWon,
      stolen_credits: stolenCredits,
      is_revenge: isRevenge,
      created_at: nowIso,
    };

    const { data: insertedRaid, error: raidInsertError } = await supabaseAdmin
      .from("raids")
      .insert(raidRecord)
      .select("*")
      .single();

    if (raidInsertError || !insertedRaid) {
      throw new Error(`Failed to record raid: ${raidInsertError?.message ?? "Unknown"}`);
    }

    if (attackerWon) {
      const attackerDisplay = attacker.username
        ? `@${attacker.username}`
        : attacker.first_name ?? `Runner #${attacker.telegram_id}`;
      const alertText =
        `⚠️ CYBER RAID ALERT!\n\n` +
        `${attackerDisplay} breached your sector and stole ${stolenCredits.toLocaleString()} Credits!\n` +
        `Open CYBER RAID now to activate a Shield or launch a Revenge strike.`;

      // Fire-and-forget guarded by short timeout inside sendTelegramMessage
      await sendTelegramMessage(defender.telegram_id, alertText);
    }

    const payload: PvpRaidResponse = {
      raid: insertedRaid as RaidRow,
      attackerWon,
      stolenCredits,
      attackerPower: attacker.combat_power,
      defenderPower: defender.combat_power,
      attackerRoll,
      defenderRoll,
      defender: {
        telegram_id: defender.telegram_id,
        username: defender.username,
        first_name: defender.first_name,
        combat_power: defender.combat_power,
      },
      user: finalAttacker,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
