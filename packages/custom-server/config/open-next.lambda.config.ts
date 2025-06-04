import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";
const openNextConfig = {
  dangerous: {
    disableIncrementalCache: true,
  },
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
    },
  },
} satisfies OpenNextConfig;

export default openNextConfig;
