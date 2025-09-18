# governance.mento.org

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
pnpm dev
```

<!-- markdown-link-check-disable -->

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

<!-- markdown-link-check-enable -->

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Address Resolver System

The governance app includes a comprehensive address resolver system that converts blockchain addresses into human-readable names and provides additional contract information. This system is essential for making governance proposals and transactions more understandable.

### How It Works

The address resolver uses a multi-layered approach to resolve addresses:

1. **Local Registry** (Fastest) - Checks a local JSON configuration file
2. **External APIs** (Comprehensive) - Queries blockchain explorers (Celoscan, Blockscout)
3. **Formatted Fallback** (Always available) - Returns a truncated address format

### Architecture

```txt
AddressResolverService
├── Local Registry (contract-registry.json)
├── ContractAPIService
│   ├── Celoscan API (requires API key)
│   └── Blockscout API (no API key required)
└── Address Formatting (fallback)
```

### Key Components

- **`AddressResolverService`** - Main service class that orchestrates address resolution
- **`ContractAPIService`** - Handles external API calls with caching and rate limiting
- **`contract-registry.json`** - Local database of known contracts and addresses
- **API Routes** - `/api/contract/abi` and `/api/contract/info` for external data fetching

### Usage Examples

```typescript
import {
  addressResolverService,
  getAddressName,
} from "./services/address-resolver-service";

// Async resolution (uses all sources)
const resolved = await addressResolverService.resolve(
  "0x471EcE3750Da237f93B8E339c536989b8978a438",
);
console.log(resolved.name); // "CELO Token"

// Sync resolution (local registry only)
const name = getAddressNameFromCache(
  "0x471EcE3750Da237f93B8E339c536989b8978a438",
);
console.log(name); // "CELO Token"

// Resolve multiple addresses efficiently
const addresses = [
  "0x471EcE3750Da237f93B8E339c536989b8978a438",
  "0x7ff62f59e3e89ea34163ea1458eebcc81177cfb6",
];
const resolved = await addressResolverService.resolveMultiple(addresses);
```

### Adding New Addresses/Contracts

#### 1. Add to Local Registry

Edit `app/components/proposal/config/contract-registry.json`:

```json
{
  "tokens": {
    "0x1234567890123456789012345678901234567890": {
      "name": "New Token",
      "symbol": "NEW",
      "decimals": 18,
      "friendlyName": "New Token (Friendly Name)"
    }
  },
  "governance": {
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd": {
      "name": "New Governor",
      "friendlyName": "New Governance Contract"
    }
  }
}
```

#### 2. Contract Categories

The registry supports these categories:

- **`tokens`** - ERC-20 tokens with symbol, decimals, and friendly names
- **`governance`** - Governance contracts and related addresses
- **`oracles`** - Oracle contracts and price feeds
- **`treasury`** - Treasury and reserve contracts
- **`multisigs`** - Multisig wallet addresses
- **`community`** - Community fund and related addresses
- **`rateFeeds`** - Special rate feed mappings (string values only)

#### 3. Contract Information Fields

```typescript
interface ContractInfo {
  name: string; // Required: Contract name
  symbol?: string; // Optional: Token symbol
  decimals?: number; // Optional: Token decimals
  friendlyName?: string; // Optional: Human-readable name
  isProxy?: boolean; // Optional: Whether it's a proxy contract
  implementationAddress?: string; // Optional: Implementation address for proxies
}
```

#### 4. Rate Feed Special Handling

Rate feeds have special handling and can be added in two ways:

```json
{
  "rateFeeds": {
    "0x1234567890123456789012345678901234567890": "TOKEN/USD rate feed"
  }
}
```

Or as part of the tokens section with a `friendlyName`:

```json
{
  "tokens": {
    "0x1234567890123456789012345678901234567890": {
      "name": "Token",
      "symbol": "TOKEN",
      "decimals": 18,
      "friendlyName": "TOKEN/USD rate feed"
    }
  }
}
```

### Adding New Patterns

#### 1. Proxy Contract Detection

The system automatically detects proxy contracts by looking for specific ABI functions:

- Functions containing "Implementation"
- Functions containing "\_getImplementation"
- Functions named "implementation"

#### 2. Custom Resolution Logic

To add custom resolution patterns, extend the `AddressResolverService` class:

```typescript
// Add custom resolution method
async resolveCustomPattern(address: string): Promise<ResolvedAddress> {
  // Custom logic here
  // Return ResolvedAddress object
}
```

#### 3. External API Integration

The system supports multiple blockchain explorers:

- **Celoscan** - Requires `ETHERSCAN_API_KEY` environment variable
- **Blockscout** - No API key required

To add a new explorer, extend the `blockchain-explorer-service.ts`:

```typescript
export type BlockchainExplorerSource =
  | "blockscout"
  | "celoscan"
  | "newExplorer";

// Add new explorer logic in fetchFromBlockchainExplorer function
```

### Caching Strategy

The system implements multiple caching layers:

1. **In-memory cache** - 30 minutes for address resolution
2. **localStorage cache** - 24 hours for API responses
3. **API response cache** - 5 minutes for external API calls
4. **Rate limiting** - Maximum 4 calls per second to external APIs

### Error Handling

The system includes comprehensive error handling:

- **Sentry integration** - All errors are reported to Sentry
- **Graceful fallbacks** - Always returns a formatted address if resolution fails
- **Duplicate request prevention** - Prevents multiple concurrent requests for the same address
- **API failure recovery** - Falls back to alternative APIs if one fails

### Environment Variables

Required environment variables:

```bash
# Celoscan API key (optional, for enhanced data)
ETHERSCAN_API_KEY=your_api_key_here

# API endpoints
NEXT_PUBLIC_ETHERSCAN_API_URL=https://api.celoscan.io/api
NEXT_PUBLIC_BLOCKSCOUT_API_URL=https://explorer.celo.org/api
```

### Performance Considerations

- **Parallel resolution** - Multiple addresses are resolved concurrently
- **Request deduplication** - Prevents duplicate API calls
- **Local-first approach** - Local registry is checked before external APIs
- **Efficient caching** - Multiple cache layers reduce API calls
- **Rate limiting** - Prevents API quota exhaustion

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
