export function shellSkinAccentColor(skin: string): number {
  switch (skin) {
    case 'kanagawa': return 0x1a3a5c;
    case 'dragon': return 0x8b0000;
    case 'bamboo': return 0x2d5a1b;
    default: return 0xd4a843;
  }
}
