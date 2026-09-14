import type { HockeyState, Skater } from '@littlegames/hockey-logic';

type Point = readonly [number, number, number?];
const TAU = Math.PI * 2;
function project([x, y, z = 0]: Point): [number, number] {
  return [500 + (x - 500) * (0.86 + y * 0.0002), 54 + y * 0.86 - z];
}
function polygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  fill: string | CanvasGradient,
  stroke?: string,
) {
  ctx.beginPath();
  points.forEach((point, i) => {
    const [x, y] = project(point);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function line(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string, width = 2) {
  ctx.beginPath();
  points.forEach((point, i) => {
    const [x, y] = project(point);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string | CanvasGradient,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
function rinkOutline(z = 0): Point[] {
  const result: Point[] = [];
  for (const [cx, cy, start] of [
    [103, 113, Math.PI],
    [897, 113, -Math.PI / 2],
    [897, 487, 0],
    [103, 487, Math.PI / 2],
  ]) {
    if (cx === undefined || cy === undefined || start === undefined) continue;
    for (let i = 0; i <= 14; i++) {
      const a = start + ((i / 14) * Math.PI) / 2;
      result.push([cx + Math.cos(a) * 66, cy + Math.sin(a) * 66, z]);
    }
  }
  return result.flatMap((a, i) => {
    const b = result[(i + 1) % result.length];
    if (!b || Math.abs(a[0] - b[0]) > 1 || Math.abs(a[1] - b[1]) < 100) return [a];
    const cuts = a[1] < b[1] ? [225, 375] : [375, 225];
    return [a].concat(cuts.map((y): Point => [a[0], y, z]));
  });
}
function iceCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width = 2,
) {
  line(
    ctx,
    Array.from(
      { length: 49 },
      (_, i): Point => [x + Math.cos((i / 48) * TAU) * r, y + Math.sin((i / 48) * TAU) * r],
    ),
    color,
    width,
  );
}
function boards(ctx: CanvasRenderingContext2D, near: boolean) {
  const outline = rinkOutline();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length];
    if (!a || !b || (a[1] + b[1]) / 2 > 300 !== near) continue;
    // Recess only the goal mouth, retaining the side boards above and below it.
    const middleY = (a[1] + b[1]) / 2;
    if (Math.abs(a[0] - b[0]) < 1 && middleY > 225 && middleY < 375) continue;
    polygon(
      ctx,
      [
        [a[0], a[1], -17],
        [b[0], b[1], -17],
        [b[0], b[1], 21],
        [a[0], a[1], 21],
      ],
      near ? '#6a8291' : '#d4e4e7',
    );
    line(
      ctx,
      [
        [a[0], a[1], 4],
        [b[0], b[1], 4],
      ],
      '#e5b65e',
      5,
    );
    line(
      ctx,
      [
        [a[0], a[1], 22],
        [b[0], b[1], 22],
      ],
      '#e6f6f4',
      5,
    );
    polygon(
      ctx,
      [
        [a[0], a[1], 24],
        [b[0], b[1], 24],
        [b[0], b[1], 48],
        [a[0], a[1], 48],
      ],
      near ? '#bdeaf018' : '#bdeaf032',
    );
    line(
      ctx,
      [
        [a[0], a[1], 48],
        [b[0], b[1], 48],
      ],
      '#b8e3ed66',
      1,
    );
  }
}
function goal(ctx: CanvasRenderingContext2D, side: number, flash: boolean) {
  const x = side === 0 ? 37 : 963,
    back = x + (side === 0 ? -30 : 30),
    color = flash ? '#ffd38c' : '#ed6963';
  polygon(
    ctx,
    [
      [x, 225],
      [back, 225],
      [back, 375],
      [x, 375],
    ],
    '#29425645',
  );
  polygon(
    ctx,
    [
      [x, 225, 36],
      [back, 235, 28],
      [back, 365, 28],
      [x, 375, 36],
    ],
    '#d9f0e13d',
  );
  polygon(
    ctx,
    [
      [back, 235],
      [back, 365],
      [back, 365, 28],
      [back, 235, 28],
    ],
    '#a9c9c252',
  );
  for (let y = 225; y <= 375; y += 12) {
    line(
      ctx,
      [
        [x, y, 36],
        [back, 235 + ((y - 225) * 130) / 150, 28],
        [back, 235 + ((y - 225) * 130) / 150],
      ],
      '#e4f4ec91',
      1,
    );
  }
  for (let z = 0; z <= 28; z += 7)
    line(
      ctx,
      [
        [back, 235, z],
        [back, 365, z],
      ],
      '#ecf6ee99',
      1,
    );
  for (const y of [225, 375]) {
    polygon(
      ctx,
      [
        [x, y],
        [back, y === 225 ? 235 : 365],
        [back, y === 225 ? 235 : 365, 28],
        [x, y, 36],
      ],
      '#d4ece559',
    );
    line(
      ctx,
      [
        [back, y === 225 ? 235 : 365],
        [back, y === 225 ? 235 : 365, 28],
        [x, y, 36],
        [x, y],
      ],
      color,
      4,
    );
  }
  line(
    ctx,
    [
      [x, 225, 36],
      [x, 375, 36],
    ],
    color,
    5,
  );
  line(
    ctx,
    [
      [x, 225, 37],
      [x, 375, 37],
    ],
    '#ffe7d688',
    1.5,
  );
}
function athlete(
  ctx: CanvasRenderingContext2D,
  p: Skater,
  color: string,
  number: string,
  carrier: boolean,
  tick: number,
  keeper = false,
) {
  const [x, y] = project([p.x, p.y]);
  const scale = 0.88 + p.y * 0.0002;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const speed = Math.hypot(p.vx, p.vy),
    angle = Math.atan2(p.dy * 0.86, p.dx),
    down = p.down > 0;
  const nx = -Math.sin(angle),
    ny = Math.cos(angle);
  ellipse(ctx, 6, 5, down ? 32 : keeper ? 25 : 22, down ? 10 : 8, '#18364b35');
  if (carrier) ellipse(ctx, 0, 0, 27, 17, '#66d2ed18', '#48b8ce88');
  if (p.charge > 0) {
    ctx.save();
    ctx.scale(1, 0.65);
    ctx.beginPath();
    ctx.arc(0, 0, 31, -Math.PI / 2, -Math.PI / 2 + TAU * p.charge);
    ctx.strokeStyle = p.charge > 0.95 ? '#ffe0a1' : '#f2b573';
    ctx.lineWidth = 3 + p.charge * 3;
    ctx.stroke();
    ctx.restore();
  }
  if (down) {
    ctx.save();
    ctx.rotate(speed > 0.1 ? Math.atan2(p.vy * 0.86, p.vx) : angle);
    ellipse(ctx, 0, -3, 21, 10, color, '#12273b');
    ctx.fillStyle = '#152c40';
    ctx.fillRect(-25, -9, 15, 13);
    ellipse(ctx, 21, -3, 9, 9, '#e9c6a4');
    ellipse(ctx, 22, -5, 10, 8, color, '#e7f9f4');
    ctx.strokeStyle = '#e6f2ec';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-29, -8);
    ctx.lineTo(-39, -9);
    ctx.moveTo(-27, 5);
    ctx.lineTo(-37, 9);
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const a = tick * 0.2 + (i * TAU) / 3;
      ellipse(ctx, Math.cos(a) * 15, -25 + Math.sin(a) * 4, 2.5, 2.5, '#ffe0a0');
    }
    ctx.restore();
    return;
  }
  const stride = keeper
    ? Math.sin(tick * 0.14) * 2
    : Math.sin(tick * 0.28) * Math.min(6, speed * 1.5);
  const skin = '#e8b994',
    dark = '#172b3b';
  // Separate hips, padded knees, boots, and steel blades give the body height.
  for (const side of [-1, 1]) {
    const fx = nx * side * (keeper ? 12 : 8) + Math.cos(angle) * stride * side,
      fy = ny * side * 6 + Math.sin(angle) * stride * side * 0.5;
    ctx.strokeStyle = dark;
    ctx.lineWidth = keeper ? 12 : 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * 6, -20);
    ctx.lineTo(fx, fy - 5);
    ctx.stroke();
    if (keeper) {
      ctx.strokeStyle = '#e7eee0';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(fx, fy - 16);
      ctx.lineTo(fx, fy - 4);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ellipse(ctx, fx + Math.cos(angle) * 2, fy - 3, keeper ? 8 : 7, 4, '#142d42');
    ctx.strokeStyle = '#d9e6e8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(fx - 7, fy + 1);
    ctx.lineTo(fx + 7, fy + 1);
    ctx.stroke();
  }
  const body = ctx.createLinearGradient(-16, -35, 14, -14);
  body.addColorStop(0, '#eefbf566');
  body.addColorStop(0.3, color);
  body.addColorStop(1, '#17334e');
  ellipse(ctx, 0, -23, keeper ? 19 : 15, 15, body, dark);
  ctx.fillStyle = '#f1f5e1';
  ctx.fillRect(-12, -19, 24, 4);
  ctx.fillStyle = color;
  ctx.fillRect(-10, -14, 20, 4);
  const wind = p.charge * 1.7,
    progress = p.swing > 0 ? 1 - p.swing / (12 + Math.round(p.swingPower * 10)) : 0;
  const swingAngle = angle + (p.swing > 0 ? -1.5 + progress * 2.7 : 0.65 + wind);
  const reach = keeper ? 30 : 38 + p.charge * 7;
  const sx = Math.cos(swingAngle) * reach,
    sy = Math.sin(swingAngle) * reach * 0.76;
  if (p.swing > 0) {
    ctx.save();
    ctx.scale(1, 0.76);
    ctx.beginPath();
    ctx.arc(0, 0, 42 + p.swingPower * 15, swingAngle - 0.8 - p.swingPower * 0.6, swingAngle);
    ctx.strokeStyle = `rgba(255,219,154,${(1 - progress) * 0.8})`;
    ctx.lineWidth = 4 + p.swingPower * 9;
    ctx.stroke();
    ctx.restore();
  }
  const gloveX = Math.cos(swingAngle) * 13,
    gloveY = -21 + Math.sin(swingAngle) * 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-12, -29);
  ctx.lineTo(gloveX - 5, gloveY);
  ctx.moveTo(12, -29);
  ctx.lineTo(gloveX + 4, gloveY + 3);
  ctx.stroke();
  ctx.strokeStyle = '#153547';
  ctx.lineWidth = keeper ? 5 : 3.7;
  ctx.beginPath();
  ctx.moveTo(gloveX - 4, gloveY - 2);
  ctx.lineTo(sx, sy - 2);
  ctx.lineTo(sx + Math.cos(angle) * 11, sy + Math.sin(angle) * 8 - 2);
  ctx.stroke();
  ctx.strokeStyle = '#edf0d8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx - 2, sy - 3);
  ctx.lineTo(sx + Math.cos(angle) * 10, sy + Math.sin(angle) * 8 - 3);
  ctx.stroke();
  ellipse(ctx, gloveX - 4, gloveY, 5, 5, dark);
  ellipse(ctx, gloveX + 5, gloveY + 2, keeper ? 8 : 5, keeper ? 7 : 5, dark, color);
  ellipse(ctx, Math.cos(angle) * 3, -39 + Math.sin(angle) * 2, 9, 10, skin);
  const helmet = ctx.createLinearGradient(-8, -51, 10, -35);
  helmet.addColorStop(0, '#f0fffb');
  helmet.addColorStop(0.25, keeper ? '#f1ead8' : color);
  helmet.addColorStop(1, dark);
  ellipse(ctx, 0, -43, 11, 9, helmet, '#ddf6ef');
  ctx.strokeStyle = '#ffffffad';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-5, -49);
  ctx.lineTo(3, -50);
  ctx.stroke();
  const faceX = Math.cos(angle) * 7,
    faceY = -39 + Math.sin(angle) * 5;
  ellipse(ctx, faceX, faceY, keeper ? 7 : 6, keeper ? 6 : 3, '#152d43ba', '#aacbd2');
  if (keeper) {
    ctx.strokeStyle = '#e9f4eb';
    ctx.lineWidth = 1;
    for (const offset of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(faceX - 5, faceY + offset);
      ctx.lineTo(faceX + 5, faceY + offset);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(faceX, faceY - 5);
    ctx.lineTo(faceX, faceY + 5);
    ctx.stroke();
  }
  ctx.fillStyle = '#f5f4df';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(number, -Math.cos(angle) * 4, -22);
  // Fine ice spray trails follow the actual skating momentum.
  if (speed > 3)
    for (let i = 0; i < 3; i++)
      ellipse(
        ctx,
        -p.vx * (3 + i * 1.5) + (i - 1) * 4,
        -p.vy * (1 + i * 0.7) + 4,
        2 - i * 0.3,
        1,
        '#f5ffffaa',
      );
  ctx.restore();
}
export function drawHockey(
  ctx: CanvasRenderingContext2D,
  state: HockeyState,
  seat: number,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.scale(width / 1000, height / 600);
  const backdrop = ctx.createLinearGradient(0, 0, 0, 600);
  backdrop.addColorStop(0, '#0b1c30');
  backdrop.addColorStop(1, '#253f4e');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, 1000, 600);
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 47; i++) {
      const x = 35 + i * 20;
      ellipse(ctx, x, 12 + row * 13, 6, 4, (i + row) % 4 === 0 ? '#9a675a' : '#3a5c74');
    }
  ctx.fillStyle = '#98d6e8';
  ctx.shadowColor = '#76d9f6';
  ctx.shadowBlur = 12;
  ctx.fillRect(118, 8, 260, 2);
  ctx.fillRect(622, 8, 260, 2);
  ctx.shadowBlur = 0;
  polygon(ctx, rinkOutline(-25), '#081d2be6');
  polygon(ctx, rinkOutline(-12), '#426579');
  const ice = ctx.createLinearGradient(0, 80, 0, 540);
  ice.addColorStop(0, '#bddde9');
  ice.addColorStop(0.45, '#eff9f2');
  ice.addColorStop(1, '#d5edf1');
  polygon(ctx, rinkOutline(), ice);
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 85; i++)
    line(
      ctx,
      [
        [45 + ((i * 173) % 910), 50 + ((i * 61) % 495)],
        [115 + ((i * 173) % 910), 69 + ((i * 61) % 495)],
      ],
      i % 2 ? '#628f9a0b' : '#ffffff40',
      1,
    );
  for (const x of [333, 667])
    line(
      ctx,
      [
        [x, 47],
        [x, 553],
      ],
      '#428bbe91',
      7,
    );
  line(
    ctx,
    [
      [500, 47],
      [500, 553],
    ],
    '#d56c728f',
    5,
  );
  iceCircle(ctx, 500, 300, 76, '#397fa477');
  iceCircle(ctx, 500, 300, 5, '#6296a5', 4);
  for (const x of [200, 800])
    for (const y of [170, 430]) {
      iceCircle(ctx, x, y, 48, '#c46d745e');
      iceCircle(ctx, x, y, 4, '#c46d7488', 4);
      line(
        ctx,
        [
          [x - 10, y - 47],
          [x - 10, y - 55],
        ],
        '#c46d7480',
      );
      line(
        ctx,
        [
          [x + 10, y - 47],
          [x + 10, y - 55],
        ],
        '#c46d7480',
      );
    }
  for (const x of [72, 928]) {
    const points: Point[] = Array.from({ length: 49 }, (_, i) => [
      x + Math.cos((i / 48) * TAU) * 72,
      300 + Math.sin((i / 48) * TAU) * 72,
    ]);
    polygon(ctx, points, '#76bcd938');
    iceCircle(ctx, x, 300, 72, '#488ea155');
    line(
      ctx,
      [
        [x, 47],
        [x, 553],
      ],
      '#c6757766',
      2,
    );
  }
  const [cx, cy] = project([500, 300]);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.86);
  ctx.fillStyle = '#56828f2a';
  ctx.font = '900 32px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('ICE CLASH', 0, -5);
  ctx.font = '9px monospace';
  ctx.fillText('FROZEN RIVALRIES · LITTLE GAMES', 0, 17);
  ctx.restore();
  polygon(
    ctx,
    [
      [160, 80],
      [220, 80],
      [600, 520],
      [540, 520],
    ],
    '#ffffff19',
  );
  polygon(
    ctx,
    [
      [720, 80],
      [760, 80],
      [380, 520],
      [340, 520],
    ],
    '#ffffff16',
  );
  ctx.restore();
  boards(ctx, false);
  const objects: { y: number; draw: () => void }[] = [];
  for (let i = 0; i < 2; i++) {
    const gy = state.goalies[i] ?? 300;
    const keeper: Skater = {
      x: i === 0 ? 76 : 924,
      y: gy,
      vx: 0,
      vy: 0,
      dx: i === 0 ? 1 : -1,
      dy: (state.puck.y - gy) / 150,
      cooldown: 0,
      charge: 0,
      down: 0,
      swing: 0,
      swingPower: 0,
    };
    objects.push({
      y: gy,
      draw: () =>
        athlete(ctx, keeper, i === seat ? '#37a4c0' : '#e38c76', 'G', false, state.tick, true),
    });
    objects.push({
      y: 376,
      draw: () => goal(ctx, i, state.phase === 'faceoff' && state.goal === 1 - i),
    });
  }
  state.players.forEach((p, i) =>
    objects.push({
      y: p.y,
      draw: () =>
        athlete(
          ctx,
          p,
          i === seat ? '#32aac3' : '#e58672',
          i === seat ? '1' : '2',
          state.puck.owner === i,
          state.tick,
        ),
    }),
  );
  objects.push({
    y: state.puck.y,
    draw: () => {
      const p = state.puck;
      line(
        ctx,
        [
          [p.x - p.vx * 2.5, p.y - p.vy * 2.5, 2],
          [p.x, p.y, 2],
        ],
        '#578da455',
        4,
      );
      const [x, y] = project([p.x, p.y]);
      ellipse(ctx, x + 2, y + 3, 8, 4, '#173b4f38');
      ellipse(ctx, x, y, 7, 4.5, '#132332');
      ellipse(ctx, x, y - 3, 7, 4, '#263f52', '#84a5b2');
    },
  });
  objects.toSorted((a, b) => a.y - b.y).forEach((object) => object.draw());
  boards(ctx, true);
  ctx.fillStyle = '#bcdfe98c';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('LITTLE GAMES  /  FROZEN RIVALRIES', 500, 582);
  if (state.phase === 'faceoff') {
    ctx.fillStyle = '#133049e8';
    ctx.beginPath();
    ctx.roundRect(415, 225, 170, 112, 14);
    ctx.fill();
    ctx.strokeStyle = '#91d1da55';
    ctx.stroke();
    ctx.fillStyle = '#f2f7e8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText(state.goal >= 0 ? 'GOAL!' : 'FACE-OFF', 500, 252);
    ctx.font = '900 46px system-ui';
    ctx.fillText(String(Math.ceil(state.countdown / 60)), 500, 305);
  }
  ctx.restore();
}
