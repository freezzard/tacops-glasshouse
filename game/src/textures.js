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

// Large warm tiles with a darker grout cross, for the dome hall floor.
export function floorTiles() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#a5714f';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 900, ['#9c6543', '#b07c55', '#a06a48'], 3);
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

// Paler slab concrete for the service corridor and lanes.
export function slabFloor() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8f8b82';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, ['#85817a', '#9a968e', '#7c786f'], 3);
    ctx.strokeStyle = '#5d5a52';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, h);
  });
}

export function soil() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#4c3a28';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 800, ['#5a4630', '#3e2f1f', '#66513a', '#57432c'], 3);
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
