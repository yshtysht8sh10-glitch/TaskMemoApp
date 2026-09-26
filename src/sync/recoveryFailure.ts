/** Safe, content-free classifications for the shareable recovery diagnostic. */
export const recoveryFailureReasons = [
  "receipt-payload-mismatch", "receipt-acknowledgement-mismatch", "predicted-winner-mismatch",
  "permission-denied", "unauthenticated", "firestore-sdk-error", "unknown",
] as const;
export type RecoveryFailureReason = typeof recoveryFailureReasons[number];

const internalMessages: Record<string, string> = {
  "receipt-payload-mismatch": "An existing receipt has a different operation payload.",
  "receipt-acknowledgement-mismatch": "An existing receipt differs from the preflight acknowledgement.",
  "predicted-winner-mismatch": "The transaction winner differs from the preflight prediction.",
};

export function recoveryFailureDetails(reason: unknown) {
  const value = reason && typeof reason === "object" ? reason as Record<string, unknown> : {};
  const rawCode = typeof value.code === "string" ? value.code : typeof value.kind === "string" ? value.kind : "unknown";
  const errorCode = /^[a-z0-9/_-]{1,80}$/i.test(rawCode) ? rawCode : "unknown";
  const internal = typeof value.recoveryReason === "string" &&
    Object.prototype.hasOwnProperty.call(internalMessages, value.recoveryReason) ? value.recoveryReason : null;
  const failureReason: RecoveryFailureReason = (internal as RecoveryFailureReason | null) ||
    (errorCode.includes("permission-denied") ? "permission-denied" :
      errorCode.includes("unauthenticated") ? "unauthenticated" :
        (reason instanceof Error || value.firestoreSdkError === true) && errorCode !== "unknown" ?
          "firestore-sdk-error" : "unknown");
  // Never copy arbitrary SDK/user-supplied messages into sessionStorage or the shareable JSON.
  const errorMessage = internal ? internalMessages[internal] :
    failureReason === "permission-denied" ? "Firestore denied this recovery transaction." :
      failureReason === "unauthenticated" ? "Firebase authentication was unavailable during recovery." :
        failureReason === "firestore-sdk-error" ? "Firestore returned an error during recovery." :
          "Recovery stopped after an unclassified error.";
  return { errorCode, errorMessage, failureReason };
}
