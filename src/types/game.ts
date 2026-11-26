export type ItemSlot = "weapon" | "armor" | "drone";

export type ItemRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export type CapsuleType = "standard" | "premium";

export type ProductId =
  | "starter_pack"
  | "vip_30d"
  | "shield_24h"
  | "premium_10x";

export interface UserRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  credits: number;
  cores: number;
  energy: number;
  max_energy: number;
  combat_power: number;
  farm_level: number;
  vip_until: string | null;
  shield_until: string | null;
  last_collected_at: string;
  last_energy_at: string;
  referred_by: number | null;
  created_at: string;
}

export interface InventoryRow {
  id: string;
  user_id: number;
  slot: ItemSlot;
  name: string;
  rarity: ItemRarity;
  power_bonus: number;
  is_equipped: boolean;
  created_at: string;
}

export interface RaidRow {
  id: string;
  attacker_id: number;
  defender_id: number;
  attacker_won: boolean;
  stolen_credits: number;
  is_revenge: boolean;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  user_id: number;
  telegram_charge_id: string;
  product_id: string;
  stars_amount: number;
  status: string;
  created_at: string;
}

export interface SyncResult {
  isNewUser: boolean;
  earnedCredits: number;
  regeneratedEnergy: number;
  referralApplied: boolean;
  isVip: boolean;
  offlineCapHours: number;
}

export interface SyncResponse {
  user: UserRow;
  equippedInventory: InventoryRow[];
  inventory: InventoryRow[];
  recentRaids: RaidRow[];
  syncResult: SyncResult;
}

export interface FarmUpgradeResponse {
  user: UserRow;
  upgradeCost: number;
  nextUpgradeCost: number;
}

export interface GachaOpenResponse {
  item: InventoryRow;
  autoEquipped: boolean;
  replacedItem: InventoryRow | null;
  capsuleType: CapsuleType;
  cost: {
    currency: "credits" | "cores";
    amount: number;
  };
  user: UserRow;
  equippedInventory: InventoryRow[];
  inventory: InventoryRow[];
}

export interface PvpRaidResponse {
  raid: RaidRow;
  attackerWon: boolean;
  stolenCredits: number;
  attackerPower: number;
  defenderPower: number;
  attackerRoll: number;
  defenderRoll: number;
  defender: {
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    combat_power: number;
  };
  user: UserRow;
}
