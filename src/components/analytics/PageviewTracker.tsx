'use client';

import { useEffect } from 'react';

const GOOGLE_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxIRP7vUsVjLpg5KA457Qu_wEZC6hDvaIQuBT1XJrxvvMN0hPsmN28iZMK8xvs7dnOmTg/exec';

const SESSION_STORAGE_KEY = 'pageview_tracked';

export default function PageviewTracker() {
  useEffect(() => {
    // 세션 스토리지에서 이미 기록했는지 확인
    const alreadyTracked = sessionStorage.getItem(SESSION_STORAGE_KEY);

    // 이미 기록한 경우 추가 기록 안함
    if (alreadyTracked) {
      return;
    }

    // ✅ Race condition 방지: fetch 시작 전에 즉시 마킹
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');

    // URL 파라미터 읽기
    const urlParams = new URLSearchParams(window.location.search);
    const adSource =
      urlParams.get('ad') ||
      urlParams.get('source') ||
      urlParams.get('utm_source');

    // 페이지 조회 이벤트 기록
    const trackPageview = async () => {
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors', // CORS 우회
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'pageview',
            source: adSource || 'direct', // 광고 출처 또는 'direct'
            page: window.location.pathname + window.location.search,
            href: window.location.href, // ✅ 전체 URL 추가
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        console.error('Analytics tracking error:', error);
        // ❌ 실패 시 마킹 제거 (재시도 가능하도록)
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    };

    trackPageview();
  }, []);

  return null; // 화면에 아무것도 렌더링하지 않음
}
