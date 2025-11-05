.PHONY: help mainnet-fork-with-block-explorer testnet-fork-with-block-explorer mainnet-fork-only testnet-fork-only stop-all-services

# Default target - show help
help:
	@echo "Available targets:"
	@echo "  make mainnet-fork-setup      				- Start mainnet fork and block explorer"
	@echo "  make testnet-fork-setup      				- Start testnet fork and block explorer"
	@echo "  make mainnet-fork-only   					- Start mainnet fork only"
	@echo "  make testnet-fork-only   					- Start testnet fork only"
	@echo "  make block-explorer-only   				- Start block explorer only"
	@echo "  make stop-all-services                     - Stop all services"

# Start mainnet fork and block explorer
mainnet-fork-setup:
	@echo "🔄 Starting mainnet fork in background..."
	@npm run fork:mainnet > /dev/null 2>&1 &
	@echo "🔄 Waiting for fork to initialize..."
	@sleep 3
	@echo "🔄 Starting block explorer..."
	@if docker ps -a --format '{{.Names}}' | grep -q '^otterscan$$'; then \
		echo "Block explorer container exists, starting it..."; \
		docker start otterscan; \
	else \
		echo "Creating new block explorer container..."; \
		npm run blockexplorer:start; \
	fi
	@echo "✅ Mainnet fork running on http://localhost:8545"
	@echo "✅ Block explorer running on http://localhost:5100"

# Start testnet fork with block explorer
testnet-fork-setup:
	@echo "🔄 Starting testnet fork in background..."
	@npm run fork:testnet > /dev/null 2>&1 &
	@echo "🔄 Waiting for fork to initialize..."
	@sleep 3
	@echo "🔄 Starting block explorer..."
	@if docker ps -a --format '{{.Names}}' | grep -q '^otterscan$$'; then \
		echo "Block explorer container exists, starting it..."; \
		docker start otterscan; \
	else \
		echo "Creating new block explorer container..."; \
		npm run blockexplorer:start; \
	fi
	@echo "✅ Testnet fork running on http://localhost:8545"
	@echo "✅ Block explorer running on http://localhost:5100"

# Start mainnet fork only
mainnet-fork-only:
	@echo "🔄 Starting mainnet fork..."
	npm run fork:mainnet

# Start testnet fork only
testnet-fork-only:
	@echo "🔄 Starting testnet fork..."
	npm run fork:testnet

# Start block explorer only
block-explorer-only:
	@echo "🔄 Starting block explorer..."
	@if docker ps -a --format '{{.Names}}' | grep -q '^otterscan$$'; then \
		echo "Block explorer container exists, starting it..."; \
		docker start otterscan; \
	else \
		echo "Creating new block explorer container..."; \
		npm run blockexplorer:start; \
	fi
	@echo "✅ Block explorer running on http://localhost:5100"

# Stop all forks and block explorer
stop-all-services:
	@echo "🔄 Stopping all services..."
	@pkill -f "anvil" || true
	@npm run blockexplorer:stop || true
	@echo "✅ All services stopped"
