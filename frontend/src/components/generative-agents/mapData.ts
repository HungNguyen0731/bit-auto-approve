import type { TownLandmark } from '../../types/generativeAgents';

export const MAP_WIDTH = 1280;
export const MAP_HEIGHT = 880;

export const TOWN_LANDMARKS: TownLandmark[] = [
  {
    id: 'bitbucket-hq',
    name: 'Bitbucket Station',
    label: 'Worker HQ & Control Plane',
    icon: '🏢',
    x: 220,
    y: 160,
    width: 170,
    height: 120,
    color: '#0052CC',
    description: 'Trung tâm điều khiển và phân bổ nhiệm vụ kiểm duyệt PR cho toàn bộ Worker.',
    type: 'hq',
  },
  {
    id: 'oak-hill-college',
    name: 'Oak Hill College',
    label: 'PR Rules & Knowledge Base',
    icon: '🏛️',
    x: 550,
    y: 140,
    width: 180,
    height: 120,
    color: '#6554C0',
    description: 'Thư viện quy tắc lọc, pattern branch và điều kiện auto-merge.',
    type: 'college',
  },
  {
    id: 'hobbs-cafe',
    name: 'Hobbs Cafe',
    label: 'Worker Rest Lounge',
    icon: '☕',
    x: 920,
    y: 170,
    width: 160,
    height: 110,
    color: '#FF8B00',
    description: 'Khu vực nghỉ ngơi của worker sau các phiên duyệt PR căng thẳng.',
    type: 'cafe',
  },
  {
    id: 'smallville-clinic',
    name: 'Smallville Clinic',
    label: 'Health & Diagnostics',
    icon: '🏥',
    x: 160,
    y: 450,
    width: 160,
    height: 120,
    color: '#E34935',
    description: 'Trạm chẩn đoán lỗi worker, rate limit và phân tích logs.',
    type: 'clinic',
  },
  {
    id: 'johnson-park',
    name: 'Johnson Town Plaza',
    label: 'Central Hub & Fountain',
    icon: '⛲',
    x: 520,
    y: 420,
    width: 220,
    height: 160,
    color: '#36B37E',
    description: 'Quảng trường trung tâm thị trấn Smallville, nơi tuần tra của worker.',
    type: 'park',
  },
  {
    id: 'rose-crown-pub',
    name: 'Rose & Crown Pub',
    label: 'Celebration Tavern',
    icon: '🍻',
    x: 930,
    y: 470,
    width: 160,
    height: 120,
    color: '#8777D9',
    description: 'Nơi tổ chức ăn mừng khi duyệt và merge thành công các PR quan trọng.',
    type: 'pub',
  },
  {
    id: 'quick-market',
    name: 'Marketplace Depot',
    label: 'Cache & Artifact Store',
    icon: '🏪',
    x: 280,
    y: 710,
    width: 170,
    height: 110,
    color: '#008DA6',
    description: 'Kho lưu trữ artifact, cache token và dữ liệu repo metadata.',
    type: 'market',
  },
  {
    id: 'vpn-gatehouse',
    name: 'VPN Gatehouse',
    label: 'Security & IP Tunnel',
    icon: '🛡️',
    x: 760,
    y: 710,
    width: 180,
    height: 120,
    color: '#FFAB00',
    description: 'Cổng kiểm soát an ninh mạng nội bộ, tunnel VPN và Bitbucket Cloud allowlist.',
    type: 'vpn',
  },
];

// Key road intersection nodes for agent navigation
export interface WaypointNode {
  id: string;
  x: number;
  y: number;
  connections: string[];
}

export const TOWN_WAYPOINTS: WaypointNode[] = [
  { id: 'w-hq', x: 305, y: 310, connections: ['w-cross-nw', 'w-clinic'] },
  { id: 'w-cross-nw', x: 450, y: 310, connections: ['w-hq', 'w-college', 'w-plaza-n'] },
  { id: 'w-college', x: 640, y: 280, connections: ['w-cross-nw', 'w-cross-ne', 'w-plaza-n'] },
  { id: 'w-cross-ne', x: 820, y: 310, connections: ['w-college', 'w-cafe', 'w-plaza-e'] },
  { id: 'w-cafe', x: 1000, y: 300, connections: ['w-cross-ne', 'w-pub'] },
  { id: 'w-clinic', x: 240, y: 590, connections: ['w-hq', 'w-plaza-w', 'w-market'] },
  { id: 'w-plaza-w', x: 450, y: 500, connections: ['w-clinic', 'w-plaza-center', 'w-cross-sw'] },
  { id: 'w-plaza-n', x: 630, y: 370, connections: ['w-cross-nw', 'w-college', 'w-plaza-center'] },
  { id: 'w-plaza-center', x: 630, y: 500, connections: ['w-plaza-n', 'w-plaza-w', 'w-plaza-e', 'w-plaza-s'] },
  { id: 'w-plaza-e', x: 820, y: 500, connections: ['w-plaza-center', 'w-cross-ne', 'w-pub', 'w-cross-se'] },
  { id: 'w-pub', x: 1010, y: 610, connections: ['w-cafe', 'w-plaza-e', 'w-cross-se'] },
  { id: 'w-plaza-s', x: 630, y: 630, connections: ['w-plaza-center', 'w-cross-sw', 'w-cross-se'] },
  { id: 'w-cross-sw', x: 450, y: 680, connections: ['w-plaza-w', 'w-plaza-s', 'w-market'] },
  { id: 'w-market', x: 365, y: 680, connections: ['w-clinic', 'w-cross-sw'] },
  { id: 'w-cross-se', x: 820, y: 680, connections: ['w-plaza-e', 'w-pub', 'w-plaza-s', 'w-vpn'] },
  { id: 'w-vpn', x: 850, y: 700, connections: ['w-cross-se'] },
];

// Helper to get nearest waypoint to given coordinates
export function findNearestWaypoint(x: number, y: number): WaypointNode {
  let nearest = TOWN_WAYPOINTS[0];
  let minDistance = Infinity;
  for (const wp of TOWN_WAYPOINTS) {
    const d = Math.hypot(wp.x - x, wp.y - y);
    if (d < minDistance) {
      minDistance = d;
      nearest = wp;
    }
  }
  return nearest;
}

// Landmark waypoints for specific activities
export const LANDMARK_DOORWAYS: Record<string, { x: number; y: number }> = {
  'bitbucket-hq': { x: 305, y: 295 },
  'oak-hill-college': { x: 640, y: 270 },
  'hobbs-cafe': { x: 1000, y: 290 },
  'smallville-clinic': { x: 240, y: 580 },
  'johnson-park': { x: 630, y: 500 },
  'rose-crown-pub': { x: 1010, y: 600 },
  'quick-market': { x: 365, y: 690 },
  'vpn-gatehouse': { x: 850, y: 695 },
};
