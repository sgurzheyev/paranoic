import { useCallback, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import ParanoicLogo from './ParanoicLogo';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Full-screen gate: no Mapbox / WebRTC / getUserMedia while inside an in-app browser.
 */
export default function InAppBrowserFallback() {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(window.location.href);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }, []);

  return (
    <div className="inapp-fallback" role="alertdialog" aria-labelledby="inapp-fallback-title" aria-describedby="inapp-fallback-sub">
      <div className="inapp-fallback__bg" aria-hidden />
      <div className="inapp-fallback__card">
        <ParanoicLogo size={44} compact withWordmark className="mb-3" />
        <h1 id="inapp-fallback-title" className="inapp-fallback__title">
          Встроенный браузер ограничивает связь.
        </h1>
        <p id="inapp-fallback-sub" className="inapp-fallback__sub">
          Пожалуйста, откройте эту ссылку в полноценном браузере (Chrome или Safari), чтобы звонки работали корректно.
        </p>
        <button type="button" className="inapp-fallback__copy" onClick={() => void onCopy()}>
          {copied ? <Check size={18} strokeWidth={2.4} aria-hidden /> : <Copy size={18} strokeWidth={2.2} aria-hidden />}
          {copied ? 'Ссылка скопирована!' : 'Скопировать ссылку'}
        </button>
        <p className="inapp-fallback__hint">
          <ExternalLink size={14} strokeWidth={2.2} aria-hidden />
          Вставьте ссылку в адресную строку Chrome или Safari — не открывайте её снова из мессенджера.
        </p>
      </div>
    </div>
  );
}
