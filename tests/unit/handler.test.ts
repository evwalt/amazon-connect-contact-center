import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { ConnectContactFlowEvent } from 'aws-lambda';
import { handler } from '../../src/vanity-converter/handler';
import { writeCallRecord } from '../../src/vanity-converter/dynamo';
import * as converterModule from '../../src/vanity-converter/converter';
import * as scorerModule from '../../src/vanity-converter/scorer';

const ddbMock = mockClient(DynamoDBDocumentClient);
let consoleSpy!: { warn: jest.SpyInstance; error: jest.SpyInstance };

function makeEvent(address: string | null, contactId = 'test-contact-id'): ConnectContactFlowEvent {
  return {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        Attributes: {},
        Channel: 'VOICE',
        ContactId: contactId,
        CustomerEndpoint: address !== null ? { Address: address, Type: 'TELEPHONE_NUMBER' } : null,
        InitialContactId: contactId,
        InitiationMethod: 'INBOUND',
        InstanceARN: 'arn:aws:connect:us-east-1:123456789012:instance/test',
        PreviousContactId: '',
        Queue: null,
        SystemEndpoint: null,
        MediaStreams: { Customer: { Audio: null } },
      },
      Parameters: {},
    },
  };
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  process.env.TABLE_NAME = 'TestTable';
  consoleSpy = {
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  jest.restoreAllMocks();
});

describe('handler', () => {
  test('returns success response for a valid US caller', async () => {
    const result = await handler(makeEvent('+12065551234'));
    expect(result.status).toBe('success');
    expect(typeof result.vanity1).toBe('string');
    expect(typeof result.vanity2).toBe('string');
    expect(typeof result.vanity3).toBe('string');
  });

  test('prefixes vanity numbers with the caller area code', async () => {
    const result = await handler(makeEvent('+12065551234'));
    expect(result.vanity1).toMatch(/^206-/);
    expect(result.vanity2).toMatch(/^206-/);
    expect(result.vanity3).toMatch(/^206-/);
  });

  test('uses TABLE_NAME env var for DynamoDB table name', async () => {
    process.env.TABLE_NAME = 'CustomTable';
    await handler(makeEvent('+12065551234'));
    const [call] = ddbMock.commandCalls(PutCommand);
    expect(call.args[0].input.TableName).toBe('CustomTable');
  });

  test('defaults table name to VanityCallLog when env var is absent', async () => {
    delete process.env.TABLE_NAME;
    await handler(makeEvent('+12065551234'));
    const [call] = ddbMock.commandCalls(PutCommand);
    expect(call.args[0].input.TableName).toBe('VanityCallLog');
  });

  test('writes callerNumber and callId to DynamoDB item', async () => {
    await handler(makeEvent('+12065551234', 'my-contact-id'));
    const [call] = ddbMock.commandCalls(PutCommand);
    const item = call.args[0].input.Item as Record<string, unknown>;
    expect(item.callerNumber).toBe('+12065551234');
    expect(item.callId).toBe('my-contact-id');
  });

  test('sets gsiPk to "CALL" in DynamoDB item', async () => {
    await handler(makeEvent('+12065551234'));
    const [call] = ddbMock.commandCalls(PutCommand);
    const item = call.args[0].input.Item as Record<string, unknown>;
    expect(item.gsiPk).toBe('CALL');
  });

  test('writes a valid ISO 8601 timestamp to DynamoDB', async () => {
    await handler(makeEvent('+12065551234'));
    const [call] = ddbMock.commandCalls(PutCommand);
    const item = call.args[0].input.Item as Record<string, unknown>;
    const ts = item.timestamp as string;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  test('sets ttl to approximately 90 days from now', async () => {
    const before = Math.floor(Date.now() / 1000);
    await handler(makeEvent('+12065551234'));
    const after = Math.floor(Date.now() / 1000);
    const [call] = ddbMock.commandCalls(PutCommand);
    const item = call.args[0].input.Item as Record<string, unknown>;
    const ttl = item.ttl as number;
    const ninetyDays = 90 * 24 * 60 * 60;
    expect(typeof ttl).toBe('number');
    expect(ttl).toBeGreaterThanOrEqual(before + ninetyDays);
    expect(ttl).toBeLessThanOrEqual(after + ninetyDays);
  });

  test('stores at most 5 vanity numbers in DynamoDB', async () => {
    await handler(makeEvent('+12065551234'));
    const [call] = ddbMock.commandCalls(PutCommand);
    const item = call.args[0].input.Item as Record<string, unknown>;
    const vanityNumbers = item.vanityNumbers as string[];
    expect(vanityNumbers.length).toBeGreaterThan(0);
    expect(vanityNumbers.length).toBeLessThanOrEqual(5);
  });

  test('returns error response when CustomerEndpoint is null', async () => {
    const result = await handler(makeEvent(null));
    expect(result.status).toBe('error');
    expect(result.vanity1).toBe('');
    expect(result.vanity2).toBe('');
    expect(result.vanity3).toBe('');
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'test-contact-id' }),
      expect.stringContaining('No caller number'),
    );
  });

  test('does not write to DynamoDB when CustomerEndpoint is null', async () => {
    await handler(makeEvent(null));
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'test-contact-id' }),
      expect.stringContaining('No caller number'),
    );
  });

  test('returns error response when DynamoDB write fails', async () => {
    ddbMock.on(PutCommand).rejects(new Error('ProvisionedThroughputExceededException'));
    const result = await handler(makeEvent('+12065551234'));
    expect(result.status).toBe('error');
    expect(result.vanity1).toBe('');
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'test-contact-id', callerNumber: '+12065551234' }),
      expect.stringContaining('DynamoDB write failed'),
    );
  });

  test('returns error response when vanity generation fails', async () => {
    jest.spyOn(converterModule, 'generateCandidates').mockImplementationOnce(() => {
      throw new Error('conversion failed');
    });
    const result = await handler(makeEvent('+12065551234'));
    expect(result.status).toBe('error');
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'test-contact-id', callerNumber: '+12065551234' }),
      expect.stringContaining('Vanity generation failed'),
    );
  });

  test('does not write to DynamoDB when vanity generation fails', async () => {
    jest.spyOn(converterModule, 'generateCandidates').mockImplementationOnce(() => {
      throw new Error('conversion failed');
    });
    await handler(makeEvent('+12065551234'));
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'test-contact-id', callerNumber: '+12065551234' }),
      expect.stringContaining('Vanity generation failed'),
    );
  });

  test('returns empty strings for missing vanity slots when fewer than 3 results', async () => {
    jest.spyOn(scorerModule, 'rankCandidates').mockReturnValueOnce(['JJJAAAB']);
    const result = await handler(makeEvent('+12065551234'));
    expect(result.status).toBe('success');
    expect(result.vanity1).toBe('206-JJJAAAB');
    expect(result.vanity2).toBe('');
    expect(result.vanity3).toBe('');
  });

  test('returns all empty vanity slots when ranked list is empty', async () => {
    jest.spyOn(scorerModule, 'rankCandidates').mockReturnValueOnce([]);
    const result = await handler(makeEvent('+12065551234'));
    expect(result.status).toBe('success');
    expect(result.vanity1).toBe('');
    expect(result.vanity2).toBe('');
    expect(result.vanity3).toBe('');
  });

  test('omits area code prefix when none is extractable from the caller number', async () => {
    // 7-digit number: extractAreaCode returns '' → vanity returned without prefix
    jest.spyOn(scorerModule, 'rankCandidates').mockReturnValueOnce(['JJJAAAB']);
    const result = await handler(makeEvent('5551234'));
    expect(result.status).toBe('success');
    expect(result.vanity1).toBe('JJJAAAB');
  });

  test('extracts area code from non-US number formats', async () => {
    // 10-digit number without country code: falls through to the length>7 branch
    jest.spyOn(scorerModule, 'rankCandidates').mockReturnValueOnce(['JJJAAAB']);
    const result = await handler(makeEvent('2065551234'));
    expect(result.status).toBe('success');
    // extractAreaCode('2065551234'): 10 digits, not US E.164 → slice(0, 3) = '206'
    expect(result.vanity1).toBe('206-JJJAAAB');
  });

  test('regression: +17575701813 returns best-effort results for all-digit-bearing subscriber', async () => {
    // Subscriber digits 5701813 → [JKL][PQRS]01[TUV]1[DEF].
    // The embedded 0 and two 1s are unavoidable; no dictionary words are possible.
    // Verifies the handler returns success with correct area code and digit pattern.
    const result = await handler(makeEvent('+17575701813'));
    expect(result.status).toBe('success');
    const pattern = /^757-[JKL][PQRS]01[TUV]1[DEF]$/;
    expect(result.vanity1).toMatch(pattern);
    expect(result.vanity2).toMatch(pattern);
    expect(result.vanity3).toMatch(pattern);
  });
});

describe('writeCallRecord', () => {
  test('sends a PutCommand with the provided table name and record fields', async () => {
    await writeCallRecord('MyTable', {
      callerNumber: '+15035551234',
      timestamp: '2026-06-17T00:00:00.000Z',
      vanityNumbers: ['503-JJJAAAB'],
      callId: 'call-99',
      gsiPk: 'CALL',
      ttl: 9999999999,
    });
    const [call] = ddbMock.commandCalls(PutCommand);
    expect(call.args[0].input.TableName).toBe('MyTable');
    expect(call.args[0].input.Item).toMatchObject({
      callerNumber: '+15035551234',
      callId: 'call-99',
      gsiPk: 'CALL',
      ttl: 9999999999,
    });
  });
});
