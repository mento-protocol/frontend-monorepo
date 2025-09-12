import { parseAbi } from "viem";
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

// SortedOracles functions
// const SORTED_ORACLES_ABI = parseAbi([
//   // Oracle management
//   "function addOracle(address token, address oracleAddress)",
//   "function removeOracle(address token, address oracleAddress, uint256 index)",

//   // Reporting
//   "function report(address token, uint256 value, address lesserKey, address greaterKey)",
//   "function removeExpiredReports(address token, uint256 n)",

//   // Configuration
//   "function setReportExpiry(uint256 _reportExpirySeconds)",
//   "function setTokenReportExpiry(address _token, uint256 _reportExpirySeconds)",
//   "function setBreakerBox(address newBreakerBox)",

//   // Equivalent token management
//   "function setEquivalentToken(address token, address equivalentToken)",
//   "function deleteEquivalentToken(address token)",

//   // Initialization
//   "function initialize(uint256 _reportExpirySeconds)",

//   // Ownership
//   "function transferOwnership(address newOwner)",
//   "function renounceOwnership()",
// ]);

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

// Combine all known ABIs
export const KNOWN_ABIS = [
  ...ERC20_ABI,
  ...MENTO_TOKEN_ABI,
  ...GOVERNANCE_ABI,
  ...VEMENTO_ABI,
  ...RESERVE_ABI,
  ...PROTOCOL_ABI,
  // ...SORTED_ORACLES_ABI,
  ...PROXY_ADMIN_ABI,
];
