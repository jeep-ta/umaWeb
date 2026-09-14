// 2D HTML/CSS particle effects & speech bubble manager
// Injected into the container/Shadow DOM above the 3D canvas

export class ChibiParticleManager {
  constructor(containerElement) {
    this.container = containerElement;
    this.particles = [];
  }

  // Spawn floating heart
  spawnHeart(screenX, screenY) {
    const heart = document.createElement('div');
    heart.className = 'chibi-particle chibi-particle-heart';
    heart.textContent = ['❤️', '💖', '💕', '✨', '🌸'][Math.floor(Math.random() * 5)];

    const offsetX = (Math.random() - 0.5) * 40;
    const offsetY = (Math.random() - 0.5) * 20;
    heart.style.left = `${screenX + offsetX}px`;
    heart.style.top = `${screenY + offsetY}px`;

    this.container.appendChild(heart);

    setTimeout(() => {
      if (heart.parentNode) heart.parentNode.removeChild(heart);
    }, 1200);
  }

  // Spawn crumbs when eating
  spawnCrumbs(screenX, screenY) {
    for (let i = 0; i < 4; i++) {
      const crumb = document.createElement('div');
      crumb.className = 'chibi-particle chibi-particle-crumb';
      const morsels = ['🥕', '✨', '🍪', '🍰', '🍙'];
      crumb.textContent = morsels[Math.floor(Math.random() * morsels.length)];

      const vx = (Math.random() - 0.5) * 60;
      crumb.style.setProperty('--vx', `${vx}px`);
      crumb.style.left = `${screenX + (Math.random() - 0.5) * 20}px`;
      crumb.style.top = `${screenY - 10}px`;

      this.container.appendChild(crumb);
      setTimeout(() => {
        if (crumb.parentNode) crumb.parentNode.removeChild(crumb);
      }, 900);
    }
  }

  // Spawn emote pop (e.g. '!', '?', '💦', '💢')
  spawnEmote(screenX, screenY, emote = '!') {
    const el = document.createElement('div');
    el.className = 'chibi-particle chibi-particle-emote';
    el.textContent = emote;
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY - 35}px`;

    this.container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1000);
  }

  // Spawn sleeping Zzz
  spawnSleepZzz(screenX, screenY) {
    const zzz = document.createElement('div');
    zzz.className = 'chibi-particle chibi-particle-zzz';
    zzz.textContent = '💤';
    const offsetX = (Math.random() * 20);
    zzz.style.left = `${screenX + 15 + offsetX}px`;
    zzz.style.top = `${screenY - 30}px`;

    this.container.appendChild(zzz);
    setTimeout(() => {
      if (zzz.parentNode) zzz.parentNode.removeChild(zzz);
    }, 1800);
  }

  // Spawn dust puff at feet coordinates
  spawnDust(screenX, screenY, dirX = -1) {
    const dust = document.createElement('div');
    dust.className = 'chibi-particle chibi-particle-dust';
    dust.textContent = '💨';
    dust.style.setProperty('--dust-dir', `${dirX * 25}px`);
    dust.style.left = `${screenX + (Math.random() - 0.5) * 16}px`;
    dust.style.top = `${screenY - 5}px`;

    this.container.appendChild(dust);
    setTimeout(() => {
      if (dust.parentNode) dust.parentNode.removeChild(dust);
    }, 750);
  }

  // Spawn comic sweat drop on rapid clicks/pokes
  spawnSweat(screenX, screenY) {
    const sweat = document.createElement('div');
    sweat.className = 'chibi-particle chibi-particle-sweat';
    sweat.textContent = '💦';
    sweat.style.left = `${screenX + 15}px`;
    sweat.style.top = `${screenY - 40}px`;

    this.container.appendChild(sweat);
    setTimeout(() => {
      if (sweat.parentNode) sweat.parentNode.removeChild(sweat);
    }, 850);
  }

  // Spawn anger/competitive spark when picked up repeatedly
  spawnAnger(screenX, screenY) {
    const anger = document.createElement('div');
    anger.className = 'chibi-particle chibi-particle-anger';
    anger.textContent = '💢';
    anger.style.left = `${screenX - 15}px`;
    anger.style.top = `${screenY - 45}px`;

    this.container.appendChild(anger);
    setTimeout(() => {
      if (anger.parentNode) anger.parentNode.removeChild(anger);
    }, 900);
  }

  // Clear all particles
  clear() {
    const existing = this.container.querySelectorAll('.chibi-particle');
    existing.forEach(el => el.remove());
  }
}
