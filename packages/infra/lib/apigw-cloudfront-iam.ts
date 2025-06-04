import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";

export class DemoAPIGWCloudfrontStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "SecureMockApi", {
      restApiName: "SecureMockApi",
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM,
      },
    });

    const hello = api.root.addResource("hello");
    hello.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": JSON.stringify({
                message: "Hello from OAC-protected API!",
              }),
            },
          },
        ],
        requestTemplates: {
          "application/json": '{"statusCode": 200}',
        },
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      }
    );

    const apiDomain = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    const region = this.region;

    const edgeSigner = new lambda.Function(this, "EdgeSigner", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambda-edge-signer/dist")
      ),
      memorySize: 1024,
    });

    const distribution = new cloudfront.Distribution(
      this,
      "ApiGatewayDistribution",
      {
        defaultBehavior: {
          origin: new origins.HttpOrigin(apiDomain, {
            originPath: "/prod",
          }),
          edgeLambdas: [
            {
              functionVersion: edgeSigner.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            },
          ],
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      }
    );

    api.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: ["*"],
      })
    );

    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.domainName}/hello`,
    });

    new cdk.CfnOutput(this, "ApiInvokeUrl", {
      value: api.url + "hello",
    });
  }
}
