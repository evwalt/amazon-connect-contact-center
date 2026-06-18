import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface CallRecord {
  callerNumber: string;
  timestamp: string;
  vanityNumbers: string[];
  callId: string;
  gsiPk: 'CALL';
  ttl: number;
}

export async function writeCallRecord(tableName: string, record: CallRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
    }),
  );
}
