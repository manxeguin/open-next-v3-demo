import { Construct } from "constructs";
import { Stack, Fn, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import * as path from "path";
import * as fs from "fs";

import {
  Function as CdkFunction,
  Runtime,
  Code,
  FunctionUrlAuthType,
  InvokeMode,
} from "aws-cdk-lib/aws-lambda";
import {
  CachePolicy,
  OriginRequestPolicy,
  Function as CloudfrontFunction,
  FunctionCode,
  CacheCookieBehavior,
  CacheQueryStringBehavior,
  CacheHeaderBehavior,
  CfnOriginAccessControl,
  CfnDistribution,
} from "aws-cdk-lib/aws-cloudfront";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export class SimpleCloudFrontLambdaUrl extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const bucket = new Bucket(this, "StaticBucket", {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    new BucketDeployment(this, "DeployStatic", {
      sources: [
        Source.asset(
          path.join(__dirname, "../../../apps/web/.open-next/assets")
        ),
      ],
      destinationBucket: bucket,
    });

    const serverFunction = new CdkFunction(this, "ServerFunction", {
      runtime: Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: Code.fromAsset(
        path.join(__dirname, "../../../apps/web/.open-next/server-function.zip")
      ),
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {},
    });

    const fnUrl = serverFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    const functionDomainName = Fn.parseDomainName(fnUrl.url);

    bucket.grantReadWrite(serverFunction);

    const cfFunction = new CloudfrontFunction(this, "CfHeaderFunction", {
      code: FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          request.headers["x-forwarded-host"] = request.headers.host;
          return request;
        }
      `),
    });

    const serverCachePolicy = new CachePolicy(this, "ServerCachePolicy", {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        "accept",
        "accept-encoding",
        "rsc",
        "next-router-prefetch",
        "next-router-state-tree",
        "next-url",
        "x-prerender-revalidate"
      ),
      cookieBehavior: CacheCookieBehavior.none(),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      minTtl: Duration.seconds(0),
    });

    const staticCachePolicy = CachePolicy.CACHING_OPTIMIZED;

    interface OpenNextOutput {
      origins: {
        s3: any;
        default: any;
        imageOptimizer: any;
      };
      behaviors: {
        pattern: string;
        origin?: string;
        edgeFunction?: string;
      }[];
    }

    const outputPath = path.join(
      __dirname,
      "../../../apps/web/.open-next/open-next.output.json"
    );
    const fileContent = fs.readFileSync(outputPath, "utf-8");
    const openNextOutput = JSON.parse(fileContent) as OpenNextOutput;

    const oac = new CfnOriginAccessControl(this, "CloudFrontOAC", {
      originAccessControlConfig: {
        name: "MyS3OAC",
        description: "OAC for CloudFront to access S3",
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    const lambdaOac = new CfnOriginAccessControl(this, "LambdaOAC", {
      originAccessControlConfig: {
        name: "LambdaOAC",
        description: "OAC for Lambda Function URL",
        originAccessControlOriginType: "lambda",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    const distribution = new CfnDistribution(this, "Distribution", {
      distributionConfig: {
        enabled: true,
        origins: [
          ...Object.entries(openNextOutput.origins).map(
            ([key, originConfig]) => {
              const isS3 = originConfig.type === "s3";
              return {
                id: key,
                domainName: isS3
                  ? bucket.bucketRegionalDomainName
                  : functionDomainName,
                originAccessControlId: isS3 ? oac.attrId : lambdaOac.attrId,
                s3OriginConfig: isS3 ? {} : undefined,
                customOriginConfig: !isS3
                  ? {
                      originProtocolPolicy: "https-only",
                    }
                  : undefined,
              };
            }
          ),
        ],
        defaultCacheBehavior: {
          targetOriginId: "default",
          viewerProtocolPolicy: "redirect-to-https",
          allowedMethods: ["GET", "HEAD", "OPTIONS"],
          cachedMethods: ["GET", "HEAD"],
          cachePolicyId: serverCachePolicy.cachePolicyId,
          originRequestPolicyId:
            OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
              .originRequestPolicyId,
          functionAssociations: [
            {
              eventType: "viewer-request",
              functionArn: cfFunction.functionArn,
            },
          ],
        },
        cacheBehaviors: openNextOutput.behaviors
          .filter((b) => b.pattern !== "*" && b.origin !== "imageOptimizer")
          .map((behavior) => {
            const isS3 = behavior.origin === "s3";
            return {
              pathPattern: behavior.pattern,
              targetOriginId: behavior.origin ?? "default",
              viewerProtocolPolicy: "redirect-to-https",
              allowedMethods: ["GET", "HEAD", "OPTIONS"],
              cachedMethods: ["GET", "HEAD"],
              cachePolicyId: isS3
                ? staticCachePolicy.cachePolicyId
                : serverCachePolicy.cachePolicyId,
              originRequestPolicyId: isS3
                ? undefined
                : OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
                    .originRequestPolicyId,
              functionAssociations: [
                {
                  eventType: "viewer-request",
                  functionArn: cfFunction.functionArn,
                },
              ],
            };
          }),
      },
    });

    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects("*")],
        principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.ref}`,
          },
        },
      })
    );

    serverFunction.addPermission("AllowCloudFrontInvoke", {
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunctionUrl",
      functionUrlAuthType: FunctionUrlAuthType.AWS_IAM,
      sourceArn: `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.ref}`,
    });
  }
}
