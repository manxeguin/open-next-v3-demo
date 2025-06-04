import converter from "@opennextjs/aws/overrides/converters/aws-apigw-v2.js";
import type { Converter } from "@opennextjs/aws/types/overrides.js";
import { randomUUID } from "crypto";

export default {
  convertFrom: async (event) => {
    const result = await converter.convertFrom(event);
    return {
      ...result,
      headers: {
        ...result.headers,
        "x-inserted-in-converter": randomUUID(),
      },
    };
  },
  convertTo: async (intResult) => {
    const result = await converter.convertTo(intResult);
    return {
      ...result,
      headers: {
        ...result.headers,
        "x-converter-end": "1",
      },
    };
  },
  name: "custom-apigw-v2",
};
