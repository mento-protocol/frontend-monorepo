"use client";

import { useState, useMemo } from "react";
import { formatUsd, formatPercent } from "@/lib/format";

export type SunburstNode = {
  id: string;
  label: string;
  // Optional override: if not provided, computed as sum of children's values.
  value: number;
  // Optional explicit color for ring 0 (inner ring) nodes; child rings
  // lighten the parent color to keep visual lineage.
  color?: string;
  children?: SunburstNode[];
};

type Slice = {
  id: string;
  label: string;
  value: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  fill: string;
  depth: number;
  pathFromRoot: string[];
};

type SunburstChartProps = {
  data: SunburstNode[];
  // Sum used for the percentage in the tooltip / center label.
  total: number;
  size?: number;
  centerLabel?: string;
  // Controlled hover (sync with sibling components like a table). When
  // provided, the chart defers hover state to the parent.
  hoverId?: string | null;
  onHoverChange?: (id: string | null) => void;
};

const DEFAULT_PALETTE = [
  "#66FFB8",
  "#3D42CD",
  "#7006FC",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f43f5e",
];

// Build flat slice list in a single pass, computing angles per ring.
function buildSlices(
  nodes: SunburstNode[],
  total: number,
  ringWidth: number,
  centerHole: number,
): Slice[] {
  const slices: Slice[] = [];

  function walk(
    items: SunburstNode[],
    startAngle: number,
    depth: number,
    parentColor: string | null,
    parentPath: string[],
  ): number {
    let cursor = startAngle;
    const siblingCount = items.length;
    items.forEach((node, idx) => {
      const fraction = total > 0 ? node.value / total : 0;
      const sweep = fraction * Math.PI * 2;
      const inner = centerHole + depth * ringWidth;
      const outer = inner + ringWidth;
      const fill =
        node.color ??
        (parentColor
          ? deriveChildColor(parentColor, idx, siblingCount, depth)
          : DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length]!);
      const path = [...parentPath, node.label];
      slices.push({
        id: node.id,
        label: node.label,
        value: node.value,
        startAngle: cursor,
        endAngle: cursor + sweep,
        innerRadius: inner,
        outerRadius: outer,
        fill,
        depth,
        pathFromRoot: path,
      });
      if (node.children?.length) {
        walk(node.children, cursor, depth + 1, fill, path);
      }
      cursor += sweep;
    });
    return cursor;
  }

  walk(nodes, -Math.PI / 2, 0, null, []);
  return slices;
}

// Spread sibling colors around the parent's hue to keep them visually
// related but distinguishable. Inner rings drift slightly lighter so
// outer rings (the actionable leaves) stay vivid.
function deriveChildColor(
  parentHex: string,
  siblingIndex: number,
  siblingCount: number,
  depth: number,
): string {
  const hsl = hexToHsl(parentHex);
  if (!hsl) return parentHex;
  const center = (siblingCount - 1) / 2;
  const offset = siblingCount > 1 ? siblingIndex - center : 0;
  const hueSpread = Math.min(48, 18 + siblingCount * 4);
  const stepDegrees = siblingCount > 1 ? hueSpread / siblingCount : 0;
  const newHue = (hsl.h + offset * stepDegrees + 360) % 360;
  const lightnessShift = Math.min(18, depth * 6);
  const newLightness = Math.max(28, Math.min(72, hsl.l + lightnessShift));
  const saturation = Math.max(35, hsl.s - depth * 4);
  return hslToHex({ h: newHue, s: saturation, l: newLightness });
}

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl | null {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
    }
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hPrime < 1) [r, g, b] = [c, x, 0];
  else if (hPrime < 2) [r, g, b] = [x, c, 0];
  else if (hPrime < 3) [r, g, b] = [0, c, x];
  else if (hPrime < 4) [r, g, b] = [0, x, c];
  else if (hPrime < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lNorm - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function arcPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  // Guard against full-circle wrap which renders as zero with two arcs.
  const sweep = endAngle - startAngle;
  const epsilon = 0.0001;
  if (sweep < epsilon) return "";

  if (sweep >= Math.PI * 2 - epsilon) {
    // Render as two half-arcs for a complete ring.
    const midAngle = startAngle + Math.PI;
    return [
      arcPath(cx, cy, innerRadius, outerRadius, startAngle, midAngle - epsilon),
      arcPath(cx, cy, innerRadius, outerRadius, midAngle, endAngle - epsilon),
    ].join(" ");
  }

  const largeArc = sweep > Math.PI ? 1 : 0;
  const x1 = cx + outerRadius * Math.cos(startAngle);
  const y1 = cy + outerRadius * Math.sin(startAngle);
  const x2 = cx + outerRadius * Math.cos(endAngle);
  const y2 = cy + outerRadius * Math.sin(endAngle);
  const x3 = cx + innerRadius * Math.cos(endAngle);
  const y3 = cy + innerRadius * Math.sin(endAngle);
  const x4 = cx + innerRadius * Math.cos(startAngle);
  const y4 = cy + innerRadius * Math.sin(startAngle);
  return [
    `M ${x1} ${y1}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export function SunburstChart({
  data,
  total,
  size = 360,
  centerLabel,
  hoverId: controlledHoverId,
  onHoverChange,
}: SunburstChartProps) {
  const [uncontrolledHoverId, setUncontrolledHoverId] = useState<string | null>(
    null,
  );
  const isControlled = controlledHoverId !== undefined;
  const hoverId = isControlled ? controlledHoverId : uncontrolledHoverId;
  const setHoverId = (id: string | null) => {
    if (!isControlled) setUncontrolledHoverId(id);
    onHoverChange?.(id);
  };

  const depth = useMemo(() => maxDepth(data), [data]);
  const center = size / 2;
  const centerHole = size * 0.12;
  const ringWidth = (size / 2 - centerHole - 8) / Math.max(depth, 1);

  const slices = useMemo(
    () => buildSlices(data, total, ringWidth, centerHole),
    [data, total, ringWidth, centerHole],
  );

  const hovered = slices.find((s) => s.id === hoverId);

  const isInHoverBranch = (sliceId: string): boolean => {
    if (!hoverId) return true;
    if (sliceId === hoverId) return true;
    if (sliceId.startsWith(`${hoverId}:`)) return true;
    if (hoverId.startsWith(`${sliceId}:`)) return true;
    return false;
  };

  return (
    <div className="relative inline-block">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Collateral hierarchy sunburst"
      >
        {slices.map((s) => {
          const path = arcPath(
            center,
            center,
            s.innerRadius,
            s.outerRadius,
            s.startAngle,
            s.endAngle,
          );
          if (!path) return null;
          const inBranch = isInHoverBranch(s.id);
          return (
            <path
              key={s.id}
              d={path}
              fill={s.fill}
              stroke="#15111b"
              strokeWidth={1}
              opacity={hoverId && !inBranch ? 0.25 : 1}
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{ cursor: "pointer", transition: "opacity 120ms" }}
            />
          );
        })}
        {slices.map((s) => {
          const sweep = s.endAngle - s.startAngle;
          const ringMid = (s.innerRadius + s.outerRadius) / 2;
          const ringSpan = s.outerRadius - s.innerRadius;
          // Only render a label when the arc is wide enough that the
          // text won't overflow its slice. ~14px glyph * label length
          // approximates the chord length we have available.
          const approxChord = sweep * ringMid;
          const labelText = sliceLabelText(s, approxChord);
          if (!labelText) return null;
          const inBranch = isInHoverBranch(s.id);
          const midAngle = (s.startAngle + s.endAngle) / 2;
          const x = center + ringMid * Math.cos(midAngle);
          const y = center + ringMid * Math.sin(midAngle);
          // Rotate so text follows the arc direction; flip on the
          // bottom half so it stays right-reading.
          let rotation = (midAngle * 180) / Math.PI + 90;
          if (rotation > 90 && rotation < 270) rotation -= 180;
          const fontSize = Math.min(12, Math.max(9, ringSpan * 0.32));
          return (
            <text
              key={`label:${s.id}`}
              x={x}
              y={y}
              transform={`rotate(${rotation}, ${x}, ${y})`}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
              fill={readableTextColor(s.fill)}
              opacity={hoverId && !inBranch ? 0.2 : 0.95}
              style={{
                fontSize,
                fontWeight: s.depth === 0 ? 600 : 500,
                transition: "opacity 120ms",
              }}
            >
              {labelText}
            </text>
          );
        })}
        <text
          x={center}
          y={center - 6}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 11 }}
        >
          {centerLabel ?? "Total"}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 14, fontWeight: 600 }}
        >
          {formatUsd(total, true)}
        </text>
      </svg>
      {hovered && (
        <div
          role="tooltip"
          className="px-3 py-2 top-2 rounded text-xs shadow-md pointer-events-none absolute left-1/2 -translate-x-1/2 border border-[var(--border)] bg-popover text-popover-foreground"
        >
          <div className="font-medium">{hovered.pathFromRoot.join(" / ")}</div>
          <div className="text-muted-foreground">
            {formatUsd(hovered.value)}
            {total > 0 && ` (${formatPercent((hovered.value / total) * 100)})`}
          </div>
        </div>
      )}
    </div>
  );
}

function maxDepth(nodes: SunburstNode[], current = 1): number {
  let depth = current;
  for (const n of nodes) {
    if (n.children?.length) {
      depth = Math.max(depth, maxDepth(n.children, current + 1));
    }
  }
  return depth;
}

function sliceLabelText(slice: Slice, chord: number): string | null {
  if (chord < 28) return null;
  // Estimate ~6px per glyph at the resolved font size; trim to fit.
  const maxChars = Math.max(3, Math.floor(chord / 6));
  if (slice.label.length <= maxChars) return slice.label;
  return `${slice.label.slice(0, Math.max(1, maxChars - 1))}\u2026`;
}

function readableTextColor(hex: string): string {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return "#0b0a10";
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  // Relative luminance — pick dark text on light fills, light on dark.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0b0a10" : "#f7f6fa";
}
