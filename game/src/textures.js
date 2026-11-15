// textures.js — every surface texture is painted on a canvas at boot.
//
// The game ships no image files: terracotta floor tiles, planter soil, crate
// planks, catwalk grating, bark and the two site roundels are all drawn here
// with a fixed seed, so the glasshouse looks the same on every load and the
// entry stays a handful of text files.

import * as THREE from 'three';
import { makeRng } from './state.js';

const rng = makeRng(7101); // texture painting only; never gameplay

function canvas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, w, h, n, colors, size) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * size, 1 + rng() * size);
  }
}

// Soft worn blotches: foot traffic and weather, at alpha so the base
// colour still rules.
function blotches(ctx, w, h, n, color, alpha, rMax) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, 8 + rng() * rMax, 5 + rng() * rMax * 0.6, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Large warm tiles with a darker grout cross, for the dome hall floor.
// Each of the four tiles in the repeat carries its own shade, the way real
// terracotta fires unevenly.
export function floorTiles() {
  return canvas(256, 256, (ctx, w, h) => {
    const shades = ['#a5714f', '#9d6a48', '#ab7853', '#a26c46'];
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      ctx.fillStyle = shades[ty * 2 + tx];
      ctx.fillRect(tx * w / 2, ty * h / 2, w / 2, h / 2);
    }
    speckle(ctx, w, h, 900, ['#9c6543', '#b07c55', '#a06a48'], 3);
    blotches(ctx, w, h, 7, '#7c4e30', 0.16, 34);
    blotches(ctx, w, h, 4, '#c08a5e', 0.12, 26);
    ctx.strokeStyle = '#6e452c';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

// Paler slab concrete for the service corridor and lanes, with a panel
// cross and the stains a working corridor earns.
export function slabFloor() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8f8b82';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, ['#85817a', '#9a968e', '#7c786f'], 3);
    blotches(ctx, w, h, 6, '#6d6a61', 0.18, 36);
    blotches(ctx, w, h, 3, '#5c6650', 0.13, 24); // moss creeping in
    ctx.strokeStyle = '#5d5a52';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
  });
}

export function soil() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#4c3a28';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 800, ['#5a4630', '#3e2f1f', '#66513a', '#57432c'], 3);
    speckle(ctx, w, h, 90, ['#8d8578', '#a39a89'], 2); // grit and small stones
    blotches(ctx, w, h, 5, '#3f6034', 0.35, 16); // moss between the roots
  });
}

export function crateWood() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9c7a4e';
    ctx.fillRect(0, 0, w, h);
    for (let y = 16; y < h; y += 26) {
      ctx.fillStyle = 'rgba(90,62,30,.45)';
      ctx.fillRect(0, y, w, 3);
    }
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(110,80,44,${0.12 + rng() * 0.2})`;
      ctx.lineWidth = 1;
      const y = rng() * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rng() - 0.5) * 6); ctx.stroke();
    }
    // A diagonal brace and a stencilled handling mark.
    ctx.strokeStyle = 'rgba(90,62,30,.5)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(6, h - 6); ctx.lineTo(w - 6, 6); ctx.stroke();
    ctx.fillStyle = 'rgba(60,40,18,.4)';
    ctx.fillRect(w / 2 - 17, h / 2 - 10, 34, 20);
    ctx.strokeStyle = '#6e5227';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, w, h);
  });
}

export function grating() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#565d61';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#33383b';
    for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 16) ctx.fillRect(x, y, 9, 9);
    speckle(ctx, w, h, 200, ['#62686c', '#4a5054'], 2);
  });
}

export function bark() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#5d4630';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 7) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(40,28,16,.5)' : 'rgba(120,95,60,.35)';
      ctx.fillRect(x, 0, 3, h);
    }
    for (let i = 0; i < 9; i++) { // knots and short cracks across the grain
      ctx.strokeStyle = 'rgba(35,24,13,.55)';
      ctx.lineWidth = 1.5;
      const x = rng() * w, y = rng() * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 + rng() * 12, y + (rng() - 0.5) * 4); ctx.stroke();
    }
    blotches(ctx, w, h, 4, '#466636', 0.25, 13); // moss on the shaded side
  });
}

// A soft leaf-cluster sprite for planter canopies, drawn as overlapping
// ellipses so a cheap plane still reads as foliage.
export function leafSprite() {
  const tex = canvas(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const greens = ['#4d7c4f', '#6fae62', '#33573a', '#5c9153'];
    for (let i = 0; i < 46; i++) {
      ctx.save();
      ctx.translate(w / 2 + (rng() - 0.5) * 74, h / 2 + (rng() - 0.5) * 74);
      ctx.rotate(rng() * Math.PI);
      ctx.fillStyle = greens[Math.floor(rng() * greens.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, 8 + rng() * 13, 4 + rng() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// The painted roundel on a bombsite floor: a ring, the site letter, and a
// wash of the site's colour.
export function siteRoundel(letter, colourCss) {
  const tex = canvas(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = colourCss;
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 104, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = colourCss;
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 104, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 130px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 6);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
