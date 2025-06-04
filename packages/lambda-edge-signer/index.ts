import { CloudFrontRequestHandler, CloudFrontHeaders } from "aws-lambda";
import { QueryParameterBag } from "@aws-sdk/types";
import { HeaderBag } from "@aws-sdk/types";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";

export const cloudFrontHeadersToHeaderBag = (
  cloudFrontHeaders: CloudFrontHeaders
): HeaderBag => {
  const headerBag: HeaderBag = {};

  for (const [lowerCaseHeader, values] of Object.entries(cloudFrontHeaders)) {
    /**
     * According to the RFC2616, section 4.2,
     * https://datatracker.ietf.org/doc/html/rfc2616#section-4.2
     *
     *   It MUST be possible to combine the multiple header fields into one
     *   "field-name: field-value" pair, without changing the semantics of the
     *   message, by appending each subsequent field-value to the first, each
     *   separated by a comma.
     */
    headerBag[lowerCaseHeader] = values.map(({ value }) => value).join(",");
  }

  return headerBag;
};

export const getRegionFromCustomDomainName = (
  domainName: string
): string | undefined => {
  //   const functionUrlRegExp = /^[a-z0-9]+\.lambda-url\.([a-z0-9-]+)\.on\.aws$/;

  //   const m = domainName.match(functionUrlRegExp);

  //   if (m !== null) {
  //     return m[1];
  //   }
  return "us-east-1";
};

export const getSigV4 = (region: string) => {
  if (process.env.AWS_ACCESS_KEY_ID === undefined)
    throw new Error("AWS_ACCESS_KEY_ID missing");
  if (process.env.AWS_SECRET_ACCESS_KEY === undefined)
    throw new Error("AWS_SECRET_ACCESS_KEY missing");

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  return new SignatureV4({
    service: "execute-api",
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
    sha256: Sha256,
    applyChecksum: false,
  });
};

export const headerBagToCloudFrontHeaders = (
  headerBag: HeaderBag
): CloudFrontHeaders => {
  const cloudFrontHeaders: CloudFrontHeaders = {};
  for (const [header, value] of Object.entries(headerBag)) {
    // 'Authorization' header does not support multiple header fields
    // cloudFrontHeaders[header] = value.split(',').map((v) => ({ key: header, value: v }));
    cloudFrontHeaders[header] = [{ key: header, value }];
  }
  return cloudFrontHeaders;
};

export const queryStringToQueryParameterBag = (
  queryString: string
): QueryParameterBag => {
  const query: QueryParameterBag = {};

  const kvPairs = queryString.split("&").filter((v) => v);

  for (const kvPair of kvPairs) {
    const split = kvPair.split("=") as [string, string?];

    const key = split[0];
    const value = split[1];

    if (query[key] === undefined || query[key] === null) {
      query[key] = value ? decodeURIComponent(value) : null;
      continue;
    }

    if (value === undefined || value === "") {
      continue;
    }

    if (Array.isArray(query[key])) {
      (query[key] as string[]).push(decodeURIComponent(value));
      continue;
    }

    query[key] = [query[key] as string, decodeURIComponent(value)];
  }

  return query;
};

export const handler: CloudFrontRequestHandler = async (event) => {
  const request = event.Records[0].cf.request;

  // The signing function must be triggered by the eventType: 'origin-request'.
  if (request.origin === undefined) {
    throw new Error("origin must be defined");
  }

  // Do not process requests to S3.
  // This should not happen because the signing function is
  // associated to behaviors targeting function URLs.
  if ("s3" in request.origin) {
    return request;
  }

  const domainName = request.origin.custom.domainName;

  const region = getRegionFromCustomDomainName(domainName);

  // Do not process requests to non-Lambda URLs.
  if (region === undefined) {
    return request;
  }

  const query = queryStringToQueryParameterBag(request.querystring);
  const sigv4 = getSigV4(region);

  const signed = await sigv4.sign(
    {
      method: request.method,
      hostname: domainName,
      headers: cloudFrontHeadersToHeaderBag(request.headers),
      path: "/prod" + request.uri,
      query,
      protocol: "https",
      body: request.body?.data
        ? Buffer.from(request.body.data, "base64")
        : undefined,
    },
    { unsignableHeaders: new Set(["x-forwarded-for"]) }
  );

  request.headers = headerBagToCloudFrontHeaders(signed.headers);

  return request;
};
