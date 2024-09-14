#!/usr/bin/env node
import * as fs from "fs";
import { program } from "commander";
import * as dotenv from "dotenv";
import { openNextBuild } from "../build";

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
  .parse(process.argv);

const { input, debug } = program.opts();

if (!input || !fs.existsSync(input)) {
  throw new Error(`App directory does not exist: ${input}`);
}

openNextBuild(input, debug);
