# General

After you make any changes, please always confirm the following:

- The TypeScript build still works. You can confirm this either globally via "turbo check-types" or on a per-project basis via "turbo check-types --filter app-or-package-name"
- Our linters are still passing. You can confirm this either globally via "turbo lint" or on a per-project basis via "turbo lint --filter app-or-package-name"
- The changes are actually working in the browser. You can use the browser tool to look at the UI and the browser console. If you can't connect to my browser, it's likely because I forgot to activate my MCP browser extension. You can ask me do activate it if that's the case

# Shell Configuration

When using the `run_terminal_cmd` tool, always use zsh with the user's configuration loaded by using:

```bash
zsh -c "source ~/.zshrc && your-command-here"
```

This ensures access to tools managed by Volta (like pnpm, turbo, node) and other development tools configured in the user's environment.

# Node and Package Manager Versions

Please refer to the main package.json to see what Node and Package Manager versions this project uses.
