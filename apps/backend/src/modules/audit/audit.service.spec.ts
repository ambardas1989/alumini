/**
 * Unit tests for AuditService.
 *
 * Tests:
 * - Successful log write
 * - Supabase error is caught and logged (does not throw)
 * - IP extraction from x-forwarded-for header
 * - IP extraction from socket when no header
 * - getForActor returns correct data
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { AuditEventType } from '@alumini/types';

// Mock Supabase client
const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockRange = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockInsert,
      select: jest.fn(() => ({
        eq: mockEq.mockReturnThis(),
        order: mockOrder.mockReturnThis(),
        range: mockRange,
      })),
    })),
  })),
}));

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    // Set required environment variables
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    service = module.get<AuditService>(AuditService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('log()', () => {
    it('should write an audit log entry with basic params', async () => {
      mockInsert.mockResolvedValue({ error: null });

      await service.log({
        eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
        actorId: 'user-123',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: AuditEventType.AUTH_LOGIN_SUCCESS,
          actor_id: 'user-123',
        }),
      );
    });

    it('should not throw when Supabase returns an error', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'DB connection lost' } });

      // Should NOT throw — audit failures must not break core flows
      await expect(
        service.log({
          eventType: AuditEventType.AUTH_LOGIN_FAILURE,
          actorId: 'user-456',
        }),
      ).resolves.not.toThrow();
    });

    it('should not throw when Supabase throws an exception', async () => {
      mockInsert.mockRejectedValue(new Error('Network timeout'));

      await expect(
        service.log({
          eventType: AuditEventType.PERSONA_SWITCHED,
          actorId: 'user-789',
        }),
      ).resolves.not.toThrow();
    });

    it('should extract IP from x-forwarded-for header', async () => {
      mockInsert.mockResolvedValue({ error: null });

      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1', 'user-agent': 'Test/1.0' },
        socket: { remoteAddress: '10.0.0.1' },
      } as any;

      await service.log({
        eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
        actorId: 'user-123',
        req: mockReq,
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          // Should take the first IP from x-forwarded-for (client IP)
          ip_address: '203.0.113.1',
          user_agent: 'Test/1.0',
        }),
      );
    });

    it('should fall back to socket remoteAddress when no x-forwarded-for', async () => {
      mockInsert.mockResolvedValue({ error: null });

      const mockReq = {
        headers: {},
        socket: { remoteAddress: '192.168.1.1' },
      } as any;

      await service.log({
        eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
        actorId: 'user-123',
        req: mockReq,
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ ip_address: '192.168.1.1' }),
      );
    });

    it('should handle null actorId for system events', async () => {
      mockInsert.mockResolvedValue({ error: null });

      await service.log({
        eventType: AuditEventType.VERIFICATION_EXPIRED,
        // No actorId — this is a system event
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ actor_id: null }),
      );
    });

    it('should include metadata in the log entry', async () => {
      mockInsert.mockResolvedValue({ error: null });

      await service.log({
        eventType: AuditEventType.CODE_REDEEMED,
        actorId: 'user-123',
        targetId: 'code-456',
        targetType: 'code',
        metadata: { institution_id: 'inst-789', code_type: 'personal' },
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          target_id: 'code-456',
          target_type: 'code',
          metadata: { institution_id: 'inst-789', code_type: 'personal' },
        }),
      );
    });
  });

  describe('getForActor()', () => {
    it('should return audit logs for the given actor', async () => {
      const mockLogs = [
        { id: 'log-1', event_type: 'auth.login.success', actor_id: 'user-123' },
        { id: 'log-2', event_type: 'persona.switched', actor_id: 'user-123' },
      ];

      mockRange.mockResolvedValue({ data: mockLogs, error: null });

      const result = await service.getForActor('user-123');
      expect(result).toEqual(mockLogs);
    });

    it('should throw when Supabase returns an error', async () => {
      mockRange.mockResolvedValue({ data: null, error: { message: 'Query failed' } });

      await expect(service.getForActor('user-123')).rejects.toThrow(
        'Failed to fetch audit logs',
      );
    });
  });
});
