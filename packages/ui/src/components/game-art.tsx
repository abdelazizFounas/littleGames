import { useId } from 'react';

/** Lightweight vector covers; no download, external font or WebGL on the homepage. */
export function GameArt({ game, hero = false }: { readonly game: string; readonly hero?: boolean }) {
  const id = useId().replaceAll(':', '');
  if (game === 'artillery') return <svg viewBox="0 0 600 360" className="game-art" aria-hidden="true">
    <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#342738"/><stop offset="1" stopColor="#c7826d"/></linearGradient></defs>
    <path d="M0 0h600v360H0Z" fill={`url(#${id})`}/><circle cx="435" cy="89" r="42" fill="#ffddb0"/>
    <path d="M0 210 95 155 164 206 248 118 353 210 469 158 600 210V360H0Z" fill="#815e75"/>
    <path d="M0 268 110 236 240 300 350 244 483 265 600 215V360H0Z" fill="#a66f67"/>
    <path d="M0 275 115 270 215 316 345 298 480 277 600 285V360H0Z" fill="#553e44" stroke="#efb283" strokeWidth="4"/>
    <path d="M100 243Q265-80 500 250" fill="none" stroke="#ffe8b4" strokeDasharray="5 10" strokeWidth="2" opacity=".6"/>
    <g transform="translate(95 254)"><rect x="-27" width="62" height="17" rx="8" fill="#253b43"/><path d="M-25 0-18-13H20L32 0Z" fill="#cadd93"/><path d="m0-10 33-32" stroke="#e3e7b2" strokeWidth="9"/><rect x="-10" y="-20" width="25" height="16" rx="5" fill="#d9e6a2"/></g>
    <g transform="translate(499 261)"><rect x="-27" width="62" height="17" rx="8" fill="#253b43"/><path d="M-25 0-18-13H20L32 0Z" fill="#f1a98e"/><path d="m0-10-30-29" stroke="#ffd3ac" strokeWidth="9"/><rect x="-10" y="-20" width="25" height="16" rx="5" fill="#eeb396"/></g>
    <circle cx="291" cy="92" r="6" fill="#fff0ba"/><path d="m294 91-22 3" stroke="#f9d191" strokeWidth="3"/><text x="30" y="40" fill="#e2c9aa" fontSize="10" fontFamily="monospace" letterSpacing="3">A LITTLE CALCULATED CHAOS</text>
  </svg>;
  if (game === 'pong') {
    return <svg viewBox="0 0 600 360" aria-hidden="true" className="game-art">
      <defs><radialGradient id={id}><stop stopColor="#374a96"/><stop offset="1" stopColor="#171c45"/></radialGradient></defs>
      <path fill={`url(#${id})`} d="M0 0h600v360H0z"/>
      <g stroke="#6875bd" opacity=".18">{Array.from({length: 12}, (_, i) => <path key={i} d={`M${i*60} 0v360M0 ${i*40}h600`}/>)}</g>
      <g transform="translate(65 45) rotate(-9 235 135)"><rect width="470" height="270" rx="16" fill="#121831" stroke="#5867a9" strokeWidth="2"/>
      <path d="M235 12v246" stroke="#7781b6" strokeDasharray="7 12" opacity=".4"/>
      <circle cx="235" cy="135" r="62" fill="none" stroke="#5867a9" opacity=".3"/>
      <rect x="28" y="125" width="14" height="83" rx="6" fill="#c5f66a"/>
      <rect x="428" y="52" width="14" height="83" rx="6" fill="#a798ff"/>
      <path d="m115 191 141-84 64 40" fill="none" stroke="#c5f66a" strokeWidth="3" opacity=".25"/>
      <circle cx="320" cy="147" r="27" fill="#c5f66a" opacity=".08"/><circle cx="320" cy="147" r="17" fill="#c5f66a" opacity=".13"/><circle cx="320" cy="147" r="8" fill="#edffd4"/>
      <text x="160" y="70" fill="#8991c4" fontFamily="monospace" fontSize="42" opacity=".4">03 02</text></g>
      <path d="m536 28 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z" fill="#c5f66a"/>
    </svg>;
  }
  if (game === 'battleship') {
    return <svg viewBox="0 0 600 360" aria-hidden="true" className="game-art">
      <defs><radialGradient id={id}><stop stopColor="#236779"/><stop offset="1" stopColor="#102f40"/></radialGradient></defs>
      <path fill={`url(#${id})`} d="M0 0h600v360H0z"/>
      <g stroke="#68b8bd" opacity=".14">{Array.from({length: 13}, (_, i) => <path key={i} d={`M${i*50} 0v360M0 ${i*40}h600`}/>)}</g>
      <g fill="none" stroke="#76daca"><circle cx="335" cy="178" r="140" opacity=".12"/><circle cx="335" cy="178" r="100" opacity=".18"/><circle cx="335" cy="178" r="60" opacity=".22"/><path d="m335 178 110-87" opacity=".4"/></g>
      <g transform="translate(126 95) rotate(-28 150 70)"><path d="m0 74 40-38h251l40 38-40 40H40Z" fill="#081f2e" opacity=".6" transform="translate(12 17)"/>
      <path d="m0 70 40-38h251l40 38-40 40H40Z" fill="#78a5a9"/><path d="m15 70 30-27h242l27 27-28 27H45Z" fill="#c0d2c0"/>
      <rect x="95" y="44" width="132" height="51" rx="5" fill="#47767d"/><rect x="119" y="33" width="76" height="47" rx="3" fill="#91b4b0"/>
      <rect x="148" y="15" width="12" height="42" fill="#deecd1"/><path d="M53 54v31m9-31v31m186-31v31m9-31v31" stroke="#507b7d" strokeWidth="5"/></g>
      <g stroke="#ffb079" fill="none" strokeWidth="2"><circle cx="456" cy="265" r="24"/><path d="M456 230v20m0 30v20m-35-35h20m30 0h20"/></g>
      <circle cx="456" cy="265" r="5" fill="#ffb079"/><circle cx="87" cy="267" r="5" fill="#a9ddd0" opacity=".5"/>
    </svg>;
  }
  return <svg viewBox={hero ? '0 0 600 510' : '0 70 600 360'} aria-hidden="true" className="game-art">
    <defs><radialGradient id={id}><stop stopColor="#914535"/><stop offset="1" stopColor="#302332"/></radialGradient></defs>
    <path fill={`url(#${id})`} d="M0 0h600v510H0z"/>
    <g fill="none" stroke="#efa78a" opacity=".15"><ellipse cx="306" cy="274" rx="274" ry="168"/><ellipse cx="306" cy="274" rx="217" ry="128"/><path d="M32 274h548M306 106v336"/></g>
    <circle cx="448" cy="113" r="62" fill="#ff926f" opacity=".1"/><circle cx="448" cy="113" r="42" fill="#ffb18c"/>
    <g transform="translate(36 119)">
      <path d="m8 164 244-121 269 135-244 132Z" fill="#101a26" opacity=".6" transform="translate(0 27)"/>
      <path d="m8 153 244-121 269 135v29L277 317 8 182Z" fill="#422e3b"/>
      <path d="m8 153 244-121 269 135-244 132Z" fill="#d17c5f"/>
      <path d="m8 153 244-121v-50L8 103Z" fill="#9b5b50"/>
      <path d="m252-18 269 135v50L252 32Z" fill="#edaa7f"/>
      <path d="m8 103 244-121 269 135-10 6L252-8 18 109Z" fill="#f6c295"/>
      <path d="m115 207 244-122 45 23-244 122Z" fill="#172e38"/>
      <path d="m115 207 244-122m-200 145 245-122" stroke="#b8efb0" strokeWidth="3"/>
      <g stroke="#b46553" opacity=".45">{Array.from({length: 6}, (_,i)=><path key={i} d={`m${35+i*39} ${141-i*19} 255 129`}/>)}</g>
      <g><path d="m64 118 44-22 46 23v49l-45 24-45-23Z" fill="#935849"/><path d="m64 118 44-22 46 23-45 23Z" fill="#f2ba7c"/><path d="m109 142 45-23v49l-45 24Z" fill="#c88a58"/><path d="m71 135 30 15m-30 9 30 15" stroke="#c38862" strokeWidth="4"/></g>
      <g><path d="m342 182 52-26 48 24v46l-50 27-50-25Z" fill="#9b6650"/><path d="m342 182 52-26 48 24-50 27Z" fill="#f5bf7a"/><path d="m392 207 50-27v46l-50 27Z" fill="#bd8051"/></g>
      <g transform="translate(254 87)"><path d="m0 15 20-10 21 11v72l-21 10L0 87Z" fill="#805059"/><path d="m0 15 20-10 21 11-21 10Z" fill="#f3b49b"/><path d="M20 26v72l21-10V16Z" fill="#c18277"/></g>
      <g transform="translate(221 181)"><ellipse cy="47" rx="24" ry="12" fill="#2b2635" opacity=".5"/><path d="m-11 20-4 25m21-24 7 22" stroke="#284b52" strokeWidth="11"/><path d="M-12-9h24v35h-24Z" fill="#c5f66a"/><path d="M-9-26h19v19H-9Z" fill="#e3ffb4"/><path d="M-9-18h18" stroke="#304555" strokeWidth="5"/><path d="m-13 0-11 17m35-17 16 7" stroke="#9dcb60" strokeWidth="10"/><path d="m15 4 29-15" stroke="#273744" strokeWidth="7"/></g>
      <g transform="translate(381 98)"><ellipse cy="38" rx="20" ry="10" fill="#2b2635" opacity=".4"/><path d="m-8 14-5 20m17-19 8 18" stroke="#60436d" strokeWidth="9"/><path d="M-11-12h22v31h-22Z" fill="#aa9afa"/><path d="M-8-28h17v17H-8Z" fill="#ddd0ff"/><path d="M-8-20h17" stroke="#463858" strokeWidth="5"/><path d="m-10-3-16 10" stroke="#b6a1fa" strokeWidth="9"/><path d="m-17 7-22 10" stroke="#29323e" strokeWidth="6"/></g>
      <path d="m268 175 63-33" stroke="#f5fabc" strokeWidth="3"/><path d="m278 170 39-20" stroke="#fff"/>
    </g>
    <g fill="#c5f66a"><path d="m103 77 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z"/><circle cx="515" cy="365" r="4"/></g>
  </svg>;
}
