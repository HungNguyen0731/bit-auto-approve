import type { AgentDirection, GenerativeAgent, TownLandmark } from '../../types/generativeAgents';
import { MAP_HEIGHT, MAP_WIDTH } from './mapData';

/**
 * Draws the complete 2D Smallville Town map onto the canvas context.
 */
export function drawSmallvilleMap(
  ctx: CanvasRenderingContext2D,
  landmarks: TownLandmark[],
  time: number,
  showLandmarkLabels = true
): void {
  // 1. Grass Ground with subtle texture
  ctx.fillStyle = '#659D32';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // Checker grass patch details
  ctx.fillStyle = '#5B8F2B';
  const tileSize = 40;
  for (let y = 0; y < MAP_HEIGHT; y += tileSize) {
    for (let x = 0; x < MAP_WIDTH; x += tileSize) {
      if ((x / tileSize + y / tileSize) % 2 === 0) {
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  // 2. River running from North to South (with curve)
  ctx.save();
  ctx.fillStyle = '#3A8FB7';
  ctx.beginPath();
  ctx.moveTo(1140, 0);
  ctx.bezierCurveTo(1120, 250, 1160, 500, 1130, 880);
  ctx.lineTo(1210, 880);
  ctx.bezierCurveTo(1240, 500, 1200, 250, 1220, 0);
  ctx.closePath();
  ctx.fill();

  // Water ripples
  ctx.strokeStyle = '#68B0D8';
  ctx.lineWidth = 2;
  const rippleOffset = (time * 0.05) % 40;
  for (let ry = 20; ry < MAP_HEIGHT; ry += 50) {
    const rx = 1160 + Math.sin(ry * 0.01 + time * 0.002) * 20;
    ctx.beginPath();
    ctx.moveTo(rx - 15, ry + (rippleOffset % 10));
    ctx.lineTo(rx + 15, ry + (rippleOffset % 10));
    ctx.stroke();
  }
  ctx.restore();

  // 3. Roads and Cobblestone Pathways
  ctx.fillStyle = '#C8B08A';
  ctx.strokeStyle = '#A89270';
  ctx.lineWidth = 2;

  // Horizontal Main Avenues
  const roads = [
    // Top avenue
    { x: 180, y: 290, w: 900, h: 40 },
    // Middle plaza avenue
    { x: 180, y: 480, w: 900, h: 44 },
    // Bottom avenue
    { x: 260, y: 660, w: 720, h: 38 },
    // Vertical Connectors
    { x: 285, y: 290, w: 40, h: 400 },
    { x: 610, y: 150, w: 44, h: 540 },
    { x: 800, y: 290, w: 40, h: 400 },
    { x: 990, y: 290, w: 40, h: 380 },
    // East Bridge to river
    { x: 1080, y: 485, w: 140, h: 36 },
  ];

  for (const r of roads) {
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  // Wooden Bridge across River
  ctx.fillStyle = '#8B5A2B';
  ctx.fillRect(1120, 480, 100, 46);
  ctx.fillStyle = '#5C381E';
  for (let bx = 1125; bx < 1215; bx += 10) {
    ctx.fillRect(bx, 480, 2, 46);
  }
  // Bridge rails
  ctx.fillStyle = '#3E2412';
  ctx.fillRect(1120, 478, 100, 4);
  ctx.fillRect(1120, 524, 100, 4);

  // 4. Central Fountain in Johnson Town Plaza
  const fx = 630;
  const fy = 500;
  ctx.fillStyle = '#B0BEC5';
  ctx.beginPath();
  ctx.arc(fx, fy, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#78909C';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Fountain water pool
  ctx.fillStyle = '#29B6F6';
  ctx.beginPath();
  ctx.arc(fx, fy, 24, 0, Math.PI * 2);
  ctx.fill();

  // Fountain spray animation
  const sprayR = 6 + Math.sin(time * 0.008) * 4;
  ctx.fillStyle = '#E1F5FE';
  ctx.beginPath();
  ctx.arc(fx, fy, sprayR, 0, Math.PI * 2);
  ctx.fill();

  // 5. Trees and Foliage
  const trees = [
    { x: 100, y: 80 }, { x: 140, y: 120 }, { x: 80, y: 220 },
    { x: 440, y: 80 }, { x: 490, y: 110 }, { x: 810, y: 90 },
    { x: 100, y: 380 }, { x: 120, y: 700 }, { x: 80, y: 800 },
    { x: 530, y: 760 }, { x: 670, y: 770 }, { x: 1050, y: 720 },
    { x: 1070, y: 110 }, { x: 1100, y: 380 }, { x: 1080, y: 640 },
  ];

  for (const tree of trees) {
    drawTree(ctx, tree.x, tree.y);
  }

  // 6. Buildings and Landmarks
  for (const lm of landmarks) {
    drawLandmarkBuilding(ctx, lm, showLandmarkLabels);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 18, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trunk
  ctx.fillStyle = '#5D4037';
  ctx.fillRect(x - 5, y + 2, 10, 16);

  // Crown (3 tiered green circles)
  ctx.fillStyle = '#2E7D32';
  ctx.beginPath();
  ctx.arc(x, y - 6, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#388E3C';
  ctx.beginPath();
  ctx.arc(x - 4, y - 10, 17, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4CAF50';
  ctx.beginPath();
  ctx.arc(x - 6, y - 14, 11, 0, Math.PI * 2);
  ctx.fill();
}

function drawLandmarkBuilding(
  ctx: CanvasRenderingContext2D,
  lm: TownLandmark,
  showLabel: boolean
): void {
  ctx.save();
  const { x, y, width, height, color } = lm;

  // Building Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(x + 8, y + 12, width, height);

  // Building Main Body (Wall)
  ctx.fillStyle = '#ECEFF1';
  ctx.fillRect(x, y + 30, width, height - 30);
  ctx.strokeStyle = '#90A4AE';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y + 30, width, height - 30);

  // Roof (Slanted roof banner with landmark primary color)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 30);
  ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x + width + 6, y + 30);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#37474F';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Door
  const doorW = 26;
  const doorH = 34;
  const doorX = x + width / 2 - doorW / 2;
  const doorY = y + height - doorH;
  ctx.fillStyle = '#5D4037';
  ctx.fillRect(doorX, doorY, doorW, doorH);
  ctx.strokeStyle = '#3E2723';
  ctx.strokeRect(doorX, doorY, doorW, doorH);

  // Windows
  const winW = 20;
  const winH = 22;
  const winLeftX = x + 20;
  const winRightX = x + width - 40;
  const winY = y + 45;

  ctx.fillStyle = '#FFF9C4'; // warm window glow
  ctx.fillRect(winLeftX, winY, winW, winH);
  ctx.strokeRect(winLeftX, winY, winW, winH);
  ctx.fillRect(winRightX, winY, winW, winH);
  ctx.strokeRect(winRightX, winY, winW, winH);

  // Window frame cross
  ctx.strokeStyle = '#78909C';
  ctx.beginPath();
  ctx.moveTo(winLeftX + winW / 2, winY);
  ctx.lineTo(winLeftX + winW / 2, winY + winH);
  ctx.moveTo(winLeftX, winY + winH / 2);
  ctx.lineTo(winLeftX + winW, winY + winH / 2);

  ctx.moveTo(winRightX + winW / 2, winY);
  ctx.lineTo(winRightX + winW / 2, winY + winH);
  ctx.moveTo(winRightX, winY + winH / 2);
  ctx.lineTo(winRightX + winW, winY + winH / 2);
  ctx.stroke();

  // Landmark Title & Icon Badge
  if (showLabel) {
    const badgeY = y - 10;
    const badgeText = `${lm.icon} ${lm.name}`;

    ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
    const textMetrics = ctx.measureText(badgeText);
    const boxW = Math.max(textMetrics.width + 18, 110);
    const boxH = 22;
    const boxX = x + width / 2 - boxW / 2;

    // Badge Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.roundRect(boxX, badgeY - 14, boxW, boxH, 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Badge Text
    ctx.fillStyle = '#1A202C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, x + width / 2, badgeY - 3);

    // Subtitle label
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText(lm.label, x + width / 2, y + height + 12);
  }

  ctx.restore();
}

/**
 * Draws an RPG pixel character sprite onto the canvas.
 * Supports:
 * - 4-direction animations (down, left, right, up)
 * - 3 walk-cycle frames
 * - Special postures:
 *   - FAILED_OFF: Downed/slumped horizontally on ground, muted palette, ⚠️ error beacon, ZERO MOVEMENT
 *   - ACTIVE_WORKING: Energetic walk, pulsating blue halo
 *   - SUCCESS_PATROL: Cheerful patrol, green halo + festive sparkles
 *   - PAUSED_VPN: Sitting / shielded by amber bubble (🛡️)
 *   - IDLE: Calm breathing bob
 */
export function drawAgentSprite(
  ctx: CanvasRenderingContext2D,
  agent: GenerativeAgent,
  time: number
): void {
  ctx.save();
  const { x, y, direction, frame, state, palette } = agent;

  // 1. Ground Auras / Shadows
  if (state === 'ACTIVE_WORKING') {
    // Pulsating energetic blue aura
    const pulse = Math.sin(time * 0.008) * 4;
    ctx.fillStyle = 'rgba(0, 102, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16, 20 + pulse, 10 + pulse * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0052CC';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (state === 'SUCCESS_PATROL') {
    // Radiant celebratory green aura
    const pulse = Math.sin(time * 0.006) * 3;
    ctx.fillStyle = 'rgba(54, 179, 126, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16, 18 + pulse, 9 + pulse * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00875A';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Floating celebratory stars / sparkles ✨
    for (let i = 0; i < 3; i++) {
      const sparkleAngle = time * 0.003 + i * ((Math.PI * 2) / 3);
      const sx = x + Math.cos(sparkleAngle) * 16;
      const sy = y - 8 + Math.sin(sparkleAngle) * 10;
      ctx.fillStyle = i % 2 === 0 ? '#FFD700' : '#36B37E';
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (state === 'PAUSED_VPN') {
    // Shield bubble
    ctx.fillStyle = 'rgba(255, 171, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFAB00';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (state === 'FAILED_OFF') {
    // Dim hazard pool on ground
    ctx.fillStyle = 'rgba(222, 53, 11, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Calm IDLE shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Character Body Render
  if (state === 'FAILED_OFF') {
    // DOWNED / OFF POSTURE: Slumped on the ground, completely halted!
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2); // Rotated horizontally onto ground
    drawCharacterBody(ctx, 0, 0, 'down', 0, {
      hair: '#64748B',
      shirt: '#94A3B8',
      pants: '#475569',
      skin: '#CBD5E1',
      auraColor: '#DE350B',
    });
    ctx.restore();

    // ⚠️ Flashing Warning Beacon above the downed worker
    ctx.save();
    const flash = Math.floor(time / 400) % 2 === 0;
    ctx.fillStyle = flash ? '#DE350B' : '#BF2600';
    ctx.beginPath();
    ctx.arc(x, y - 24, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y - 24);

    // "OFF" Tag
    ctx.fillStyle = '#DE350B';
    ctx.beginPath();
    ctx.roundRect(x - 16, y - 44, 32, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('OFF', x, y - 37);
    ctx.restore();
    return;
  }

  // Active / Normal Posture
  const bobbing = state === 'ACTIVE_WORKING' || state === 'SUCCESS_PATROL'
    ? (frame === 1 ? -2 : 0)
    : Math.sin(time * 0.004) * 1; // Subtle idle breath

  drawCharacterBody(ctx, x, y + bobbing, direction, frame, palette);

  // Status icons above head
  if (state === 'PAUSED_VPN') {
    ctx.fillStyle = '#FFAB00';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🛡️', x, y - 22);
  } else if (state === 'ACTIVE_WORKING') {
    ctx.fillStyle = '#0052CC';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚙️', x, y - 22);
  } else if (state === 'SUCCESS_PATROL') {
    ctx.fillStyle = '#36B37E';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⭐', x, y - 22);
  }

  ctx.restore();
}

/**
 * Pixel-art vector rendering of the character body parts
 */
function drawCharacterBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  direction: AgentDirection,
  frame: number,
  palette: GenerativeAgent['palette']
): void {
  const { hair, shirt, pants, skin } = palette;

  // Legs & Feet (Frame 0: left step, Frame 1: standing, Frame 2: right step)
  ctx.fillStyle = pants;
  const legOffsetL = (direction === 'down' || direction === 'up') && frame === 0 ? -3 : 0;
  const legOffsetR = (direction === 'down' || direction === 'up') && frame === 2 ? 3 : 0;

  if (direction === 'left' || direction === 'right') {
    // Side view legs
    const stride = frame === 1 ? 0 : 4;
    ctx.fillRect(cx - 3 - stride / 2, cy + 6, 4, 9);
    ctx.fillRect(cx + 1 + stride / 2, cy + 6, 4, 9);
  } else {
    // Front/Back view legs
    ctx.fillRect(cx - 6, cy + 6 + legOffsetL, 5, 9);
    ctx.fillRect(cx + 2, cy + 6 + legOffsetR, 5, 9);
  }

  // Shoes
  ctx.fillStyle = '#212121';
  if (direction === 'left') {
    ctx.fillRect(cx - 6, cy + 13, 5, 3);
    ctx.fillRect(cx - 1, cy + 13, 5, 3);
  } else if (direction === 'right') {
    ctx.fillRect(cx + 2, cy + 13, 5, 3);
    ctx.fillRect(cx - 3, cy + 13, 5, 3);
  } else {
    ctx.fillRect(cx - 7, cy + 13 + legOffsetL, 6, 3);
    ctx.fillRect(cx + 2, cy + 13 + legOffsetR, 6, 3);
  }

  // Torso / Shirt
  ctx.fillStyle = shirt;
  ctx.fillRect(cx - 7, cy - 4, 14, 11);

  // Arms
  const armSwing = (frame === 0 ? -2 : frame === 2 ? 2 : 0);
  if (direction === 'left') {
    ctx.fillRect(cx - 4, cy - 2 + armSwing, 4, 8);
  } else if (direction === 'right') {
    ctx.fillRect(cx + 1, cy - 2 + armSwing, 4, 8);
  } else {
    ctx.fillRect(cx - 10, cy - 2 - armSwing, 3, 8);
    ctx.fillRect(cx + 7, cy - 2 + armSwing, 3, 8);
  }

  // Head / Face
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 6, cy - 16, 12, 12);

  // Eyes & Face details
  if (direction === 'down') {
    ctx.fillStyle = '#1A202C';
    ctx.fillRect(cx - 4, cy - 11, 2, 3); // Left eye
    ctx.fillRect(cx + 2, cy - 11, 2, 3); // Right eye
    ctx.fillStyle = '#E57373';
    ctx.fillRect(cx - 1, cy - 7, 2, 1);  // Mouth
  } else if (direction === 'left') {
    ctx.fillStyle = '#1A202C';
    ctx.fillRect(cx - 5, cy - 11, 2, 3);
  } else if (direction === 'right') {
    ctx.fillStyle = '#1A202C';
    ctx.fillRect(cx + 3, cy - 11, 2, 3);
  }

  // Hair
  ctx.fillStyle = hair;
  if (direction === 'up') {
    // Back hair covers most of the head
    ctx.fillRect(cx - 7, cy - 19, 14, 14);
  } else {
    // Hair cap and bangs
    ctx.fillRect(cx - 7, cy - 19, 14, 6);
    ctx.fillRect(cx - 7, cy - 14, 3, 5);
    ctx.fillRect(cx + 4, cy - 14, 3, 5);
  }
}

/**
 * Draws the interactive thought/speech bubble for an agent.
 */
export function drawThoughtBubble(
  ctx: CanvasRenderingContext2D,
  agent: GenerativeAgent
): void {
  ctx.save();
  const { x, y, name, thought, state } = agent;

  // Bubble colors based on state
  let bgColor = '#FFFFFF';
  let borderColor = '#0052CC';
  let badgeColor = '#0052CC';
  let textColor = '#091E42';

  if (state === 'FAILED_OFF') {
    bgColor = '#FFF0F0';
    borderColor = '#DE350B';
    badgeColor = '#DE350B';
    textColor = '#BF2600';
  } else if (state === 'SUCCESS_PATROL') {
    bgColor = '#E3FCEF';
    borderColor = '#00875A';
    badgeColor = '#00875A';
    textColor = '#006644';
  } else if (state === 'PAUSED_VPN') {
    bgColor = '#FFFAE6';
    borderColor = '#FFAB00';
    badgeColor = '#FF8B00';
    textColor = '#172B4D';
  } else if (state === 'ACTIVE_WORKING') {
    bgColor = '#DEEBFF';
    borderColor = '#0052CC';
    badgeColor = '#0052CC';
    textColor = '#0747A6';
  } else {
    bgColor = '#F4F5F7';
    borderColor = '#97A0AF';
    badgeColor = '#42526E';
    textColor = '#172B4D';
  }

  ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
  const nameWidth = ctx.measureText(name).width;

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  // Truncate thought if too long
  let displayThought = thought;
  if (displayThought.length > 36) {
    displayThought = `${displayThought.substring(0, 34)}...`;
  }
  const thoughtWidth = ctx.measureText(displayThought).width;

  const bubbleW = Math.max(nameWidth + 24, thoughtWidth + 20, 120);
  const bubbleH = 38;
  const bubbleX = x - bubbleW / 2;
  const bubbleY = y - 64;

  // Bubble Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.beginPath();
  ctx.roundRect(bubbleX + 2, bubbleY + 2, bubbleW, bubbleH, 8);
  ctx.fill();

  // Bubble Body
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 8);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Speech carrot / pointer tail
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(x - 6, bubbleY + bubbleH);
  ctx.lineTo(x, bubbleY + bubbleH + 6);
  ctx.lineTo(x + 6, bubbleY + bubbleH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(x - 6, bubbleY + bubbleH);
  ctx.lineTo(x, bubbleY + bubbleH + 6);
  ctx.lineTo(x + 6, bubbleY + bubbleH);
  ctx.stroke();

  // Agent Name Pill
  ctx.fillStyle = badgeColor;
  ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(name, bubbleX + 8, bubbleY + 6);

  // State Tag Indicator
  ctx.fillStyle = textColor;
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(displayThought, bubbleX + 8, bubbleY + 20);

  ctx.restore();
}
