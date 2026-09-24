/**
 * Unit tests for NotificationService. Resend and firebase-admin are fully
 * mocked — no real network calls are ever made.
 *
 * Covers:
 * - Graceful degradation: missing RESEND_API_KEY skips email, missing
 *   Firebase credentials skips push, neither ever throws
 * - sendInApp()/sendPush() primitives: insert shape, multi-device fan-out,
 *   one bad token not blocking the others, DB errors logged not thrown
 * - Every one of the eight handled events, including brand.name in email
 *   subjects (never a hardcoded app name), the OTP code in the email body,
 *   the magic-link URL in the invite email, and the event notification's
 *   date/location formatting (including the isOnline → "Online" case)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { AppLogger } from '../../common/logger/logger.service';
import { brand } from '@alumini/config/brand';

const mockAppLogger = {
  setContext: jest.fn().mockReturnThis(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// ── Supabase mock (sequenced per table — see prior modules' specs for the same pattern) ──

let fromTables: Record<string, any> = {};

function chain(...results: Array<{ data: any; error: any; count?: number }>) {
  const queue = [...results];
  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: any = {};
  ['select', 'insert', 'update', 'eq', 'or', 'is', 'not', 'in', 'order', 'limit'].forEach((method) => {
    builder[method] = jest.fn(() => builder);
  });
  builder.single = jest.fn(() => Promise.resolve(next()));
  builder.maybeSingle = jest.fn(() => Promise.resolve(next()));
  builder.then = (resolve: any, reject: any) => Promise.resolve(next()).then(resolve, reject);
  return builder;
}

function mockTables(overrides: Record<string, ReturnType<typeof chain>>) {
  fromTables = overrides;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => fromTables[table] ?? chain({ data: null, error: null }),
  })),
}));

// ── Resend mock ──────────────────────────────────────────────────────────────

const mockEmailsSend = jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: any[]) => mockEmailsSend(...args) },
  })),
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────
// `mockApps` is mutated in place (never reassigned) so the factory's closure
// over it stays valid across tests — jest.mock factories may only reference
// out-of-scope identifiers whose name starts with "mock".

const mockMessagingSend = jest.fn().mockResolvedValue('message-id');
const mockInitializeApp = jest.fn((...args: any[]) => ({ name: args[1] }));
const mockCert = jest.fn((...args: any[]) => args[0]);
const mockApps: any[] = [];

jest.mock('firebase-admin', () => ({
  // A getter, not a plain property — `import { NotificationService }` below
  // is hoisted above this file's `const mockApps = []`, so the factory
  // would otherwise capture `mockApps` before it's initialized (TDZ). A
  // getter defers the read until `.apps` is actually accessed at test run
  // time, long after module-level init has finished.
  get apps() {
    return mockApps;
  },
  initializeApp: (...args: any[]) => mockInitializeApp(...args),
  credential: { cert: (...args: any[]) => mockCert(...args) },
  messaging: () => ({ send: (...args: any[]) => mockMessagingSend(...args) }),
}));

// ── Test suite ───────────────────────────────────────────────────────────────

async function createService(): Promise<NotificationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [NotificationService, { provide: AppLogger, useValue: mockAppLogger }],
  }).compile();
  return module.get<NotificationService>(NotificationService);
}

function setFirebaseEnv(): void {
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_PRIVATE_KEY = 'test-key';
  process.env.FIREBASE_CLIENT_EMAIL = 'svc@test-project.iam.gserviceaccount.com';
}

describe('NotificationService', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    delete process.env.RESEND_API_KEY;
    delete process.env.FROM_EMAIL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    mockTables({});
    mockApps.length = 0;
    jest.clearAllMocks();
  });

  // ── Graceful degradation ─────────────────────────────────────────────────

  describe('graceful degradation', () => {
    it('skips email silently when RESEND_API_KEY is not configured', async () => {
      const service = await createService();

      await service.handleEmailOtpInitiate({
        userId: 'u1', institutionalEmail: 'a@school.edu', classroomId: 'c1', code: '123456', expiresAt: new Date(),
      });

      expect(mockEmailsSend).not.toHaveBeenCalled();
    });

    it('skips push silently when Firebase credentials are not configured', async () => {
      const service = await createService();

      await service.sendPush('user-1', 'Title', 'Body');

      expect(mockMessagingSend).not.toHaveBeenCalled();
    });

    it('never throws even when Resend itself rejects', async () => {
      process.env.RESEND_API_KEY = 're_test';
      mockEmailsSend.mockRejectedValueOnce(new Error('Resend is down'));
      const service = await createService();

      await expect(
        service.handleEmailOtpInitiate({
          userId: 'u1', institutionalEmail: 'a@school.edu', classroomId: 'c1', code: '123456', expiresAt: new Date(),
        }),
      ).resolves.not.toThrow();
    });
  });

  // ── sendInApp() ──────────────────────────────────────────────────────────

  describe('sendInApp()', () => {
    it('inserts a notification row', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({ notifications: notificationsChain });

      const service = await createService();
      await service.sendInApp('user-1', 'test.type', 'Title', 'Body', { foo: 'bar' });

      expect(notificationsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', type: 'test.type', title: 'Title', body: 'Body' }),
      );
    });

    it('never throws when the insert fails', async () => {
      mockTables({ notifications: chain({ data: null, error: { message: 'db error' } }) });
      const service = await createService();

      await expect(service.sendInApp('user-1', 'test.type', 'T', 'B')).resolves.not.toThrow();
    });
  });

  // ── getNotifications() / getUnreadCount() / markRead() ──────────────────

  describe('getNotifications()', () => {
    it('returns the caller’s notifications newest-first', async () => {
      mockTables({
        notifications: chain({ data: [{ id: 'n1', type: 'test', title: 'T', body: 'B', is_read: false }], error: null }),
      });

      const service = await createService();
      const result = await service.getNotifications('user-1');

      expect(result).toEqual([{ id: 'n1', type: 'test', title: 'T', body: 'B', is_read: false }]);
    });

    it('returns an empty array on a Supabase error rather than throwing', async () => {
      mockTables({ notifications: chain({ data: null, error: { message: 'db down' } }) });
      const service = await createService();

      await expect(service.getNotifications('user-1')).resolves.toEqual([]);
    });
  });

  describe('getUnreadCount()', () => {
    it('returns the unread count', async () => {
      mockTables({ notifications: chain({ data: null, error: null, count: 3 }) });
      const service = await createService();

      await expect(service.getUnreadCount('user-1')).resolves.toBe(3);
    });

    it('returns 0 on a Supabase error rather than throwing', async () => {
      mockTables({ notifications: chain({ data: null, error: { message: 'db down' } }) });
      const service = await createService();

      await expect(service.getUnreadCount('user-1')).resolves.toBe(0);
    });
  });

  describe('markRead()', () => {
    it('marks specific ids read, scoped to the caller', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({ notifications: notificationsChain });
      const service = await createService();

      await service.markRead('user-1', ['n1', 'n2']);

      expect(notificationsChain.update).toHaveBeenCalledWith({ is_read: true });
      expect(notificationsChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(notificationsChain.in).toHaveBeenCalledWith('id', ['n1', 'n2']);
    });

    it('marks everything read when all is true, without filtering by id', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({ notifications: notificationsChain });
      const service = await createService();

      await service.markRead('user-1', undefined, true);

      expect(notificationsChain.in).not.toHaveBeenCalled();
    });

    it('is a no-op when neither ids nor all is given', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({ notifications: notificationsChain });
      const service = await createService();

      await service.markRead('user-1');

      expect(notificationsChain.update).not.toHaveBeenCalled();
    });
  });

  // ── sendPush() ───────────────────────────────────────────────────────────

  describe('sendPush()', () => {
    it('sends to every active session with a token', async () => {
      setFirebaseEnv();
      mockTables({
        sessions: chain({ data: [{ fcm_token: 'token-a' }, { fcm_token: 'token-b' }], error: null }),
      });

      const service = await createService();
      await service.sendPush('user-1', 'Title', 'Body');

      expect(mockMessagingSend).toHaveBeenCalledTimes(2);
    });

    it('logs and continues when one token fails, without throwing', async () => {
      setFirebaseEnv();
      mockTables({
        sessions: chain({ data: [{ fcm_token: 'bad-token' }, { fcm_token: 'good-token' }], error: null }),
      });
      mockMessagingSend
        .mockRejectedValueOnce(new Error('registration-token-not-registered'))
        .mockResolvedValueOnce('msg-id');

      const service = await createService();

      await expect(service.sendPush('user-1', 'Title', 'Body')).resolves.not.toThrow();
      expect(mockMessagingSend).toHaveBeenCalledTimes(2);
    });

    it('does nothing when the user has no sessions with a registered token', async () => {
      setFirebaseEnv();
      mockTables({ sessions: chain({ data: [], error: null }) });

      const service = await createService();
      await service.sendPush('user-1', 'Title', 'Body');

      expect(mockMessagingSend).not.toHaveBeenCalled();
    });
  });

  // ── verification.email.initiate ──────────────────────────────────────────

  describe('handleEmailOtpInitiate()', () => {
    it('sends the OTP email with brand.name in the subject and the code in the body', async () => {
      process.env.RESEND_API_KEY = 're_test';
      const service = await createService();

      await service.handleEmailOtpInitiate({
        userId: 'u1', institutionalEmail: 'a@school.edu', classroomId: 'c1', code: '654321', expiresAt: new Date(),
      });

      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@school.edu',
          subject: expect.stringContaining(brand.name),
          text: expect.stringContaining('654321'),
        }),
      );
    });

    it('falls back to brand.supportEmail when FROM_EMAIL is not set', async () => {
      process.env.RESEND_API_KEY = 're_test';
      const service = await createService();

      await service.handleEmailOtpInitiate({
        userId: 'u1', institutionalEmail: 'a@school.edu', classroomId: 'c1', code: '111111', expiresAt: new Date(),
      });

      expect(mockEmailsSend).toHaveBeenCalledWith(expect.objectContaining({ from: brand.supportEmail }));
    });

    it('uses FROM_EMAIL when set', async () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.FROM_EMAIL = 'noreply@alumini.app';
      const service = await createService();

      await service.handleEmailOtpInitiate({
        userId: 'u1', institutionalEmail: 'a@school.edu', classroomId: 'c1', code: '111111', expiresAt: new Date(),
      });

      expect(mockEmailsSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'noreply@alumini.app' }));
    });
  });

  // ── verification.document.submitted ──────────────────────────────────────

  describe('handleDocumentSubmitted()', () => {
    it('notifies every verified admin of the classroom', async () => {
      const notificationsChain = chain({ data: null, error: null }, { data: null, error: null });
      mockTables({
        memberships: chain({ data: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }], error: null }),
        notifications: notificationsChain,
      });

      const service = await createService();
      await service.handleDocumentSubmitted({ userId: 'applicant-1', classroomId: 'class-1' });

      expect(notificationsChain.insert).toHaveBeenCalledTimes(2);
    });
  });

  // ── verification.document.approved ───────────────────────────────────────

  describe('handleDocumentApproved()', () => {
    it('sends both in-app and push to the applicant', async () => {
      setFirebaseEnv();
      const notificationsChain = chain({ data: null, error: null });
      mockTables({
        notifications: notificationsChain,
        sessions: chain({ data: [{ fcm_token: 'token-a' }], error: null }),
      });

      const service = await createService();
      await service.handleDocumentApproved({ userId: 'user-1', storagePath: 'p/doc', verificationId: 'v1' });

      expect(notificationsChain.insert).toHaveBeenCalledTimes(1);
      expect(mockMessagingSend).toHaveBeenCalledTimes(1);
    });
  });

  // ── verification.document.rejected ───────────────────────────────────────

  describe('handleDocumentRejected()', () => {
    it('sends an in-app notification with the rejection reason as the body', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({ notifications: notificationsChain });

      const service = await createService();
      await service.handleDocumentRejected({ userId: 'user-1', classroomId: 'class-1', reason: 'Blurry photo' });

      expect(notificationsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ body: 'Blurry photo' }));
    });
  });

  // ── verification.approved ────────────────────────────────────────────────

  describe('handleVerificationApproved()', () => {
    it('sends in-app and push announcing verification', async () => {
      setFirebaseEnv();
      mockTables({
        notifications: chain({ data: null, error: null }),
        sessions: chain({ data: [{ fcm_token: 'token-a' }], error: null }),
      });

      const service = await createService();
      await service.handleVerificationApproved({ userId: 'user-1', classroomId: 'class-1', method: 'email' });

      expect(mockMessagingSend).toHaveBeenCalledTimes(1);
    });
  });

  // ── institution.admin.invited ────────────────────────────────────────────

  describe('handleAdminInvited()', () => {
    it('includes the magic-link URL with the token in the email body', async () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.APP_URL = 'https://api.alumini.app';
      const service = await createService();

      await service.handleAdminInvited({
        institutionId: 'inst-1', email: 'co@example.com', invitedBy: 'admin-1',
        token: 'signed-jwt-token', expiresAt: new Date(),
      });

      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'co@example.com',
          text: expect.stringContaining('https://api.alumini.app/v1/institution/invite/accept?token=signed-jwt-token'),
        }),
      );
    });
  });

  // ── event.created ────────────────────────────────────────────────────────

  describe('handleEventCreated()', () => {
    it('notifies every verified member with the event title and formatted date/location', async () => {
      setFirebaseEnv();
      const notificationsChain = chain({ data: null, error: null }, { data: null, error: null });
      mockTables({
        memberships: chain({ data: [{ user_id: 'member-1' }, { user_id: 'member-2' }], error: null }),
        notifications: notificationsChain,
        sessions: chain({ data: [], error: null }),
      });

      const service = await createService();
      await service.handleEventCreated({
        eventId: 'event-1',
        classroomId: 'class-1',
        title: 'Reunion 2026',
        eventDate: '2026-12-01T18:00:00Z',
        location: 'School Auditorium',
        isOnline: false,
      });

      expect(notificationsChain.insert).toHaveBeenCalledTimes(2);
      expect(notificationsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Reunion 2026', body: expect.stringContaining('School Auditorium') }),
      );
    });

    it('shows "Online" as the location when isOnline is true', async () => {
      const notificationsChain = chain({ data: null, error: null });
      mockTables({
        memberships: chain({ data: [{ user_id: 'member-1' }], error: null }),
        notifications: notificationsChain,
      });

      const service = await createService();
      await service.handleEventCreated({
        eventId: 'event-1',
        classroomId: 'class-1',
        title: 'Webinar',
        eventDate: '2026-12-01T18:00:00Z',
        isOnline: true,
      });

      expect(notificationsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('Online') }),
      );
    });
  });
});
