export type ArtifactKind = 'java' | 'htl' | 'clientlib' | 'osgi' | 'content';

export interface GeneratedArtifact {
  absolutePath: string;
  content: string;
  kind: ArtifactKind;
}
