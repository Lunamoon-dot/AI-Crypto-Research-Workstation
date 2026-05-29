export function isResearchContinuityDebugEnabled(): boolean {
  return process.env.ENABLE_RESEARCH_CONTINUITY_DEBUG === 'true';
}
