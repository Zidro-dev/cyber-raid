import crypto from "node:crypto";
import {
  BASE_COMBAT_POWER,
  BASE_STARTING_CORES,
  BASE_STARTING_CREDITS,
  ENERGY_REGEN_INTERVAL_MS,
  FARM_RATE_PER_LEVEL_PER_HOUR,
  FREE_OFFLINE_CAP_HOURS,
  getFarmUpgradeCost,
  PREMIUM_CAPSULE_COST_CORES,
  REFERRAL_BONUS_CORES,
  REFERRAL_BONUS_CREDITS,
  STANDARD_CAPSULE_COST_CREDITS,
  STARTING_ENERGY,
  STARTING_FARM_LEVEL,
  STARTING_MAX_ENERGY,
  VIP_OFFLINE_CAP_HOURS,
} from "@/lib/game-constants";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type {
  CapsuleType,
  InventoryRow,
  ItemRarity,
  ItemSlot,
  UserRow,
} from "@/types/game";

export {
  BASE_COMBAT_POWER,
  BASE_STARTING_CORES,
  BASE_STARTING_CREDITS,
  ENERGY_REGEN_INTERVAL_MS,
  FARM_RATE_PER_LEVEL_PER_HOUR,
  FREE_OFFLINE_CAP_HOURS,
  getFarmUpgradeCost,
  PREMIUM_CAPSULE_COST_CORES,
  REFERRAL_BONUS_CORES,
  REFERRAL_BONUS_CREDITS,
  STANDARD_CAPSULE_COST_CREDITS,
  STARTING_ENERGY,
  STARTING_FARM_LEVEL,
  STARTING_MAX_ENERGY,
  VIP_OFFLINE_CAP_HOURS,
};

export const RARITY_MULTIPLIERS: Record<ItemRarity, number> = {
  common: 1,
  rare: 1.8,
  epic: 3.5,
  legendary: 7,
  mythic: 15,
};

const SLOTS: ItemSlot[] = ["weapon", "armor", "drone"];

const ITEM_NAMES: Record<ItemSlot, Record<ItemRarity, string[]>> = {
  weapon: {
    common: ["Rust-9 Pistol", "Street Shiv", "Scrap Carbine"],
    rare: ["Kestrel Pulse Rifle", "Neon Arc Blade", "Vector SMG"],
    epic: ["Valkyrie Plasma Katana", "Ion Gauss Cannon", "Phantom Railgun"],
    legendary: ["Helios Singularity Rifle", "Chronos Monoblade", "Hyperion Blaster"],
    mythic: ["Omega Voidbreaker", "Astral Oblivion Lance", "Zero-Day Annihilator"],
  },
  armor: {
    common: ["Padded Kevlar Vest", "Scrap Street Jacket", "Synth-Cloth Coat"],
    rare: ["Specter Carbon Rig", "Tactical Nanoweave", "Gridwalker Suit"],
    epic: ["Titan Exo-Carapace", "Aegis Reactive Plate", "Mirage Stealth Armor"],
    legendary: ["Vanguard Quantum Shell", "Cyber-Seraph Mantle", "Apex Dreadplate"],
    mythic: ["Eternity Singularity Aegis", "Godshell Exo-Frame", "Abyssal Matrix Armor"],
  },
  drone: {
    common: ["Bit-01 Recon Bot", "Scrap Spark Drone", "Relay Micro-Orb"],
    rare: ["Viper Tactical Drone", "Pulse Shield Bit", "Interceptor Mini"],
    epic: ["Tempest Hunter Drone", "Sentinel Laser Satellite", "Phantom Stalker"],
    legendary: ["Seraph Combat AI", "Overlord Siege Drone", "Eclipse Orbital Unit"],
    mythic: ["Archon Neural Swarm", "Omega Singularity Bit", "Leviathan Core Drone"],
  },
};

export function isUserVip(user: Pick<UserRow, "vip_until">, now = new Date()): boolean {
  return Boolean(user.vip_until && new Date(user.vip_until).getTime() > now.getTime());
}

export function isUserShielded(user: Pick<UserRow, "shield_until">, now = new Date()): boolean {
  return Boolean(user.shield_until && new Date(user.shield_until).getTime() > now.getTime());
}

export function calculateOfflineCredits(
  user: Pick<UserRow, "farm_level" | "vip_until" | "last_collected_at">,
  now = new Date()
): {
  earnedCredits: number;
  nextLastCollectedAt: string;
  isVip: boolean;
  offlineCapHours: number;
} {
  const isVip = isUserVip(user, now);
  const offlineCapHours = isVip ? VIP_OFFLINE_CAP_HOURS : FREE_OFFLINE_CAP_HOURS;
  if (!user.last_collected_at) {
    return {
      earnedCredits: 0,
      nextLastCollectedAt: now.toISOString(),
      isVip,
      offlineCapHours,
    };
  }

  const maxCapMs = offlineCapHours * 3600 * 1000;
  const lastCollectedMs = new Date(user.last_collected_at).getTime();
  const elapsedMs = Math.max(0, now.getTime() - lastCollectedMs);
  const cappedMs = Math.min(elapsedMs, maxCapMs);
  const ratePerHour = user.farm_level * FARM_RATE_PER_LEVEL_PER_HOUR;
  const earnedCredits = Math.floor((cappedMs / (3600 * 1000)) * ratePerHour);

  let nextLastCollectedAt = user.last_collected_at;
  if (elapsedMs >= maxCapMs) {
    nextLastCollectedAt = now.toISOString();
  } else if (earnedCredits > 0 && ratePerHour > 0) {
    const consumedMs = Math.floor((earnedCredits * 3600 * 1000) / ratePerHour);
    nextLastCollectedAt = new Date(lastCollectedMs + consumedMs).toISOString();
  }

  return {
    earnedCredits,
    nextLastCollectedAt,
    isVip,
    offlineCapHours,
  };
}

export function calculateEnergySync(
  user: Pick<UserRow, "energy" | "max_energy" | "last_energy_at">,
  now = new Date()
): {
  energy: number;
  regeneratedEnergy: number;
  nextLastEnergyAt: string;
} {
  if (user.energy >= user.max_energy) {
    return {
      energy: user.energy,
      regeneratedEnergy: 0,
      nextLastEnergyAt: now.toISOString(),
    };
  }

  if (!user.last_energy_at) {
    return {
      energy: user.energy,
      regeneratedEnergy: 0,
      nextLastEnergyAt: now.toISOString(),
    };
  }

  const lastEnergyMs = new Date(user.last_energy_at).getTime();
  const elapsedMs = Math.max(0, now.getTime() - lastEnergyMs);
  const regenCount = Math.floor(elapsedMs / ENERGY_REGEN_INTERVAL_MS);

  if (regenCount <= 0) {
    return {
      energy: user.energy,
      regeneratedEnergy: 0,
      nextLastEnergyAt: user.last_energy_at,
    };
  }

  const nextEnergy = Math.min(user.max_energy, user.energy + regenCount);
  const regeneratedEnergy = nextEnergy - user.energy;
  const nextLastEnergyAt =
    nextEnergy >= user.max_energy
      ? now.toISOString()
      : new Date(lastEnergyMs + regenCount * ENERGY_REGEN_INTERVAL_MS).toISOString();

  return {
    energy: nextEnergy,
    regeneratedEnergy,
    nextLastEnergyAt,
  };
}

export function parseStartParamReferrerId(
  startParam: string | null | undefined,
  currentUserId: number
): number | null {
  if (!startParam) return null;
  const normalized = startParam.trim().replace(/^ref_/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed === currentUserId) {
    return null;
  }
  return parsed;
}

export function rollGachaRarity(capsuleType: CapsuleType): ItemRarity {
  const roll = crypto.randomInt(0, 10000);

  if (capsuleType === "standard") {
    if (roll < 6500) return "common"; // 65.0%
    if (roll < 9000) return "rare"; // 25.0%
    if (roll < 9800) return "epic"; // 8.0%
    if (roll < 9980) return "legendary"; // 1.8%
    return "mythic"; // 0.2%
  }

  if (roll < 4500) return "rare"; // 45.0%
  if (roll < 8300) return "epic"; // 38.0%
  if (roll < 9700) return "legendary"; // 14.0%
  return "mythic"; // 3.0%
}

export function rollRandomSlot(): ItemSlot {
  return SLOTS[crypto.randomInt(0, SLOTS.length)];
}

export function generateItemName(slot: ItemSlot, rarity: ItemRarity): string {
  const pool = ITEM_NAMES[slot][rarity];
  return pool[crypto.randomInt(0, pool.length)];
}

export function calculateItemPowerBonus(farmLevel: number, rarity: ItemRarity): number {
  const multiplier = RARITY_MULTIPLIERS[rarity];
  return Math.floor((20 + farmLevel * 5) * multiplier);
}

export function computeBattleMultiplier(): number {
  // Uniformly sampled in [0.8500, 1.1500]
  return crypto.randomInt(8500, 11501) / 10000;
}

/**
 * Inserts an item into inventory, auto-equips it if no item is equipped in that slot
 * or if its power_bonus exceeds the currently equipped item, and recalculates
 * the user's total combat_power (`100 + sum of equipped power_bonus`).
 */
export async function grantItemWithAutoEquip(params: {
  userId: number;
  slot: ItemSlot;
  rarity: ItemRarity;
  name?: string;
  powerBonus: number;
}): Promise<{
  item: InventoryRow;
  autoEquipped: boolean;
  replacedItem: InventoryRow | null;
  combatPower: number;
  equippedInventory: InventoryRow[];
  inventory: InventoryRow[];
}> {
  const { userId, slot, rarity, powerBonus } = params;
  const itemName = params.name ?? generateItemName(slot, rarity);
  const nowIso = new Date().toISOString();

  const { data: currentEquippedList, error: equippedLookupError } = await supabaseAdmin
    .from("inventory")
    .select("*")
    .eq("user_id", userId)
    .eq("slot", slot)
    .eq("is_equipped", true);

  if (equippedLookupError) {
    throw new Error(`Failed to inspect equipped inventory: ${equippedLookupError.message}`);
  }

  const currentEquipped = (currentEquippedList ?? []) as InventoryRow[];
  const strongestCurrent =
    currentEquipped.length > 0
      ? currentEquipped.reduce((best, cur) =>
          cur.power_bonus > best.power_bonus ? cur : best
        )
      : null;

  const autoEquipped = !strongestCurrent || powerBonus > strongestCurrent.power_bonus;

  if (autoEquipped && currentEquipped.length > 0) {
    const { error: unequipError } = await supabaseAdmin
      .from("inventory")
      .update({ is_equipped: false })
      .eq("user_id", userId)
      .eq("slot", slot)
      .eq("is_equipped", true);

    if (unequipError) {
      throw new Error(`Failed to unequip previous item: ${unequipError.message}`);
    }
  }

  const newItemPayload: InventoryRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    slot,
    name: itemName,
    rarity,
    power_bonus: powerBonus,
    is_equipped: autoEquipped,
    created_at: nowIso,
  };

  const { data: insertedItem, error: insertError } = await supabaseAdmin
    .from("inventory")
    .insert(newItemPayload)
    .select("*")
    .single();

  if (insertError || !insertedItem) {
    throw new Error(`Failed to insert inventory item: ${insertError?.message ?? "Unknown"}`);
  }

  const { data: allInventoryData, error: allInventoryError } = await supabaseAdmin
    .from("inventory")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (allInventoryError) {
    throw new Error(`Failed to fetch updated inventory: ${allInventoryError.message}`);
  }

  const inventory = (allInventoryData ?? []) as InventoryRow[];
  const equippedInventory = inventory.filter((item) => item.is_equipped);
  const combatPower =
    BASE_COMBAT_POWER +
    equippedInventory.reduce((sum, item) => sum + item.power_bonus, 0);

  const { error: powerUpdateError } = await supabaseAdmin
    .from("users")
    .update({ combat_power: combatPower })
    .eq("telegram_id", userId);

  if (powerUpdateError) {
    throw new Error(`Failed to update combat power: ${powerUpdateError.message}`);
  }

  return {
    item: insertedItem as InventoryRow,
    autoEquipped,
    replacedItem: autoEquipped ? strongestCurrent : null,
    combatPower,
    equippedInventory,
    inventory,
  };
}
