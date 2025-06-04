#!/usr/bin/env node
import * as fs from "fs";
import { program } from "commander";
import * as dotenv from "dotenv";
import * as path from "path";

import { openNextBuild } from "../build";
import { zipFolder } from "../zip";

dotenv.config();
program
  .requiredOption(
    "-i --input <string>",
    "The folder where the Next.js app is located"
  )
  .option(
    "-d --debug",
    "disable minifying in esbuild, and add source maps to the output. This can result in code that might be up to 2-3X larger than the production build. Do not enable this in production"
  )
  .option(
    "-m --mode <string>",
    "deploy mode, it can be lambda or node (default: node)"
  )
  .parse(process.argv);

const { input, debug, mode } = program.opts();

async function main() {
  if (!input || !fs.existsSync(input)) {
    throw new Error(`App directory does not exist: ${input}`);
  }

  await openNextBuild(input, debug, mode);

  const openNextFolder = path.join(input, ".open-next");
  const serverFunctionFolder = path.join(
    input,
    ".open-next/server-functions/default"
  );
  const zipPath = path.join(openNextFolder, `server-function.zip`);
  await zipFolder(serverFunctionFolder, zipPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
