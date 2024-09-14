import { IncomingMessage, ServerResponse } from "http";
import converter from "open-next/converters/node.js";
import { InternalResult } from "open-next/types/open-next.js";
import { randomUUID } from "crypto";

const CustomNodeConverter = {
  convertFrom: async (event: IncomingMessage, other: any) => {
    const result: any = await converter.convertFrom(event);

    return {
      ...result,
      headers: {
        ...result.headers,
        "x-inserted-in-converter": randomUUID(),
      },
    };
  },
  convertTo: async (intResult: InternalResult) => {
    const result = await converter.convertTo(intResult);
    return {
      ...result,
      headers: {
        ...result.headers,
        "x-converter-end": "1",
      },
    };
  },
  name: "custom-node-converter",
};

export default CustomNodeConverter;
