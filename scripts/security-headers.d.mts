export function buildSecurityHeaders(options?: {
  reportOnlyCsp?: string;
}): { key: string; value: string }[];

export function sentryCspReportUri(dsn: string | undefined): string;

export function originOf(value: string | undefined): string;
