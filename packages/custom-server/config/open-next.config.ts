/** @type {import('open-next/types/open-next').OpenNextConfig} */
const openNextConfig = {
  dangerous: {
    disableIncrementalCache: true,
  },
  default: {
    override: {
      wrapper: "node",
      converter: () =>
        import("./overrides/converter").then((mod) => mod.default),
    },
  },
};

export default openNextConfig;
