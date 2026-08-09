export interface QualityInput {
  hasDialog: boolean;
  hasReadme: boolean;
  hasThumbnail: boolean;
  owner: string;
  status: string;
  version: string;
}

export interface QualityAssessment {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  missing: string[];
}

const checks: Array<{ key: keyof QualityInput; label: string; weight: number }> = [
  { key: 'hasDialog', label: 'author dialog', weight: 25 },
  { key: 'hasReadme', label: 'README documentation', weight: 20 },
  { key: 'hasThumbnail', label: 'thumbnail', weight: 15 },
  { key: 'owner', label: 'owner', weight: 15 },
  { key: 'status', label: 'lifecycle status', weight: 15 },
  { key: 'version', label: 'version', weight: 10 },
];

export function assessComponentQuality(input: QualityInput): QualityAssessment {
  let score = 0;
  const missing: string[] = [];
  for (const check of checks) {
    if (input[check.key]) {
      score += check.weight;
    } else {
      missing.push(check.label);
    }
  }
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { score, grade, missing };
}
