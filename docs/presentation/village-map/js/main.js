/* 시작: 탭과 발표 순서를 정하고 첫 화면을 띄운다 */
(function () {
  'use strict';
  const SJ = window.SJ;
  const TABS = [
    { id: 'map', label: '전체 지도', core: true },
    { id: 'data', label: '데이터 모델' },
    { id: 'team', label: '팀과 계약' },
    { id: 'flow', label: '앱 화면 흐름' },
    { id: 'results', label: '결과' },
    { id: 'plan', label: '일정표' },
    { id: 'diff', label: '1학기 → 2학기' },
  ].filter((t) => SJ.views[t.id]);
  // 발표 순서: 지도 → 빨간 방들 → 나머지 그림
  const sequence = ['map'].concat(SJ.roomOrder.map((r) => 'room-' + r), TABS.slice(1).map((t) => t.id));
  SJ.boot({ tabs: TABS, sequence });
})();
