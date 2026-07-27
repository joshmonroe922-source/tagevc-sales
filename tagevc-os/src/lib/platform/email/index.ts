export {
  base64UrlDecode,
  clickTrackingUrl,
  injectMailTracking,
  openTrackingUrl,
} from '@/lib/platform/email/mail-tracking';
export {
  newPlatformEmailTrackingToken,
  sendGraphMail,
  type GraphMailAttachment,
  type GraphSendMailInput,
} from '@/lib/platform/email/graph-send';
export {
  summarizePlatformEmailMessages,
  type PlatformEmailAnalyticsSummary,
  type PlatformEmailEvent,
  type PlatformEmailEventType,
  type PlatformEmailMessage,
  type PlatformEmailProvider,
  type PlatformEmailSource,
  type PlatformEmailStatus,
} from '@/lib/platform/email/types';
