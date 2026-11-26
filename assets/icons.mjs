const paths = {
  phone:
    '<rect x="6.5" y="2" width="11" height="20" rx="2.8"/><path d="M10 5h4m-3 14h2"/>',
  tablet:
    '<rect x="3.5" y="2.5" width="17" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 14.5A8.8 8.8 0 0 1 9.5 3a9 9 0 1 0 11 11.5Z"/>',
  link: '<path d="m10 14 4-4m-5 6-1 1a4.2 4.2 0 0 1-6-6l3.5-3.5a4.2 4.2 0 0 1 6 0M15 8l1-1a4.2 4.2 0 0 1 6 6l-3.5 3.5a4.2 4.2 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  rotate:
    '<path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  refresh: '<path d="M20 5v5h-5m5 0a8 8 0 1 0 0 5"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  next: '<path d="m9.5 5 7 7-7 7"/>',
  display:
    '<rect x="2" y="3.5" width="20" height="14" rx="2.5"/><path d="M8 21h8m-4-3v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sliders:
    '<path d="M3 7h7m5 0h6M3 17h12m4 0h2"/><circle cx="12" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
export function icon(name) {
  return (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (paths[name] || "") +
    "</svg>"
  );
}
