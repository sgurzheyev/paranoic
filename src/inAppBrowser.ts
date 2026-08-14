/** Signatures of messenger in-app browsers that block camera/mic WebRTC. */
const IN_APP_UA_MARKERS = [
  'Telegram',
  'FBAV',
  'FBAN',
  'FB_IAB',
  'FB4A',
  'Instagram',
  'WhatsApp',
  'Line/',
  'Line ',
] as const;

/**
 * True when the page is opened inside a messenger WebView
 * (Telegram, Facebook/Instagram, WhatsApp, Line, …).
 */
export function isInAppBrowser(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''
): boolean {
  if (!userAgent) return false;
  return IN_APP_UA_MARKERS.some((marker) => userAgent.includes(marker));
}
