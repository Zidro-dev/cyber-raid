import type { ProductId } from "@/types/game";

export interface ShopProduct {
  id: ProductId;
  title: string;
  description: string;
  starsAmount: number;
  badge: string;
  highlights: string[];
}

export const PRODUCTS: Record<ProductId, ShopProduct> = {
  starter_pack: {
    id: "starter_pack",
    title: "Starter Raid Pack",
    description: "Instant +500 Quantum Cores and 1 guaranteed Epic Weapon.",
    starsAmount: 50,
    badge: "BEST VALUE",
    highlights: ["+500 Cores", "1x Guaranteed Epic Weapon (auto-equips if stronger)"],
  },
  vip_30d: {
    id: "vip_30d",
    title: "VIP Neural Link (30 Days)",
    description: "Extends offline idle credit storage from 4 hours to 24 hours for 30 days.",
    starsAmount: 250,
    badge: "24H IDLE CAP",
    highlights: ["24h Offline Farm Cap", "Extends existing VIP by +30 days"],
  },
  shield_24h: {
    id: "shield_24h",
    title: "Aegis Energy Shield (24h)",
    description: "Protects your base from PvP raids for 24 hours.",
    starsAmount: 40,
    badge: "DEFENSE",
    highlights: ["24h PvP Raid Immunity", "Stacks onto active shield"],
  },
  premium_10x: {
    id: "premium_10x",
    title: "Premium Core Vault (10x)",
    description: "Grants +600 Quantum Cores for 10+ Premium Gacha Capsules.",
    starsAmount: 500,
    badge: "WHALE VAULT",
    highlights: ["+600 Cores", "Enough for 12 Premium Capsules"],
  },
};

export const PRODUCT_LIST: ShopProduct[] = Object.values(PRODUCTS);

export function getProductById(productId: string): ShopProduct | null {
  if (productId in PRODUCTS) {
    return PRODUCTS[productId as ProductId];
  }
  return null;
}
