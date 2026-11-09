/* Keep the existing MOS2Career analytics property on production guide pages.
   Local previews do not send analytics or make translator submissions. */
(() => {
  'use strict';
  if (!['mos2career.com', 'www.mos2career.com'].includes(window.location.hostname)) return;
  if (window.m2cGuideAnalyticsStarted) return;
  window.m2cGuideAnalyticsStarted = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-2251989Z9F');
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-2251989Z9F';
  document.head.appendChild(script);
})();
