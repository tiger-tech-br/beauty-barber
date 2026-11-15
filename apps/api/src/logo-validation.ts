export const MAX_LOGO_BYTES = 256 * 1024;
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);

/** Inspeciona a estrutura PNG sem decodificar a imagem ou processar metadados. */
export function isValidPngLogo(bytes: Buffer): boolean {
  if (bytes.length < 57 || bytes.length > MAX_LOGO_BYTES || !bytes.subarray(0,8).equals(pngSignature)) return false;
  let position = 8;
  let sawHeader = false;
  let sawData = false;
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position);
    if (length > bytes.length - position - 12) return false;
    const chunk = bytes.toString('ascii',position+4,position+8);
    if (!sawHeader) {
      if (chunk !== 'IHDR' || length !== 13) return false;
      const width = bytes.readUInt32BE(position+8);
      const height = bytes.readUInt32BE(position+12);
      if (width < 1 || width > 1024 || height < 1 || height > 1024) return false;
      if (bytes[position+18] !== 0 || bytes[position+19] !== 0 || bytes[position+20] !== 0) return false;
      sawHeader = true;
    } else if (chunk === 'IHDR') return false;
    if (chunk === 'IDAT') sawData = true;
    position += length + 12;
    if (chunk === 'IEND') return length === 0 && sawData && position === bytes.length;
  }
  return false;
}

