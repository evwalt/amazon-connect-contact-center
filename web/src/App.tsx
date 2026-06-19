import { useEffect, useState } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import '@cloudscape-design/global-styles/index.css';

interface CallerRecord {
  callerNumber: string;
  timestamp: string;
  vanityNumbers: string[];
  callId: string;
}

const API_URL: string = import.meta.env.VITE_API_URL ?? '';

// Formats E.164 numbers for display. +17575701813 → +1 (757) 570-1813.
// Returns the raw value unchanged for anything that doesn't match.
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

export default function App() {
  const [callers, setCallers] = useState<CallerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/callers`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ callers: CallerRecord[] }>;
      })
      .then((data) => {
        setCallers(data.callers);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load recent callers. Check VITE_API_URL and try again.');
        setLoading(false);
      });
  }, []);

  return (
    <AppLayout
      navigationHide
      toolsHide
      content={
        <ContentLayout header={<Header variant="h1">Recent Callers</Header>}>
          {error ? (
            <Box color="text-status-error">{error}</Box>
          ) : (
            <Table
              loading={loading}
              loadingText="Loading recent callers…"
              empty={
                <Box textAlign="center" color="inherit">
                  <b>No calls recorded yet</b>
                </Box>
              }
              columnDefinitions={[
                {
                  id: 'callerNumber',
                  header: 'Caller Number',
                  cell: (item) => formatPhone(item.callerNumber),
                  width: 180,
                },
                {
                  id: 'timestamp',
                  header: 'Time',
                  cell: (item) => new Date(item.timestamp).toLocaleString(),
                  width: 200,
                },
                {
                  id: 'vanityNumbers',
                  header: 'Vanity Numbers',
                  cell: (item) => item.vanityNumbers.slice(0, 3).join('  ·  '),
                },
              ]}
              items={callers}
              variant="full-page"
            />
          )}
        </ContentLayout>
      }
    />
  );
}
