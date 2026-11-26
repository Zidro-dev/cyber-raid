import { NextResponse } from "next/server";
import { adjustUserBalance, handleApiError } from "@/lib/api-utils";
import {
  BASE_COMBAT_POWER,
  BASE_STARTING_CORES,
  BASE_STARTING_CREDITS,
  calculateEnergySync,
  calculateOfflineCredits,
  FREE_OFFLINE_CAP_HOURS,
  parseStartParamReferrerId,
  REFERRAL_BONUS_CORES,
  REFERRAL_BONUS_CREDITS,
  STARTING_ENERGY,
  STARTING_FARM_LEVEL,
  STARTING_MAX_ENERGY,
  VIP_OFFLINE_CAP_HOURS,
} from "@/lib/game-logic";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTelegramUser } from "@/lib/telegram-auth";
import type { InventoryRow, RaidRow, SyncResponse, UserRow } from "@/types/game";

async function fetchUserArtifacts(userId: number): Promise<{
  inventory: InventoryRow[];
  equippedInventory: InventoryRow[];
  recentRaids: RaidRow[];
}> {
  const [{ data: inventoryData, error: invError }, { data: raidsData, error: raidsError }] =
    await Promise.all([
      supabaseAdmin
        .from("inventory")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("raids")
        .select("*")
        .or(`attacker_id.eq.${userId},defender_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  if (invError) {
    throw new Error(`Failed to load inventory: ${invError.message}`);
  }
  if (raidsError) {
    throw new Error(`Failed to load raid logs: ${raidsError.message}`);
  }

  const inventory = (inventoryData ?? []) as InventoryRow[];
  const equippedInventory = inventory.filter((item) => item.is_equipped);
  const recentRaids = (raidsData ?? []) as RaidRow[];

  return { inventory, equippedInventory, recentRaids };
}

export async function POST(req: Request) {
  try {
    const tgUser = await verifyTelegramUser(req);
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: existingData, error: lookupError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Failed to look up user: ${lookupError.message}`);
    }

    let userRecord: UserRow | null = (existingData as UserRow | null) ?? null;
    let isNewUser = false;
    let referralApplied = false;
    let earnedCredits = 0;
    let regeneratedEnergy = 0;
    let isVip = false;
    let offlineCapHours = FREE_OFFLINE_CAP_HOURS;

    if (!userRecord) {
      const candidateReferrerId = parseStartParamReferrerId(tgUser.start_param, tgUser.id);
      let validReferrerId: number | null = null;

      if (candidateReferrerId) {
        const { data: referrerRow, error: refLookupError } = await supabaseAdmin
          .from("users")
          .select("telegram_id")
          .eq("telegram_id", candidateReferrerId)
          .maybeSingle();

        if (refLookupError) {
          throw new Error(`Failed to validate referrer: ${refLookupError.message}`);
        }
        if (referrerRow) {
          validReferrerId = referrerRow.telegram_id as number;
        }
      }

      const startingCredits =
        BASE_STARTING_CREDITS + (validReferrerId ? REFERRAL_BONUS_CREDITS : 0);
      const startingCores =
        BASE_STARTING_CORES + (validReferrerId ? REFERRAL_BONUS_CORES : 0);

      const newUserPayload: UserRow = {
        telegram_id: tgUser.id,
        username: tgUser.username ?? null,
        first_name: tgUser.first_name,
        credits: startingCredits,
        cores: startingCores,
        energy: STARTING_ENERGY,
        max_energy: STARTING_MAX_ENERGY,
        combat_power: BASE_COMBAT_POWER,
        farm_level: STARTING_FARM_LEVEL,
        vip_until: null,
        shield_until: null,
        last_collected_at: nowIso,
        last_energy_at: nowIso,
        referred_by: validReferrerId,
        created_at: nowIso,
      };

      const { data: insertedUser, error: insertError } = await supabaseAdmin
        .from("users")
        .insert(newUserPayload)
        .select("*")
        .single();

      if (insertError) {
        // Handle concurrent initial sync race (e.g., StrictMode double mount)
        if (insertError.code === "23505") {
          const { data: raceUser, error: raceFetchError } = await supabaseAdmin
            .from("users")
            .select("*")
            .eq("telegram_id", tgUser.id)
            .single();

          if (raceFetchError || !raceUser) {
            throw new Error(`Failed to recover user after insert race: ${raceFetchError?.message}`);
          }
          userRecord = raceUser as UserRow;
        } else {
          throw new Error(`Failed to create user: ${insertError.message}`);
        }
      } else {
        userRecord = insertedUser as UserRow;
        isNewUser = true;

        if (validReferrerId) {
          try {
            await adjustUserBalance(validReferrerId, {
              creditsDelta: REFERRAL_BONUS_CREDITS,
              coresDelta: REFERRAL_BONUS_CORES,
            });
            referralApplied = true;
          } catch (refRewardError) {
            console.error(
              `[auth/sync] Failed to award referral bonus to ${validReferrerId}:`,
              refRewardError
            );
          }
        }
      }
    }

    if (!isNewUser && userRecord) {
      // Existing user: sync offline idle credits and regenerated energy with optimistic locking
      for (let attempt = 0; attempt < 3; attempt++) {
        const syncNow = new Date();
        const creditSync = calculateOfflineCredits(userRecord, syncNow);
        const energySync = calculateEnergySync(userRecord, syncNow);

        const nextUsername = tgUser.username ?? userRecord.username;
        const nextFirstName = tgUser.first_name || userRecord.first_name;

        const hasChanges =
          creditSync.earnedCredits > 0 ||
          creditSync.nextLastCollectedAt !== userRecord.last_collected_at ||
          energySync.regeneratedEnergy > 0 ||
          energySync.nextLastEnergyAt !== userRecord.last_energy_at ||
          nextUsername !== userRecord.username ||
          nextFirstName !== userRecord.first_name;

        isVip = creditSync.isVip;
        offlineCapHours = isVip ? VIP_OFFLINE_CAP_HOURS : FREE_OFFLINE_CAP_HOURS;

        if (!hasChanges) {
          break;
        }

        let syncQuery = supabaseAdmin
          .from("users")
          .update({
            username: nextUsername,
            first_name: nextFirstName,
            credits: userRecord.credits + creditSync.earnedCredits,
            energy: energySync.energy,
            last_collected_at: creditSync.nextLastCollectedAt,
            last_energy_at: energySync.nextLastEnergyAt,
          })
          .eq("telegram_id", userRecord.telegram_id)
          .eq("credits", userRecord.credits)
          .eq("energy", userRecord.energy);

        syncQuery =
          userRecord.last_collected_at === null
            ? syncQuery.is("last_collected_at", null)
            : syncQuery.eq("last_collected_at", userRecord.last_collected_at);

        const { data: updated, error: updateError } = await syncQuery
          .select("*")
          .maybeSingle();

        if (updateError) {
          throw new Error(`Failed to sync user state: ${updateError.message}`);
        }

        if (updated) {
          userRecord = updated as UserRow;
          earnedCredits = creditSync.earnedCredits;
          regeneratedEnergy = energySync.regeneratedEnergy;
          break;
        }

        const { data: refetched, error: refetchError } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("telegram_id", tgUser.id)
          .single();

        if (refetchError || !refetched) {
          throw new Error(`Failed to re-fetch user during sync: ${refetchError?.message}`);
        }
        userRecord = refetched as UserRow;
      }
    }

    if (!userRecord) {
      throw new Error("Unable to load or create user state.");
    }

    const { inventory, equippedInventory, recentRaids } = await fetchUserArtifacts(
      userRecord.telegram_id
    );

    const payload: SyncResponse = {
      user: userRecord,
      equippedInventory,
      inventory,
      recentRaids,
      syncResult: {
        isNewUser,
        earnedCredits,
        regeneratedEnergy,
        referralApplied,
        isVip,
        offlineCapHours,
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
