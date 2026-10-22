// Ilustraciones SVG en estilo cartoon para el tutorial: camellos, pirámide, dados y monedas.

import type { CamelId } from '../../../shared/game';
import { CAMEL_COLORS } from '../scene/models';

const OUT = '#2b1608'; // contorno

function lighten(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, t: number) => Math.round(c + (t - c) * k);
  const r = mix((n >> 16) & 255, 255);
  const g = mix((n >> 8) & 255, 244);
  const b = mix(n & 255, 220);
  return `rgb(${r},${g},${b})`;
}

/** Camello de perfil mirando a la derecha. `mascot` lleva fez. */
export function camelSvg(id: CamelId | 'mascot'): string {
  const crazy = id === 'white' || id === 'black';
  const color = id === 'mascot' ? '#e8a33a' : id === 'black' ? '#3b3b46' : CAMEL_COLORS[id];
  const light = lighten(id === 'black' ? '#5a5a66' : color, 0.55);
  const hoof = '#5a3a22';
  const leg = (x: number, cls: string) =>
    `<g class="leg ${cls}"><rect x="${x}" y="64" width="11" height="30" rx="5" fill="${color}" stroke="${OUT}" stroke-width="3"/><rect x="${x - 1}" y="89" width="13" height="7" rx="3" fill="${hoof}" stroke="${OUT}" stroke-width="2.5"/></g>`;
  const pupils = crazy
    ? `<circle cx="110" cy="17" r="3.4" fill="${OUT}"/><circle cx="111" cy="16" r="1.1" fill="#fff"/>`
    : `<circle cx="110.5" cy="20.5" r="3.6" fill="${OUT}"/><circle cx="111.8" cy="18.9" r="1.3" fill="#fff"/>`;
  const extras =
    id === 'mascot'
      ? `<path d="M99 6 l3 -13 h13 l3 13 z" fill="#c0392b" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/><path d="M109 -7 q8 2 9 12" stroke="#f2c14e" stroke-width="2.5" fill="none"/><circle cx="118" cy="6" r="2.6" fill="#f2c14e" stroke="${OUT}" stroke-width="1.5"/>`
      : crazy
        ? `<path d="M96 10 l2 -12 l4 9 l3 -12 l3 11 l4 -9 l1 12" fill="${id === 'black' ? '#15151a' : '#d8d2c4'}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>`
        : `<path d="M100 9 l3 -9 l3 7 l3 -8 l2 9" fill="#6b4422" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>`;
  const tongue = crazy
    ? `<path d="M117 35 q2 9 7 8 q3 -1 0 -9" fill="#ff7b8a" stroke="${OUT}" stroke-width="2"/>`
    : '';
  const blanket = crazy ? ['#5b2a86', '#2fa36b'] : ['#c73a2f', '#f2c14e'];
  return `<svg class="tc-svg" viewBox="-4 -16 140 118" xmlns="http://www.w3.org/2000/svg">
    <path class="tail" d="M24 54 q-12 6 -9 20" stroke="${OUT}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <circle class="tail" cx="15" cy="75" r="4.5" fill="${OUT}"/>
    ${leg(32, 'l1')}${leg(47, 'l2')}${leg(74, 'l3')}${leg(89, 'l4')}
    <ellipse cx="62" cy="60" rx="39" ry="23" fill="${color}" stroke="${OUT}" stroke-width="3.5"/>
    <ellipse cx="62" cy="69" rx="26" ry="10" fill="${light}"/>
    <path d="M40 50 Q48 20 64 24 Q80 28 83 48" fill="${color}" stroke="${OUT}" stroke-width="3.5"/>
    <path d="M45 44 Q52 27 64 29 Q76 32 78 45 Z" fill="${blanket[0]}" stroke="${OUT}" stroke-width="2.5"/>
    <path d="M49 38 Q62 30 75 39" stroke="${blanket[1]}" stroke-width="3.5" fill="none"/>
    <path d="M88 56 Q100 48 103 28" stroke="${OUT}" stroke-width="21" fill="none" stroke-linecap="round"/>
    <path d="M88 56 Q100 48 103 28" stroke="${color}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <g class="head">
      <ellipse cx="97" cy="12" rx="4.5" ry="8" transform="rotate(-22 97 12)" fill="${color}" stroke="${OUT}" stroke-width="2.5"/>
      ${extras}
      <ellipse cx="108" cy="24" rx="16" ry="13.5" fill="${color}" stroke="${OUT}" stroke-width="3.5"/>
      <ellipse cx="121" cy="30" rx="10.5" ry="9" fill="${light}" stroke="${OUT}" stroke-width="3"/>
      <ellipse cx="127" cy="26.5" rx="1.8" ry="1.3" fill="${OUT}"/>
      ${tongue}
      <path d="M114 35 q6 5 13 0" stroke="${OUT}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <rect x="119" y="36" width="3.5" height="4" rx="1" fill="#fff" stroke="${OUT}" stroke-width="1.2"/>
      <ellipse cx="108" cy="20" rx="${crazy ? 7.5 : 6.5}" ry="${crazy ? 8.5 : 7.5}" fill="#fff" stroke="${OUT}" stroke-width="2.2"/>
      ${pupils}
      <path class="lid" d="M101 20 a7 8 0 0 1 14 0 Z" fill="${color}" stroke="${OUT}" stroke-width="2"/>
    </g>
  </svg>`;
}

/** Pirámide escalonada con su remate dorado y puerta. */
export function pyramidSvg(): string {
  const layers = Array.from({ length: 6 }, (_, i) => {
    const w = 120 - i * 18;
    const x = 70 - w / 2;
    const y = 104 - i * 15;
    return `<rect x="${x}" y="${y}" width="${w}" height="15" rx="3" fill="${i % 2 ? '#e6c07e' : '#dcb36c'}" stroke="${OUT}" stroke-width="3"/>`;
  }).join('');
  return `<svg class="tp-svg" viewBox="0 0 140 130" xmlns="http://www.w3.org/2000/svg">
    ${layers}
    <path d="M58 29 L70 8 L82 29 Z" fill="#f2c14e" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="62" y="96" width="16" height="23" rx="3" fill="#3a2010" stroke="${OUT}" stroke-width="3"/>
  </svg>`;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
};

/** Dado con puntos (o con número para el dado gris). */
export function dieHtml(color: string, value: number, numeral?: 'white' | 'black'): string {
  const inner = numeral
    ? `<text x="50" y="68" text-anchor="middle" font-size="58" font-weight="900" font-family="Georgia, serif" fill="${numeral === 'white' ? '#fff' : '#151515'}" stroke="${OUT}" stroke-width="${numeral === 'white' ? 2.5 : 0}">${value}</text>`
    : PIPS[value].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="${color === '#f0c02a' ? '#4a3200' : '#fff'}"/>`).join('');
  return `<div class="tdie"><svg viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="18" fill="${color}" stroke="${OUT}" stroke-width="6"/>${inner}</svg></div>`;
}

export function coinSvg(): string {
  return `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#f2c14e" stroke="${OUT}" stroke-width="4"/><circle cx="30" cy="30" r="18" fill="none" stroke="#c98a1c" stroke-width="3"/><text x="30" y="40" text-anchor="middle" font-size="26" font-weight="900" font-family="Georgia, serif" fill="#8a5210">1</text></svg>`;
}
