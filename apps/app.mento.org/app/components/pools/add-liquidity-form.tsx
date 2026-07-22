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
} from "@mento-protocol/ui";
import type {
  LiquidityQuoteResult,
  PoolDisplay,
  SlippageOption,
} from "@repo/web3";
import {
  SLIPPAGE_OPTIONS,
  useLiquidityQuote,
  useAddLiquidityTransaction,
  useZapInQuote,
  useZapInTransaction,
  ConnectButton,
  tryParseUnits,
  formatCompactBalance,
  executeLiquidityFlow,
  liquidityFlowAtom,
  showLiquiditySuccessToast,
  type LiquidityFlowStepDefinition,
  getPoolDisplayOrder,
  isUserRejection,
  type LiquidityQuoteRequest,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useConfig,
  useBlockNumber,
} from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import {
  getContractAddress,
  type AddLiquidityTransaction,
} from "@mento-protocol/mento-sdk";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  formatLiquiditySummaryAmount,
  getBalancedLiquidityDisplayState,
} from "./balanced-liquidity-display";

function isSingleTokenLiquidityLimitError(message: string): boolean {
  return /pool liquidity is insufficient|insufficient liquidity|insufficient reserves|insufficient output amount|bb55fd27/i.test(
    message,
  );
}

function isSingleTokenPoolRatioError(message: string): boolean {
  return /current pool ratio|cannot be added|insufficient amount[ab]?|insufficient amount[ab] desired|0x8f66ec14|0x34c90624|0xdc6b2ef2|0xacee0513|0x5945ea56/i.test(
    message,
  );
}

function isSingleTokenRouteError(message: string): boolean {
  return /no viable zap-in route|no viable route|no route|route unavailable|unable to prepare single-token|no single-token route/i.test(
    message,
  );
}

function getSingleTokenLiquidityErrorMessage(
  message: string,
  tokenSymbol: string,
): string {
  if (isSingleTokenLiquidityLimitError(message)) {
    return `This pool cannot convert enough ${tokenSymbol} into the other token for this single-token amount. Try a smaller amount or use balanced mode.`;
  }

  if (isSingleTokenPoolRatioError(message)) {
    return `This ${tokenSymbol} amount cannot be added at the current pool ratio. Try a smaller amount, higher slippage, or balanced mode.`;
  }

  if (isSingleTokenRouteError(message)) {
    return "No single-token route is available for this amount. Try a smaller amount or use balanced mode.";
  }

  return message.replace(/zap-?in/gi, "single-token liquidity");
}

const POOL_RATIO_CHANGED_ERROR =
  "Pool ratio changed. Review the updated amounts before submitting.";

function isWithinOneWei(actual: bigint, expected: bigint): boolean {
  return actual >= expected ? actual - expected <= 1n : expected - actual <= 1n;
}

function getMinimumAmount(amount: bigint, slippage: SlippageOption): bigint {
  const basisPoints = BigInt(Math.floor(slippage * 100));
  return (amount * (10_000n - basisPoints)) / 10_000n;
}

function isBuildAlignedWithQuote(
  build: AddLiquidityTransaction,
  quote: LiquidityQuoteResult,
  slippage: SlippageOption,
): boolean {
  const details = build.addLiquidity;
  return (
    isWithinOneWei(details.amountADesired, quote.amountA) &&
    isWithinOneWei(details.amountBDesired, quote.amountB) &&
    isWithinOneWei(
      details.amountAMin,
      getMinimumAmount(quote.amountA, slippage),
    ) &&
    isWithinOneWei(
      details.amountBMin,
      getMinimumAmount(quote.amountB, slippage),
    )
  );
}

function TokenAmountInput({
  token,
  balance,
  amount,
  onChange,
  onMax,
  insufficient,
  disabled,
}: {
  token: { address: string; symbol: string };
  balance: string;
  amount: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  onMax: () => void;
  insufficient: boolean;
}) {
  return (
    <div className="gap-2 flex flex-col">
      <div className="gap-2 flex items-center justify-between">
        <span className="font-semibold font-mono tracking-widest text-[11px] text-muted-foreground uppercase">
          {token.symbol}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          Balance: <span>{formatCompactBalance(balance)}</span>
        </span>
      </div>
      <div
        className={`gap-2 px-4 py-1 flex items-center rounded-xl border bg-muted/30 transition-colors focus-within:border-primary ${insufficient ? "border-destructive" : "border-border"}`}
      >
        <CoinInput
          value={amount}
          onChange={onChange}
          placeholder="0.00"
          disabled={disabled}
          aria-label={`Deposit amount in ${token.symbol}`}
          className="h-10 p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onMax}
          disabled={disabled}
          aria-label={`MAX ${token.symbol}`}
        >
          MAX
        </button>
        <div className="gap-1.5 px-3 py-1.5 flex items-center rounded-lg bg-muted/50">
          <TokenIcon
            token={{ address: token.address, symbol: token.symbol }}
            size={20}
            className="rounded-full"
          />
          <span className="text-sm font-semibold text-foreground/70">
            {token.symbol}
          </span>
        </div>
      </div>
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
  onLiquidityUpdated?: (txHash?: string) => void | Promise<void>;
  header?: React.ReactNode;
  disabled?: boolean;
}

export function AddLiquidityForm({
  pool,
  onLiquidityUpdated,
  header,
  disabled,
}: AddLiquidityFormProps) {
  const { displayToken0, displayToken1, isSwapped } = getPoolDisplayOrder(pool);
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = pool.chainId;
  const { data: blockNumber } = useBlockNumber({
    chainId,
    watch: !!address,
    query: { enabled: !!address },
  });
  const queryClient = useQueryClient();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const routerAddress = getContractAddress(
    Number(chainId) as Parameters<typeof getContractAddress>[0],
    "Router",
  ) as Address;

  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [liquidityQuoteRequest, setLiquidityQuoteRequest] =
    useState<LiquidityQuoteRequest | null>(null);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const liquidityQuoteRequestId = useRef(0);

  // Single-token (zap) state
  const [zapTokenIn, setZapTokenIn] = useState<string>(pool.token0.address);
  const [zapAmount, setZapAmount] = useState("");

  // Fetch token balances
  const { data: token0Balance, refetch: refetchToken0Balance } =
    useReadContract({
      chainId,
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
      chainId,
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
      chainId,
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
      chainId,
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

  const {
    data: quote,
    isFetching: isFetchingQuote,
    isDebouncing: isQuoteDebouncing,
    refetch: refetchLiquidityQuote,
  } = useLiquidityQuote({
    pool,
    request: mode === "balanced" ? liquidityQuoteRequest : null,
    chainId,
  });
  const isQuoting = isFetchingQuote || isQuoteDebouncing;

  const currentQuote =
    quote && quote.requestId === liquidityQuoteRequest?.id ? quote : null;
  const balancedDisplay = getBalancedLiquidityDisplayState({
    quote: currentQuote,
    pool,
    rawToken0Amount: token0Amount,
    rawToken1Amount: token1Amount,
  });

  const { buildTransaction, buildResult, isBuilding } =
    useAddLiquidityTransaction(pool, chainId);

  // Build transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (
      !address ||
      !currentQuote ||
      currentQuote.amountA === 0n ||
      currentQuote.amountB === 0n
    )
      return;
    buildTransaction(
      currentQuote.amountA,
      currentQuote.amountB,
      address,
      slippage,
    );
  }, [currentQuote, address, slippage, buildTransaction, mode]);

  // === Single-token (zap) hooks ===

  const zapToken =
    zapTokenIn === pool.token0.address ? pool.token0 : pool.token1;
  const zapTokenBalance =
    zapTokenIn === pool.token0.address ? token0Balance : token1Balance;
  const formattedZapBalance = zapTokenBalance
    ? formatUnits(zapTokenBalance, zapToken.decimals)
    : "0";

  const { isFetching: isZapQuoting } = useZapInQuote({
    pool,
    tokenIn: zapTokenIn,
    amountIn: mode === "single" ? zapAmount : "",
    slippage,
    chainId,
  });

  const {
    buildTransaction: buildZapTransaction,
    buildTransactionAttempt: buildZapTransactionAttempt,
    buildResult: zapBuildResult,
    buildError: zapBuildError,
    isBuilding: isZapBuilding,
  } = useZapInTransaction(pool, chainId);

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
      const amount = e.target.value;
      const requestId = ++liquidityQuoteRequestId.current;
      setToken0Amount(amount);
      setToken1Amount("");
      setLiquidityQuoteRequest(
        amount ? { id: requestId, kind: "manual", token: 0, amount } : null,
      );
    },
    [],
  );

  const handleToken1Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const amount = e.target.value;
      const requestId = ++liquidityQuoteRequestId.current;
      setToken0Amount("");
      setToken1Amount(amount);
      setLiquidityQuoteRequest(
        amount ? { id: requestId, kind: "manual", token: 1, amount } : null,
      );
    },
    [],
  );

  const handleMax0 = useCallback(() => {
    if (
      token0Balance === undefined ||
      token1Balance === undefined ||
      token0Balance === 0n ||
      token1Balance === 0n
    )
      return;

    const requestId = ++liquidityQuoteRequestId.current;
    setToken0Amount("");
    setToken1Amount("");
    setLiquidityQuoteRequest({
      id: requestId,
      kind: "max",
      token: 0,
      token0Balance,
      token1Balance,
    });
  }, [token0Balance, token1Balance]);

  const handleMax1 = useCallback(() => {
    if (
      token0Balance === undefined ||
      token1Balance === undefined ||
      token0Balance === 0n ||
      token1Balance === 0n
    )
      return;

    const requestId = ++liquidityQuoteRequestId.current;
    setToken0Amount("");
    setToken1Amount("");
    setLiquidityQuoteRequest({
      id: requestId,
      kind: "max",
      token: 1,
      token0Balance,
      token1Balance,
    });
  }, [token0Balance, token1Balance]);

  // === Validation ===

  // Balanced mode
  const parsedToken0 = currentQuote?.amountA ?? null;
  const parsedToken1 = currentQuote?.amountB ?? null;
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
  const singleTokenLiquidityError = zapBuildError
    ? getSingleTokenLiquidityErrorMessage(zapBuildError, zapToken.symbol)
    : null;

  // === Button state ===

  const getButtonState = () => {
    if (disabled) return { text: "Wrong network", disabled: true };
    if (isSubmitting) return { text: "Confirm in wallet...", disabled: true };

    if (mode === "single") {
      if (!hasZapAmount) return { text: "Enter amount", disabled: true };
      if (insufficientZap)
        return {
          text: `Insufficient ${zapToken.symbol} balance`,
          disabled: true,
        };
      if (zapBuildError)
        return {
          text: isSingleTokenLiquidityLimitError(zapBuildError)
            ? "Amount too large"
            : isSingleTokenPoolRatioError(zapBuildError)
              ? "Adjust amount"
              : "Unavailable",
          disabled: true,
        };
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

  const refreshLiquidityState = useCallback(
    async (txHash?: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pools-list", chainId] }),
        queryClient.invalidateQueries({ queryKey: ["readContract"] }),
        queryClient.refetchQueries({
          queryKey: ["readContract"],
          type: "active",
        }),
        // useUserPosition's queryKey embeds lpBalance.toString(), so it only
        // rebuilds when the refetched balance differs. On RPCs that lag
        // post-confirmation (notably Polygon Amoy's public endpoint), the
        // refetch returns the prior value and the position card stays stale.
        // Invalidate the position query directly so it always rerenders.
        queryClient.invalidateQueries({ queryKey: ["user-position"] }),
        refetchToken0Balance(),
        refetchToken1Balance(),
        refetchToken0Allowance(),
        refetchToken1Allowance(),
        onLiquidityUpdated?.(txHash),
      ]);
    },
    [
      queryClient,
      chainId,
      refetchToken0Balance,
      refetchToken1Balance,
      refetchToken0Allowance,
      refetchToken1Allowance,
      onLiquidityUpdated,
    ],
  );

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
        // --- Single-token liquidity flow ---
        const capturedZapAmount = parsedZap;
        const capturedZapTokenIn = zapTokenIn;
        const capturedSlippage = slippage;

        if (!capturedZapAmount || capturedZapAmount <= 0n) {
          throw new Error("Invalid single-token amount");
        }
        const capturedZapAttempt = await buildZapTransactionAttempt(
          capturedZapTokenIn as Address,
          capturedZapAmount,
          address,
          capturedSlippage,
        );
        const capturedZapBuild = capturedZapAttempt.build;
        if (!capturedZapBuild) {
          throw new Error(
            capturedZapAttempt.error ||
              "No single-token route is available for this amount. Try a smaller amount or use balanced mode.",
          );
        }

        const steps: LiquidityFlowStepDefinition[] = [];

        const allowances = await getLatestAllowances();
        const currentZapAllowance =
          capturedZapTokenIn.toLowerCase() === pool.token0.address.toLowerCase()
            ? allowances.token0
            : allowances.token1;

        if (
          capturedZapBuild.approval &&
          capturedZapAmount > currentZapAllowance
        ) {
          const approvalParams = capturedZapBuild.approval.params;
          steps.push({
            id: "approve-token",
            label: `Approve ${zapToken.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        const hasApprovalStep = steps.length > 0;

        steps.push({
          id: "zap-in",
          label: "Add Liquidity",
          buildTx: async () => {
            const freshBuildAttempt =
              hasApprovalStep || capturedZapBuild.approval
                ? await buildZapTransactionAttempt(
                    capturedZapTokenIn as Address,
                    capturedZapAmount,
                    address,
                    capturedSlippage,
                  )
                : { build: capturedZapBuild, error: null };
            const freshBuild = freshBuildAttempt.build;
            if (!freshBuild) {
              throw new Error(
                freshBuildAttempt.error ||
                  "No single-token route is available for this amount. Try a smaller amount or use balanced mode.",
              );
            }
            if (freshBuild.approval) {
              throw new Error(
                "Token approval is still required. Please try again.",
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
          chainId,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: displayToken0.symbol,
              token1Symbol: displayToken1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState(lastTxHash);
          setZapAmount("");
        }
      } else if (mode === "balanced" && currentQuote && buildResult) {
        // --- Balanced add flow ---
        const capturedQuote = currentQuote;
        const capturedSlippage = slippage;

        const refreshedQuoteResult = await refetchLiquidityQuote();
        if (refreshedQuoteResult.error) {
          throw new Error("Unable to refresh liquidity quote.");
        }
        const refreshedQuote = refreshedQuoteResult.data;
        if (
          !refreshedQuote ||
          refreshedQuote.requestId !== capturedQuote.requestId ||
          refreshedQuote.amountA !== capturedQuote.amountA ||
          refreshedQuote.amountB !== capturedQuote.amountB
        ) {
          throw new Error(POOL_RATIO_CHANGED_ERROR);
        }

        // Rebuild at click time and use this exact result for approvals. The
        // stateful preview build may still belong to a previous quote.
        const capturedBuild = await buildTransaction(
          capturedQuote.amountA,
          capturedQuote.amountB,
          address,
          capturedSlippage,
        );
        if (!capturedBuild) throw new Error("Failed to build transaction");
        if (
          !isBuildAlignedWithQuote(
            capturedBuild,
            capturedQuote,
            capturedSlippage,
          )
        ) {
          throw new Error(POOL_RATIO_CHANGED_ERROR);
        }

        const steps: LiquidityFlowStepDefinition[] = [];
        const allowances = await getLatestAllowances();

        if (
          capturedBuild.approvalA &&
          capturedQuote.amountA > allowances.token0
        ) {
          const approvalParams = capturedBuild.approvalA.params;
          steps.push({
            id: "approve-a",
            label: `Approve ${pool.token0.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        if (
          capturedBuild.approvalB &&
          capturedQuote.amountB > allowances.token1
        ) {
          const approvalParams = capturedBuild.approvalB.params;
          steps.push({
            id: "approve-b",
            label: `Approve ${pool.token1.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        const hasApprovalSteps = steps.length > 0;

        steps.push({
          id: "add-liquidity",
          label: "Add Liquidity",
          buildTx: async () => {
            if (!hasApprovalSteps) {
              return capturedBuild.addLiquidity.params;
            }

            const postApprovalQuoteResult = await refetchLiquidityQuote();
            if (postApprovalQuoteResult.error) {
              throw new Error("Unable to refresh liquidity quote.");
            }
            const postApprovalQuote = postApprovalQuoteResult.data;
            if (
              !postApprovalQuote ||
              postApprovalQuote.requestId !== capturedQuote.requestId ||
              postApprovalQuote.amountA !== capturedQuote.amountA ||
              postApprovalQuote.amountB !== capturedQuote.amountB
            ) {
              throw new Error(POOL_RATIO_CHANGED_ERROR);
            }

            const freshBuild = await buildTransaction(
              capturedQuote.amountA,
              capturedQuote.amountB,
              address,
              capturedSlippage,
            );
            if (!freshBuild) throw new Error("Failed to build transaction");
            if (freshBuild.approvalA || freshBuild.approvalB) {
              throw new Error(
                "Token approval is still required. Please try again.",
              );
            }
            if (
              !isBuildAlignedWithQuote(
                freshBuild,
                capturedQuote,
                capturedSlippage,
              )
            ) {
              throw new Error(POOL_RATIO_CHANGED_ERROR);
            }
            return freshBuild.addLiquidity.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Add Liquidity",
          steps,
          chainId,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: displayToken0.symbol,
              token1Symbol: displayToken1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState(lastTxHash);
          setToken0Amount("");
          setToken1Amount("");
          setLiquidityQuoteRequest(null);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isUserRejection(err)) {
        // The InsufficientAmount* selectors fire in balanced mode too, so the
        // single-token-specific copy ("…or balanced mode") only makes sense
        // when the user is actually in single-token mode.
        if (
          mode === "single" &&
          (isSingleTokenRouteError(msg) ||
            isSingleTokenLiquidityLimitError(msg) ||
            isSingleTokenPoolRatioError(msg))
        ) {
          toast.error(
            getSingleTokenLiquidityErrorMessage(msg, zapToken.symbol),
          );
        } else if (msg === POOL_RATIO_CHANGED_ERROR) {
          toast.error(POOL_RATIO_CHANGED_ERROR);
        } else {
          toast.error("Something went wrong. Please try again.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // === Preview calculations ===

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

  // Summary display values
  const summaryToken0Amount =
    mode === "balanced"
      ? balancedDisplay.summaryToken0Amount
      : zapTokenIn === pool.token0.address
        ? formatLiquiditySummaryAmount(zapAmount || "0")
        : "—";
  const summaryToken1Amount =
    mode === "balanced"
      ? balancedDisplay.summaryToken1Amount
      : zapTokenIn === pool.token1.address
        ? formatLiquiditySummaryAmount(zapAmount || "0")
        : "—";

  const maxSurplus0 =
    currentQuote?.requestKind === "max" && currentQuote.surplus0 > 0n
      ? formatUnits(currentQuote.surplus0, pool.token0.decimals)
      : null;
  const maxSurplus1 =
    currentQuote?.requestKind === "max" && currentQuote.surplus1 > 0n
      ? formatUnits(currentQuote.surplus1, pool.token1.decimals)
      : null;

  return (
    <div className="gap-4 md:grid-cols-[2fr_1fr] grid grid-cols-1">
      {/* Left — Inputs card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {header}
        <div className="gap-6 p-6 flex flex-col">
          {/* Deposit mode toggle */}
          <div className="gap-1 p-1 grid grid-cols-2 rounded-lg bg-muted/50">
            <button
              onClick={() => setMode("balanced")}
              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer rounded-md transition-colors ${
                mode === "balanced"
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Balanced (2 tokens)
            </button>
            <button
              onClick={() => setMode("single")}
              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer rounded-md transition-colors ${
                mode === "single"
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Single token
            </button>
          </div>

          {mode === "balanced" ? (
            <>
              {(isSwapped
                ? [
                    <TokenAmountInput
                      key="t1"
                      token={pool.token1}
                      balance={formattedToken1Balance}
                      amount={balancedDisplay.token1Amount}
                      onChange={handleToken1Change}
                      onMax={handleMax1}
                      insufficient={insufficientToken1}
                      disabled={disabled}
                    />,
                    <TokenAmountInput
                      key="t0"
                      token={pool.token0}
                      balance={formattedToken0Balance}
                      amount={balancedDisplay.token0Amount}
                      onChange={handleToken0Change}
                      onMax={handleMax0}
                      insufficient={insufficientToken0}
                      disabled={disabled}
                    />,
                  ]
                : [
                    <TokenAmountInput
                      key="t0"
                      token={pool.token0}
                      balance={formattedToken0Balance}
                      amount={balancedDisplay.token0Amount}
                      onChange={handleToken0Change}
                      onMax={handleMax0}
                      insufficient={insufficientToken0}
                      disabled={disabled}
                    />,
                    <TokenAmountInput
                      key="t1"
                      token={pool.token1}
                      balance={formattedToken1Balance}
                      amount={balancedDisplay.token1Amount}
                      onChange={handleToken1Change}
                      onMax={handleMax1}
                      insufficient={insufficientToken1}
                      disabled={disabled}
                    />,
                  ]
              ).map((input) => input)}
              <div className="gap-1.5 p-3 text-xs leading-5 flex flex-col rounded-lg border border-border bg-muted/30 text-muted-foreground">
                <span>
                  Balanced liquidity follows the pool&apos;s current reserve
                  ratio, which may differ from equal USD value.
                </span>
                {(maxSurplus0 || maxSurplus1) && (
                  <span className="text-foreground">
                    Estimated surplus:{" "}
                    {maxSurplus0 &&
                      `${formatCompactBalance(maxSurplus0)} ${pool.token0.symbol}`}
                    {maxSurplus0 && maxSurplus1 && ", "}
                    {maxSurplus1 &&
                      `${formatCompactBalance(maxSurplus1)} ${pool.token1.symbol}`}{" "}
                    stays in your wallet.
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Token selector + input */}
              <div className="gap-2 flex flex-col">
                <div className="gap-2 flex items-center justify-between">
                  <span className="font-semibold font-mono tracking-widest text-[11px] text-muted-foreground uppercase">
                    Deposit Token
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Balance:{" "}
                    <span>{formatCompactBalance(formattedZapBalance)}</span>
                  </span>
                </div>
                <div
                  className={`gap-2 px-4 py-1 flex items-center rounded-xl border bg-muted/30 transition-colors focus-within:border-primary ${insufficientZap ? "border-destructive" : "border-border"}`}
                >
                  <CoinInput
                    value={zapAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setZapAmount(e.target.value)
                    }
                    placeholder="0.00"
                    disabled={disabled}
                    aria-label={`Deposit amount in ${zapToken.symbol}`}
                    className="h-10 p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setZapAmount(formattedZapBalance)}
                    disabled={disabled}
                    aria-label={`MAX ${zapToken.symbol}`}
                  >
                    MAX
                  </button>
                  {/* Token selector */}
                  <Select
                    value={zapTokenIn}
                    onValueChange={(v) => {
                      setZapTokenIn(v);
                      setZapAmount("");
                    }}
                  >
                    <SelectTrigger
                      className="gap-1.5 px-3 py-1.5 font-semibold h-auto w-auto rounded-lg border-0 bg-muted/50 shadow-none"
                      aria-label={`${zapToken.symbol} deposit token`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={displayToken0.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: displayToken0.address,
                              symbol: displayToken0.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {displayToken0.symbol}
                        </div>
                      </SelectItem>
                      <SelectItem
                        value={displayToken1.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: displayToken1.address,
                              symbol: displayToken1.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {displayToken1.symbol}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {insufficientZap && (
                  <p className="text-xs text-destructive">
                    Insufficient {zapToken.symbol} balance
                  </p>
                )}
              </div>

              {/* Amount presets */}
              <div className="gap-2 grid grid-cols-4">
                {[
                  { label: "25%", pct: "25" },
                  { label: "50%", pct: "50" },
                  { label: "75%", pct: "75" },
                  { label: "Max", pct: "100" },
                ].map(({ label, pct }) => (
                  <button
                    key={label}
                    onClick={() => handleAmountPreset(pct)}
                    className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Warning */}
              <div className="gap-2 p-3 border-yellow-500/20 bg-yellow-50/50 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400 flex items-start rounded-lg border">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Single-sided deposits use an auto-swap, which incurs the pool
                  fee and some price impact.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right — Summary & Action */}
      <div className="gap-4 flex flex-col">
        {/* Summary card */}
        <div className="p-6 flex-1 rounded-xl border border-border bg-card">
          <h2 className="text-sm font-semibold mb-5 text-muted-foreground">
            Transaction Summary
          </h2>

          <div className="space-y-3.5">
            {/* Deposit display token 0 */}
            <div className="flex items-center justify-between">
              <div className="gap-2 flex items-center">
                <TokenIcon
                  token={{
                    address: displayToken0.address,
                    symbol: displayToken0.symbol,
                  }}
                  size={20}
                  className="rounded-full"
                />
                <span className="text-sm text-muted-foreground">
                  Deposit {displayToken0.symbol}
                </span>
              </div>
              <span className="text-sm font-semibold font-mono tabular-nums">
                {isSwapped ? summaryToken1Amount : summaryToken0Amount}
              </span>
            </div>

            {/* Deposit display token 1 */}
            <div className="flex items-center justify-between">
              <div className="gap-2 flex items-center">
                <TokenIcon
                  token={{
                    address: displayToken1.address,
                    symbol: displayToken1.symbol,
                  }}
                  size={20}
                  className="rounded-full"
                />
                <span className="text-sm text-muted-foreground">
                  Deposit {displayToken1.symbol}
                </span>
              </div>
              <span className="text-sm font-semibold font-mono tabular-nums">
                {isSwapped ? summaryToken0Amount : summaryToken1Amount}
              </span>
            </div>

            <div className="h-px bg-border" />

            {/* LP fee */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">LP fee</span>
              <span className="text-sm font-medium font-mono text-muted-foreground">
                {pool.fees.lp.toFixed(1)}%
              </span>
            </div>

            {/* Slippage tolerance */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Slippage tolerance
              </span>
              <Select
                value={String(slippage)}
                onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
              >
                <SelectTrigger
                  className="h-7 text-xs font-mono w-[80px] border-border bg-muted/30"
                  aria-label={`Slippage tolerance: ${slippage}%`}
                >
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
          </div>

          <p className="mt-4 leading-relaxed text-[11px] text-muted-foreground">
            Sets the minimum amounts for single-token deposits/withdrawals and
            liquidity mint/burn.
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
            {mode === "single" && singleTokenLiquidityError && (
              <p className="text-xs leading-5 text-center text-muted-foreground">
                {singleTokenLiquidityError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
