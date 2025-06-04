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

interface OpenNextOutput {
  origins: Record<string, any>;
  behaviors: {
    pattern: string;
    origin?: string;
    edgeFunction?: string;
  }[];
}

export class SimpleCloudFrontLambdaUrl extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const bucket = this.createStaticAssetsBucket();
    const openNextOutput = this.readOpenNextOutput();

    this.deployStaticAssets(bucket);

    const serverFunction = this.createServerFunction(bucket);
    const functionDomainName = Fn.parseDomainName(
      serverFunction.addFunctionUrl({
        authType: FunctionUrlAuthType.AWS_IAM,
        invokeMode: InvokeMode.RESPONSE_STREAM,
      }).url
    );

    const cfFunction = this.createCloudFrontHeaderFunction();
    const serverCachePolicy = this.createServerCachePolicy();

    const oacS3 = this.createOriginAccessControl("S3OAC", "s3");
    const oacLambda = this.createOriginAccessControl("LambdaOAC", "lambda");

    const distribution = this.createCloudFrontDistribution({
      bucket,
      openNextOutput,
      serverCachePolicy,
      cfFunction,
      functionDomainName,
      oacS3,
      oacLambda,
    });

    this.grantCloudFrontAccess(bucket, distribution);
    this.grantLambdaInvokePermission(serverFunction, distribution);
  }

  private createStaticAssetsBucket(): Bucket {
    return new Bucket(this, "StaticBucket", {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
  }

  private deployStaticAssets(bucket: Bucket) {
    new BucketDeployment(this, "DeployStatic", {
      sources: [
        Source.asset(
          path.join(__dirname, "../../../apps/web/.open-next/assets")
        ),
      ],
      destinationBucket: bucket,
    });
  }

  private createServerFunction(bucket: Bucket): CdkFunction {
    const fn = new CdkFunction(this, "ServerFunction", {
      runtime: Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: Code.fromAsset(
        path.join(__dirname, "../../../apps/web/.open-next/server-function.zip")
      ),
      memorySize: 1024,
      timeout: Duration.seconds(30),
    });

    bucket.grantReadWrite(fn);
    return fn;
  }

  private createCloudFrontHeaderFunction(): CloudfrontFunction {
    return new CloudfrontFunction(this, "CfHeaderFunction", {
      code: FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          request.headers["x-forwarded-host"] = request.headers.host;
          return request;
        }
      `),
    });
  }

  private createServerCachePolicy(): CachePolicy {
    return new CachePolicy(this, "ServerCachePolicy", {
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
  }

  private createOriginAccessControl(
    name: string,
    type: "s3" | "lambda"
  ): CfnOriginAccessControl {
    return new CfnOriginAccessControl(this, name, {
      originAccessControlConfig: {
        name,
        description: `OAC for ${type.toUpperCase()}`,
        originAccessControlOriginType: type,
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });
  }

  private createCloudFrontDistribution(params: {
    bucket: Bucket;
    openNextOutput: OpenNextOutput;
    serverCachePolicy: CachePolicy;
    cfFunction: CloudfrontFunction;
    functionDomainName: string;
    oacS3: CfnOriginAccessControl;
    oacLambda: CfnOriginAccessControl;
  }): CfnDistribution {
    const {
      bucket,
      openNextOutput,
      serverCachePolicy,
      cfFunction,
      functionDomainName,
      oacS3,
      oacLambda,
    } = params;

    const origins = Object.entries(openNextOutput.origins).map(
      ([key, originConfig]) => {
        const isS3 = originConfig.type === "s3";
        return {
          id: key,
          domainName: isS3
            ? bucket.bucketRegionalDomainName
            : functionDomainName,
          originAccessControlId: isS3 ? oacS3.attrId : oacLambda.attrId,
          s3OriginConfig: isS3 ? {} : undefined,
          customOriginConfig: !isS3
            ? { originProtocolPolicy: "https-only" }
            : undefined,
        };
      }
    );

    const behaviors = openNextOutput.behaviors
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
            ? CachePolicy.CACHING_OPTIMIZED.cachePolicyId
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
      });

    return new CfnDistribution(this, "Distribution", {
      distributionConfig: {
        enabled: true,
        origins,
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
        cacheBehaviors: behaviors,
      },
    });
  }

  private grantCloudFrontAccess(bucket: Bucket, distribution: CfnDistribution) {
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
  }

  private grantLambdaInvokePermission(
    lambdaFn: CdkFunction,
    distribution: CfnDistribution
  ) {
    lambdaFn.addPermission("AllowCloudFrontInvoke", {
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunctionUrl",
      functionUrlAuthType: FunctionUrlAuthType.AWS_IAM,
      sourceArn: `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.ref}`,
    });
  }

  private readOpenNextOutput(): OpenNextOutput {
    const outputPath = path.join(
      __dirname,
      "../../../apps/web/.open-next/open-next.output.json"
    );
    const fileContent = fs.readFileSync(outputPath, "utf-8");
    return JSON.parse(fileContent);
  }
}
