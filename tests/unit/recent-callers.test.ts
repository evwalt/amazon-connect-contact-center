import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from '../../src/recent-callers/handler';

const ddbMock = mockClient(DynamoDBDocumentClient);
let errorSpy: jest.SpyInstance;

function makeEvent(): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /callers',
    rawPath: '/callers',
    rawQueryString: '',
    headers: { host: 'test.execute-api.us-west-2.amazonaws.com' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'testApiId',
      domainName: 'test.execute-api.us-west-2.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/callers',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: 'GET /callers',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  };
}

const SAMPLE_RECORDS = [
  {
    callerNumber: '+12065551234',
    timestamp: '2024-01-02T00:00:00.000Z',
    vanityNumbers: ['206-FLOWERS', '206-FLOWERP', '206-FLOWERQ'],
    callId: 'call-2',
    gsiPk: 'CALL',
    ttl: 9999999999,
  },
  {
    callerNumber: '+17575701813',
    timestamp: '2024-01-01T00:00:00.000Z',
    vanityNumbers: ['757-JP01T1D', '757-JP01T1E', '757-JP01T1F'],
    callId: 'call-1',
    gsiPk: 'CALL',
    ttl: 9999999999,
  },
];

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = 'TestTable';
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  jest.restoreAllMocks();
});

describe('handler', () => {
  test('returns 200 with callers array on success', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: SAMPLE_RECORDS });

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.callers).toHaveLength(2);
    expect(body.callers[0].callerNumber).toBe('+12065551234');
    expect(body.callers[0].vanityNumbers).toEqual([
      '206-FLOWERS',
      '206-FLOWERP',
      '206-FLOWERQ',
    ]);
  });

  test('returns empty array when no records exist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.callers).toEqual([]);
  });

  test('handles undefined Items gracefully', async () => {
    ddbMock.on(QueryCommand).resolves({});

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.callers).toEqual([]);
  });

  test('queries TimestampIndex with correct parameters', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(makeEvent());

    const [call] = ddbMock.commandCalls(QueryCommand);
    expect(call.args[0].input).toMatchObject({
      TableName: 'TestTable',
      IndexName: 'TimestampIndex',
      ScanIndexForward: false,
      Limit: 5,
    });
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ':pk': 'CALL' });
  });

  test('uses TABLE_NAME environment variable', async () => {
    process.env.TABLE_NAME = 'ProdTable';
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(makeEvent());

    const [call] = ddbMock.commandCalls(QueryCommand);
    expect(call.args[0].input.TableName).toBe('ProdTable');
  });

  test('defaults table name to VanityCallLog when env var is absent', async () => {
    delete process.env.TABLE_NAME;
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(makeEvent());

    const [call] = ddbMock.commandCalls(QueryCommand);
    expect(call.args[0].input.TableName).toBe('VanityCallLog');
  });

  test('returns 500 and logs error when DynamoDB throws', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('DynamoDB unavailable'));

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body!);
    expect(body.error).toBe('Failed to retrieve recent callers');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('response includes CORS header', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
