// Mantine's Vite guide (https://mantine.dev/styles/postcss-preset/) — breakpoint variables and
// the light/dark colour-scheme helpers Mantine's own stylesheets rely on are emitted through
// these two plugins, not hand-rolled here.
module.exports = {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
