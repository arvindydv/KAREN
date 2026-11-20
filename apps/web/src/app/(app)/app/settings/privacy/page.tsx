import type { ConsentHistory, DataRightsList } from '@karen/api-contracts';
import {
  ConsentToggles,
  LegalAcceptance,
  VerifyReceiptsButton,
} from '@/components/app/consent-controls';
import { DataRequestsList, DeletionForm, ExportButton } from '@/components/app/data-rights';
import { NoticeView } from '@/components/app/notice-view';
import { EmptyState, LoadError, PageHeader, SectionCard } from '@/components/app/states';
import { loadPrivacyData } from '@/lib/privacy-data';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Privacy & data' };

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export default async function PrivacySettingsPage() {
  const [privacy, history, rights] = await Promise.all([
    loadPrivacyData(),
    serverGet<ConsentHistory>('v1/me/consents/history'),
    serverGet<DataRightsList>('v1/me/data-rights'),
  ]);
  const { purposes, consents, legal, notices, privacyNoticeVersion } = privacy;
  const openExport = rights.ok
    ? rights.data.items.some(
        (r) => r.kind === 'export' && ['requested', 'processing'].includes(r.status),
      )
    : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy & data"
        intro="You decide what KAREN may do with your data. Every choice is recorded with a tamper-evident receipt."
      />

      <SectionCard
        title="Optional features"
        description="All optional processing is off unless you turn it on. You can change your mind at any time."
      >
        {purposes.ok && consents.ok ? (
          <ConsentToggles
            purposes={purposes.data.items}
            states={consents.data.items}
            noticeVersion={privacyNoticeVersion}
            source="settings"
          />
        ) : (
          <LoadError
            what="your consent settings"
            error={purposes.ok ? (consents.ok ? null : consents.error) : purposes.error}
          />
        )}
      </SectionCard>

      <SectionCard title="Consent history" description="Most recent first.">
        {history.ok ? (
          history.data.items.length === 0 ? (
            <EmptyState>No consent decisions recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--karen-border)] text-sm">
              {history.data.items.map((r) => (
                <li key={r.id} className="py-2">
                  <span className="font-medium">{r.purpose}</span> — {r.decision}
                  <span className="text-xs text-muted">
                    {' '}
                    · {fmt(r.occurred_at)} · notice v{r.notice_version}
                    {r.method.startsWith('cascade:')
                      ? ` · automatically, because ${r.method.slice(8)} was revoked`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <LoadError what="your consent history" error={history.error} />
        )}
        <VerifyReceiptsButton />
      </SectionCard>

      <SectionCard title="Notices & terms">
        {notices.length === 0 ? (
          <EmptyState>No notices are published yet.</EmptyState>
        ) : (
          notices.map((n) => <NoticeView key={`${n.kind}-${n.version}`} notice={n} />)
        )}
        {legal.ok ? (
          <LegalAcceptance items={legal.data.items} />
        ) : (
          <LoadError what="your acknowledgements" error={legal.error} />
        )}
      </SectionCard>

      <SectionCard
        title="Your data"
        description="Get a copy of everything KAREN holds about you, as JSON."
      >
        {rights.ok ? (
          <>
            <ExportButton hasOpenExport={openExport} />
            <DataRequestsList items={rights.data.items} />
          </>
        ) : (
          <LoadError what="your data requests" error={rights.error} />
        )}
      </SectionCard>

      <SectionCard title="Delete your account" description="This needs your current password.">
        <DeletionForm />
      </SectionCard>
    </div>
  );
}
