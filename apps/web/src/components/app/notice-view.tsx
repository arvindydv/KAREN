import type { Notice } from '@karen/api-contracts';

const KIND_TITLE: Record<Notice['kind'], string> = {
  privacy_notice: 'Privacy notice',
  terms_of_service: 'Terms of service',
  ai_disclosure: 'AI disclosure',
};

export const noticeTitle = (kind: Notice['kind']) => KIND_TITLE[kind];

/** Banner REQUIRED on any notice that is not legally reviewed. */
export function DraftBanner() {
  return (
    <p
      role="note"
      className="rounded-[var(--karen-radius-sm)] border border-[var(--karen-warning)] px-3 py-2 text-xs font-semibold text-[var(--karen-warning)]"
    >
      Draft — not legally reviewed
    </p>
  );
}

/** A notice rendered as plain text (never as HTML: notice content is not trusted markup). */
export function NoticeView({ notice }: { notice: Notice }) {
  return (
    <details className="rounded-[var(--karen-radius-md)] border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {KIND_TITLE[notice.kind]} · version {notice.version}
        {notice.state === 'draft' ? ' (draft)' : ''}
      </summary>
      <div className="mt-3 space-y-3">
        {notice.state === 'draft' ? <DraftBanner /> : null}
        <div className="max-h-80 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-muted">
          {notice.content}
        </div>
      </div>
    </details>
  );
}
