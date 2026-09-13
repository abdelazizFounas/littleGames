import type { HockeyState, Skater } from '@littlegames/hockey-logic';
function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function skater(
  ctx: CanvasRenderingContext2D,
  p: Skater,
  color: string,
  number: string,
  carrier: boolean,
) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#18365830';
  ctx.beginPath();
  ctx.ellipse(4, 11, 24, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  if (carrier) {
    circle(ctx, 0, 0, 28, '#0000', color);
  }
  const angle = Math.atan2(p.dy, p.dx);
  ctx.save();
  ctx.rotate(angle);
  ctx.strokeStyle = '#334957';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, -12);
  ctx.lineTo(7, -12);
  ctx.moveTo(-10, 12);
  ctx.lineTo(7, 12);
  ctx.stroke();
  ctx.strokeStyle = '#a47a52';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, 13);
  ctx.lineTo(29, 17);
  ctx.lineTo(35, 4);
  ctx.stroke();
  ctx.restore();
  circle(ctx, 0, 0, 19, '#16354c');
  circle(ctx, 0, -2, 16, color);
  ctx.fillStyle = '#ffffffb0';
  ctx.fillRect(-13, -3, 26, 5);
  circle(ctx, -2, -7, 11, '#f0d7b7');
  circle(ctx, -2, -10, 12, color, '#f9ffff');
  ctx.fillStyle = '#17384e';
  ctx.fillRect(-10, -7, 17, 5);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(number, 0, 12);
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
  ctx.fillStyle = '#102435';
  ctx.fillRect(0, 0, 1000, 600);
  for (let i = 0; i < 62; i++) {
    const x = 25 + i * 16;
    circle(ctx, x, 12, 3, i % 3 === 0 ? '#dbab87' : '#668895');
    circle(ctx, x, 588, 3, i % 3 === 0 ? '#9ed4c8' : '#577b90');
  }
  ctx.fillStyle = '#607c90';
  ctx.beginPath();
  ctx.roundRect(24, 32, 952, 536, 70);
  ctx.fill();
  const ice = ctx.createLinearGradient(0, 40, 0, 560);
  ice.addColorStop(0, '#e2f4f4');
  ice.addColorStop(0.5, '#f1faf3');
  ice.addColorStop(1, '#b9d8e2');
  ctx.fillStyle = ice;
  ctx.beginPath();
  ctx.roundRect(34, 42, 932, 516, 62);
  ctx.fill();
  ctx.strokeStyle = '#d5eef4';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(38, 46, 924, 508, 58);
  ctx.clip();
  ctx.strokeStyle = '#7ba5b219';
  ctx.lineWidth = 1;
  for (let i = 0; i < 50; i++) {
    ctx.beginPath();
    ctx.moveTo((i * 181) % 980, (i * 57) % 550);
    ctx.lineTo(((i * 181) % 980) + 120, ((i * 57) % 550) + 45);
    ctx.stroke();
  }
  for (const x of [333, 667]) {
    ctx.fillStyle = '#508bbb80';
    ctx.fillRect(x - 5, 44, 10, 512);
  }
  ctx.fillStyle = '#d66d6b90';
  ctx.fillRect(497, 44, 6, 512);
  circle(ctx, 500, 300, 76, '#0000', '#668cac88');
  circle(ctx, 500, 300, 7, '#7aa5b1');
  ctx.fillStyle = '#6a95a344';
  ctx.font = '900 27px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('ICE CLASH', 500, 294);
  ctx.font = '10px monospace';
  ctx.fillText('LITTLE GAMES / BIG RIVALRIES', 500, 315);
  for (const x of [200, 800])
    for (const y of [170, 430]) {
      circle(ctx, x, y, 48, '#0000', '#cf767559');
      circle(ctx, x, y, 5, '#ce8b83');
    }
  for (const x of [72, 928]) {
    circle(ctx, x, 300, 72, '#72bbda30', '#6cabc566');
    ctx.fillStyle = '#da858780';
    ctx.fillRect(x - 2, 44, 4, 512);
  }
  ctx.restore();
  for (const x of [17, 963]) {
    ctx.fillStyle = '#132f4866';
    ctx.fillRect(x, 220, 20, 160);
    ctx.strokeStyle = '#f8faf2';
    ctx.lineWidth = 1;
    for (let y = 225; y < 380; y += 10) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#d55456';
    ctx.lineWidth = 5;
    ctx.strokeRect(x, 224, 20, 152);
  }
  for (let i = 0; i < 2; i++) {
    const gx = i === 0 ? 76 : 924,
      gy = state.goalies[i] ?? 300;
    ctx.fillStyle = '#17354b30';
    ctx.fillRect(gx - 22, gy - 19, 44, 44);
    ctx.fillStyle = i === seat ? '#479fba' : '#dc8274';
    ctx.beginPath();
    ctx.roundRect(gx - 18, gy - 22, 36, 44, 9);
    ctx.fill();
    ctx.fillStyle = '#f5efe0';
    ctx.fillRect(gx - 16, gy + 4, 12, 20);
    ctx.fillRect(gx + 4, gy + 4, 12, 20);
    circle(ctx, gx, gy - 12, 12, '#eef4e6', '#284957');
    ctx.strokeStyle = '#386075';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx - 7, gy - 15);
    ctx.lineTo(gx + 7, gy - 15);
    ctx.moveTo(gx - 7, gy - 9);
    ctx.lineTo(gx + 7, gy - 9);
    ctx.stroke();
  }
  state.players.forEach((p, i) =>
    skater(
      ctx,
      p,
      i === seat ? '#36a6b7' : '#e98370',
      i === seat ? '1' : '2',
      state.puck.owner === i,
    ),
  );
  const puck = state.puck;
  ctx.strokeStyle = '#3a718c38';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(puck.x - puck.vx * 2, puck.y - puck.vy * 2);
  ctx.lineTo(puck.x, puck.y);
  ctx.stroke();
  circle(ctx, puck.x + 2, puck.y + 4, 8, '#12314630');
  circle(ctx, puck.x, puck.y, 7, '#152738', '#9bb7c4');
  circle(ctx, puck.x - 2, puck.y - 2, 2, '#607f8c');
  if (state.phase === 'faceoff') {
    ctx.fillStyle = '#17364ed9';
    ctx.beginPath();
    ctx.roundRect(380, 205, 240, 160, 20);
    ctx.fill();
    ctx.fillStyle = '#f3f6e5';
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px system-ui';
    ctx.fillText(state.goal >= 0 ? 'GOAL!' : 'FACE-OFF', 500, 246);
    ctx.font = '900 60px system-ui';
    ctx.fillText(String(Math.ceil(state.countdown / 60)), 500, 315);
  }
  ctx.restore();
}
