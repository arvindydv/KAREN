import { createHash } from 'node:crypto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';

/** Inserts DRAFT placeholder notices for tests (idempotent). Never legally reviewed text. */
export const TEST_NOTICE_VERSION = 'test-draft-1';

export async function ensureDraftNotices(owner: PrismaService, version = TEST_NOTICE_VERSION) {
  for (const kind of ['privacy_notice', 'terms_of_service', 'ai_disclosure']) {
    for (const locale of ['en-IN', 'hi-IN']) {
      const content = `DRAFT — NOT LEGALLY REVIEWED. Test placeholder for ${kind} (${locale}) ${version}.`;
      const contentSha256 = `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
      await owner.notice.upsert({
        where: { kind_locale_version: { kind, locale, version } },
        create: { kind, locale, version, content, contentSha256 },
        update: {},
      });
    }
  }
}
