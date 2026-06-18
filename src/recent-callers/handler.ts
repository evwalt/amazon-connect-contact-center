import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env.TABLE_NAME ?? 'VanityCallLog';

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'TimestampIndex',
        KeyConditionExpression: 'gsiPk = :pk',
        ExpressionAttributeValues: { ':pk': 'CALL' },
        ScanIndexForward: false,
        Limit: 5,
      }),
    );

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ callers: result.Items ?? [] }),
    };
  } catch (err) {
    console.error({ err }, 'Failed to query recent callers');
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Failed to retrieve recent callers' }),
    };
  }
}
