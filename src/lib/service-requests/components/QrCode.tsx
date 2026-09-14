import QRCode from "qrcode";

/**
 * QR-koodi SVG:nä palvelimella. Sisältö on sovelluksen itse muodostama
 * osoite, ja SVG tulee qrcode-kirjastolta, joten upotus on turvallinen.
 */
export async function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1b2a41", light: "#ffffff" } });
  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-lg border border-line bg-white [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
