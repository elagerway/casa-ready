export const successfulTargetSummary = {
  name: 'spa',
  outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z/spa',
  summaryMd: `# CASA Ready Scan Summary

Total findings: 2

## High Risk

### CSP Header Not Set

- CWE-693
- Confidence: 3
- Instances: 1

> Set the header.

## Low Risk

### HSTS Header Not Set

- CWE-319
- Confidence: 3
- Instances: 1

> Enable HSTS.
`,
};

export const successfulApiTargetSummary = {
  name: 'api',
  outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z/api',
  summaryMd: `# CASA Ready Scan Summary

Total findings: 1

## Medium Risk

### Missing API rate limit

- CWE-770
- Confidence: 2
- Instances: 5

> Add rate limiting.
`,
};

export const failedTarget = {
  name: 'api',
  outputDir: '/abs/scan-output/staging/2026-04-29T12-00-00Z/api',
  error: new Error('ZAP container exited with code 2'),
  stage: 'runZap',
};
