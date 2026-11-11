# ChronoCCG plugin — common dev tasks.
# Everything runs inside Docker so no Node toolchain is needed on the host.

COMPOSE ?= docker compose
# Always anchor paths to the Makefile's directory, never the caller's $PWD.
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
VAULT_PLUGIN_DIR := $(ROOT)/TstVault/.obsidian/plugins/chronoccg

.PHONY: help image install build dev test lint shell clean link unlink reinstall

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target>\n\nTargets:\n"} \
		/^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

image: ## Build the dev Docker image
	$(COMPOSE) build

install: ## npm install inside the container (populates plugin/node_modules)
	$(COMPOSE) run --rm install

build: ## One-shot production build (typecheck + minify)
	$(COMPOSE) run --rm build

dev: ## Watch mode — rebuilds plugin/main.js on save (Ctrl-C to stop)
	$(COMPOSE) up dev

test: ## Run unit tests (deck codec, parser, rules)
	$(COMPOSE) run --rm shell -c "npm test"

lint: ## Lint with Obsidian's community-plugin rules (eslint-plugin-obsidianmd)
	$(COMPOSE) run --rm shell -c "npm run lint"

shell: ## Open a shell inside the dev container
	$(COMPOSE) run --rm shell

clean: ## Remove build artifacts and node_modules
	rm -rf $(ROOT)/plugin/node_modules $(ROOT)/plugin/main.js $(ROOT)/plugin/main.js.map

reinstall: clean install ## Wipe and reinstall dependencies

link: ## Symlink plugin/ into the test vault so Obsidian can load it
	mkdir -p $(ROOT)/TstVault/.obsidian/plugins
	@if [ -e "$(VAULT_PLUGIN_DIR)" ] || [ -L "$(VAULT_PLUGIN_DIR)" ]; then \
		echo "$(VAULT_PLUGIN_DIR) already exists — run 'make unlink' first if you want to recreate it."; \
	else \
		ln -s "$(ROOT)/plugin" "$(VAULT_PLUGIN_DIR)" && \
		echo "Linked $(VAULT_PLUGIN_DIR) -> $(ROOT)/plugin"; \
	fi

unlink: ## Remove the test-vault symlink
	@if [ -L "$(VAULT_PLUGIN_DIR)" ]; then \
		rm "$(VAULT_PLUGIN_DIR)" && echo "Removed $(VAULT_PLUGIN_DIR)"; \
	else \
		echo "$(VAULT_PLUGIN_DIR) is not a symlink — refusing to delete."; \
	fi
