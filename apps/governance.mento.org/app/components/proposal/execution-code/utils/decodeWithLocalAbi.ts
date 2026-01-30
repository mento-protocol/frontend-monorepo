import { parseAbi, type Abi } from "viem";
// ABI fallback is now handled in ExecutionCode component

// Common ERC20 ABI (Complete)
const ERC20_ABI = parseAbi([
  // Core transfer functions
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",

  // Mint and burn (common extensions)
  "function mint(address to, uint256 amount)",
  "function burn(uint256 amount)",

  // View functions
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// MENTO Token specific functions (extends ERC20)
const MENTO_TOKEN_ABI = parseAbi([
  // Additional burn function
  "function burnFrom(address account, uint256 amount)",

  // Allowance management
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)",

  // Mint function (only callable by emission contract)
  "function mint(address target, uint256 amount)",

  // Ownership
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",

  // Pause functionality
  "function unpause()",
]);

// Governance functions - MentoGovernor
const GOVERNANCE_ABI = parseAbi([
  // Core proposal functions
  "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)",
  "function propose(address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, string description) returns (uint256)",
  "function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) payable returns (uint256)",
  "function execute(uint256 proposalId) payable",
  "function queue(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) returns (uint256)",
  "function queue(uint256 proposalId)",
  "function cancel(uint256 proposalId)",

  // Voting functions
  "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
  "function castVoteWithReason(uint256 proposalId, uint8 support, string reason) returns (uint256)",
  "function castVoteWithReasonAndParams(uint256 proposalId, uint8 support, string reason, bytes params) returns (uint256)",
  "function castVoteBySig(uint256 proposalId, uint8 support, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function castVoteWithReasonAndParamsBySig(uint256 proposalId, uint8 support, string reason, bytes params, uint8 v, bytes32 r, bytes32 s) returns (uint256)",

  // Configuration functions
  "function setProposalThreshold(uint256 newProposalThreshold)",
  "function setVotingDelay(uint256 newVotingDelay)",
  "function setVotingPeriod(uint256 newVotingPeriod)",
  "function updateQuorumNumerator(uint256 newQuorumNumerator)",
  "function updateTimelock(address newTimelock)",

  // Other functions
  "function relay(address target, uint256 value, bytes data) payable",
  "function __MentoGovernor_init(address veToken, address timelockController, uint256 votingDelay_, uint256 votingPeriod_, uint256 threshold_, uint256 quorum_)",
]);

// veMENTO (Voting Escrow) functions
const VEMENTO_ABI = parseAbi([
  // Core locking functions
  "function lock(address account, address _delegate, uint96 amount, uint32 slopePeriod, uint32 cliff) returns (uint256)",
  "function relock(uint256 id, address newDelegate, uint96 newAmount, uint32 newSlopePeriod, uint32 newCliff) returns (uint256)",
  "function withdraw()",

  // Delegation functions
  "function delegateTo(uint256 id, address newDelegate)",

  // Configuration functions
  "function setMinCliffPeriod(uint32 newMinCliffPeriod)",
  "function setMinSlopePeriod(uint32 newMinSlopePeriod)",
  "function setPaused(bool paused_)",
  "function setMentoLabsMultisig(address mentoLabsMultisig_)",

  // L2 transition functions
  "function setL2TransitionBlock(uint256 l2TransitionBlock_)",
  "function setL2StartingPointWeek(int256 l2StartingPointWeek_)",
  "function setL2EpochShift(uint32 l2EpochShift_)",

  // Update functions
  "function updateAccountLines(address account, uint32 time)",
  "function updateAccountLinesBlockNumber(address account, uint32 blockNumber)",
  "function updateTotalSupplyLine(uint32 time)",
  "function updateTotalSupplyLineBlockNumber(uint32 blockNumber)",

  // Ownership
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",

  // Initialization
  "function __Locking_init(address _token, uint32 _startingPointWeek, uint32 _minCliffPeriod, uint32 _minSlopePeriod)",
]);

// Reserve functions
const RESERVE_ABI = parseAbi([
  // Transfer functions
  "function transferGold(address to, uint256 value) returns (bool)",
  "function transferCollateralAsset(address collateralAsset, address to, uint256 value) returns (bool)",
  "function transferExchangeGold(address to, uint256 value) returns (bool)",
  "function transferExchangeCollateralAsset(address collateralAsset, address to, uint256 value) returns (bool)",

  // Asset management
  "function addToken(address token) returns (bool)",
  "function removeToken(address token, uint256 index) returns (bool)",
  "function addCollateralAsset(address collateralAsset) returns (bool)",
  "function removeCollateralAsset(address collateralAsset, uint256 index) returns (bool)",

  // Configuration
  "function setAssetAllocations(bytes32[] symbols, uint256[] weights)",
  "function setDailySpendingRatio(uint256 ratio)",
  "function setDailySpendingRatioForCollateralAssets(address[] _collateralAssets, uint256[] collateralAssetDailySpendingRatios)",
  "function setFrozenGold(uint256 frozenGold, uint256 frozenDays)",
  "function setTobinTax(uint256 value)",
  "function setTobinTaxReserveRatio(uint256 value)",
  "function setTobinTaxStalenessThreshold(uint256 value)",

  // Spender management
  "function addSpender(address spender)",
  "function removeSpender(address spender)",
  "function addExchangeSpender(address spender)",
  "function removeExchangeSpender(address spender, uint256 index)",
  "function addOtherReserveAddress(address reserveAddress) returns (bool)",
  "function removeOtherReserveAddress(address reserveAddress, uint256 index) returns (bool)",

  // Ownership
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// Generic Protocol functions
const PROTOCOL_ABI = parseAbi([
  "function setReserveRatio(uint256 ratio)",
  "function updateOracle(address oracle)",
  "function pause()",
  "function unpause()",
  "function addMember(address member)",
  "function removeMember(address member)",
  "function setParameter(bytes32 key, uint256 value)",
]);

// Proxy Admin functions
const PROXY_ADMIN_ABI = parseAbi([
  // Proxy management
  "function changeProxyAdmin(address proxy, address newAdmin)",
  "function upgrade(address proxy, address implementation)",
  "function upgradeAndCall(address proxy, address implementation, bytes data) payable",

  // View functions
  "function getProxyAdmin(address proxy) view returns (address)",
  "function getProxyImplementation(address proxy) view returns (address)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// StableToken ABI (from implementation contract)
const STABLETOKEN_ABI = parseAbi([
  // ERC20 functions
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",

  // EIP-2612 Permit
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",

  // StableToken specific functions
  "function mint(address to, uint256 value) returns (bool)",
  "function burn(uint256 value) returns (bool)",
  "function transferWithComment(address to, uint256 value, string comment) returns (bool)",

  // Broker and Exchange
  "function broker() view returns (address)",
  "function exchange() view returns (address)",
  "function setBroker(address _broker)",
  "function setExchange(address _exchange)",

  // Validators
  "function validators() view returns (address)",
  "function setValidators(address _validators)",

  // Gas fee management
  "function creditGasFees(address from, address feeRecipient, address gatewayFeeRecipient, address communityFund, uint256 refund, uint256 tipTxFee, uint256 gatewayFee, uint256 baseTxFee)",
  "function debitGasFees(address from, uint256 value)",

  // Allowance management
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",

  // Renamer functions (from StableTokenV2Renamer)
  "function setName(string newName)",
  "function setSymbol(string newSymbol)",
  "function slot1() view returns (address)",

  // Initialization
  "function initialize(string _name, string _symbol, uint8, address, uint256, uint256, address[] initialBalanceAddresses, uint256[] initialBalanceValues, string)",
  "function initializeV2(address _broker, address _validators, address _exchange)",
]);

// Proxy ABI (for proxy contracts like StableToken proxies)
const PROXY_ABI = parseAbi([
  // View functions
  "function _getImplementation() view returns (address)",
  "function _getOwner() view returns (address)",

  // Proxy management functions
  "function _setImplementation(address implementation)",
  "function _setAndInitializeImplementation(address implementation, bytes callbackData) payable",
  "function _transferOwnership(address newOwner)",
]);

// SortedOracles ABI
const SORTED_ORACLES_ABI = parseAbi([
  // Oracle management
  "function addOracle(address token, address oracleAddress)",
  "function removeOracle(address token, address oracleAddress, uint256 index)",

  // Token report expiry
  "function setTokenReportExpiry(address token, uint256 _reportExpirySeconds)",

  // Equivalent token
  "function setEquivalentToken(address token, address equivalentToken)",

  // View functions
  "function getOracles(address token) view returns (address[])",
  "function getRates(address token) view returns (uint256[], address[])",
  "function getMedianRate(address token) view returns (uint256)",
  "function getMedianTimestamp(address token) view returns (uint256)",
  "function isOldestOracleExpired(address token) view returns (bool)",
  "function numRates(address token) view returns (uint256)",
  "function numTimestamps(address token) view returns (uint256)",
  "function medianRate(address token) view returns (uint256)",
  "function medianTimestamp(address token) view returns (uint256)",
  "function reportExpirySeconds(address token) view returns (uint256)",
  "function equivalentToken(address token) view returns (address)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// BiPoolManager ABI (manages two-asset virtual pools)
// PoolExchange struct contains PoolConfig which contains FixidityLib.Fraction (a single uint256)
// The nested struct encoding is: ((uint256),address,uint256,uint256,uint256) for PoolConfig
// Note: createExchange signatures may not decode all on-chain calldata due to
// complex struct encoding variations. Known limitation from selector 0x271eb2e4.
const BI_POOL_MANAGER_ABI = parseAbi([
  // Exchange management - with nested Fraction struct
  "function createExchange((address,address,address,uint256,uint256,uint256,((uint256),address,uint256,uint256,uint256))) returns (bytes32)",
  // Alternative encoding without nested Fraction (flattened)
  "function createExchange((address,address,address,uint256,uint256,uint256,(uint256,address,uint256,uint256,uint256))) returns (bytes32)",
  "function destroyExchange(bytes32 exchangeId, uint256 exchangeIdIndex) returns (bool destroyed)",

  // View functions
  "function getPoolExchange(bytes32 exchangeId) view returns ((address,address,address,uint256,uint256,uint256,(uint256,address,uint256,uint256,uint256)))",
  "function getExchangeIds() view returns (bytes32[])",
  "function broker() view returns (address)",
  "function reserve() view returns (address)",
  "function sortedOracles() view returns (address)",
  "function breakerBox() view returns (address)",

  // Swap functions
  "function swapIn(bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountIn) returns (uint256 amountOut)",
  "function swapOut(bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountOut) returns (uint256 amountIn)",
  "function getAmountOut(bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut)",
  "function getAmountIn(bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountOut) view returns (uint256 amountIn)",

  // Setters
  "function setBroker(address newBroker)",
  "function setReserve(address newReserve)",
  "function setSortedOracles(address newSortedOracles)",
  "function setBreakerBox(address newBreakerBox)",
  "function setPricingModules(bytes32[] identifiers, address[] addresses)",
  // setSpread is available in BiPoolManager v2.6.5+ (0xc016174b60519bdc24433d4ed2cff6c1efac7881)
  "function setSpread(bytes32 exchangeId, uint256 spread)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// ValueDeltaBreaker ABI (circuit breaker for stable asset pairs)
// Note: setRateChangeThreshold is SINGULAR for individual rate feed configuration
const VALUE_DELTA_BREAKER_ABI = parseAbi([
  // Configuration - singular versions for individual rate feeds
  "function setRateChangeThreshold(address rateFeedID, uint256 rateChangeThreshold)",
  "function setReferenceValue(address rateFeedID, uint256 referenceValue)",
  "function setCooldownTime(address rateFeedID, uint256 cooldownTime)",

  // Configuration - plural versions for batch updates
  "function setReferenceValues(address[] rateFeedIDs, uint256[] _referenceValues)",
  "function setCooldownTimes(address[] rateFeedIDs, uint256[] cooldownTime)",
  "function setDefaultCooldownTime(uint256 cooldownTime)",
  "function setDefaultRateChangeThreshold(uint256 _rateChangeTreshold)",
  "function setRateChangeThresholds(address[] rateFeedIDs, uint256[] rateChangeThresholds)",
  "function setSortedOracles(address _sortedOracles)",
  "function setBreakerBox(address _breakerBox)",

  // View functions
  "function sortedOracles() view returns (address)",
  "function breakerBox() view returns (address)",
  "function referenceValues(address) view returns (uint256)",
  "function getCoolDown(address rateFeedID) view returns (uint256)",
  "function defaultCooldownTime() view returns (uint256)",
  "function defaultRateChangeThreshold() view returns (uint256)",
  "function rateChangeThreshold(address) view returns (uint256)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// BreakerBox ABI (manages circuit breakers for oracles)
const BREAKER_BOX_ABI = parseAbi([
  // Breaker management
  "function addBreaker(address breaker, uint8 tradingMode)",
  "function removeBreaker(address breaker)",
  "function toggleBreaker(address breaker, address rateFeedID, bool enable)",
  "function addRateFeed(address rateFeedID)",
  "function removeRateFeed(address rateFeedID)",
  "function setRateFeedTradingMode(address rateFeedID, uint8 tradingMode)",

  // View functions
  "function sortedOracles() view returns (address)",
  "function getBreakers() view returns (address[])",
  "function isBreaker(address) view returns (bool)",
  "function getRateFeedTradingMode(address rateFeedID) view returns (uint8)",
  "function checkAndSetBreakers(address rateFeedID) returns (uint8)",

  // Ownership
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);

// Combine all known ABIs
export const KNOWN_ABIS: Abi = [
  ...ERC20_ABI,
  ...MENTO_TOKEN_ABI,
  ...GOVERNANCE_ABI,
  ...VEMENTO_ABI,
  ...RESERVE_ABI,
  ...PROTOCOL_ABI,
  ...SORTED_ORACLES_ABI,
  ...PROXY_ADMIN_ABI,
  ...STABLETOKEN_ABI,
  ...PROXY_ABI,
  ...BI_POOL_MANAGER_ABI,
  ...VALUE_DELTA_BREAKER_ABI,
  ...BREAKER_BOX_ABI,
];
