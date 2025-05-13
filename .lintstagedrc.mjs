export default {
  "**/*.ts?(x)": () => "pnpm check-types",
  "**/*.(ts|tsx|js|jsx)": (filenames) => {
    return [
      `pnpm dlx eslint ${filenames.join(" ")} --max-warnings 100`,
      `pnpm prettier --write ${filenames.join(" ")} --list-different`,
    ];
  },
  "**/*.(css|json)": (filenames) => {
    return [`pnpm prettier --write ${filenames.join(" ")} --list-different`];
  },
};
