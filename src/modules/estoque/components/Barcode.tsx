// Código de barras Code 39 em SVG (sem dependências). n = estreito, w = largo; barras e espaços alternados.
const PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn",
  "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw",
  C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn",
  I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
  O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
};

export function code39Supported(text: string) {
  return [...text.toUpperCase()].every((c) => c in PATTERNS && c !== "*");
}

export function Barcode({ value, height = 40 }: { value: string; height?: number }) {
  const text = value.toUpperCase();
  if (!code39Supported(text)) return <span className="font-mono text-xs">{value}</span>;
  const chars = ["*", ...text, "*"];
  const rects: { x: number; w: number }[] = [];
  let x = 0;
  const narrow = 1;
  const wide = 2.5;
  chars.forEach((c, ci) => {
    PATTERNS[c].split("").forEach((e, i) => {
      const w = e === "w" ? wide : narrow;
      if (i % 2 === 0) rects.push({ x, w });
      x += w;
    });
    if (ci < chars.length - 1) x += narrow; // espaço entre caracteres
  });
  return (
    <svg viewBox={`0 0 ${x} ${height}`} width={Math.min(x * 1.6, 260)} height={height} role="img" aria-label={`Código de barras ${value}`} preserveAspectRatio="none">
      {rects.map((r, i) => <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="black" />)}
    </svg>
  );
}
