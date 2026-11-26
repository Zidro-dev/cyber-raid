export const BASE_STARTING_CREDITS = 300;
export const BASE_STARTING_CORES = 10;
export const STARTING_ENERGY = 5;
export const STARTING_MAX_ENERGY = 5;
export const BASE_COMBAT_POWER = 100;
export const STARTING_FARM_LEVEL = 1;

export const REFERRAL_BONUS_CREDITS = 500;
export const REFERRAL_BONUS_CORES = 20;

export const FARM_RATE_PER_LEVEL_PER_HOUR = 120;
export const FREE_OFFLINE_CAP_HOURS = 4;
export const VIP_OFFLINE_CAP_HOURS = 24;
export const ENERGY_REGEN_INTERVAL_MS = 30 * 60 * 1000;

export const STANDARD_CAPSULE_COST_CREDITS = 300;
export const PREMIUM_CAPSULE_COST_CORES = 50;

export function getFarmUpgradeCost(farmLevel: number): number {
  return Math.floor(250 * Math.pow(1.15, farmLevel));
}
