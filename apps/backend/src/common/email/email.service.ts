/**
 * EmailService — the one place every transactional email in this backend
 * goes through. Centralizes what auth.service.ts previously duplicated
 * inline three times (OTP codes, password reset, MFA recovery), and adds
 * two genuinely new email types (welcome, institution request update).
 *
 * RENDER ENV VARS REQUIRED:
 * RESEND_API_KEY = re_xxxxxxxxxxxx (from resend.com dashboard)
 * FROM_EMAIL     = noreply@alumtribe.com
 * Without RESEND_API_KEY emails log to console (dev mode)
 */

import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { AppLogger } from '../logger/logger.service';
import { brand } from '@alumini/config/brand';

type OtpPurpose = 'login' | 'password_reset' | 'mfa_change';

@Injectable()
export class EmailService {
  private resend: Resend | null = null;
  private readonly from: string;

  constructor(private readonly logger: AppLogger) {
    this.logger.setContext('EMAIL');
    this.from = process.env.FROM_EMAIL || `noreply@${brand.domain}`;
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.info('Resend configured', { from: this.from });
    } else {
      this.logger.warn('RESEND_API_KEY not set — emails will log to console only');
    }
  }

  async sendOtpCode(to: string, code: string, purpose: OtpPurpose | string): Promise<void> {
    const subject =
      purpose === 'login'
        ? `Your ${brand.name} sign-in code`
        : purpose === 'password_reset'
          ? `Reset your ${brand.name} password`
          : `Your ${brand.name} verification code`;

    const body = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4A1FA8;">${brand.name}</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px;
                    color: #4A1FA8; padding: 20px; background: #f0ecff;
                    border-radius: 8px; text-align: center;">
          ${code}
        </div>
        <p style="color: #666; font-size: 14px;">
          Valid for 10 minutes. Do not share this code with anyone.
        </p>
        <p style="color: #999; font-size: 12px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `;

    await this.send(to, subject, body);
  }

  async sendPasswordResetLink(to: string, resetUrl: string): Promise<void> {
    const body = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4A1FA8;">${brand.name}</h2>
        <p>We received a request to reset your password.</p>
        <a href="${resetUrl}"
           style="display: inline-block; padding: 12px 24px;
                  background: #4A1FA8; color: white; border-radius: 8px;
                  text-decoration: none; font-weight: bold;">
          Reset my password
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 16px;">
          This link expires in 1 hour. If you didn't request this,
          you can safely ignore this email.
        </p>
      </div>
    `;
    await this.send(to, `Reset your ${brand.name} password`, body);
  }

  async sendMfaRecoveryLink(to: string, recoveryUrl: string): Promise<void> {
    const body = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4A1FA8;">${brand.name}</h2>
        <p>We received a request to reset your two-factor authentication.</p>
        <a href="${recoveryUrl}"
           style="display: inline-block; padding: 12px 24px;
                  background: #4A1FA8; color: white; border-radius: 8px;
                  text-decoration: none; font-weight: bold;">
          Reset my authenticator
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 16px;">
          This link expires in 1 hour.
        </p>
      </div>
    `;
    await this.send(to, `Reset your ${brand.name} authenticator`, body);
  }

  async sendWelcome(to: string, fullName: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'https://alumtribe.com';
    const body = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4A1FA8;">Welcome to ${brand.name}, ${fullName}!</h2>
        <p>${brand.tagline}</p>
        <p>You're now part of ${brand.name} — find your batch and
           reconnect with your people.</p>
        <a href="${frontendUrl}"
           style="display: inline-block; padding: 12px 24px;
                  background: #4A1FA8; color: white; border-radius: 8px;
                  text-decoration: none; font-weight: bold;">
          Find your batch
        </a>
      </div>
    `;
    await this.send(to, `Welcome to ${brand.name}`, body);
  }

  async sendInstitutionRequestUpdate(
    to: string,
    institutionName: string,
    status: 'approved' | 'rejected',
    reason?: string,
  ): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'https://alumtribe.com';
    const subject =
      status === 'approved'
        ? `${institutionName} has been added to ${brand.name}`
        : `Update on your institution request`;

    const body =
      status === 'approved'
        ? `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #4A1FA8;">${brand.name}</h2>
          <p>Great news! <strong>${institutionName}</strong> has been
             added to ${brand.name}.</p>
          <p>You can now create or join a classroom for your batch.</p>
          <a href="${frontendUrl}/classroom/create"
             style="display: inline-block; padding: 12px 24px;
                    background: #4A1FA8; color: white; border-radius: 8px;
                    text-decoration: none; font-weight: bold;">
            Create a classroom
          </a>
        </div>
      `
        : `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #4A1FA8;">${brand.name}</h2>
          <p>Your request to add <strong>${institutionName}</strong>
             was not approved.</p>
          ${reason ? `<p>Reason: ${reason}</p>` : ''}
          <p>If you think this is a mistake please contact
             ${brand.supportEmail}</p>
        </div>
      `;

    await this.send(to, subject, body);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`[EMAIL-CONSOLE] To: ${to} | Subject: ${subject}`);
      this.logger.warn(`[EMAIL-CONSOLE] Body preview: ${html.replace(/<[^>]*>/g, '').trim().slice(0, 100)}`);
      return;
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      if (error) throw error;
      this.logger.info('Email sent', { to: AppLogger.maskEmail(to), subject, id: data?.id });
    } catch (error: any) {
      this.logger.error('Email send failed', {
        to: AppLogger.maskEmail(to),
        subject,
        error: error?.message,
      });
      // Do not throw — email failure should not break the main flow
    }
  }
}
