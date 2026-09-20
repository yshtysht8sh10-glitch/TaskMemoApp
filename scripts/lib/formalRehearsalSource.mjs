export function assessFormalSourceInventory(source) {
  const profileCaptured = source.localProfileInventory?.complete === true
    && Array.isArray(source.legacyPinnedNoteCandidates);
  if (!profileCaptured) return {
    profileStatus: "NOT_CAPTURED",
    candidateCount: null,
    candidateStatus: "UNKNOWN",
    canRunFormalRehearsal: false,
    issues: [{
      kind: "missing-local-profile-inventory",
      nodeId: "profile",
      detail: "pinnedNote, ideasEnabled and legacyPinnedNoteCandidates are device-local in V1 and were not captured by the Firestore snapshot.",
    }],
  };
  const candidateCount = source.legacyPinnedNoteCandidates.length;
  return {
    profileStatus: "CAPTURED",
    candidateCount,
    candidateStatus: candidateCount ? "USER_ACTION_REQUIRED" : "CLEAR",
    canRunFormalRehearsal: candidateCount === 0,
    issues: candidateCount ? [{
      kind: "legacy-pinned-note-candidate",
      nodeId: "profile",
      detail: `${candidateCount} unresolved candidate(s) require explicit user action.`,
    }] : [],
  };
}
