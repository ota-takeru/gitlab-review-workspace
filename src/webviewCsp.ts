export function webviewContentSecurityPolicy(cspSource: string): string {
  return [
    "default-src 'none'",
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data: https:`,
    `script-src ${cspSource}`
  ].join("; ");
}
