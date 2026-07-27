export {
  injectMailTracking,
  mailTrackingBaseUrl,
  openTrackingUrl,
  clickTrackingUrl,
  base64UrlDecode,
  TRANSPARENT_GIF,
} from '@/lib/platform-email/mail-tracking';
export type {
  EntityScopedEmailEvent,
  EntityScopedEmailMessage,
  PlatformEmailProvider,
  PlatformEmailSource,
} from '@/lib/platform-email/types';
export {
  getPlatformEmailGraphConfig,
  isResendConfigured,
  platformEmailAppUrl,
} from '@/lib/platform-email/config';
