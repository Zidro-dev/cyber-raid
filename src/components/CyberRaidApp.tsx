"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryCharging,
  Cpu,
  Crosshair,
  PackageOpen,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  Swords,
  TrendingUp,
  UserPlus,
  Zap,
} from "lucide-react";
import {
  FARM_RATE_PER_LEVEL_PER_HOUR,
  FREE_OFFLINE_CAP_HOURS,
  getFarmUpgradeCost,
  PREMIUM_CAPSULE_COST_CORES,
  STANDARD_CAPSULE_COST_CREDITS,
  VIP_OFFLINE_CAP_HOURS,
} from "@/lib/game-constants";
import { PRODUCT_LIST } from "@/lib/products";
import type {
  CapsuleType,
  FarmUpgradeResponse,
  GachaOpenResponse,
  InventoryRow,
  ItemRarity,
  ProductId,
  PvpRaidResponse,
  RaidRow,
  SyncResponse,
  SyncResult,
  UserRow,
} from "@/types/game";

type TabId = "base" | "gacha" | "pvp" | "shop";

type TelegramWebApp = typeof import("@twa-dev/sdk").default;

const RARITY_STYLES: Record<ItemRarity, string> = {
  common: "border-slate-600/70 bg-slate-900/70 text-slate-300",
  rare: "border-cyan-500/60 bg-cyan-950/40 text-cyan-300",
  epic: "border-fuchsia-500/60 bg-fuchsia-950/40 text-fuchsia-300",
  legendary: "border-amber-400/70 bg-amber-950/40 text-amber-300",
  mythic: "border-rose-500/80 bg-rose-950/50 text-rose-300",
};

function formatRemaining(isoTimestamp: string | null, nowMs: number): string | null {
  if (!isoTimestamp) return null;
  const diffMs = new Date(isoTimestamp).getTime() - nowMs;
  if (diffMs <= 0) return null;
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function CyberRaidApp() {
  const [activeTab, setActiveTab] = useState<TabId>("base");
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [initData, setInitData] = useState<string>("");
  const [manualInitData, setManualInitData] = useState<string>("");
  const [showManualAuth, setShowManualAuth] = useState<boolean>(false);

  const [user, setUser] = useState<UserRow | null>(null);
  const [equippedInventory, setEquippedInventory] = useState<InventoryRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [recentRaids, setRecentRaids] = useState<RaidRow[]>([]);
  const [lastSyncInfo, setLastSyncInfo] = useState<SyncResult | null>(null);

  const [gachaDrop, setGachaDrop] = useState<GachaOpenResponse | null>(null);
  const [raidOutcome, setRaidOutcome] = useState<PvpRaidResponse | null>(null);

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  const apiRequest = useCallback(
    async <T,>(path: string, authInitData: string, body?: unknown): Promise<T> => {
      if (!authInitData) {
        throw new Error(
          "Missing Telegram initData. Launch inside Telegram Mini App or enter signed initData below."
        );
      }

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${authInitData}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const data = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      return data;
    },
    []
  );

  const syncUser = useCallback(
    async (authInitData: string) => {
      setLoadingAction("sync");
      setBanner(null);
      try {
        const data = await apiRequest<SyncResponse>("/api/auth/sync", authInitData);
        setUser(data.user);
        setEquippedInventory(data.equippedInventory);
        setInventory(data.inventory);
        setRecentRaids(data.recentRaids);
        setLastSyncInfo(data.syncResult);

        if (data.syncResult.isNewUser) {
          setBanner({
            type: "success",
            text: data.syncResult.referralApplied
              ? "Welcome to CYBER RAID! Referral bonus +500 Credits & +20 Cores activated."
              : "Welcome to CYBER RAID! Neural base initialized.",
          });
        } else if (data.syncResult.earnedCredits > 0 || data.syncResult.regeneratedEnergy > 0) {
          setBanner({
            type: "success",
            text: `Synced +${data.syncResult.earnedCredits.toLocaleString()} Credits & +${data.syncResult.regeneratedEnergy} Energy.`,
          });
        }
      } catch (err) {
        setBanner({
          type: "error",
          text: err instanceof Error ? err.message : "Failed to sync account.",
        });
      } finally {
        setLoadingAction(null);
      }
    },
    [apiRequest]
  );

  useEffect(() => {
    let cancelled = false;

    async function initTelegramSdk() {
      try {
        const sdk = (await import("@twa-dev/sdk")).default;
        if (cancelled) return;

        sdk.ready();
        sdk.expand();
        try {
          sdk.setHeaderColor("#05070e");
          sdk.setBackgroundColor("#05070e");
        } catch {
          // Ignore on older Telegram clients
        }

        setWebApp(sdk);

        if (sdk.initData) {
          setInitData(sdk.initData);
          await syncUser(sdk.initData);
        } else {
          setShowManualAuth(true);
        }
      } catch {
        if (!cancelled) {
          setShowManualAuth(true);
        }
      }
    }

    initTelegramSdk();
    return () => {
      cancelled = true;
    };
  }, [syncUser]);

  const handleFarmUpgrade = async () => {
    setLoadingAction("upgrade");
    setBanner(null);
    try {
      const data = await apiRequest<FarmUpgradeResponse>("/api/farm/upgrade", initData);
      setUser(data.user);
      setBanner({
        type: "success",
        text: `Farm upgraded to Level ${data.user.farm_level} (-${data.upgradeCost.toLocaleString()} Credits)!`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Farm upgrade failed.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGachaOpen = async (capsuleType: CapsuleType) => {
    setLoadingAction(`gacha:${capsuleType}`);
    setBanner(null);
    try {
      const data = await apiRequest<GachaOpenResponse>("/api/gacha/open", initData, {
        capsuleType,
      });
      setUser(data.user);
      setEquippedInventory(data.equippedInventory);
      setInventory(data.inventory);
      setGachaDrop(data);
      setBanner({
        type: "success",
        text: `Pulled ${data.item.rarity.toUpperCase()} ${data.item.name} (+${data.item.power_bonus} PWR)${
          data.autoEquipped ? " — Auto-Equipped!" : ""
        }`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to open capsule.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRaid = async (revengeRaidId?: string) => {
    setLoadingAction(revengeRaidId ? `revenge:${revengeRaidId}` : "raid");
    setBanner(null);
    try {
      const data = await apiRequest<PvpRaidResponse>(
        "/api/pvp/raid",
        initData,
        revengeRaidId ? { revengeRaidId } : {}
      );
      setUser(data.user);
      setRaidOutcome(data);
      setRecentRaids((prev) => [data.raid, ...prev.slice(0, 9)]);
      setBanner({
        type: data.attackerWon ? "success" : "info",
        text: data.attackerWon
          ? `VICTORY! Stole ${data.stolenCredits.toLocaleString()} Credits from ${
              data.defender.username
                ? `@${data.defender.username}`
                : data.defender.first_name ?? `#${data.defender.telegram_id}`
            }!`
          : `DEFEAT against ${
              data.defender.username
                ? `@${data.defender.username}`
                : data.defender.first_name ?? `#${data.defender.telegram_id}`
            }. Upgrade gear & try again!`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Raid failed.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePurchase = async (productId: ProductId) => {
    setLoadingAction(`buy:${productId}`);
    setBanner(null);
    try {
      const { invoiceLink } = await apiRequest<{ invoiceLink: string }>(
        "/api/payments/create-invoice",
        initData,
        { productId }
      );

      if (webApp && typeof webApp.openInvoice === "function") {
        webApp.openInvoice(invoiceLink, (status) => {
          if (status === "paid") {
            setBanner({
              type: "success",
              text: "Telegram Stars payment completed! Syncing rewards...",
            });
            setTimeout(() => {
              void syncUser(initData);
            }, 1200);
          } else if (status === "cancelled") {
            setBanner({ type: "info", text: "Invoice cancelled." });
          } else {
            setBanner({ type: "error", text: `Invoice status: ${status}` });
          }
        });
      } else {
        setBanner({
          type: "info",
          text: `Invoice created: ${invoiceLink}`,
        });
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to create Stars invoice.",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const vipRemaining = useMemo(
    () => formatRemaining(user?.vip_until ?? null, nowMs),
    [user?.vip_until, nowMs]
  );
  const shieldRemaining = useMemo(
    () => formatRemaining(user?.shield_until ?? null, nowMs),
    [user?.shield_until, nowMs]
  );

  const estimatedPendingCredits = useMemo(() => {
    if (!user) return 0;
    const capHours = vipRemaining ? VIP_OFFLINE_CAP_HOURS : FREE_OFFLINE_CAP_HOURS;
    const elapsedMs = Math.max(0, nowMs - new Date(user.last_collected_at).getTime());
    const cappedMs = Math.min(elapsedMs, capHours * 3600 * 1000);
    return Math.floor((cappedMs / (3600 * 1000)) * user.farm_level * FARM_RATE_PER_LEVEL_PER_HOUR);
  }, [user, vipRemaining, nowMs]);

  const upgradeCost = user ? getFarmUpgradeCost(user.farm_level) : 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 pt-4 pb-24">
      {/* Header */}
      <header className="mb-4 rounded-2xl border border-cyan-500/30 bg-[#0b1020]/90 p-4 shadow-[0_0_30px_rgba(34,211,238,0.1)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" />
              <h1 className="text-lg font-bold tracking-wider text-white">
                CYBER <span className="text-cyan-400">RAID</span>
              </h1>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {user
                ? `${user.first_name ?? "Runner"}${user.username ? ` (@${user.username})` : ""} · ID ${user.telegram_id}`
                : initData
                  ? "Connecting neural link..."
                  : "Awaiting Telegram WebApp session"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void syncUser(initData)}
            disabled={!initData || loadingAction !== null}
            className="flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingAction === "sync" ? "animate-spin" : ""}`} />
            Sync
          </button>
        </div>

        {/* Resource HUD */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Credits</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-emerald-400">
              {user ? user.credits.toLocaleString() : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Cores</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-fuchsia-400">
              {user ? user.cores.toLocaleString() : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Energy</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-amber-300">
              {user ? `${user.energy}/${user.max_energy}` : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Power</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-cyan-300">
              {user ? user.combat_power.toLocaleString() : "—"}
            </div>
          </div>
        </div>

        {/* Active Status Badges */}
        {user && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${
                vipRemaining
                  ? "border-amber-400/50 bg-amber-500/15 text-amber-300"
                  : "border-slate-700 bg-slate-900/60 text-slate-400"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              {vipRemaining ? `VIP Active (${vipRemaining})` : "Free Tier (4h Cap)"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${
                shieldRemaining
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-300"
                  : "border-slate-700 bg-slate-900/60 text-slate-400"
              }`}
            >
              <Shield className="h-3 w-3" />
              {shieldRemaining ? `Shielded (${shieldRemaining})` : "Unshielded"}
            </span>
          </div>
        )}
      </header>

      {/* Non-Telegram Fallback / Manual Verification Auth Input */}
      {showManualAuth && !user && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4 text-xs">
          <div className="font-semibold text-amber-300">
            Browser Preview Mode — Telegram initData Not Detected
          </div>
          <p className="mt-1 text-slate-300">
            Open this app via your Telegram Bot Mini App for automatic HMAC authentication, or paste
            a signed <code className="text-cyan-300">initData</code> query string to test:
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              type="text"
              value={manualInitData}
              onChange={(e) => setManualInitData(e.target.value)}
              placeholder="query_id=...&user=...&auth_date=...&hash=..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setInitData(manualInitData.trim());
                void syncUser(manualInitData.trim());
              }}
              disabled={!manualInitData.trim() || loadingAction !== null}
              className="rounded-lg bg-cyan-500 px-3 py-2 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-40"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {/* Status Banner */}
      {banner && (
        <div
          className={`mb-4 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            banner.type === "error"
              ? "border-rose-500/50 bg-rose-950/40 text-rose-200"
              : banner.type === "success"
                ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-200"
                : "border-cyan-500/40 bg-cyan-950/30 text-cyan-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Tab Content */}
      <main className="flex-1 space-y-4">
        {activeTab === "base" && (
          <>
            <section className="rounded-2xl border border-slate-800 bg-[#0b1020]/90 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-cyan-300">
                    <Cpu className="h-4 w-4" />
                    Credit Generator · Lv.{user?.farm_level ?? 1}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Output:{" "}
                    <span className="font-mono text-emerald-300">
                      {((user?.farm_level ?? 1) * FARM_RATE_PER_LEVEL_PER_HOUR).toLocaleString()}
                    </span>{" "}
                    Credits/hr · Max Offline Cap:{" "}
                    <span className="text-slate-200">
                      {vipRemaining ? `${VIP_OFFLINE_CAP_HOURS}h (VIP)` : `${FREE_OFFLINE_CAP_HOURS}h`}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase text-slate-400">Pending Idle</div>
                  <div className="font-mono text-base font-bold text-emerald-400">
                    +{estimatedPendingCredits.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void syncUser(initData)}
                  disabled={!user || loadingAction !== null}
                  className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-3 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  <BatteryCharging className="h-4 w-4" />
                  Collect & Sync
                </button>

                <button
                  type="button"
                  onClick={() => void handleFarmUpgrade()}
                  disabled={!user || loadingAction !== null || user.credits < upgradeCost}
                  className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-40"
                >
                  <TrendingUp className="h-4 w-4" />
                  Upgrade ({upgradeCost.toLocaleString()} Cr)
                </button>
              </div>

              {lastSyncInfo && (
                <div className="mt-3 text-[11px] text-slate-400">
                  Last server sync: +{lastSyncInfo.earnedCredits.toLocaleString()} credits, +
                  {lastSyncInfo.regeneratedEnergy} energy.
                </div>
              )}
            </section>

            {/* Equipped Loadout */}
            <section className="rounded-2xl border border-slate-800 bg-[#0b1020]/90 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Equipped Cyberware ({equippedInventory.length}/3 Slots)
              </h2>
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {(["weapon", "armor", "drone"] as const).map((slot) => {
                  const item = equippedInventory.find((i) => i.slot === slot);
                  return (
                    <div
                      key={slot}
                      className={`rounded-xl border p-3 ${
                        item
                          ? RARITY_STYLES[item.rarity]
                          : "border-slate-800 bg-slate-950/60 text-slate-500"
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">
                        {slot}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold text-white">
                        {item ? item.name : "Empty"}
                      </div>
                      <div className="mt-1.5 font-mono text-[11px]">
                        {item ? `+${item.power_bonus} PWR` : "+0 PWR"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {inventory.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-400">
                    Inventory Vault ({inventory.length})
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {inventory.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${RARITY_STYLES[item.rarity]}`}
                      >
                        <div>
                          <span className="font-semibold text-white">{item.name}</span>{" "}
                          <span className="text-[10px] uppercase opacity-80">
                            [{item.rarity} · {item.slot}]
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <span>+{item.power_bonus}</span>
                          {item.is_equipped && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                              EQP
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Referral Info */}
            {user && (
              <section className="rounded-2xl border border-slate-800 bg-[#0b1020]/90 p-4 text-xs">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-fuchsia-300">
                  <UserPlus className="h-4 w-4" />
                  Syndicate Referral Protocol
                </div>
                <p className="mt-1 text-slate-400">
                  Invite runners with <code className="text-cyan-300">startapp={user.telegram_id}</code>{" "}
                  to grant both of you +500 Credits &amp; +20 Cores.
                  {user.referred_by ? ` (Recruited by #${user.referred_by})` : ""}
                </p>
              </section>
            )}
          </>
        )}

        {activeTab === "gacha" && (
          <>
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-cyan-500/40 bg-[#0b1020]/90 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-cyan-300">Standard Capsule</h2>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-300">
                    {STANDARD_CAPSULE_COST_CREDITS} Credits
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Common 65% · Rare 25% · Epic 8% · Legendary 1.8% · Mythic 0.2%
                </p>
                <button
                  type="button"
                  onClick={() => void handleGachaOpen("standard")}
                  disabled={
                    !user ||
                    loadingAction !== null ||
                    user.credits < STANDARD_CAPSULE_COST_CREDITS
                  }
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-40"
                >
                  <PackageOpen className="h-4 w-4" />
                  {loadingAction === "gacha:standard" ? "Decrypting..." : "Open Standard"}
                </button>
              </div>

              <div className="rounded-2xl border border-fuchsia-500/50 bg-[#0b1020]/90 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-fuchsia-300">Premium Capsule</h2>
                  <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-fuchsia-300">
                    {PREMIUM_CAPSULE_COST_CORES} Cores
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Rare 45% · Epic 38% · Legendary 14% · Mythic 3%
                </p>
                <button
                  type="button"
                  onClick={() => void handleGachaOpen("premium")}
                  disabled={
                    !user || loadingAction !== null || user.cores < PREMIUM_CAPSULE_COST_CORES
                  }
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  {loadingAction === "gacha:premium" ? "Decrypting..." : "Open Premium"}
                </button>
              </div>
            </section>

            {gachaDrop && (
              <section
                className={`rounded-2xl border p-4 ${RARITY_STYLES[gachaDrop.item.rarity]}`}
              >
                <div className="text-[11px] font-bold uppercase tracking-widest opacity-80">
                  Latest Drop · {gachaDrop.capsuleType.toUpperCase()}
                </div>
                <div className="mt-1 text-lg font-bold text-white">{gachaDrop.item.name}</div>
                <div className="mt-1 flex flex-wrap gap-3 font-mono text-xs">
                  <span className="uppercase">{gachaDrop.item.rarity}</span>
                  <span>Slot: {gachaDrop.item.slot.toUpperCase()}</span>
                  <span>Power: +{gachaDrop.item.power_bonus}</span>
                  <span>Total PWR: {gachaDrop.user.combat_power}</span>
                </div>
                <div className="mt-2 text-xs text-slate-200">
                  {gachaDrop.autoEquipped
                    ? gachaDrop.replacedItem
                      ? `Auto-equipped (replaced ${gachaDrop.replacedItem.name} +${gachaDrop.replacedItem.power_bonus}).`
                      : "Auto-equipped into empty slot!"
                    : "Stored in vault (current equipped item is stronger or equal)."}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "pvp" && (
          <>
            <section className="rounded-2xl border border-rose-500/40 bg-[#0b1020]/90 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-rose-300">
                    <Crosshair className="h-4 w-4" />
                    Asynchronous Sector Raid
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Matches unshielded rivals within ±30% Combat Power. Win to steal 15% Credits
                    (min 50).
                  </p>
                </div>
                <div className="text-right font-mono text-xs text-amber-300">
                  {user ? `${user.energy}/${user.max_energy} Energy` : "—"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleRaid()}
                disabled={!user || loadingAction !== null || user.energy < 1}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-rose-400 disabled:opacity-40"
              >
                <Swords className="h-4 w-4" />
                {loadingAction === "raid" ? "Infiltrating..." : "Launch PvP Raid (1 Energy)"}
              </button>
            </section>

            {raidOutcome && (
              <section
                className={`rounded-2xl border p-4 ${
                  raidOutcome.attackerWon
                    ? "border-emerald-500/50 bg-emerald-950/30"
                    : "border-rose-500/50 bg-rose-950/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">
                    {raidOutcome.attackerWon ? "BREACH SUCCESSFUL" : "DEFENSE HELD"}
                  </span>
                  <span className="font-mono text-xs text-emerald-300">
                    {raidOutcome.attackerWon
                      ? `+${raidOutcome.stolenCredits.toLocaleString()} Credits`
                      : "0 Credits"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-950/70 p-2.5">
                    <div className="text-slate-400">You</div>
                    <div className="font-mono font-bold text-cyan-300">
                      Roll {raidOutcome.attackerRoll} (Base {raidOutcome.attackerPower})
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 p-2.5">
                    <div className="text-slate-400">
                      {raidOutcome.defender.username
                        ? `@${raidOutcome.defender.username}`
                        : raidOutcome.defender.first_name ?? `Rival #${raidOutcome.defender.telegram_id}`}
                    </div>
                    <div className="font-mono font-bold text-rose-300">
                      Roll {raidOutcome.defenderRoll} (Base {raidOutcome.defenderPower})
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-800 bg-[#0b1020]/90 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Recent Combat Log
              </h3>
              {recentRaids.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No raids logged yet.</p>
              ) : (
                <div className="mt-2.5 space-y-2">
                  {recentRaids.map((raid) => {
                    const wasAttacker = user ? raid.attacker_id === user.telegram_id : true;
                    const canRevenge = !wasAttacker && raid.attacker_won;
                    return (
                      <div
                        key={raid.id}
                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">
                            {wasAttacker
                              ? raid.attacker_won
                                ? `Raided #${raid.defender_id}`
                                : `Failed vs #${raid.defender_id}`
                              : raid.attacker_won
                                ? `Raided by #${raid.attacker_id}`
                                : `Defended vs #${raid.attacker_id}`}
                            {raid.is_revenge ? " · REVENGE" : ""}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {raid.attacker_won
                              ? `${wasAttacker ? "+" : "-"}${raid.stolen_credits.toLocaleString()} Credits`
                              : "No loot"}
                          </div>
                        </div>

                        {canRevenge && (
                          <button
                            type="button"
                            onClick={() => void handleRaid(raid.id)}
                            disabled={!user || loadingAction !== null || user.energy < 1}
                            className="rounded-lg border border-rose-500/50 bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-40"
                          >
                            Revenge
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "shop" && (
          <section className="grid gap-3 sm:grid-cols-2">
            {PRODUCT_LIST.map((product) => (
              <div
                key={product.id}
                className="flex flex-col justify-between rounded-2xl border border-amber-500/35 bg-[#0b1020]/90 p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      {product.badge}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-300">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      {product.starsAmount} Stars
                    </span>
                  </div>
                  <h2 className="mt-2.5 text-sm font-bold text-white">{product.title}</h2>
                  <p className="mt-1 text-xs text-slate-400">{product.description}</p>
                  <ul className="mt-2.5 space-y-1 text-[11px] text-cyan-300">
                    {product.highlights.map((hl) => (
                      <li key={hl}>• {hl}</li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => void handlePurchase(product.id)}
                  disabled={!user || loadingAction !== null}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
                >
                  <Star className="h-3.5 w-3.5 fill-slate-950" />
                  {loadingAction === `buy:${product.id}`
                    ? "Creating Invoice..."
                    : `Buy (${product.starsAmount} XTR)`}
                </button>
              </div>
            ))}
          </section>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed right-0 bottom-0 left-0 border-t border-slate-800 bg-[#05070e]/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1 px-3 py-2">
          {[
            { id: "base" as const, label: "Base", icon: Cpu },
            { id: "gacha" as const, label: "Capsules", icon: PackageOpen },
            { id: "pvp" as const, label: "PvP Raid", icon: Swords },
            { id: "shop" as const, label: "Stars", icon: Star },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition ${
                  active
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
