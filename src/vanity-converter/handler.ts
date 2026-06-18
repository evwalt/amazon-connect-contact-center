import type { ConnectContactFlowEvent, ConnectContactFlowResult } from 'aws-lambda';
import { extractSubscriberDigits, generateCandidates } from './converter';
import { rankCandidates } from './scorer';
import { getWordSet, getBlocklistSet } from './wordlist';
import { writeCallRecord } from './dynamo';

const TTL_SECONDS = 90 * 24 * 60 * 60;

const ERROR_RESPONSE: ConnectContactFlowResult = {
  status: 'error',
  vanity1: '',
  vanity2: '',
  vanity3: '',
};

// Extracts the area code from an E.164 number for output formatting.
// US E.164 (+1NXXNXXXXXX): returns the 3-digit area code.
// Other formats: returns everything before the last 7 subscriber digits.
function extractAreaCode(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return digits.slice(1, 4);
  }
  return digits.length > 7 ? digits.slice(0, digits.length - 7) : '';
}

export async function handler(event: ConnectContactFlowEvent): Promise<ConnectContactFlowResult> {
  const callerNumber = event.Details.ContactData.CustomerEndpoint?.Address;
  const callId = event.Details.ContactData.ContactId;

  if (!callerNumber) {
    console.warn({ callId }, 'No caller number; returning error response');
    return ERROR_RESPONSE;
  }

  let top5: string[];
  try {
    const areaCode = extractAreaCode(callerNumber);
    const subscriberDigits = extractSubscriberDigits(callerNumber);
    const candidates = generateCandidates(subscriberDigits);
    const ranked = rankCandidates(candidates, getWordSet(), getBlocklistSet(), 5);
    top5 = ranked.map((candidate) => (areaCode ? `${areaCode}-${candidate}` : candidate));
  } catch (err) {
    console.error({ callId, callerNumber, err }, 'Vanity generation failed');
    return ERROR_RESPONSE;
  }

  try {
    const now = new Date();
    const tableName = process.env.TABLE_NAME ?? 'VanityCallLog';
    await writeCallRecord(tableName, {
      callerNumber,
      timestamp: now.toISOString(),
      vanityNumbers: top5,
      callId,
      gsiPk: 'CALL',
      ttl: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
    });
  } catch (err) {
    console.error({ callId, callerNumber, err }, 'DynamoDB write failed');
    return ERROR_RESPONSE;
  }

  return {
    status: 'success',
    vanity1: top5[0] ?? '',
    vanity2: top5[1] ?? '',
    vanity3: top5[2] ?? '',
  };
}
