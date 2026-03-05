import {
  Button,
  TokenIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  CoinInput,
  toast,
} from "@repo/ui";
import type { PoolDisplay, SlippageOption } from "@repo/web3";
import {
  SLIPPAGE_OPTIONS,
  useLiquidityQuote,
  getProportionalAmount,
  useAddLiquidityTransaction,
  useZapInQuote,
  useZapInTransaction,
  ConnectButton,
  tryParseUnits,
  formatCompactBalance,
  executeLiquidityFlow,
  liquidityFlowAtom,
  showLiquiditySuccessToast,
  useExplorerUrl,
  type LiquidityFlowStepDefinition,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useConfig,
  useChainId,
  useBlockNumber,
} from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
} from "react";
import { Info, AlertTriangle, ExternalLink } from "lucide-react";
import { getContractAddress } from "@mento-protocol/mento-sdk";
import {
  sanitizePercentInput,
  sanitizePercentOnBlur,
} from "@/lib/utils/percent-input";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

function formatLP(liquidity: bigint | undefined): string {
  if (!liquidity || liquidity === 0n) return "0.00";
  return Number(formatUnits(liquidity, 18)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function TokenAmountInput({
  token,
  balance,
  amount,
  onChange,
  onMax,
  insufficient,
}: {
  token: { address: string; symbol: string };
  balance: string;
  amount: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMax: () => void;
  insufficient: boolean;
}) {
  return (
    <div className="gap-2 flex flex-col">
      <div className="gap-2 flex items-center justify-between">
        <div className="gap-2 flex items-center">
          <TokenIcon
            token={{ address: token.address, symbol: token.symbol }}
            size={24}
            className="rounded-full"
          />
          <span className="font-medium">{token.symbol}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Balance:{" "}
          <span className="font-medium font-mono text-foreground/80">
            {formatCompactBalance(balance)}
          </span>{" "}
          <button
            className="font-medium cursor-pointer text-primary hover:underline"
            onClick={onMax}
          >
            MAX
          </button>
        </div>
      </div>
      <CoinInput
        value={amount}
        onChange={onChange}
        placeholder="0"
        className={`shadow-xs h-10 px-3 text-sm font-mono placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${insufficient ? "border-destructive" : ""}`}
      />
      {insufficient && (
        <p className="text-xs text-destructive">
          Insufficient {token.symbol} balance
        </p>
      )}
    </div>
  );
}

interface AddLiquidityFormProps {
  pool: PoolDisplay;
  onLiquidityUpdated?: () => void | Promise<void>;
  header?: React.ReactNode;
}

export function AddLiquidityForm({
  pool,
  onLiquidityUpdated,
  header,
}: AddLiquidityFormProps) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = useChainId();
  const { data: blockNumber } = useBlockNumber({
    watch: !!address,
    query: { enabled: !!address },
  });
  const explorerUrl = useExplorerUrl();
  const queryClient = useQueryClient();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const routerAddress = getContractAddress(chainId, "Router") as Address;

  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [lastEditedToken, setLastEditedToken] = useState<0 | 1>(0);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Single-token (zap) state
  const [zapTokenIn, setZapTokenIn] = useState<string>(pool.token0.address);
  const [zapAmount, setZapAmount] = useState("");

  // Track whether the auto-fill should be suppressed (during programmatic updates)
  const isAutoFilling = useRef(false);

  // Fetch token balances
  const { data: token0Balance, refetch: refetchToken0Balance } =
    useReadContract({
      address: pool.token0.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      query: {
        enabled: !!address,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const { data: token1Balance, refetch: refetchToken1Balance } =
    useReadContract({
      address: pool.token1.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      query: {
        enabled: !!address,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const formattedToken0Balance = token0Balance
    ? formatUnits(token0Balance, pool.token0.decimals)
    : "0";
  const formattedToken1Balance = token1Balance
    ? formatUnits(token1Balance, pool.token1.decimals)
    : "0";

  // Fetch token allowances for Router to avoid unnecessary approval steps.
  const { data: token0Allowance, refetch: refetchToken0Allowance } =
    useReadContract({
      address: pool.token0.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: address ? [address, routerAddress] : undefined,
      query: {
        enabled: !!address && !!routerAddress,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const { data: token1Allowance, refetch: refetchToken1Allowance } =
    useReadContract({
      address: pool.token1.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: address ? [address, routerAddress] : undefined,
      query: {
        enabled: !!address && !!routerAddress,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  useEffect(() => {
    if (!address || blockNumber === undefined) return;
    void refetchToken0Balance();
    void refetchToken1Balance();
    void refetchToken0Allowance();
    void refetchToken1Allowance();
  }, [
    address,
    blockNumber,
    refetchToken0Balance,
    refetchToken1Balance,
    refetchToken0Allowance,
    refetchToken1Allowance,
  ]);

  // === Balanced mode hooks ===

  const { data: quote, isFetching: isQuoting } = useLiquidityQuote({
    pool,
    token0Amount: mode === "balanced" ? token0Amount : "",
    token1Amount: mode === "balanced" ? token1Amount : "",
    lastEditedToken,
  });

  // Auto-fill proportional amount when quote returns
  useEffect(() => {
    if (mode !== "balanced" || !quote || isAutoFilling.current) return;
    const proportional = getProportionalAmount(quote, lastEditedToken, pool);
    if (!proportional) return;

    isAutoFilling.current = true;
    if (lastEditedToken === 0) {
      setToken1Amount(proportional);
    } else {
      setToken0Amount(proportional);
    }
    requestAnimationFrame(() => {
      isAutoFilling.current = false;
    });
  }, [quote, lastEditedToken, pool, mode]);

  const { buildTransaction, buildResult, isBuilding } =
    useAddLiquidityTransaction(pool);

  // Build transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (!address || !quote || quote.amountA === 0n || quote.amountB === 0n)
      return;
    buildTransaction(quote.amountA, quote.amountB, address, slippage);
  }, [quote, address, slippage, buildTransaction, mode]);

  // === Single-token (zap) hooks ===

  const zapToken =
    zapTokenIn === pool.token0.address ? pool.token0 : pool.token1;
  const zapTokenBalance =
    zapTokenIn === pool.token0.address ? token0Balance : token1Balance;
  const formattedZapBalance = zapTokenBalance
    ? formatUnits(zapTokenBalance, zapToken.decimals)
    : "0";

  const { data: zapQuote, isFetching: isZapQuoting } = useZapInQuote({
    pool,
    tokenIn: zapTokenIn,
    amountIn: mode === "single" ? zapAmount : "",
    slippage,
  });

  const {
    buildTransaction: buildZapTransaction,
    buildResult: zapBuildResult,
    buildError: zapBuildError,
    isBuilding: isZapBuilding,
  } = useZapInTransaction(pool);

  // Build zap transaction whenever the amount is valid for current state.
  useEffect(() => {
    if (mode !== "single" || !address || !zapAmount) return;
    const amountInWei = tryParseUnits(zapAmount, zapToken.decimals);
    if (!amountInWei || amountInWei <= 0n) return;
    buildZapTransaction(zapTokenIn as Address, amountInWei, address, slippage);
  }, [
    address,
    slippage,
    zapAmount,
    zapTokenIn,
    zapToken.decimals,
    mode,
    buildZapTransaction,
  ]);

  // === Input handlers ===

  const handleToken0Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isAutoFilling.current) return;
      setLastEditedToken(0);
      setToken0Amount(e.target.value);
    },
    [],
  );

  const handleToken1Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isAutoFilling.current) return;
      setLastEditedToken(1);
      setToken1Amount(e.target.value);
    },
    [],
  );

  const handleMax0 = useCallback(() => {
    setLastEditedToken(0);
    setToken0Amount(formattedToken0Balance);
  }, [formattedToken0Balance]);

  const handleMax1 = useCallback(() => {
    setLastEditedToken(1);
    setToken1Amount(formattedToken1Balance);
  }, [formattedToken1Balance]);

  // === Validation ===

  // Balanced mode
  const parsedToken0 = tryParseUnits(token0Amount, pool.token0.decimals);
  const parsedToken1 = tryParseUnits(token1Amount, pool.token1.decimals);
  const hasAmounts =
    parsedToken0 !== null &&
    parsedToken0 > 0n &&
    parsedToken1 !== null &&
    parsedToken1 > 0n;
  const insufficientToken0 =
    parsedToken0 !== null &&
    token0Balance !== undefined &&
    parsedToken0 > token0Balance;
  const insufficientToken1 =
    parsedToken1 !== null &&
    token1Balance !== undefined &&
    parsedToken1 > token1Balance;

  // Single-token mode
  const parsedZap = tryParseUnits(zapAmount, zapToken.decimals);
  const hasZapAmount = parsedZap !== null && parsedZap > 0n;
  const insufficientZap =
    parsedZap !== null &&
    zapTokenBalance !== undefined &&
    parsedZap > zapTokenBalance;

  // === Button state ===

  const getButtonState = () => {
    if (isSubmitting) return { text: "Confirm in wallet...", disabled: true };

    if (mode === "single") {
      if (!hasZapAmount) return { text: "Enter amount", disabled: true };
      if (insufficientZap)
        return {
          text: `Insufficient ${zapToken.symbol} balance`,
          disabled: true,
        };
      if (zapBuildError) return { text: "Unavailable", disabled: true };
      if (isZapBuilding || isZapQuoting)
        return { text: "Preparing...", disabled: true };
      if (!zapBuildResult) return { text: "Preparing...", disabled: true };
      return { text: "Add Liquidity", disabled: false };
    }

    // Balanced mode
    if (!hasAmounts) return { text: "Enter amount", disabled: true };
    if (insufficientToken0)
      return {
        text: `Insufficient ${pool.token0.symbol} balance`,
        disabled: true,
      };
    if (insufficientToken1)
      return {
        text: `Insufficient ${pool.token1.symbol} balance`,
        disabled: true,
      };
    if (isBuilding || isQuoting)
      return { text: "Preparing...", disabled: true };
    if (!buildResult) return { text: "Preparing...", disabled: true };

    return { text: "Add Liquidity", disabled: false };
  };

  const buttonState = getButtonState();

  const refreshLiquidityState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pools-list", chainId] }),
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.refetchQueries({
        queryKey: ["readContract"],
        type: "active",
      }),
      refetchToken0Balance(),
      refetchToken1Balance(),
      refetchToken0Allowance(),
      refetchToken1Allowance(),
      onLiquidityUpdated?.(),
    ]);
  }, [
    queryClient,
    chainId,
    refetchToken0Balance,
    refetchToken1Balance,
    refetchToken0Allowance,
    refetchToken1Allowance,
    onLiquidityUpdated,
  ]);

  const getLatestAllowances = useCallback(async () => {
    const [token0AllowanceResult, token1AllowanceResult] = await Promise.all([
      refetchToken0Allowance(),
      refetchToken1Allowance(),
    ]);

    return {
      token0: token0AllowanceResult.data ?? token0Allowance ?? 0n,
      token1: token1AllowanceResult.data ?? token1Allowance ?? 0n,
    };
  }, [
    refetchToken0Allowance,
    refetchToken1Allowance,
    token0Allowance,
    token1Allowance,
  ]);

  const handleAction = async () => {
    if (!address) return;
    setIsSubmitting(true);

    try {
      if (mode === "single" && zapBuildResult) {
        // --- Zap-in flow ---
        const capturedZapAmount = parsedZap;
        const capturedZapTokenIn = zapTokenIn;
        const capturedSlippage = slippage;

        if (!capturedZapAmount || capturedZapAmount <= 0n) {
          throw new Error("Invalid zap amount");
        }
        if (zapBuildError) {
          throw new Error(zapBuildError);
        }

        const steps: LiquidityFlowStepDefinition[] = [];

        const allowances = await getLatestAllowances();
        const currentZapAllowance =
          capturedZapTokenIn.toLowerCase() === pool.token0.address.toLowerCase()
            ? allowances.token0
            : allowances.token1;

        if (
          zapBuildResult.approval &&
          capturedZapAmount > currentZapAllowance
        ) {
          const approvalParams = zapBuildResult.approval.params;
          steps.push({
            id: "approve-token",
            label: `Approve ${zapToken.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "zap-in",
          label: "Add Liquidity",
          buildTx: async () => {
            const freshBuild = await buildZapTransaction(
              capturedZapTokenIn as Address,
              capturedZapAmount,
              address,
              capturedSlippage,
            );
            if (!freshBuild) {
              throw new Error(
                zapBuildError ||
                  "No viable zap-in route for this amount. Reduce amount or use balanced mode.",
              );
            }
            return freshBuild.zapIn.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Add Liquidity",
          steps,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: pool.token0.symbol,
              token1Symbol: pool.token1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setZapAmount("");
        }
      } else if (mode === "balanced" && quote && buildResult) {
        // --- Balanced add flow ---
        const capturedQuote = quote;
        const capturedSlippage = slippage;

        const steps: LiquidityFlowStepDefinition[] = [];
        const allowances = await getLatestAllowances();

        if (
          buildResult.approvalA &&
          capturedQuote.amountA > allowances.token0
        ) {
          const approvalParams = buildResult.approvalA.params;
          steps.push({
            id: "approve-a",
            label: `Approve ${pool.token0.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        if (
          buildResult.approvalB &&
          capturedQuote.amountB > allowances.token1
        ) {
          const approvalParams = buildResult.approvalB.params;
          steps.push({
            id: "approve-b",
            label: `Approve ${pool.token1.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "add-liquidity",
          label: "Add Liquidity",
          buildTx: async () => {
            const freshBuild = await buildTransaction(
              capturedQuote.amountA,
              capturedQuote.amountB,
              address,
              capturedSlippage,
            );
            if (!freshBuild) throw new Error("Failed to build transaction");
            return freshBuild.addLiquidity.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Add Liquidity",
          steps,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: pool.token0.symbol,
              token1Symbol: pool.token1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setToken0Amount("");
          setToken1Amount("");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/user\s+rejected/i.test(msg) && !/denied/i.test(msg)) {
        if (
          /no viable zap-in route/i.test(msg) ||
          /route unavailable/i.test(msg)
        ) {
          toast.error(
            "No viable zap-in route for this amount. Reduce amount or use balanced mode.",
          );
        } else {
          toast.error("Something went wrong. Please try again.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // === Preview calculations ===

  const estimatedLP = formatLP(quote?.liquidity);
  const zapEstimatedLP = formatLP(zapQuote?.estimatedMinLiquidity);

  const [customPct, setCustomPct] = useState("");

  const handleAmountPreset = (pctString: string) => {
    if (!zapTokenBalance) return;
    const pct = Number(pctString);
    if (pct >= 100) {
      setZapAmount(formattedZapBalance);
    } else {
      if (!zapTokenBalance || zapTokenBalance === 0n) return;
      const scaledPct = BigInt(Math.round(pct * 10));
      const fractionalBalance = (zapTokenBalance * scaledPct) / 1000n;
      setZapAmount(formatUnits(fractionalBalance, zapToken.decimals));
    }
  };

  const handleCustomPctChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!zapTokenBalance) return;
    const raw = sanitizePercentInput(e.target.value);
    setCustomPct(raw);
    const pct = parseFloat(raw);
    if (!isNaN(pct) && pct > 0) {
      if (pct >= 100) {
        setZapAmount(formattedZapBalance);
      } else {
        const fractionalBalance =
          (zapTokenBalance * BigInt(Math.round((pct / 100) * 1_000_000))) /
          1_000_000n;
        setZapAmount(formatUnits(fractionalBalance, zapToken.decimals));
      }
    }
  };

  const handleCustomPctBlur = () => {
    if (!zapTokenBalance) return;
    const corrected = sanitizePercentOnBlur(customPct);
    if (corrected === null) return;
    setCustomPct(corrected);
    const val = parseFloat(corrected);
    if (!isNaN(val) && val > 0) {
      if (val >= 100) {
        setZapAmount(formattedZapBalance);
      } else {
        const fractionalBalance =
          (zapTokenBalance * BigInt(Math.round((val / 100) * 1_000_000))) /
          1_000_000n;
        setZapAmount(formatUnits(fractionalBalance, zapToken.decimals));
      }
    }
  };

  return (
    <div className="md:flex-row flex flex-col">
      {/* Left Column — Inputs */}
      <div className="min-w-0 md:border-r flex-1 border-border">
        {header}
        <div className="gap-6 p-6 flex flex-col">
          {/* Deposit mode toggle */}
          <div className="gap-2 grid grid-cols-2">
            <button
              onClick={() => setMode("balanced")}
              className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
                mode === "balanced"
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-transparent text-muted-foreground"
              }`}
            >
              Balanced (2 tokens)
            </button>
            <button
              onClick={() => setMode("single")}
              className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
                mode === "single"
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-transparent text-muted-foreground"
              }`}
            >
              Single token (auto-swap)
            </button>
          </div>

          {mode === "balanced" ? (
            <>
              <TokenAmountInput
                token={pool.token0}
                balance={formattedToken0Balance}
                amount={token0Amount}
                onChange={handleToken0Change}
                onMax={handleMax0}
                insufficient={insufficientToken0}
              />
              <TokenAmountInput
                token={pool.token1}
                balance={formattedToken1Balance}
                amount={token1Amount}
                onChange={handleToken1Change}
                onMax={handleMax1}
                insufficient={insufficientToken1}
              />

              {/* Info text */}
              <p className="text-xs text-muted-foreground">
                Amounts are based on the current pool ratio.
              </p>
            </>
          ) : (
            <>
              {/* How it works */}
              <div className="gap-2 p-3 flex flex-col rounded-md border border-border bg-muted/30">
                <div className="gap-1.5 text-sm font-medium flex items-center">
                  <Info className="h-4 w-4" />
                  How it works
                </div>
                <ul className="gap-1 ml-5 text-xs flex list-disc flex-col text-muted-foreground">
                  <li>
                    A portion of your input will be swapped to balance the pool
                  </li>
                  <li>Both tokens will then be added as liquidity</li>
                  <li>Swap uses current pool price and fees</li>
                </ul>
              </div>

              {/* Token selector + input */}
              <div className="gap-2 flex flex-col">
                <div className="gap-2 flex items-center justify-between">
                  <Select
                    value={zapTokenIn}
                    onValueChange={(v) => {
                      setZapTokenIn(v);
                      setZapAmount("");
                    }}
                  >
                    <SelectTrigger className="gap-2 px-3 py-2 font-medium w-auto border border-border bg-transparent shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={pool.token0.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: pool.token0.address,
                              symbol: pool.token0.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {pool.token0.symbol}
                        </div>
                      </SelectItem>
                      <SelectItem
                        value={pool.token1.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: pool.token1.address,
                              symbol: pool.token1.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {pool.token1.symbol}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-sm text-muted-foreground">
                    Balance:{" "}
                    <span className="font-medium font-mono text-foreground/80">
                      {formatCompactBalance(formattedZapBalance)}
                    </span>{" "}
                    <button
                      className="font-medium cursor-pointer text-primary hover:underline"
                      onClick={() => setZapAmount(formattedZapBalance)}
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <CoinInput
                  value={zapAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setZapAmount(e.target.value)
                  }
                  placeholder="0"
                  className={`shadow-xs h-10 px-3 text-sm font-mono placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${insufficientZap ? "border-destructive" : ""}`}
                />
                {insufficientZap && (
                  <p className="text-xs text-destructive">
                    Insufficient {zapToken.symbol} balance
                  </p>
                )}
              </div>

              {/* Amount presets */}
              <div className="gap-2 grid grid-cols-3">
                <button
                  onClick={() => handleAmountPreset("0.1")}
                  className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
                >
                  0.1%
                </button>
                <button
                  onClick={() => handleAmountPreset("1")}
                  className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
                >
                  1%
                </button>
                <div className="py-1.5 flex items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={6}
                    placeholder="Custom %"
                    value={customPct}
                    className="min-w-0 text-xs font-medium w-full shrink bg-transparent text-center outline-none placeholder:text-muted-foreground"
                    onChange={handleCustomPctChange}
                    onBlur={handleCustomPctBlur}
                    style={
                      customPct
                        ? { width: `${customPct.length}ch`, flexShrink: 0 }
                        : undefined
                    }
                  />
                  {customPct && (
                    <span className="text-xs font-medium shrink-0">%</span>
                  )}
                </div>
              </div>

              {/* Warning */}
              <div className="gap-2 p-3 border-yellow-500/20 bg-yellow-50/50 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400 flex items-start rounded-md border">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Single-token liquidity uses an automatic swap and may result
                  in slightly higher fees than providing both tokens.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Column — Summary & Action */}
      <div className="md:w-80 p-6 flex shrink-0 flex-col">
        <h3 className="text-sm font-semibold mb-4 text-foreground">Summary</h3>

        {/* Summary metrics */}
        <div className="space-y-3 flex-1">
          <div className="text-sm flex justify-between">
            <span className="text-muted-foreground">Est. LP tokens</span>
            <span className="font-medium font-mono">
              {mode === "balanced" ? estimatedLP : zapEstimatedLP} LP
            </span>
          </div>
          <div className="text-sm flex justify-between">
            <span className="text-muted-foreground">LP fee</span>
            <span className="font-medium font-mono">
              {pool.fees.lp.toFixed(2)}%
            </span>
          </div>
          <div className="text-sm flex justify-between">
            <span className="text-muted-foreground">Protocol fee</span>
            <span className="font-medium font-mono">
              {pool.fees.protocol.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Slippage Tolerance */}
        <div className="pt-4 mt-4 mb-4 border-t border-border">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">
              Slippage tolerance
            </label>
            <Select
              value={String(slippage)}
              onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
            >
              <SelectTrigger className="h-7 text-xs w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLIPPAGE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Used to set minimum amounts for zap swaps and liquidity mint/burn.
          </p>
        </div>

        {/* CTA */}
        {!address ? (
          <ConnectButton size="lg" text="Connect Wallet" fullWidth />
        ) : (
          <>
            <Button
              size="lg"
              className="w-full"
              disabled={buttonState.disabled}
              onClick={handleAction}
            >
              {buttonState.text}
            </Button>
            {mode === "single" && zapBuildError && (
              <p className="text-xs leading-5 mt-2 text-center text-muted-foreground">
                {zapBuildError}
              </p>
            )}
          </>
        )}

        {/* Footer links */}
        <div className="mt-3 flex items-center justify-between">
          <a
            href={`${explorerUrl}/address/${pool.poolAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            View on explorer
          </a>
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/fixed-price-market-makers-fpmms"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            FPMM mechanics
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
